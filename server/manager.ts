import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EditorInstall, OpenResult, ProjectListItem, ProjectStatus, UnityProject } from "../shared/contracts";
import type { UnitySettings } from "../shared/settings";
import { listEditors, listHubProjects, resolveEditor } from "./editors";
import { exists, expandHome } from "./fsutil";
import { launchDetached } from "./launch";
import { findUnityCli, isLiveEditor, liveProjectKeys } from "./live";
import { editorsForProject, forgetRunningEditors, listRunningEditors, samePathKey } from "./processes";
import { cloneInfo, findProjectsBelow, gitSummary, isUnityProject, readPackages, readProject, requireProject } from "./project";

const ROOT_SCAN_DEPTH = 3;

export async function projectStatus(projectPath: string, settings: UnitySettings): Promise<ProjectStatus> {
  const project = await requireProject(projectPath);
  const [editor, running, lockfile, liveEditor, clone, git, packages] = await Promise.all([
    resolveEditor(project.editorVersion, settings.editorRoots),
    editorsForProject(project.path),
    exists(join(project.path, "Temp", "UnityLockfile")),
    settings.useUnityCli ? isLiveEditor(project.path) : Promise.resolve(false),
    cloneInfo(project.path),
    gitSummary(project.path),
    readPackages(project.path),
  ]);
  return { project, editor, running, lockfile, liveEditor, clone, git, packages };
}

export async function listProjects(paseo: PluginHandlerContext["paseo"], settings: UnitySettings): Promise<{ projects: ProjectListItem[]; editors: EditorInstall[]; cliAvailable: boolean }> {
  const candidates = new Map<string, { sources: Set<ProjectListItem["sources"][number]>; lastModified: number | null }>();
  const add = (path: string, source: ProjectListItem["sources"][number], lastModified: number | null = null) => {
    const key = samePathKey(path);
    const current = candidates.get(key) ?? { sources: new Set(), lastModified: null };
    current.sources.add(source);
    current.lastModified = Math.max(current.lastModified ?? 0, lastModified ?? 0) || null;
    candidates.set(key, current);
  };

  const [hubProjects, workspaceDirectories, scanned] = await Promise.all([
    listHubProjects(),
    paseoDirectories(paseo),
    Promise.all(settings.projectRoots.map((root) => findProjectsBelow(resolve(expandHome(root)), ROOT_SCAN_DEPTH))),
  ]);
  for (const project of hubProjects) add(project.path, "hub", project.lastModified);
  for (const directory of workspaceDirectories) {
    for (const path of await findProjectsBelow(directory, 2)) add(path, "paseo");
  }
  for (const path of scanned.flat()) add(path, "scan");

  const [editors, running, live, cli] = await Promise.all([
    listEditors(settings.editorRoots),
    listRunningEditors(),
    settings.useUnityCli ? liveProjectKeys() : Promise.resolve(new Set<string>()),
    findUnityCli(),
  ]);
  const openKeys = new Set([...running.map((editor) => samePathKey(editor.projectPath)), ...live]);
  const installed = new Set(editors.map((editor) => editor.version));

  const projects = await Promise.all(
    [...candidates.entries()].map(async ([key, candidate]): Promise<ProjectListItem> => {
      const missing = !(await isUnityProject(key));
      const project: UnityProject = missing ? { path: key, name: key.split(/[\\/]/u).pop() ?? key, productName: null, editorVersion: null } : await readProject(key);
      return {
        ...project,
        sources: [...candidate.sources].sort(),
        editorInstalled: project.editorVersion !== null && installed.has(project.editorVersion),
        open: openKeys.has(key),
        missing,
        lastModified: candidate.lastModified ?? (missing ? null : await modifiedAt(key)),
      };
    }),
  );
  projects.sort((left, right) => Number(right.open) - Number(left.open) || (right.lastModified ?? 0) - (left.lastModified ?? 0) || left.name.localeCompare(right.name));
  return { projects, editors, cliAvailable: cli !== null };
}

async function paseoDirectories(paseo: PluginHandlerContext["paseo"]): Promise<string[]> {
  try {
    const directories = new Set<string>();
    let cursor: string | undefined;
    // The daemon caps pages at 200 workspaces; five pages cover any realistic host.
    for (let pageIndex = 0; pageIndex < 5; pageIndex += 1) {
      const page = await paseo.workspaces.list({ page: cursor === undefined ? { limit: 200 } : { limit: 200, cursor } });
      for (const workspace of page.entries) {
        directories.add(workspace.projectRootPath);
        if (workspace.workspaceDirectory) directories.add(workspace.workspaceDirectory);
      }
      if (!page.pageInfo.hasMore || page.pageInfo.nextCursor === null) break;
      cursor = page.pageInfo.nextCursor;
    }
    return [...directories];
  } catch (error) {
    console.error("[unity-workspace] could not list Paseo workspaces", error);
    return [];
  }
}

async function modifiedAt(projectPath: string): Promise<number | null> {
  try {
    return (await stat(join(projectPath, "ProjectSettings", "ProjectVersion.txt"))).mtimeMs;
  } catch {
    return null;
  }
}

export async function openProject(projectPath: string, editorVersion: string | undefined, settings: UnitySettings, extraArgs: readonly string[] = []): Promise<OpenResult> {
  const project = await requireProject(projectPath);
  const running = await editorsForProject(project.path);
  if (running.length > 0) {
    const holder = running[0];
    return {
      status: "already-open",
      pid: holder?.pid ?? null,
      message: holder?.batchmode ? `Um processo Unity em batch mode (PID ${holder.pid}) está usando ${project.name}.` : `${project.name} já está aberto no Unity (PID ${holder?.pid ?? "?"}).`,
    };
  }
  const editor = await requireEditor(editorVersion ?? project.editorVersion, settings);
  const pid = await launchDetached(editor.executable, ["-projectPath", project.path, ...extraArgs], project.path);
  forgetRunningEditors();
  return { status: "launched", pid, message: `Abrindo ${project.name} com Unity ${editor.version}.` };
}

export async function requireEditor(version: string | null, settings: UnitySettings): Promise<EditorInstall> {
  if (version === null) throw new Error("Não foi possível ler a versão do editor em ProjectSettings/ProjectVersion.txt.");
  const editor = await resolveEditor(version, settings.editorRoots);
  if (editor === null) throw new Error(`Unity ${version} não está instalado. Instale pelo Unity Hub (ou \`unity install ${version}\`) ou adicione a pasta do editor nas configurações do plugin.`);
  return editor;
}

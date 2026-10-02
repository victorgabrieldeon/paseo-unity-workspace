import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { OpenResult, Scene } from "../shared/contracts";
import type { UnitySettings } from "../shared/settings";
import { exists, isInside, readTextOrNull } from "./fsutil";
import { csharpString, isLiveEditor, liveEval } from "./live";
import { openProject } from "./manager";
import { editorsForProject } from "./processes";
import { requireProject } from "./project";

const MAX_SCENES = 2_000;

export type BuildSceneEntry = { path: string; enabled: boolean };

export function parseBuildScenes(text: string): BuildSceneEntry[] {
  const lines = text.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s*m_Scenes:/u.test(line));
  if (start < 0) return [];
  const scenes: BuildSceneEntry[] = [];
  let current: { enabled: boolean; path: string | null } | null = null;
  const flush = () => {
    if (current?.path) scenes.push({ path: current.path, enabled: current.enabled });
  };
  for (const line of lines.slice(start + 1)) {
    if (/^\s*m_\w+:/u.test(line)) break;
    const enabled = /^\s*-\s*enabled:\s*(\d)/u.exec(line);
    if (enabled !== null) {
      flush();
      current = { enabled: enabled[1] === "1", path: null };
      continue;
    }
    const path = /^\s*path:\s*(.+?)\s*$/u.exec(line);
    if (path?.[1] !== undefined && current !== null) current.path = path[1];
  }
  flush();
  return scenes;
}

export function parseActiveScene(text: string): string | null {
  const setups = text.split(/^-\s+path:\s*/mu).slice(1);
  const active = setups.find((setup) => /isActive:\s*1/u.test(setup)) ?? setups[0];
  return active?.split(/\r?\n/u)[0]?.trim() || null;
}

export function sceneSetupYaml(scenePath: string): string {
  return `sceneSetups:\n- path: ${scenePath}\n  isLoaded: 1\n  isActive: 1\n  isSubScene: 0\n`;
}

export async function listScenes(projectPath: string): Promise<{ scenes: Scene[]; lastOpened: string | null }> {
  const project = await requireProject(projectPath);
  const [buildText, setupText, files] = await Promise.all([
    readTextOrNull(join(project.path, "ProjectSettings", "EditorBuildSettings.asset")),
    readTextOrNull(join(project.path, "Library", "LastSceneManagerSetup.txt")),
    findSceneFiles(join(project.path, "Assets"), "Assets"),
  ]);
  const build = buildText === null ? [] : parseBuildScenes(buildText);
  const buildIndex = new Map(build.map((entry, index) => [entry.path, { index, enabled: entry.enabled }]));
  const scenes = files.map((path): Scene => {
    const inBuild = buildIndex.get(path);
    return { path, name: sceneName(path), group: path.split("/")[1] ?? "Assets", buildIndex: inBuild?.index ?? null, enabled: inBuild?.enabled ?? false };
  });
  scenes.sort((left, right) => (left.buildIndex ?? Number.MAX_SAFE_INTEGER) - (right.buildIndex ?? Number.MAX_SAFE_INTEGER) || left.path.localeCompare(right.path));
  return { scenes, lastOpened: setupText === null ? null : parseActiveScene(setupText) };
}

async function findSceneFiles(directory: string, relative: string, found: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.length >= MAX_SCENES) break;
    // Unity ignores hidden folders and folders ending in "~"; nested symlinks are skipped to avoid loops.
    if (entry.name.startsWith(".") || entry.name.endsWith("~") || entry.isSymbolicLink()) continue;
    const childRelative = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await findSceneFiles(join(directory, entry.name), childRelative, found);
    else if (entry.isFile() && entry.name.endsWith(".unity")) found.push(childRelative);
  }
  return found;
}

function sceneName(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.unity$/u, "");
}

export async function openScene(projectPath: string, scenePath: string, settings: UnitySettings): Promise<OpenResult> {
  const project = await requireProject(projectPath);
  if (!/^Assets\/.+\.unity$/u.test(scenePath) || scenePath.split("/").includes("..")) throw new Error(`Cena inválida: ${scenePath}`);
  const absolute = resolve(project.path, scenePath);
  if (!isInside(join(project.path, "Assets"), absolute) || !(await exists(absolute))) throw new Error(`Cena não encontrada: ${scenePath}`);

  const running = await editorsForProject(project.path);
  if (running.length > 0) {
    if (settings.useUnityCli && (await isLiveEditor(project.path))) return openSceneLive(project.path, scenePath);
    throw new Error(
      `${project.name} já está aberto no Unity. Para trocar de cena pelo Paseo com o Editor aberto, instale a Unity CLI e o pacote com.unity.pipeline; ou feche o Editor e tente de novo.`,
    );
  }

  // Unity restores the scenes listed here when it opens the project.
  await mkdir(join(project.path, "Library"), { recursive: true });
  await writeFile(join(project.path, "Library", "LastSceneManagerSetup.txt"), sceneSetupYaml(scenePath), "utf8");
  const result = await openProject(project.path, undefined, settings);
  return { ...result, message: `Abrindo ${project.name} na cena ${sceneName(scenePath)}.` };
}

async function openSceneLive(projectPath: string, scenePath: string): Promise<OpenResult> {
  const code = [
    "if (UnityEditor.EditorApplication.isPlayingOrWillChangePlaymode) return \"playing\";",
    "if (!UnityEditor.SceneManagement.EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return \"cancelled\";",
    `UnityEditor.SceneManagement.EditorSceneManager.OpenScene(${csharpString(scenePath)}, UnityEditor.SceneManagement.OpenSceneMode.Single);`,
    "return \"opened\";",
  ].join(" ");
  const output = await liveEval(projectPath, code, 120);
  if (output.includes("playing")) throw new Error("O Editor está em Play Mode. Saia do Play Mode para trocar de cena.");
  if (output.includes("cancelled")) return { status: "live", pid: null, message: "Troca de cena cancelada no Editor." };
  if (!output.includes("opened")) throw new Error(`O Editor não confirmou a abertura da cena: ${output.slice(0, 300)}`);
  return { status: "live", pid: null, message: `${sceneName(scenePath)} aberta no Editor.` };
}

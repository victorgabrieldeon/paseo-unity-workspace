import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { EditorInstall } from "../shared/contracts";
import { exists, expandHome, isDirectory, readJsonOrNull } from "./fsutil";

type Platform = NodeJS.Platform;

export function hubConfigDirectories(platform: Platform = process.platform): string[] {
  if (platform === "darwin") return [join(homedir(), "Library", "Application Support", "UnityHub")];
  if (platform === "win32") return [join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "UnityHub")];
  return [join(homedir(), ".config", "unityhub"), join(homedir(), ".config", "UnityHub")];
}

function defaultEditorRoots(platform: Platform): string[] {
  if (platform === "darwin") return ["/Applications/Unity/Hub/Editor"];
  if (platform === "win32") return [join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Unity", "Hub", "Editor")];
  return [join(homedir(), "Unity", "Hub", "Editor")];
}

export function editorExecutable(versionDirectory: string, platform: Platform = process.platform): string {
  if (platform === "darwin") return join(versionDirectory, "Unity.app", "Contents", "MacOS", "Unity");
  if (platform === "win32") return join(versionDirectory, "Editor", "Unity.exe");
  return join(versionDirectory, "Editor", "Unity");
}

function playbackEngineDirectories(versionDirectory: string, platform: Platform): string[] {
  if (platform === "darwin") return [join(versionDirectory, "PlaybackEngines"), join(versionDirectory, "Unity.app", "Contents", "PlaybackEngines")];
  return [join(versionDirectory, "Editor", "Data", "PlaybackEngines")];
}

async function hubInstallRoots(): Promise<string[]> {
  const roots: string[] = [];
  for (const directory of hubConfigDirectories()) {
    const secondary = await readJsonOrNull(join(directory, "secondaryInstallPath.json"));
    if (typeof secondary === "string" && secondary.trim() !== "") roots.push(secondary.trim());
  }
  return roots;
}

/** Editors installed by Unity Hub (default and secondary folders) plus user-configured roots. */
export async function listEditors(extraRoots: readonly string[] = []): Promise<EditorInstall[]> {
  const platform = process.platform;
  const roots = [...extraRoots.map(expandHome), ...(await hubInstallRoots()), ...defaultEditorRoots(platform)].map((root) => resolve(root));
  const editors = new Map<string, EditorInstall>();
  for (const root of new Set(roots)) {
    if (!(await isDirectory(root))) continue;
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || editors.has(entry.name)) continue;
      const versionDirectory = join(root, entry.name);
      const executable = editorExecutable(versionDirectory, platform);
      if (!(await exists(executable))) continue;
      editors.set(entry.name, { version: entry.name, executable, modules: await listModules(versionDirectory, platform) });
    }
  }
  return [...editors.values()].sort((left, right) => compareVersions(right.version, left.version));
}

async function listModules(versionDirectory: string, platform: Platform): Promise<string[]> {
  const modules = new Set<string>();
  for (const directory of playbackEngineDirectories(versionDirectory, platform)) {
    if (!(await isDirectory(directory))) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) modules.add(entry.name);
    }
  }
  return [...modules].sort();
}

export async function resolveEditor(version: string | null, extraRoots: readonly string[] = []): Promise<EditorInstall | null> {
  if (version === null) return null;
  return (await listEditors(extraRoots)).find((editor) => editor.version === version) ?? null;
}

export function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, "en", { numeric: true });
}

export type HubProject = { path: string; title: string | null; version: string | null; lastModified: number | null };

/** Projects registered in the Unity Hub list (`projects-v1.json`). */
export async function listHubProjects(): Promise<HubProject[]> {
  const projects = new Map<string, HubProject>();
  for (const directory of hubConfigDirectories()) {
    const file = await readJsonOrNull(join(directory, "projects-v1.json"));
    for (const project of parseHubProjects(file)) {
      if (!projects.has(project.path)) projects.set(project.path, project);
    }
  }
  return [...projects.values()];
}

export function parseHubProjects(file: unknown): HubProject[] {
  if (typeof file !== "object" || file === null) return [];
  const data = "data" in file && typeof file.data === "object" && file.data !== null ? file.data : file;
  const projects: HubProject[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    const path = typeof record["path"] === "string" ? record["path"] : key;
    projects.push({
      path: resolve(path),
      title: typeof record["title"] === "string" ? record["title"] : null,
      version: typeof record["version"] === "string" ? record["version"] : null,
      lastModified: typeof record["lastModified"] === "number" ? record["lastModified"] : null,
    });
  }
  return projects;
}

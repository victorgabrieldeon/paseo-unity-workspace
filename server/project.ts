import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProjectPackages, UnityProject } from "../shared/contracts";
import { exists, isDirectory, readJsonOrNull, readTextOrNull } from "./fsutil";

const execFileAsync = promisify(execFile);
const SKIPPED_DIRECTORIES = new Set(["Library", "Temp", "Logs", "obj", "Builds", "node_modules", "Packages", "Assets", "UserSettings"]);

export const CLONE_MARKER = ".clone";
export const CLONE_ARGUMENT_FILE = ".parrelsyncarg";
const CLONE_SUFFIX = /^(.*)_clone_(\d+)$/u;

export function parseProjectVersion(text: string): string | null {
  return /^m_EditorVersion:\s*(\S+)/mu.exec(text)?.[1] ?? null;
}

export function parseProductName(text: string): string | null {
  const name = /^[ \t]*productName:[ \t]*(.*?)[ \t]*$/mu.exec(text)?.[1];
  return name === undefined || name === "" ? null : name.replace(/^["']|["']$/gu, "");
}

export async function isUnityProject(path: string): Promise<boolean> {
  return (await exists(join(path, "ProjectSettings", "ProjectVersion.txt"))) && (await isDirectory(join(path, "Assets")));
}

export async function readProject(path: string): Promise<UnityProject> {
  const root = resolve(path);
  const versionText = await readTextOrNull(join(root, "ProjectSettings", "ProjectVersion.txt"));
  const settingsText = await readTextOrNull(join(root, "ProjectSettings", "ProjectSettings.asset"));
  return {
    path: root,
    name: basename(root),
    productName: settingsText === null ? null : parseProductName(settingsText),
    editorVersion: versionText === null ? null : parseProjectVersion(versionText),
  };
}

/** Validates an RPC-supplied project path before any filesystem or process work touches it. */
export async function requireProject(path: string): Promise<UnityProject> {
  const root = resolve(path);
  if (!(await isUnityProject(root))) throw new Error(`${root} não é um projeto Unity (ProjectSettings/ProjectVersion.txt ou Assets ausente).`);
  return readProject(root);
}

/** The Unity project containing `directory`, or the projects nested up to two levels below it. */
export async function detectProjects(directory: string): Promise<UnityProject[]> {
  const start = resolve(directory);
  for (let current = start; ; current = dirname(current)) {
    if (await isUnityProject(current)) return [await readProject(current)];
    if (dirname(current) === current) break;
  }
  const found = await findProjectsBelow(start, 2);
  return Promise.all(found.sort().map(readProject));
}

export async function findProjectsBelow(root: string, depth: number): Promise<string[]> {
  if (depth < 0 || !(await isDirectory(root))) return [];
  if (await isUnityProject(root)) return [root];
  if (depth === 0) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const children = entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIPPED_DIRECTORIES.has(entry.name));
  const nested = await Promise.all(children.map((entry) => findProjectsBelow(join(root, entry.name), depth - 1)));
  return nested.flat();
}

export async function readPackages(projectPath: string): Promise<ProjectPackages> {
  const manifest = await readJsonOrNull(join(projectPath, "Packages", "manifest.json"));
  const dependencies = manifestDependencies(manifest);
  return {
    parrelsync: dependencies.has("com.veriorpies.parrelsync"),
    multiplayerPlayMode: dependencies.has("com.unity.multiplayer.playmode"),
    netcode: dependencies.has("com.unity.netcode.gameobjects") || dependencies.has("com.unity.netcode"),
    pipeline: dependencies.has("com.unity.pipeline"),
  };
}

function manifestDependencies(manifest: unknown): Set<string> {
  if (typeof manifest !== "object" || manifest === null || !("dependencies" in manifest)) return new Set();
  const dependencies = manifest.dependencies;
  return typeof dependencies === "object" && dependencies !== null ? new Set(Object.keys(dependencies)) : new Set();
}

/** ParrelSync clone identity: `<original>_clone_<n>` with a `.clone` marker in its root. */
export async function cloneInfo(projectPath: string): Promise<{ index: number; originalPath: string } | null> {
  const match = CLONE_SUFFIX.exec(resolve(projectPath));
  if (match === null || !(await exists(join(projectPath, CLONE_MARKER)))) return null;
  return { index: Number(match[2]), originalPath: match[1] ?? projectPath };
}

export async function gitSummary(projectPath: string): Promise<{ branch: string | null; commit: string | null } | null> {
  try {
    const [{ stdout: branch }, { stdout: commit }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: projectPath, timeout: 4_000 }),
      execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: projectPath, timeout: 4_000 }),
    ]);
    return { branch: branch.trim() || null, commit: commit.trim() || null };
  } catch {
    return null;
  }
}

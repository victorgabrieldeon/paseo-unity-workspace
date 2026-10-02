import { cp, lstat, mkdir, readdir, readFile, rm, rmdir, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { Clone, Job } from "../shared/contracts";
import type { UnitySettings } from "../shared/settings";
import { formatBytes } from "../shared/format";
import { errorMessage, exists, isDirectory, isMissing, pathSize, readJsonOrNull } from "./fsutil";
import { appendLog, createJob, finishJob, runningJob, snapshot } from "./jobs";
import { launchDetached } from "./launch";
import { requireEditor } from "./manager";
import { editorsForProject, forgetRunningEditors, listRunningEditors, samePathKey } from "./processes";
import { CLONE_ARGUMENT_FILE, CLONE_MARKER, cloneInfo, readPackages, readProject, requireProject } from "./project";

export const MAX_CLONES = 10;
const DEFAULT_ARGUMENT = "client";
const LINKED_FOLDERS = ["Assets", "ProjectSettings", "AutoBuild", "LocalPackages"];
const COPIED_FOLDERS = ["Packages"];
const LIBRARY_SKIP = /(-lock|\.pid)$/u;
export const PARRELSYNC_PACKAGE = "com.veriorpies.parrelsync";
export const PARRELSYNC_URL = "https://github.com/VeriorPies/ParrelSync.git?path=/ParrelSync";

/** Resolves the original project of a clone family; clones are always managed from it. */
async function family(projectPath: string): Promise<{ originalPath: string; isClone: boolean }> {
  const project = await requireProject(projectPath);
  const clone = await cloneInfo(project.path);
  if (clone === null) return { originalPath: project.path, isClone: false };
  await requireProject(clone.originalPath);
  return { originalPath: resolve(clone.originalPath), isClone: true };
}

export function clonePathFor(originalPath: string, index: number): string {
  return `${resolve(originalPath)}_clone_${index}`;
}

export async function listClones(projectPath: string) {
  const { originalPath, isClone } = await family(projectPath);
  const [running, packages] = await Promise.all([listRunningEditors(), readPackages(originalPath)]);
  const openKeys = new Set(running.map((editor) => samePathKey(editor.projectPath)));
  const clones: Clone[] = [];
  const prefix = `${basename(originalPath)}_clone_`;
  for (const entry of await readdir(dirname(originalPath), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue;
    const index = Number(entry.name.slice(prefix.length));
    const path = join(dirname(originalPath), entry.name);
    if (!Number.isInteger(index) || !(await exists(join(path, CLONE_MARKER)))) continue;
    clones.push(await describeClone(path, index, openKeys));
  }
  clones.sort((left, right) => left.index - right.index);
  return { originalPath, isClone, originalOpen: openKeys.has(samePathKey(originalPath)), packages, clones };
}

async function describeClone(path: string, index: number, openKeys: Set<string>): Promise<Clone> {
  const brokenLinks: string[] = [];
  for (const folder of ["Assets", "ProjectSettings"]) {
    if (!(await isDirectory(join(path, folder)))) brokenLinks.push(folder);
  }
  return { index, path, argument: await readArgument(path), open: openKeys.has(samePathKey(path)), brokenLinks };
}

async function readArgument(clonePath: string): Promise<string> {
  try {
    return (await readFile(join(clonePath, CLONE_ARGUMENT_FILE), "utf8")).replace(/^﻿/u, "").trim() || DEFAULT_ARGUMENT;
  } catch (error) {
    if (isMissing(error)) return DEFAULT_ARGUMENT;
    throw error;
  }
}

/** A clone path is accepted only when it is `<original>_clone_<n>` with the ParrelSync marker. */
async function requireClone(originalPath: string, clonePath: string): Promise<{ path: string; index: number }> {
  const path = resolve(clonePath);
  const match = /_clone_(\d+)$/u.exec(path);
  const index = match === null ? -1 : Number(match[1]);
  if (index < 0 || samePathKey(clonePathFor(originalPath, index)) !== samePathKey(path) || !(await exists(join(path, CLONE_MARKER)))) {
    throw new Error(`${path} não é um clone ParrelSync de ${basename(originalPath)}.`);
  }
  return { path, index };
}

export async function createClone(projectPath: string, copyLibrary: boolean): Promise<Job> {
  const { originalPath } = await family(projectPath);
  const busy = runningJob(originalPath);
  if (busy !== null) throw new Error(`Já existe uma tarefa em andamento neste projeto: ${busy.job.title}.`);
  let index = -1;
  for (let candidate = 0; candidate < MAX_CLONES; candidate += 1) {
    if (!(await exists(clonePathFor(originalPath, candidate)))) {
      index = candidate;
      break;
    }
  }
  if (index < 0) throw new Error(`Limite de ${MAX_CLONES} clones atingido (mesmo limite do ParrelSync).`);
  const clonePath = clonePathFor(originalPath, index);
  const record = createJob("clone", originalPath, `Clone ${index}`, { artifactPath: clonePath });
  let cancelled = false;
  record.onCancel = () => {
    cancelled = true;
  };

  void (async () => {
    try {
      await mkdir(clonePath);
      for (const folder of COPIED_FOLDERS) {
        if (!(await exists(join(originalPath, folder)))) continue;
        appendLog(record, `Copiando ${folder}/`);
        await cp(join(originalPath, folder), join(clonePath, folder), { recursive: true, verbatimSymlinks: true });
      }
      if (copyLibrary && (await isDirectory(join(originalPath, "Library")))) {
        const total = await pathSize(join(originalPath, "Library"));
        appendLog(record, `Copiando Library/ (${formatBytes(total)}). O primeiro Editor do clone abre sem reimportar.`);
        let copied = 0;
        await mkdir(join(clonePath, "Library"));
        for (const entry of await readdir(join(originalPath, "Library"), { withFileTypes: true })) {
          if (cancelled) throw new CancelledError();
          if (LIBRARY_SKIP.test(entry.name)) continue;
          const source = join(originalPath, "Library", entry.name);
          await cp(source, join(clonePath, "Library", entry.name), { recursive: true, verbatimSymlinks: true });
          copied += await pathSize(source);
          if (total > 0) appendLog(record, `Library ${Math.min(100, Math.round((copied / total) * 100))}% · ${entry.name}`);
        }
      }
      if (cancelled) throw new CancelledError();
      for (const folder of LINKED_FOLDERS) {
        if (!(await exists(join(originalPath, folder)))) continue;
        await symlink(join(originalPath, folder), join(clonePath, folder), process.platform === "win32" ? "junction" : "dir");
        appendLog(record, `Link ${folder}/ → original`);
      }
      // ParrelSync's RegisterClone: marker, default argument, and a collab ignore-all file.
      await writeFile(join(clonePath, CLONE_MARKER), "");
      await writeFile(join(clonePath, CLONE_ARGUMENT_FILE), DEFAULT_ARGUMENT, "utf8");
      await writeFile(join(clonePath, "collabignore.txt"), "*");
      finishJob(record, "succeeded", `Clone ${index} criado em ${clonePath}.`, 0);
    } catch (error) {
      await removeCloneDirectory(clonePath).catch((cleanupError: unknown) => appendLog(record, `Falha ao limpar o clone parcial: ${errorMessage(cleanupError)}`));
      if (error instanceof CancelledError) finishJob(record, "cancelled", "Criação do clone cancelada; arquivos parciais removidos.");
      else finishJob(record, "failed", `Falha ao criar o clone: ${errorMessage(error)}`);
    }
  })();
  return snapshot(record);
}

class CancelledError extends Error {}

export async function deleteClone(projectPath: string, clonePath: string): Promise<{ freedBytes: number }> {
  const { originalPath } = await family(projectPath);
  const clone = await requireClone(originalPath, clonePath);
  const holders = await editorsForProject(clone.path);
  if (holders.length > 0) throw new Error(`Feche o Unity Editor do clone ${clone.index} (PID ${holders.map((holder) => holder.pid).join(", ")}) antes de removê-lo.`);
  const freedBytes = await pathSize(clone.path);
  await removeCloneDirectory(clone.path);
  if (!(await isDirectory(join(originalPath, "Assets")))) console.error(`[unity-workspace] Assets of ${originalPath} missing after deleting ${clone.path}`);
  return { freedBytes };
}

/** Unlinks every symlink/junction at the clone root without entering it, then removes the clone's own files. */
async function removeCloneDirectory(clonePath: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(clonePath);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  for (const name of entries) {
    const path = join(clonePath, name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      if (process.platform === "win32") await rmdir(path).catch(() => unlink(path));
      else await unlink(path);
    }
  }
  for (const name of await readdir(clonePath)) {
    const path = join(clonePath, name);
    if ((await lstat(path)).isSymbolicLink()) throw new Error(`Link ${path} não pôde ser removido com segurança.`);
    await rm(path, { recursive: true, force: true, maxRetries: 2 });
  }
  await rmdir(clonePath);
}

export async function setCloneArgument(projectPath: string, clonePath: string, argument: string): Promise<Clone> {
  const { originalPath } = await family(projectPath);
  const clone = await requireClone(originalPath, clonePath);
  await writeFile(join(clone.path, CLONE_ARGUMENT_FILE), argument.trim() || DEFAULT_ARGUMENT, "utf8");
  const running = await listRunningEditors();
  return describeClone(clone.path, clone.index, new Set(running.map((editor) => samePathKey(editor.projectPath))));
}

export async function openInstances(projectPath: string, paths: readonly string[], settings: UnitySettings) {
  const { originalPath } = await family(projectPath);
  const original = await readProject(originalPath);
  const editor = await requireEditor(original.editorVersion, settings);
  const launched: { path: string; pid: number | null }[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const requested of paths) {
    const path = resolve(requested);
    try {
      if (samePathKey(path) !== samePathKey(originalPath)) await requireClone(originalPath, path);
      if ((await editorsForProject(path)).length > 0) {
        skipped.push({ path, reason: "já está aberto" });
        continue;
      }
      launched.push({ path, pid: await launchDetached(editor.executable, ["-projectPath", path], path) });
    } catch (error) {
      skipped.push({ path, reason: errorMessage(error) });
    }
  }
  forgetRunningEditors();
  return { launched, skipped };
}

/** Adds ParrelSync to the original manifest and to every clone's copied manifest. */
export async function installParrelSync(projectPath: string): Promise<{ changed: boolean; message: string }> {
  const { originalPath } = await family(projectPath);
  const { clones } = await listClones(originalPath);
  const manifests = [originalPath, ...clones.map((clone) => clone.path)].map((path) => join(path, "Packages", "manifest.json"));
  let changed = 0;
  for (const manifestPath of manifests) {
    if (!(await exists(manifestPath)) || (await lstat(manifestPath)).isSymbolicLink()) continue;
    const manifest = await readJsonOrNull(manifestPath);
    if (typeof manifest !== "object" || manifest === null) throw new Error(`${manifestPath} não é um JSON válido.`);
    const record = manifest as { dependencies?: Record<string, string> };
    record.dependencies ??= {};
    if (record.dependencies[PARRELSYNC_PACKAGE] !== undefined) continue;
    record.dependencies[PARRELSYNC_PACKAGE] = PARRELSYNC_URL;
    record.dependencies = Object.fromEntries(Object.entries(record.dependencies).sort(([left], [right]) => left.localeCompare(right)));
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    changed += 1;
  }
  if (changed === 0) return { changed: false, message: "ParrelSync já está no manifest." };
  return { changed: true, message: `ParrelSync adicionado a ${changed} manifest(s). O Unity baixa o pacote (via git) na próxima vez que focar ou abrir o projeto.` };
}

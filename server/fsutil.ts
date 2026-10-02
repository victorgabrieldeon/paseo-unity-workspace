import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export async function readTextOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function readJsonOrNull(path: string): Promise<unknown> {
  const text = await readTextOrNull(path);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Total size of regular files under `path`. Never follows symlinks, so linked clone folders count as zero. */
export async function pathSize(path: string): Promise<number> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error) || isPermission(error)) return 0;
    throw error;
  }
  let total = 0;
  const pending = entries.map((entry) => join(path, entry.name));
  // Bounded fan-out keeps a 50k-file Library from exhausting file descriptors.
  for (let index = 0; index < pending.length; index += 64) {
    const sizes = await Promise.all(pending.slice(index, index + 64).map(pathSize));
    for (const size of sizes) total += size;
  }
  return total;
}

/** True when `child` is `parent` itself or nested inside it. Both must be absolute. */
export function isInside(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

export function isMissing(error: unknown): boolean {
  return hasCode(error, "ENOENT") || hasCode(error, "ENOTDIR");
}

function isPermission(error: unknown): boolean {
  return hasCode(error, "EACCES") || hasCode(error, "EPERM");
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

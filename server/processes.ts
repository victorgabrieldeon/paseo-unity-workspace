import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { RunningEditor } from "../shared/contracts";

const execFileAsync = promisify(execFile);
const CACHE_MS = 1_500;

let cached: { at: number; editors: Promise<RunningEditor[]> } | null = null;

/** Unity Editor processes (GUI or batch mode) with the project each one holds open. */
export function listRunningEditors(): Promise<RunningEditor[]> {
  const now = Date.now();
  if (cached !== null && now - cached.at < CACHE_MS) return cached.editors;
  const editors = scan().catch((error: unknown) => {
    console.error("[unity-workspace] process scan failed", error);
    return [];
  });
  cached = { at: now, editors };
  return editors;
}

export function forgetRunningEditors(): void {
  cached = null;
}

export async function editorsForProject(projectPath: string): Promise<RunningEditor[]> {
  const target = samePathKey(projectPath);
  return (await listRunningEditors()).filter((editor) => samePathKey(editor.projectPath) === target);
}

export function samePathKey(path: string): string {
  const resolved = resolve(path).replace(/[\\/]+$/u, "");
  return process.platform === "win32" || process.platform === "darwin" ? resolved.toLowerCase() : resolved;
}

async function scan(): Promise<RunningEditor[]> {
  if (process.platform === "linux") return scanProc();
  if (process.platform === "win32") return scanWindows();
  return scanPs();
}

async function scanProc(): Promise<RunningEditor[]> {
  const editors: RunningEditor[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    try {
      const comm = (await readFile(`/proc/${entry}/comm`, "utf8")).trim();
      if (comm !== "Unity") continue;
      const args = (await readFile(`/proc/${entry}/cmdline`, "utf8")).split("\0").filter(Boolean);
      const editor = editorFromArgs(Number(entry), args);
      if (editor !== null) editors.push(editor);
    } catch {
      // The process exited between readdir and read.
    }
  }
  return editors;
}

async function scanPs(): Promise<RunningEditor[]> {
  const { stdout } = await execFileAsync("ps", ["-axww", "-o", "pid=,command="], { timeout: 5_000, maxBuffer: 8 * 1024 * 1024 });
  const editors: RunningEditor[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/u.exec(line);
    if (match === null || !/Unity\.app\/Contents\/MacOS\/Unity\b/u.test(match[2] ?? "")) continue;
    const editor = editorFromCommandLine(Number(match[1]), match[2] ?? "");
    if (editor !== null) editors.push(editor);
  }
  return editors;
}

async function scanWindows(): Promise<RunningEditor[]> {
  const script = "Get-CimInstance Win32_Process -Filter \"Name='Unity.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 10_000 });
  if (stdout.trim() === "") return [];
  const parsed = JSON.parse(stdout) as unknown;
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const editors: RunningEditor[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    const record = row as Record<string, unknown>;
    if (typeof record["ProcessId"] !== "number" || typeof record["CommandLine"] !== "string") continue;
    const editor = editorFromArgs(record["ProcessId"], splitCommandLine(record["CommandLine"]));
    if (editor !== null) editors.push(editor);
  }
  return editors;
}

export function editorFromArgs(pid: number, args: readonly string[]): RunningEditor | null {
  const index = args.findIndex((arg) => arg.toLowerCase() === "-projectpath");
  const projectPath = index >= 0 ? args[index + 1] : undefined;
  if (projectPath === undefined || projectPath.startsWith("-")) return null;
  return { pid, projectPath: resolve(projectPath), batchmode: args.some((arg) => arg.toLowerCase() === "-batchmode") };
}

/** macOS `ps` joins argv with spaces; take everything after -projectPath up to the next flag. */
export function editorFromCommandLine(pid: number, commandLine: string): RunningEditor | null {
  const match = /\s-projectpath\s+(.+?)(?=\s+-[A-Za-z]|$)/iu.exec(commandLine);
  if (match?.[1] === undefined) return null;
  return { pid, projectPath: resolve(match[1].replace(/^"|"$/gu, "")), batchmode: /\s-batchmode\b/iu.test(commandLine) };
}

export function splitCommandLine(commandLine: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (const char of commandLine) {
    if (char === "\"") {
      quoted = !quoted;
      started = true;
    } else if (/\s/u.test(char) && !quoted) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

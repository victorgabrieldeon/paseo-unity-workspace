import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { promisify } from "node:util";
import { exists } from "./fsutil";
import { childEnv } from "./launch";
import { samePathKey } from "./processes";

const execFileAsync = promisify(execFile);
const CLI_ENV = { UNITY_NO_BANNER: "1", UNITY_NO_PAGER: "1", UNITY_NON_INTERACTIVE: "1", NO_COLOR: "1" };
const STATUS_CACHE_MS = 3_000;

let cliPath: Promise<string | null> | null = null;
let statusCache: { at: number; paths: Promise<Set<string>> } | null = null;

/** The Unity CLI (`unity`) from PATH or its default install folder. */
export function findUnityCli(): Promise<string | null> {
  cliPath ??= (async () => {
    const names = process.platform === "win32" ? ["unity.exe", "unity.cmd"] : ["unity"];
    const directories = [...(process.env["PATH"] ?? "").split(delimiter), join(homedir(), ".local", "bin")];
    for (const directory of directories.filter(Boolean)) {
      for (const name of names) {
        const candidate = join(directory, name);
        if (await exists(candidate)) return candidate;
      }
    }
    return null;
  })();
  return cliPath;
}

/**
 * Projects whose open Editor answers the Unity CLI (requires the `com.unity.pipeline` package). Editors
 * without the package stay invisible here; process detection still reports them as open.
 */
export function liveProjectKeys(): Promise<Set<string>> {
  const now = Date.now();
  if (statusCache !== null && now - statusCache.at < STATUS_CACHE_MS) return statusCache.paths;
  const paths = (async () => {
    const cli = await findUnityCli();
    if (cli === null) return new Set<string>();
    try {
      const { stdout } = await execFileAsync(cli, ["status", "--json"], { env: childEnv(CLI_ENV), timeout: 8_000 });
      return new Set(parseStatusProjects(stdout).map(samePathKey));
    } catch (error) {
      // `unity status` exits non-zero when no Editor is connected; its JSON still lists zero instances.
      const stdout = typeof error === "object" && error !== null && "stdout" in error ? String(error.stdout) : "";
      return new Set(parseStatusProjects(stdout).map(samePathKey));
    }
  })();
  statusCache = { at: now, paths };
  return paths;
}

export function parseStatusProjects(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }
  const data = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : parsed;
  const instances = typeof data === "object" && data !== null && "instances" in data ? data.instances : data;
  if (!Array.isArray(instances)) return [];
  const paths: string[] = [];
  for (const instance of instances) {
    if (typeof instance !== "object" || instance === null) continue;
    const record = instance as Record<string, unknown>;
    const path = [record["projectPath"], record["project_path"], record["project"], record["path"]].find((value) => typeof value === "string");
    if (typeof path === "string") paths.push(path);
  }
  return paths;
}

export async function isLiveEditor(projectPath: string): Promise<boolean> {
  return (await liveProjectKeys()).has(samePathKey(projectPath));
}

/** Runs a C# snippet in the project's open Editor through `unity command eval`; the snippet must `return` a value. */
export async function liveEval(projectPath: string, code: string, timeoutSeconds = 60): Promise<string> {
  const cli = await findUnityCli();
  if (cli === null) throw new Error("Unity CLI (`unity`) não encontrada no PATH.");
  const { stdout } = await execFileAsync(
    cli,
    ["command", "--project-path", projectPath, "--timeout", String(timeoutSeconds), "--result-only", "eval", code],
    { env: childEnv(CLI_ENV), timeout: (timeoutSeconds + 10) * 1000, maxBuffer: 4 * 1024 * 1024 },
  );
  statusCache = null;
  return stdout.trim();
}

/** C# string literal for snippets sent to `liveEval`. */
export function csharpString(value: string): string {
  return `"${value.replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"").replace(/\r?\n/gu, "\\n")}"`;
}

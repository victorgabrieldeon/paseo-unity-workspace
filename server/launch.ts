import { spawn } from "node:child_process";
import { delimiter } from "node:path";

const INHERITED_RUNTIME_KEYS = ["ELECTRON_RUN_AS_NODE", "NODE_CHANNEL_FD", "NODE_CHANNEL_SERIALIZATION_MODE", "NODE_OPTIONS"];

/**
 * Environment for Unity, players, and CLIs started from the plugin subprocess. The subprocess runs inside
 * Paseo's Electron binary: its Node IPC channel and bundled library path must not leak into Unity.
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of INHERITED_RUNTIME_KEYS) delete env[key];
  const libraryPath = env["LD_LIBRARY_PATH"];
  if (libraryPath !== undefined) {
    const kept = libraryPath.split(delimiter).filter((entry) => entry !== "" && !/paseo/iu.test(entry));
    if (kept.length > 0) env["LD_LIBRARY_PATH"] = kept.join(delimiter);
    else delete env["LD_LIBRARY_PATH"];
  }
  return { ...env, ...extra };
}

/** Starts a GUI process that outlives the plugin subprocess. Resolves once the OS accepted the spawn. */
export function launchDetached(executable: string, args: readonly string[], cwd: string): Promise<number | null> {
  return new Promise((resolvePid, reject) => {
    const child = spawn(executable, [...args], { cwd, detached: true, stdio: "ignore", env: childEnv() });
    child.once("error", (error) => reject(new Error(`Falha ao iniciar ${executable}: ${error.message}`)));
    child.once("spawn", () => {
      child.unref();
      resolvePid(child.pid ?? null);
    });
  });
}

import { chmod, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { Player } from "../shared/contracts";
import type { UnitySettings } from "../shared/settings";
import { isDirectory, isInside } from "./fsutil";
import { launchDetached } from "./launch";
import { splitCommandLine } from "./processes";
import { requireProject } from "./project";

const MAX_DEPTH = 4;
const MAX_INSTANCES = 8;
/** Folders Unity writes next to a player; they never contain another player. */
const PLAYER_SIDECARS = /(_Data|_BurstDebugInformation_DoNotShip|^MonoBleedingEdge|^D3D12|^Logs)$/u;

export function playerPlatform(path: string): Player["platform"] | null {
  if (path.endsWith(".x86_64")) return "linux";
  if (path.endsWith(".app")) return "macos";
  if (path.endsWith(".exe") && !/UnityCrashHandler\w*\.exe$/u.test(path)) return "windows";
  return null;
}

export function runnableHere(platform: Player["platform"], host: NodeJS.Platform = process.platform): boolean {
  return (platform === "linux" && host === "linux") || (platform === "windows" && host === "win32") || (platform === "macos" && host === "darwin");
}

function outputRoot(projectPath: string, settings: UnitySettings): string {
  const root = resolve(projectPath, settings.buildOutputDir);
  if (!isInside(projectPath, root)) throw new Error("A pasta de saída dos builds precisa ficar dentro do projeto.");
  return root;
}

/** Players under the build output folder, newest first. */
export async function listPlayers(projectPath: string, settings: UnitySettings): Promise<{ root: string; players: Player[] }> {
  const project = await requireProject(projectPath);
  const root = outputRoot(project.path, settings);
  const players = await findPlayers(root);
  return { root: relative(project.path, root) || ".", players: players.sort((left, right) => right.modifiedAt - left.modifiedAt) };
}

export async function findPlayers(root: string, depth = MAX_DEPTH): Promise<Player[]> {
  if (depth < 0 || !(await isDirectory(root))) return [];
  const players: Player[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || PLAYER_SIDECARS.test(entry.name)) continue;
    const path = join(root, entry.name);
    const platform = playerPlatform(entry.name);
    if (platform !== null && (entry.isFile() || (platform === "macos" && entry.isDirectory()))) {
      const info = await stat(path);
      players.push({ path, name: entry.name, folder: dirname(path).split(/[\\/]/u).pop() ?? "", platform, runnable: runnableHere(platform), modifiedAt: info.mtimeMs });
    } else if (entry.isDirectory()) {
      players.push(...(await findPlayers(path, depth - 1)));
    }
  }
  return players;
}

/** Newest runnable player written after `since`; how method builds, whose output path is up to the script, get a Run button. */
export async function newestPlayerSince(root: string, since: number): Promise<string | null> {
  const players = (await findPlayers(root)).filter((player) => player.runnable && player.modifiedAt >= since - 1_000);
  return players.sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.path ?? null;
}

export async function launchPlayer(path: string, args: readonly string[] = [], instances = 1): Promise<{ pids: (number | null)[]; message: string }> {
  const platform = playerPlatform(path);
  if (platform === null || !runnableHere(platform)) throw new Error("Este build é de outra plataforma e não pode ser executado nesta máquina.");
  const count = Math.min(Math.max(1, Math.trunc(instances)), MAX_INSTANCES);
  const directory = dirname(path);
  if (platform === "linux") await chmod(path, 0o755);
  const pids: (number | null)[] = [];
  for (let index = 0; index < count; index += 1) {
    pids.push(platform === "macos" ? await launchDetached("open", ["-n", path, "--args", ...args], directory) : await launchDetached(path, [...args], directory));
  }
  return { pids, message: count === 1 ? "Player iniciado." : `${count} instâncias do player iniciadas.` };
}

export async function launchProjectPlayer(projectPath: string, playerPath: string, args: string, instances: number, settings: UnitySettings) {
  const { players } = await listPlayers(projectPath, settings);
  const target = resolve(playerPath);
  const player = players.find((candidate) => candidate.path === target);
  if (player === undefined) throw new Error(`Player não encontrado na pasta de builds: ${playerPath}`);
  return launchPlayer(player.path, splitCommandLine(args), instances);
}

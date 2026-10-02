import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { BuildMethod, BuildProfile, BuildRecipe, BuildTarget, Job } from "../shared/contracts";
import type { UnitySettings } from "../shared/settings";
import { resolveEditor } from "./editors";
import { exists, isInside, readTextOrNull } from "./fsutil";
import { appendLog, createJob, finishJob, getJob, runningJob, snapshot, type JobRecord } from "./jobs";
import { childEnv } from "./launch";
import { launchPlayer, newestPlayerSince } from "./players";
import { requireEditor } from "./manager";
import { editorsForProject, forgetRunningEditors } from "./processes";
import { requireProject } from "./project";
import { parseBuildScenes } from "./scenes";

const MAX_SOURCE_FILES = 6_000;
const BUILD_API = /BuildPipeline\.BuildPlayer|BuildPlayerOptions|BuildPlayerWithProfileOptions/u;

type TargetSpec = { label: string; folder: string; flag: string; buildTarget: string; module: string; extension: string };

export const TARGETS: Record<BuildTarget, TargetSpec> = {
  StandaloneLinux64: { label: "Linux", folder: "Linux", flag: "-buildLinux64Player", buildTarget: "Linux64", module: "LinuxStandaloneSupport", extension: ".x86_64" },
  StandaloneWindows64: { label: "Windows", folder: "Windows", flag: "-buildWindows64Player", buildTarget: "Win64", module: "WindowsStandaloneSupport", extension: ".exe" },
  StandaloneOSX: { label: "macOS", folder: "macOS", flag: "-buildOSXUniversalPlayer", buildTarget: "OSXUniversal", module: "MacStandaloneSupport", extension: ".app" },
};

/** `m_BuildTarget` values in BuildProfile assets mapped to player file extensions ("" builds into a folder). */
const PROFILE_EXTENSIONS: Record<number, string> = { 24: ".x86_64", 19: ".exe", 2: ".app", 13: ".apk", 20: "", 9: "" };

// ── Discovery ─────────────────────────────────────────────────────────

export async function buildOptions(projectPath: string, settings: UnitySettings) {
  const project = await requireProject(projectPath);
  const [methods, profiles, editor] = await Promise.all([
    discoverBuildMethods(project.path),
    discoverProfiles(project.path),
    resolveEditor(project.editorVersion, settings.editorRoots),
  ]);
  const modules = new Set(editor?.modules ?? []);
  const targets = (Object.keys(TARGETS) as BuildTarget[]).map((target) => ({
    target,
    label: TARGETS[target].label,
    moduleInstalled: modules.has(TARGETS[target].module),
  }));
  const major = Number(project.editorVersion?.split(".")[0] ?? 0);
  return { methods, profiles: profiles.map(({ path, name }) => ({ path, name })), targets, outputRoot: settings.buildOutputDir, supportsProfiles: major >= 6000 };
}

export async function discoverBuildMethods(projectPath: string): Promise<BuildMethod[]> {
  const files = await collectFiles(join(projectPath, "Assets"), "Assets", (name) => name.endsWith(".cs"), MAX_SOURCE_FILES);
  const methods: BuildMethod[] = [];
  for (const file of files) {
    const source = await readTextOrNull(join(projectPath, file));
    if (source === null || !BUILD_API.test(source)) continue;
    for (const method of parseBuildMethods(source)) methods.push({ ...method, file });
  }
  return methods.sort((left, right) => left.label.localeCompare(right.label));
}

/** Public static parameterless methods (valid `-executeMethod` entry points) in a C# file that builds players. */
export function parseBuildMethods(source: string): Omit<BuildMethod, "file">[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/.*$/gmu, "");
  const namespace = /^\s*namespace\s+([\w.]+)/mu.exec(code)?.[1] ?? null;
  const classes = [...code.matchAll(/\bclass\s+(\w+)/gu)].map((match) => ({ name: match[1] ?? "", index: match.index }));
  const signatures = [...code.matchAll(/public\s+static\s+(?:async\s+)?void\s+(\w+)\s*\(\s*\)/gu)];
  return signatures.map((match, position) => {
    const name = match[1] ?? "";
    const owner = classes.filter((candidate) => candidate.index < match.index).pop()?.name ?? "Builder";
    const previous = signatures[position - 1];
    const previousEnd = previous === undefined ? 0 : previous.index + previous[0].length;
    const before = code.slice(Math.max(previousEnd, match.index - 400), match.index);
    const menu = [...before.matchAll(/\[MenuItem\(\s*"([^"]+)"/gu)].pop()?.[1] ?? null;
    const rest = code.slice(match.index + match[0].length);
    const stop = rest.search(/\[MenuItem|\b(?:public|private|internal|protected)\s+static\b/u);
    const body = stop < 0 ? rest : rest.slice(0, stop);
    const label = menu?.split("/").pop() ?? name;
    return {
      method: [namespace, owner, name].filter(Boolean).join("."),
      label,
      development: /Dev(elopment)?(?![a-z])/u.test(name) || /\bdev(elopment)?\b/iu.test(label) || /BuildOptions\.Development/u.test(body),
    };
  });
}

export async function discoverProfiles(projectPath: string): Promise<(BuildProfile & { buildTarget: number | null })[]> {
  const files = await collectFiles(join(projectPath, "Assets"), "Assets", (name, relative) => name.endsWith(".asset") && /build ?profiles?\//iu.test(relative), 500);
  const profiles: (BuildProfile & { buildTarget: number | null })[] = [];
  for (const file of files) {
    const text = await readTextOrNull(join(projectPath, file));
    if (text === null || !/BuildProfile|m_PlatformId/u.test(text)) continue;
    const target = /m_BuildTarget:\s*(\d+)/u.exec(text)?.[1];
    profiles.push({ path: file, name: (file.split("/").pop() ?? file).replace(/\.asset$/u, ""), buildTarget: target === undefined ? null : Number(target) });
  }
  return profiles.sort((left, right) => left.name.localeCompare(right.name));
}

async function collectFiles(directory: string, relative: string, accept: (name: string, relative: string) => boolean, limit: number, found: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (found.length >= limit) break;
    if (entry.name.startsWith(".") || entry.name.endsWith("~") || entry.isSymbolicLink()) continue;
    const childRelative = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await collectFiles(join(directory, entry.name), childRelative, accept, limit, found);
    else if (entry.isFile() && accept(entry.name, childRelative)) found.push(childRelative);
  }
  return found;
}

// ── Running builds ────────────────────────────────────────────────────

async function prepareBuild(projectPath: string, settings: UnitySettings) {
  const project = await requireProject(projectPath);
  const busy = runningJob(project.path);
  if (busy !== null) throw new Error(`Já existe uma tarefa em andamento neste projeto: ${busy.job.title}.`);
  const holders = await editorsForProject(project.path);
  if (holders.length > 0) {
    throw new Error(`Feche o Unity Editor de ${project.name} (PID ${holders.map((holder) => holder.pid).join(", ")}) antes de buildar: o Unity não abre o mesmo projeto em duas instâncias.`);
  }
  const editor = await requireEditor(project.editorVersion, settings);
  return { project, editor, product: safeFileName(project.productName ?? project.name) };
}

export async function startBuild(projectPath: string, recipe: BuildRecipe, settings: UnitySettings): Promise<Job> {
  const { project, editor, product } = await prepareBuild(projectPath, settings);
  const outputRoot = resolve(project.path, settings.buildOutputDir);
  if (!isInside(project.path, outputRoot)) throw new Error("A pasta de saída dos builds precisa ficar dentro do projeto.");

  let title: string;
  let args: string[];
  let artifactPath: string | null = null;
  switch (recipe.kind) {
    case "method": {
      if (!/^[A-Za-z_][\w.]*\.[A-Za-z_]\w*$/u.test(recipe.method)) throw new Error(`Método inválido: ${recipe.method}`);
      title = recipe.method.split(".").slice(-2).join(".");
      args = ["-executeMethod", recipe.method];
      break;
    }
    case "profile": {
      const profile = (await discoverProfiles(project.path)).find((candidate) => candidate.path === recipe.profilePath);
      if (profile === undefined) throw new Error(`Build Profile não encontrado: ${recipe.profilePath}`);
      const extension = profile.buildTarget === null ? "" : (PROFILE_EXTENSIONS[profile.buildTarget] ?? "");
      const folder = join(outputRoot, safeFileName(profile.name));
      artifactPath = extension === "" ? folder : join(folder, `${product}${extension}`);
      title = `Profile ${profile.name}`;
      args = ["-activeBuildProfile", profile.path, "-build", artifactPath];
      break;
    }
    case "target": {
      const spec = TARGETS[recipe.target];
      if (!editor.modules.includes(spec.module)) throw new Error(`O módulo ${spec.module} não está instalado no Unity ${editor.version}. Adicione-o pelo Unity Hub (Installs → Add modules).`);
      artifactPath = join(outputRoot, spec.folder, `${product}${spec.extension}`);
      title = `${spec.label} player`;
      args = ["-buildTarget", spec.buildTarget, spec.flag, artifactPath];
      break;
    }
  }

  const afterSuccess = recipe.kind === "method"
    ? async (record: JobRecord) => {
        record.job.artifactPath = await newestPlayerSince(outputRoot, Date.parse(record.job.startedAt)).catch(() => null);
        return "Build concluído.";
      }
    : null;
  return beginBuild(project.path, editor.executable, title, args, artifactPath, afterSuccess);
}

type AfterSuccess = ((record: JobRecord) => Promise<string>) | null;

async function beginBuild(projectPath: string, executable: string, title: string, args: string[], artifactPath: string | null, afterSuccess: AfterSuccess): Promise<Job> {
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const logPath = join(projectPath, "Logs", `paseo-build-${safeFileName(title).toLowerCase().replace(/\s+/gu, "-")}-${stamp}.log`);
  await mkdir(dirname(logPath), { recursive: true });
  if (artifactPath !== null) await mkdir(/\.\w+$/u.test(artifactPath) ? dirname(artifactPath) : artifactPath, { recursive: true });

  const record = createJob("build", projectPath, title, { logPath, artifactPath });
  const fullArgs = ["-batchmode", "-quit", "-projectPath", projectPath, "-logFile", "-", ...args];
  appendLog(record, `$ ${executable} ${fullArgs.join(" ")}`);
  runUnity(record, executable, fullArgs, projectPath, logPath, afterSuccess);
  forgetRunningEditors();
  return snapshot(record);
}

function runUnity(record: JobRecord, executable: string, args: string[], cwd: string, logPath: string, afterSuccess: AfterSuccess): void {
  const log = createWriteStream(logPath, { flags: "a" });
  const child = spawn(executable, args, { cwd, env: childEnv(), stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  record.child = child;
  let pending = "";
  const onData = (chunk: Buffer) => {
    log.write(chunk);
    const text = pending + chunk.toString("utf8");
    const cut = text.lastIndexOf("\n");
    if (cut < 0) {
      pending = text;
      return;
    }
    pending = text.slice(cut + 1);
    appendLog(record, text.slice(0, cut));
  };
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.once("error", (error) => {
    appendLog(record, error.message);
    log.end();
    finishJob(record, "failed", `Falha ao iniciar o Unity: ${error.message}`);
  });
  child.once("close", (code, signal) => {
    if (pending !== "") appendLog(record, pending);
    log.end();
    forgetRunningEditors();
    if (record.job.state !== "running") return;
    if (code === 0) {
      if (afterSuccess === null) {
        finishJob(record, "succeeded", "Build concluído.", 0);
        return;
      }
      void afterSuccess(record).then(
        (message) => finishJob(record, "succeeded", message, 0),
        (error: unknown) => finishJob(record, "succeeded", `Build concluído, mas: ${error instanceof Error ? error.message : String(error)}`, 0),
      );
      return;
    }
    const exit = signal === null ? `Unity encerrou com código ${code ?? "?"}` : `Unity encerrou com sinal ${signal}`;
    const cause = record.job.errors.find((line) => !/^Aborting batchmode/u.test(line));
    finishJob(record, "failed", cause === undefined ? `${exit}.` : `${exit}: ${cause}`, code);
  });
}

export async function launchArtifact(jobId: string): Promise<{ pid: number | null; message: string }> {
  const record = getJob(jobId);
  if (record === null) throw new Error("Build não encontrado (o plugin pode ter sido recarregado).");
  const artifact = record.job.artifactPath;
  if (record.job.state !== "succeeded" || artifact === null) throw new Error("Este build não gerou um executável conhecido.");
  if (!(await exists(artifact))) throw new Error(`Executável não encontrado: ${artifact}`);
  const { pids, message } = await launchPlayer(artifact);
  return { pid: pids[0] ?? null, message };
}

// ── Quick play ────────────────────────────────────────────────────────

const QUICK_PLAY_FOLDER = "QuickPlay";
const QUICK_PLAY_STAMP = ".built-at";

export function hostTarget(platform: NodeJS.Platform = process.platform): BuildTarget | null {
  if (platform === "linux") return "StandaloneLinux64";
  if (platform === "win32") return "StandaloneWindows64";
  if (platform === "darwin") return "StandaloneOSX";
  return null;
}

/**
 * "Jogar" without opening the Editor: a batch-mode player build for this machine into <Builds>/QuickPlay
 * (Unity refuses to build into Library),
 * then launch. When nothing in Assets, Packages, or ProjectSettings changed since the last quick build, it
 * launches the existing player right away.
 */
export async function quickPlay(projectPath: string, launchArgs: readonly string[], instances: number, force: boolean, settings: UnitySettings): Promise<{ job: Job | null; message: string }> {
  const target = hostTarget();
  if (target === null) throw new Error(`Plataforma ${process.platform} não suportada para Jogar.`);
  const spec = TARGETS[target];
  const project = await requireProject(projectPath);
  const product = safeFileName(project.productName ?? project.name);
  const outputRoot = resolve(project.path, settings.buildOutputDir);
  if (!isInside(project.path, outputRoot)) throw new Error("A pasta de saída dos builds precisa ficar dentro do projeto.");
  const folder = join(outputRoot, QUICK_PLAY_FOLDER);
  const artifactPath = join(folder, `${product}${spec.extension}`);
  const stampPath = join(folder, QUICK_PLAY_STAMP);

  if (!force && (await exists(artifactPath))) {
    const builtAt = Number((await readTextOrNull(stampPath))?.trim() ?? Number.NaN);
    if (Number.isFinite(builtAt) && (await newestSourceChange(project.path)) <= builtAt) {
      const { message } = await launchPlayer(artifactPath, launchArgs, instances);
      return { job: null, message: `Nada mudou desde o último build. ${message}` };
    }
  }

  const buildSettings = await readTextOrNull(join(project.path, "ProjectSettings", "EditorBuildSettings.asset"));
  if (buildSettings === null || !parseBuildScenes(buildSettings).some((scene) => scene.enabled)) {
    throw new Error("Nenhuma cena ativa no Build Settings. Adicione a cena inicial em File → Build Profiles (Scene List) antes de jogar.");
  }
  const { editor } = await prepareBuild(project.path, settings);
  if (!editor.modules.includes(spec.module)) throw new Error(`O módulo ${spec.module} não está instalado no Unity ${editor.version}.`);
  const job = await beginBuild(project.path, editor.executable, "Jogar", ["-buildTarget", spec.buildTarget, spec.flag, artifactPath], artifactPath, async () => {
    // Stamp after Unity exits: files Unity itself rewrites while quitting must not count as user changes.
    await writeFile(stampPath, String(Date.now()), "utf8");
    const { message } = await launchPlayer(artifactPath, launchArgs, instances);
    return `Build concluído. ${message}`;
  });
  return { job, message: "Buildando para jogar…" };
}

/** Latest modification under the folders that feed a player build; symlinked top-level folders (clones) are followed. */
export async function newestSourceChange(projectPath: string): Promise<number> {
  let newest = 0;
  const visit = async (path: string, top: boolean): Promise<void> => {
    let info;
    try {
      info = top ? await stat(path) : await lstat(path);
    } catch {
      return;
    }
    if (info.isSymbolicLink()) return;
    newest = Math.max(newest, info.mtimeMs);
    if (!info.isDirectory()) return;
    const entries = await readdir(path);
    for (let index = 0; index < entries.length; index += 64) {
      await Promise.all(entries.slice(index, index + 64).filter((name) => !name.startsWith(".") && !name.endsWith("~")).map((name) => visit(join(path, name), false)));
    }
  };
  for (const folder of ["Assets", "Packages", "ProjectSettings"]) await visit(join(projectPath, folder), true);
  return newest;
}

export function safeFileName(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\u0000-\u001f]+/gu, "").replace(/\s+/gu, " ").trim();
  return cleaned === "" ? "Game" : cleaned;
}

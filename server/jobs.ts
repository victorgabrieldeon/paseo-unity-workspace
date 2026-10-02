import { execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Job } from "../shared/contracts";
import { samePathKey } from "./processes";

const MAX_TAIL_LINES = 200;
const MAX_ERROR_LINES = 40;
const MAX_FINISHED_PER_PROJECT = 10;
// Unity's bundled .NET tools color their console output.
const ANSI_ESCAPE = /\u001b\[[0-9;]*[A-Za-z]/gu;

const ERROR_PATTERNS = [
  /error CS\d+/u,
  /^\s*Error\b/u,
  /\bException\b/u,
  /Build Finished, Result: Failure/u,
  /Aborting batchmode due to/u,
  /another Unity instance is running/iu,
  /^\s*BuildFailed/u,
  /Scripts have compiler errors/u,
  /executeMethod (class|method) .* (could not be found|does not exist)/u,
  /^Error building Player/u,
];

/** Mutable runtime record; the process lifecycle is its purpose. */
export type JobRecord = {
  job: Job;
  child: ChildProcess | null;
  onCancel: (() => void) | null;
};

const jobs = new Map<string, JobRecord>();

export function createJob(kind: Job["kind"], projectPath: string, title: string, fields: Partial<Pick<Job, "logPath" | "artifactPath">> = {}): JobRecord {
  const record: JobRecord = {
    job: {
      id: randomUUID(),
      kind,
      projectPath,
      title,
      state: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      message: null,
      logPath: fields.logPath ?? null,
      logTail: [],
      errors: [],
      artifactPath: fields.artifactPath ?? null,
    },
    child: null,
    onCancel: null,
  };
  jobs.set(record.job.id, record);
  pruneFinished(projectPath);
  return record;
}

export function appendLog(record: JobRecord, text: string): void {
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(ANSI_ESCAPE, "").trimEnd();
    if (line === "") continue;
    record.job.logTail.push(line);
    if (ERROR_PATTERNS.some((pattern) => pattern.test(line)) && !record.job.errors.includes(line) && record.job.errors.length < MAX_ERROR_LINES) {
      record.job.errors.push(line);
    }
  }
  if (record.job.logTail.length > MAX_TAIL_LINES) record.job.logTail.splice(0, record.job.logTail.length - MAX_TAIL_LINES);
}

export function finishJob(record: JobRecord, state: Exclude<Job["state"], "running">, message: string, exitCode: number | null = null): void {
  if (record.job.state !== "running") return;
  record.job.state = state;
  record.job.message = message;
  record.job.exitCode = exitCode;
  record.job.endedAt = new Date().toISOString();
  record.child = null;
  record.onCancel = null;
}

export function snapshot(record: JobRecord): Job {
  return { ...record.job, logTail: [...record.job.logTail], errors: [...record.job.errors] };
}

export function getJob(id: string): JobRecord | null {
  return jobs.get(id) ?? null;
}

export function listJobs(projectPath: string, kind?: Job["kind"]): Job[] {
  const key = samePathKey(projectPath);
  return [...jobs.values()]
    .filter((record) => samePathKey(record.job.projectPath) === key && (kind === undefined || record.job.kind === kind))
    .map(snapshot)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export function runningJob(projectPath: string): JobRecord | null {
  const key = samePathKey(projectPath);
  return [...jobs.values()].find((record) => record.job.state === "running" && samePathKey(record.job.projectPath) === key) ?? null;
}

export function cancelJob(id: string): Job {
  const record = jobs.get(id);
  if (record === undefined) throw new Error("Job não encontrado (o plugin pode ter sido recarregado).");
  if (record.job.state !== "running") return snapshot(record);
  if (record.child !== null) killTree(record.child);
  record.onCancel?.();
  finishJob(record, "cancelled", "Cancelado pelo usuário.");
  return snapshot(record);
}

export function cancelAll(): void {
  for (const record of jobs.values()) {
    if (record.job.state === "running") cancelJob(record.job.id);
  }
}

/** Unity spawns shader compilers and Bee workers; children are started in their own process group so all of them stop. */
export function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => undefined);
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const pid = child.pid;
  setTimeout(() => {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }, 10_000).unref();
}

function pruneFinished(projectPath: string): void {
  const key = samePathKey(projectPath);
  const finished = [...jobs.values()]
    .filter((record) => record.job.state !== "running" && samePathKey(record.job.projectPath) === key)
    .sort((left, right) => right.job.startedAt.localeCompare(left.job.startedAt));
  for (const record of finished.slice(MAX_FINISHED_PER_PROJECT)) jobs.delete(record.job.id);
}

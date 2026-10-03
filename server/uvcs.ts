import { execFile } from "node:child_process";
import { delimiter, join, relative } from "node:path";
import { promisify } from "node:util";
import type { VcsChange, VcsChangeset, VcsOverview } from "../shared/contracts";
import { errorMessage, exists } from "./fsutil";
import { childEnv } from "./launch";
import { requireProject } from "./project";

const execFileAsync = promisify(execFile);
const RECORD = "@@PASEO-CS@@";
const FIELD = "|~|";
const MAX_CHANGES = 400;
const ASSET_KINDS: { kind: VcsChange["unityKind"]; pattern: RegExp }[] = [
  { kind: "scene", pattern: /\.unity$/u },
  { kind: "prefab", pattern: /\.prefab$/u },
  { kind: "script", pattern: /\.cs$/u },
  { kind: "meta", pattern: /\.meta$/u },
  { kind: "settings", pattern: /^(ProjectSettings|Packages)\//u },
];

let cmPath: Promise<string | null> | null = null;

export function findCm(): Promise<string | null> {
  cmPath ??= (async () => {
    const names = process.platform === "win32" ? ["cm.exe"] : ["cm"];
    const directories = [...(process.env["PATH"] ?? "").split(delimiter), "/opt/plasticscm5/client", "/usr/bin", "C:\\Program Files\\PlasticSCM5\\client"];
    for (const directory of directories.filter(Boolean)) {
      for (const name of names) {
        if (await exists(join(directory, name))) return join(directory, name);
      }
    }
    return null;
  })();
  return cmPath;
}

async function cm(projectPath: string, args: string[], timeoutMs = 30_000): Promise<string> {
  const executable = await findCm();
  if (executable === null) throw new Error("CLI do Unity Version Control (`cm`) não encontrada.");
  const { stdout } = await execFileAsync(executable, args, { cwd: projectPath, env: childEnv(), timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

export const STATUS_LABELS: Record<string, string> = {
  CH: "Alterado",
  CO: "Checkout",
  AD: "Adicionado",
  DE: "Removido",
  LD: "Removido localmente",
  MV: "Movido",
  LM: "Movido localmente",
  PR: "Privado",
  RP: "Substituído",
  CP: "Copiado",
  HD: "Hijacked",
};

/** `/main@get-out/get-out@org@unity (cs:318 - head)` */
export function parseStatusHeader(text: string): { branch: string; repository: string; changeset: number | null } | null {
  const match = /^(\/[^@\s]*)@(\S+?)\s+\(cs:(\d+)/mu.exec(text.trim());
  if (match === null) return null;
  return { branch: match[1] ?? "/", repository: match[2] ?? "", changeset: Number(match[3]) };
}

/** `cm status --machinereadable`: one `TYPE <absolute path> <merge info…>` line per change after the STATUS header. */
export function parseStatusLines(text: string, root: string): VcsChange[] {
  const changes: VcsChange[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^([A-Z]{2})\s+(.+?)(?:\s+(?:True|False)\s+\S+)?$/u.exec(line.trim());
    if (match === null || match[1] === undefined || match[2] === undefined || match[1] === "ST") continue;
    const path = relative(root, match[2]).split("\\").join("/") || match[2];
    changes.push({ code: match[1], label: STATUS_LABELS[match[1]] ?? match[1], path, unityKind: unityKind(path) });
  }
  return changes;
}

export function unityKind(path: string): VcsChange["unityKind"] {
  return ASSET_KINDS.find((entry) => entry.pattern.test(path))?.kind ?? "other";
}

/** Added or deleted Assets entries whose `.meta` partner is not part of the same change set (Unity breaks references). */
export function metaProblems(changes: readonly VcsChange[]): string[] {
  const byPath = new Map(changes.map((change) => [change.path, change.code]));
  const problems: string[] = [];
  for (const change of changes) {
    if (!change.path.startsWith("Assets/") || !["AD", "DE", "LD"].includes(change.code)) continue;
    if (change.path.endsWith(".meta")) {
      const asset = change.path.slice(0, -5);
      if (!byPath.has(asset)) problems.push(`${change.path} sem ${asset}`);
    } else if (!byPath.has(`${change.path}.meta`)) {
      problems.push(`${change.path} sem .meta`);
    }
  }
  return problems;
}

export function parseChangesets(text: string): VcsChangeset[] {
  return text
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [id, date, owner, ...rest] = record.split(FIELD);
      const comment = rest.join(FIELD).trim();
      return { id: Number(id), date: date ?? "", owner: owner ?? "", comment, title: comment.split(/\r?\n/u)[0] ?? "" };
    })
    .filter((changeset) => Number.isInteger(changeset.id));
}

export function parseLocks(text: string): VcsOverview["locks"] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [, owner, workspace, path] = line.split(FIELD);
      return { owner: owner ?? "", workspace: workspace ?? "", path: (path ?? "").replace(/^\//u, "") };
    })
    .filter((lock) => lock.path !== "");
}

async function section<T>(run: () => Promise<T>, fallback: T): Promise<{ value: T; error: string | null }> {
  try {
    return { value: await run(), error: null };
  } catch (error) {
    const stderr = typeof error === "object" && error !== null && "stderr" in error ? String(error.stderr).trim() : "";
    return { value: fallback, error: stderr || errorMessage(error) };
  }
}

export function summarize(changes: readonly VcsChange[]): VcsOverview["summary"] {
  const byKind: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  for (const change of changes) {
    byKind[change.unityKind] = (byKind[change.unityKind] ?? 0) + 1;
    byCode[change.code] = (byCode[change.code] ?? 0) + 1;
  }
  return { total: changes.length, byKind, byCode };
}

export async function vcsOverview(projectPath: string): Promise<VcsOverview> {
  const project = await requireProject(projectPath);
  const [cmAvailable, workspace] = await Promise.all([findCm().then(Boolean), exists(join(project.path, ".plastic"))]);
  if (!cmAvailable || !workspace) {
    return { available: cmAvailable, workspace, header: null, behind: null, changes: [], truncated: false, summary: summarize([]), metaProblems: [], changesets: [], branches: [], locks: [], errors: [] };
  }
  const header = parseStatusHeader(await cm(project.path, ["status", "--header"]).catch(() => ""));
  const branch = header?.branch ?? "/main";
  const branchFilter = `where branch='${branch.replace(/'/gu, "''")}'`;
  const [status, changesets, branches, locks] = await Promise.all([
    section(async () => parseStatusLines(await cm(project.path, ["status", "--machinereadable"], 60_000), project.path), [] as VcsChange[]),
    section(
      async () => parseChangesets(await cm(project.path, ["find", "changeset", branchFilter, "order by changesetid desc", "limit 30", `--format=${RECORD}{changesetid}${FIELD}{date}${FIELD}{owner}${FIELD}{comment}`, "--dateformat=yyyy-MM-ddTHH:mm:ss", "--nototal"])),
      [] as VcsChangeset[],
    ),
    section(
      async () =>
        (await cm(project.path, ["find", "branch", `--format={name}${FIELD}{owner}${FIELD}{date}${FIELD}{changeset}`, "--dateformat=yyyy-MM-ddTHH:mm:ss", "--nototal"]))
          .split(/\r?\n/u)
          .filter(Boolean)
          .map((line) => {
            const [name, owner, date, changeset] = line.split(FIELD);
            return { name: name ?? "", owner: owner ?? "", date: date ?? "", headChangeset: changeset ? Number(changeset) : null };
          }),
      [] as VcsOverview["branches"],
    ),
    section(async () => parseLocks(await cm(project.path, ["lock", "list", "--machinereadable", `--fieldseparator=${FIELD}`])), [] as VcsOverview["locks"]),
  ]);
  const latest = changesets.value[0]?.id ?? null;
  const errors = [
    status.error && `Status: ${status.error}`,
    changesets.error && `Changesets: ${changesets.error}`,
    branches.error && `Branches: ${branches.error}`,
    locks.error && `Locks: ${locks.error}`,
  ].filter((error): error is string => typeof error === "string" && error !== "");
  return {
    available: true,
    workspace: true,
    header,
    behind: latest !== null && header?.changeset !== null && header?.changeset !== undefined ? changesets.value.filter((changeset) => changeset.id > (header.changeset ?? 0)).length : null,
    changes: status.value.slice(0, MAX_CHANGES),
    truncated: status.value.length > MAX_CHANGES,
    summary: summarize(status.value),
    metaProblems: metaProblems(status.value),
    changesets: changesets.value,
    branches: branches.value,
    locks: locks.value,
    errors,
  };
}

export async function changesetFiles(projectPath: string, changeset: number): Promise<VcsChange[]> {
  const project = await requireProject(projectPath);
  const text = await cm(project.path, ["log", `cs:${changeset}`, "--csformat={items}", "--itemformat={shortstatus}|{path}{newline}"]);
  return text
    .split(/\r?\n/u)
    .map((line) => /^([A-Z])\|(.+)$/u.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => {
      const path = (match[2] ?? "").replace(/^\//u, "");
      const code = { A: "AD", C: "CH", D: "DE", M: "MV" }[match[1] ?? ""] ?? (match[1] ?? "");
      return { code, label: STATUS_LABELS[code] ?? code, path, unityKind: unityKind(path) };
    });
}

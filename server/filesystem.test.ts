import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanCache, scanCache } from "./cache";
import { createClone, deleteClone, installParrelSync, listClones, setCloneArgument } from "./clones";
import { getJob } from "./jobs";
import { listScenes } from "./scenes";
import { detectProjects } from "./project";

let root: string;
let project: string;

async function makeProject(path: string): Promise<void> {
  await mkdir(join(path, "Assets", "Scenes"), { recursive: true });
  await mkdir(join(path, "ProjectSettings"), { recursive: true });
  await mkdir(join(path, "Packages"), { recursive: true });
  await mkdir(join(path, "Library", "Bee"), { recursive: true });
  await mkdir(join(path, "Temp"), { recursive: true });
  await writeFile(join(path, "ProjectSettings", "ProjectVersion.txt"), "m_EditorVersion: 6000.3.25f1\n");
  await writeFile(join(path, "ProjectSettings", "EditorBuildSettings.asset"), "EditorBuildSettings:\n  m_Scenes:\n  - enabled: 1\n    path: Assets/Scenes/Menu.unity\n    guid: 0\n");
  await writeFile(join(path, "Packages", "manifest.json"), JSON.stringify({ dependencies: { "com.unity.ugui": "2.0.0" } }, null, 2));
  await writeFile(join(path, "Assets", "Scenes", "Menu.unity"), "%YAML 1.1");
  await writeFile(join(path, "Assets", "Scenes", "Combat.unity"), "%YAML 1.1");
  await writeFile(join(path, "Assets", "Player.cs"), "class Player {}");
  await writeFile(join(path, "Library", "Bee", "cache.bin"), "x".repeat(2048));
  await writeFile(join(path, "Library", "ArtifactDB-lock"), "");
  await writeFile(join(path, "Temp", "UnityTempFile"), "tmp");
  await writeFile(join(path, "Game.csproj"), "<Project/>");
}

async function waitForJob(id: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (getJob(id)?.job.state !== "running") return;
    await Bun.sleep(10);
  }
  throw new Error("job did not finish");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "unity-workspace-"));
  project = join(root, "game");
  await makeProject(project);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("detection and scenes", () => {
  test("finds the project from a nested folder and from a parent folder", async () => {
    expect((await detectProjects(join(project, "Assets", "Scenes"))).map((item) => item.path)).toEqual([project]);
    expect((await detectProjects(root)).map((item) => item.path)).toEqual([project]);
  });

  test("lists build scenes first", async () => {
    const { scenes } = await listScenes(project);
    expect(scenes.map((scene) => [scene.path, scene.buildIndex])).toEqual([
      ["Assets/Scenes/Menu.unity", 0],
      ["Assets/Scenes/Combat.unity", null],
    ]);
  });
});

describe("ParrelSync clones", () => {
  test("creates a ParrelSync-compatible clone and deletes it without touching the original", async () => {
    const job = await createClone(project, true);
    await waitForJob(job.id);
    expect(getJob(job.id)?.job.state).toBe("succeeded");

    const clone = `${project}_clone_0`;
    expect(await readlink(join(clone, "Assets"))).toBe(join(project, "Assets"));
    expect((await lstat(join(clone, "Packages"))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(clone, ".parrelsyncarg"), "utf8")).toBe("client");
    expect(await readFile(join(clone, "Library", "Bee", "cache.bin"), "utf8")).toHaveLength(2048);
    await expect(lstat(join(clone, "Library", "ArtifactDB-lock"))).rejects.toThrow();

    const listed = await listClones(clone);
    expect(listed.isClone).toBe(true);
    expect(listed.originalPath).toBe(project);
    expect(listed.clones.map((item) => [item.index, item.argument, item.brokenLinks])).toEqual([[0, "client", []]]);

    expect((await setCloneArgument(project, clone, "server")).argument).toBe("server");

    await deleteClone(project, clone);
    await expect(lstat(clone)).rejects.toThrow();
    expect(await readFile(join(project, "Assets", "Player.cs"), "utf8")).toBe("class Player {}");
    expect((await listClones(project)).clones).toEqual([]);
  });

  test("refuses to delete folders that are not clones of the project", async () => {
    const other = join(root, "other");
    await makeProject(other);
    await expect(deleteClone(project, other)).rejects.toThrow("não é um clone");
    await expect(deleteClone(project, project)).rejects.toThrow("não é um clone");
  });

  test("adds ParrelSync to the original and clone manifests", async () => {
    const job = await createClone(project, false);
    await waitForJob(job.id);
    expect((await installParrelSync(project)).changed).toBe(true);
    for (const path of [project, `${project}_clone_0`]) {
      const manifest = JSON.parse(await readFile(join(path, "Packages", "manifest.json"), "utf8")) as { dependencies: Record<string, string> };
      expect(manifest.dependencies["com.veriorpies.parrelsync"]).toContain("ParrelSync.git");
    }
    expect((await installParrelSync(project)).changed).toBe(false);
  });
});

describe("cache cleaner", () => {
  test("measures and removes regenerable folders only", async () => {
    const scan = await scanCache(project);
    expect(scan.entries.find((entry) => entry.id === "bee")?.bytes).toBe(2048);
    expect(scan.entries.find((entry) => entry.id === "ide")?.exists).toBe(true);

    const result = await cleanCache(project, ["bee", "temp", "ide", "library"]);
    expect(result.removed.sort()).toEqual(["Game.csproj", "Library", "Temp"]);
    expect(await readFile(join(project, "Assets", "Player.cs"), "utf8")).toBe("class Player {}");
  });

  test("never follows a symlinked cache folder", async () => {
    const outside = join(root, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "keep");
    await rm(join(project, "Temp"), { recursive: true });
    await symlink(outside, join(project, "Temp"));
    const result = await cleanCache(project, ["temp"]);
    expect(result.skipped.map((item) => item.path)).toEqual(["Temp"]);
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });

  test("rejects unknown cache ids", async () => {
    await expect(cleanCache(project, ["assets"])).rejects.toThrow("desconhecidos");
  });
});

describe("players", () => {
  test("finds players under Builds and skips Unity sidecar folders", async () => {
    const { listPlayers } = await import("./players");
    await mkdir(join(project, "Builds", "Linux", "Game_Data", "Nested"), { recursive: true });
    await mkdir(join(project, "Builds", "Windows"), { recursive: true });
    await writeFile(join(project, "Builds", "Linux", "Game.x86_64"), "");
    await writeFile(join(project, "Builds", "Linux", "Game_Data", "Nested", "Fake.x86_64"), "");
    await writeFile(join(project, "Builds", "Windows", "Game.exe"), "");
    await writeFile(join(project, "Builds", "Windows", "UnityCrashHandler64.exe"), "");
    const settings = { projectRoots: [], editorRoots: [], buildOutputDir: "Builds", useUnityCli: false };
    const { players } = await listPlayers(project, settings);
    expect(players.map((player) => `${player.folder}/${player.name}`).sort()).toEqual(["Linux/Game.x86_64", "Windows/Game.exe"]);
  });
});

describe("quick play", () => {
  test("tracks the newest change in the folders that feed a build, through a clone's symlinked Assets", async () => {
    const { newestSourceChange } = await import("./build");
    const { utimes } = await import("node:fs/promises");
    const old = new Date("2020-01-01T00:00:00Z");
    for (const path of ["Assets", "Assets/Scenes", "Assets/Scenes/Menu.unity", "Assets/Scenes/Combat.unity", "Assets/Player.cs", "Packages", "Packages/manifest.json", "ProjectSettings", "ProjectSettings/ProjectVersion.txt", "ProjectSettings/EditorBuildSettings.asset"]) {
      await utimes(join(project, path), old, old);
    }
    expect(await newestSourceChange(project)).toBe(old.getTime());
    const edited = new Date("2024-05-05T00:00:00Z");
    await utimes(join(project, "Assets", "Player.cs"), edited, edited);
    expect(await newestSourceChange(project)).toBe(edited.getTime());

    const clone = join(root, "clone");
    await mkdir(clone);
    await symlink(join(project, "Assets"), join(clone, "Assets"));
    expect(await newestSourceChange(clone)).toBe(edited.getTime());
  });
});

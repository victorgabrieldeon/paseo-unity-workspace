import { describe, expect, test } from "bun:test";
import { parseBuildMethods, safeFileName } from "./build";
import { dropNested } from "./cache";
import { parseHubProjects } from "./editors";
import { isInside } from "./fsutil";
import { csharpString, parseStatusProjects } from "./live";
import { editorFromArgs, editorFromCommandLine, splitCommandLine } from "./processes";
import { parseProductName, parseProjectVersion } from "./project";
import { parseActiveScene, parseBuildScenes, sceneSetupYaml } from "./scenes";

describe("project files", () => {
  test("reads the editor version and product name", () => {
    expect(parseProjectVersion("m_EditorVersion: 6000.3.25f1\nm_EditorVersionWithRevision: 6000.3.25f1 (e1dba0a9aba4)\n")).toBe("6000.3.25f1");
    expect(parseProductName("PlayerSettings:\n  companyName: Acme\n  productName: Get Out\n")).toBe("Get Out");
    expect(parseProductName("PlayerSettings:\n  productName: \n")).toBeNull();
  });
});

describe("scenes", () => {
  const settings = [
    "EditorBuildSettings:",
    "  m_ObjectHideFlags: 0",
    "  serializedVersion: 2",
    "  m_Scenes:",
    "  - enabled: 1",
    "    path: Assets/_Project/Scenes/Menu.unity",
    "    guid: 1e60e517f50a4befdb966d3b2aab0ebc",
    "  - enabled: 0",
    "    path: Assets/_Project/Scenes/W1L1.unity",
    "    guid: 2e60e517f50a4befdb966d3b2aab0ebc",
    "  m_configObjects: {}",
    "",
  ].join("\n");

  test("parses build scenes in order with their enabled flag", () => {
    expect(parseBuildScenes(settings)).toEqual([
      { path: "Assets/_Project/Scenes/Menu.unity", enabled: true },
      { path: "Assets/_Project/Scenes/W1L1.unity", enabled: false },
    ]);
  });

  test("handles an empty scene list", () => {
    expect(parseBuildScenes("EditorBuildSettings:\n  m_Scenes: []\n  m_configObjects: {}\n")).toEqual([]);
  });

  test("round-trips the last scene setup Unity restores on open", () => {
    expect(parseActiveScene(sceneSetupYaml("Assets/Scenes/Sea.unity"))).toBe("Assets/Scenes/Sea.unity");
    const two = "sceneSetups:\n- path: Assets/A.unity\n  isLoaded: 1\n  isActive: 0\n  isSubScene: 0\n- path: Assets/B.unity\n  isLoaded: 1\n  isActive: 1\n  isSubScene: 0\n";
    expect(parseActiveScene(two)).toBe("Assets/B.unity");
  });
});

describe("build methods", () => {
  const source = `
using UnityEditor;
namespace GetOut.Editor.Level
{
    /// <summary>Linux players.</summary>
    public static class LevelBuild
    {
        [MenuItem("GetOut/Level/Build Linux Player")]
        public static void BuildLinux() => Build(LinuxOutput, BuildOptions.None);

        /// <summary>Development player.</summary>
        [MenuItem("GetOut/Level/Build Linux Player (Development)")]
        public static void BuildLinuxDev() => Build(LinuxDevOutput, BuildOptions.Development);

        public static void Smoke()
        {
            Run();
        }

        private static void Build(string output, BuildOptions options)
        {
            BuildPipeline.BuildPlayer(new BuildPlayerOptions { options = options });
        }
    }
}`;

  test("finds executeMethod entry points with menu labels and development flag", () => {
    expect(parseBuildMethods(source)).toEqual([
      { method: "GetOut.Editor.Level.LevelBuild.BuildLinux", label: "Build Linux Player", development: false },
      { method: "GetOut.Editor.Level.LevelBuild.BuildLinuxDev", label: "Build Linux Player (Development)", development: true },
      { method: "GetOut.Editor.Level.LevelBuild.Smoke", label: "Smoke", development: false },
    ]);
  });

  test("supports file-scoped namespaces and classes without namespace", () => {
    expect(parseBuildMethods("namespace Game.Build;\npublic static class Ci { public static void Release() {} }")[0]?.method).toBe("Game.Build.Ci.Release");
    expect(parseBuildMethods("public class Ci { public static void BuildDevice() {} }")[0]).toEqual({ method: "Ci.BuildDevice", label: "BuildDevice", development: false });
  });

  test("sanitizes product names for output files", () => {
    expect(safeFileName('My: "Game"/2')).toBe("My Game2");
    expect(safeFileName("   ")).toBe("Game");
  });
});

describe("processes", () => {
  test("reads the project from Linux argv", () => {
    expect(editorFromArgs(42, ["/opt/Unity/Editor/Unity", "-projectpath", "/home/me/My Game", "-useHub"])).toEqual({ pid: 42, projectPath: "/home/me/My Game", batchmode: false });
    expect(editorFromArgs(7, ["Unity", "-batchmode", "-projectPath", "/p"])).toEqual({ pid: 7, projectPath: "/p", batchmode: true });
    expect(editorFromArgs(1, ["Unity", "-projectPath"])).toBeNull();
  });

  test("reads the project from a joined macOS command line", () => {
    expect(editorFromCommandLine(3, "/Applications/Unity/Hub/Editor/6000.3.25f1/Unity.app/Contents/MacOS/Unity -projectpath /Users/me/My Game -useHub -hubIPC")?.projectPath).toBe("/Users/me/My Game");
  });

  test("splits quoted Windows command lines", () => {
    expect(splitCommandLine('"C:\\Program Files\\Unity\\Editor\\Unity.exe" -projectpath "D:\\My Game" -useHub')).toEqual([
      "C:\\Program Files\\Unity\\Editor\\Unity.exe",
      "-projectpath",
      "D:\\My Game",
      "-useHub",
    ]);
  });
});

describe("integrations", () => {
  test("parses the Unity Hub project registry", () => {
    const projects = parseHubProjects({ schema_version: "v1", data: { "/g/a": { title: "a", path: "/g/a", version: "6000.3.25f1", lastModified: 10 } } });
    expect(projects).toEqual([{ path: "/g/a", title: "a", version: "6000.3.25f1", lastModified: 10 }]);
    expect(parseHubProjects(null)).toEqual([]);
  });

  test("parses connected editors from unity status", () => {
    expect(parseStatusProjects('{"success":true,"data":{"count":1,"instances":[{"port":1,"projectPath":"/g/a","state":"ready"}]}}')).toEqual(["/g/a"]);
    expect(parseStatusProjects('{"success":false,"data":{"count":0,"instances":[]}}')).toEqual([]);
    expect(parseStatusProjects("not json")).toEqual([]);
  });

  test("escapes C# string literals", () => {
    expect(csharpString('Assets/My "Scene"\\x.unity')).toBe('"Assets/My \\"Scene\\"\\\\x.unity"');
  });
});

describe("path safety", () => {
  test("keeps nested cache paths from being counted twice", () => {
    expect(dropNested(["Library/Bee", "Temp", "Library", "Library/ShaderCache.db"])).toEqual(["Temp", "Library"]);
  });

  test("detects paths outside a root", () => {
    expect(isInside("/p", "/p/Library")).toBe(true);
    expect(isInside("/p", "/p")).toBe(true);
    expect(isInside("/p", "/p/../q")).toBe(false);
    expect(isInside("/p", "/pq")).toBe(false);
  });
});

describe("players", () => {
  test("recognizes player executables and where they can run", async () => {
    const { playerPlatform, runnableHere } = await import("./players");
    expect(playerPlatform("GetOut.x86_64")).toBe("linux");
    expect(playerPlatform("GetOut.exe")).toBe("windows");
    expect(playerPlatform("UnityCrashHandler64.exe")).toBeNull();
    expect(playerPlatform("Game.app")).toBe("macos");
    expect(playerPlatform("UnityPlayer.so")).toBeNull();
    expect(runnableHere("linux", "linux")).toBe(true);
    expect(runnableHere("windows", "linux")).toBe(false);
  });
});

describe("quick play target", () => {
  test("builds for the machine it runs on", async () => {
    const { hostTarget } = await import("./build");
    expect(hostTarget("linux")).toBe("StandaloneLinux64");
    expect(hostTarget("win32")).toBe("StandaloneWindows64");
    expect(hostTarget("darwin")).toBe("StandaloneOSX");
    expect(hostTarget("aix")).toBeNull();
  });
});

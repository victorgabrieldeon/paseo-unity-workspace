import type { PluginClientContext, PluginWorkspaceCommandContext } from "@getpaseo/plugin/client";
import { BuildPanel } from "./client/build";
import { CachePanel } from "./client/cache";
import { ClonesPanel } from "./client/clones";
import { PANELS, setPanelOpener, type PanelId } from "./client/navigation";
import { OverviewPanel } from "./client/overview";
import { WINDOWED_ARGS } from "./client/play";
import { ProjectsSurface } from "./client/projects";
import { ScenesPanel } from "./client/scenes";
import { SettingsScreen } from "./client/settings";
import { VcsPanel } from "./client/vcs";
import { BuildOptionsRpc, DetectProjectsRpc, ListScenesRpc, OpenProjectRpc, OpenSceneRpc, QuickPlayRpc, StartBuildRpc, type BuildRecipe, type UnityProject } from "./shared/contracts";

const PANEL_ALIASES: Record<string, PanelId> = {
  "": PANELS.overview,
  build: PANELS.build,
  builds: PANELS.build,
  cena: PANELS.scenes,
  cenas: PANELS.scenes,
  scene: PANELS.scenes,
  scenes: PANELS.scenes,
  clone: PANELS.clones,
  clones: PANELS.clones,
  parrelsync: PANELS.clones,
  cache: PANELS.cache,
  limpar: PANELS.cache,
  vcs: PANELS.vcs,
  plastic: PANELS.vcs,
  uvcs: PANELS.vcs,
};

const TARGET_ALIASES: Record<string, BuildRecipe> = {
  linux: { kind: "target", target: "StandaloneLinux64" },
  windows: { kind: "target", target: "StandaloneWindows64" },
  win: { kind: "target", target: "StandaloneWindows64" },
  mac: { kind: "target", target: "StandaloneOSX" },
  macos: { kind: "target", target: "StandaloneOSX" },
  osx: { kind: "target", target: "StandaloneOSX" },
};

async function workspaceProject({ rpc, workspace }: Pick<PluginWorkspaceCommandContext, "rpc" | "workspace">): Promise<UnityProject> {
  const { projects } = await rpc(DetectProjectsRpc, { directory: workspace.directory });
  const project = projects[0];
  if (project === undefined) throw new Error(`Nenhum projeto Unity em ${workspace.directory}.`);
  return project;
}

/** Exact name first, then the first build scene containing the text, then any path containing it. */
function pickByName<T>(items: readonly T[], query: string, keys: (item: T) => readonly string[]): T | undefined {
  const needle = query.trim().toLowerCase();
  return (
    items.find((item) => keys(item).some((key) => key.toLowerCase() === needle)) ??
    items.find((item) => keys(item).some((key) => key.toLowerCase().includes(needle)))
  );
}

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    setPanelOpener((id, options) => client.openPanel(id, options)),
    client.addSurface("projects", ProjectsSurface),
    client.addSidebarItem({ id: "projects", title: "Unity", icon: "Gamepad2", surface: "projects" }),
    client.addSettingsScreen({ id: "settings", title: "Unity", icon: "Gamepad2", Component: SettingsScreen }),
    client.addWorkspacePanel({ id: PANELS.overview, title: "Unity", icon: "Gamepad2", context: "workspace", Component: OverviewPanel }),
    client.addWorkspacePanel({ id: PANELS.build, title: "Unity Build", icon: "Hammer", context: "workspace", Component: BuildPanel }),
    client.addWorkspacePanel({ id: PANELS.scenes, title: "Cenas", icon: "Clapperboard", context: "workspace", locations: ["workspace", "explorer"], Component: ScenesPanel }),
    client.addWorkspacePanel({ id: PANELS.clones, title: "ParrelSync", icon: "Users", context: "workspace", Component: ClonesPanel }),
    client.addWorkspacePanel({ id: PANELS.cache, title: "Unity Cache", icon: "Trash2", context: "workspace", Component: CachePanel }),
    client.addWorkspacePanel({ id: PANELS.vcs, title: "Version Control", icon: "GitBranch", context: "workspace", locations: ["workspace", "explorer"], Component: VcsPanel }),

    client.addCommandCenterItem({ id: "projects", title: "Unity: projetos", icon: "Gamepad2", keywords: ["unity", "hub", "editor"], context: "global", onSelect: ({ openSurface }) => openSurface("projects") }),
    client.addCommandCenterItem({ id: "settings", title: "Unity: configurações", icon: "Settings2", keywords: ["unity"], context: "global", onSelect: ({ openSettings }) => openSettings("settings") }),
    client.addCommandCenterItem({ id: "overview", title: "Unity: painel do projeto", icon: "Gamepad2", keywords: ["unity", "cockpit"], context: "workspace", onSelect: ({ openPanel }) => openPanel(PANELS.overview) }),
    client.addCommandCenterItem({ id: "build", title: "Unity: build", icon: "Hammer", keywords: ["unity", "build", "player", "release", "development"], context: "workspace", onSelect: ({ openPanel }) => openPanel(PANELS.build) }),
    client.addCommandCenterItem({ id: "scenes", title: "Unity: cenas", icon: "Clapperboard", keywords: ["unity", "scene", "cena"], context: "workspace", onSelect: ({ openPanel }) => openPanel(PANELS.scenes) }),
    client.addCommandCenterItem({ id: "clones", title: "Unity: clones ParrelSync", icon: "Users", keywords: ["unity", "parrelsync", "multiplayer", "clone"], context: "workspace", onSelect: ({ openPanel }) => openPanel(PANELS.clones) }),
    client.addCommandCenterItem({ id: "cache", title: "Unity: limpar cache", icon: "Trash2", keywords: ["unity", "library", "cache", "temp"], context: "workspace", onSelect: ({ openPanel }) => openPanel(PANELS.cache) }),
    client.addCommandCenterItem({ id: "vcs", title: "Unity: Version Control", icon: "GitBranch", keywords: ["unity", "plastic", "uvcs", "version control", "changeset", "lock"], context: "workspace", onSelect: ({ openPanel }) => openPanel(PANELS.vcs) }),
    client.addCommandCenterItem({
      id: "open-editor",
      title: "Unity: abrir projeto no Editor",
      icon: "SquareArrowOutUpRight",
      keywords: ["unity", "editor", "abrir"],
      context: "workspace",
      async onSelect(context) {
        const project = await workspaceProject(context);
        await context.rpc(OpenProjectRpc, { projectPath: project.path });
        context.openPanel(PANELS.overview);
      },
    }),

    client.addSlashCommand({
      name: "unity",
      description: "Abre o painel Unity (ou build, cenas, clones, cache)",
      argumentHint: "[build|cenas|clones|cache|vcs]",
      context: "workspace",
      onSubmit({ args, openPanel }) {
        const panel = PANEL_ALIASES[args.trim().toLowerCase()];
        if (panel === undefined) throw new Error(`Use /unity, /unity build, /unity cenas, /unity clones, /unity cache ou /unity vcs.`);
        openPanel(panel);
      },
    }),
    client.addCommandCenterItem({
      id: "play",
      title: "Unity: jogar (sem abrir o Editor)",
      icon: "Play",
      keywords: ["unity", "play", "jogar", "rodar"],
      context: "workspace",
      async onSelect(context) {
        const project = await workspaceProject(context);
        await context.rpc(QuickPlayRpc, { projectPath: project.path, args: WINDOWED_ARGS, instances: 1, force: false });
        context.openPanel(PANELS.overview);
      },
    }),
    client.addSlashCommand({
      name: "unity-play",
      description: "Joga o projeto sem abrir o Unity (build rápido + abre o jogo)",
      argumentHint: "[jogadores 1-4]",
      context: "workspace",
      async onSubmit(context) {
        const instances = context.args.trim() === "" ? 1 : Number(context.args.trim());
        if (!Number.isInteger(instances) || instances < 1 || instances > 4) throw new Error("Use /unity-play ou /unity-play 2 (até 4 jogadores).");
        const project = await workspaceProject(context);
        await context.rpc(QuickPlayRpc, { projectPath: project.path, args: WINDOWED_ARGS, instances, force: false });
        context.openPanel(PANELS.overview);
      },
    }),
    client.addSlashCommand({
      name: "unity-open",
      description: "Abre o projeto Unity deste workspace no Editor",
      argumentHint: "",
      context: "workspace",
      async onSubmit(context) {
        const project = await workspaceProject(context);
        await context.rpc(OpenProjectRpc, { projectPath: project.path });
      },
    }),
    client.addSlashCommand({
      name: "unity-scene",
      description: "Abre o Unity numa cena (busca pelo nome)",
      argumentHint: "<cena>",
      context: "workspace",
      async onSubmit(context) {
        if (context.args.trim() === "") {
          context.openPanel(PANELS.scenes);
          return;
        }
        const project = await workspaceProject(context);
        const { scenes } = await context.rpc(ListScenesRpc, { projectPath: project.path });
        const ordered = [...scenes.filter((scene) => scene.buildIndex !== null), ...scenes.filter((scene) => scene.buildIndex === null)];
        const scene = pickByName(ordered, context.args, (candidate) => [candidate.name, candidate.path]);
        if (scene === undefined) throw new Error(`Nenhuma cena com "${context.args}" em ${project.name}.`);
        await context.rpc(OpenSceneRpc, { projectPath: project.path, scenePath: scene.path });
      },
    }),
    client.addSlashCommand({
      name: "unity-build",
      description: "Builda o projeto Unity (plataforma, método ou Build Profile)",
      argumentHint: "[linux|windows|mac|<método>|<perfil>]",
      context: "workspace",
      async onSubmit(context) {
        const query = context.args.trim();
        if (query === "") {
          context.openPanel(PANELS.build);
          return;
        }
        const project = await workspaceProject(context);
        let recipe = TARGET_ALIASES[query.toLowerCase()];
        if (recipe === undefined) {
          const options = await context.rpc(BuildOptionsRpc, { projectPath: project.path });
          const method = pickByName(options.methods, query, (candidate) => [candidate.label, candidate.method, candidate.method.split(".").pop() ?? ""]);
          const profile = method === undefined ? pickByName(options.profiles, query, (candidate) => [candidate.name]) : undefined;
          if (method !== undefined) recipe = { kind: "method", method: method.method };
          else if (profile !== undefined) recipe = { kind: "profile", profilePath: profile.path };
          else throw new Error(`Nada para buildar com "${query}". Use linux, windows, mac, o nome de um método de build ou de um Build Profile.`);
        }
        await context.rpc(StartBuildRpc, { projectPath: project.path, recipe });
        context.openPanel(PANELS.build);
      },
    }),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}

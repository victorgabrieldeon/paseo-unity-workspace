import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  BuildOptionsRpc,
  CancelJobRpc,
  CleanCacheRpc,
  CreateCloneRpc,
  DeleteCloneRpc,
  DetectProjectsRpc,
  InstallParrelSyncRpc,
  LaunchArtifactRpc,
  LaunchPlayerRpc,
  ListPlayersRpc,
  ListClonesRpc,
  ListJobsRpc,
  ListProjectsRpc,
  ListScenesRpc,
  OpenInstancesRpc,
  OpenProjectRpc,
  OpenSceneRpc,
  ProjectStatusRpc,
  QuickPlayRpc,
  ScanCacheRpc,
  SetCloneArgumentRpc,
  StartBuildRpc,
} from "./shared/contracts";
import { unitySettings, type UnitySettings } from "./shared/settings";
import { buildOptions, launchArtifact, quickPlay, startBuild } from "./server/build";
import { cleanCache, scanCache } from "./server/cache";
import { createClone, deleteClone, installParrelSync, listClones, openInstances, setCloneArgument } from "./server/clones";
import { cancelAll, cancelJob, listJobs } from "./server/jobs";
import { listProjects, openProject, projectStatus } from "./server/manager";
import { detectProjects } from "./server/project";
import { launchProjectPlayer, listPlayers } from "./server/players";
import { splitCommandLine } from "./server/processes";
import { listScenes, openScene } from "./server/scenes";

export default function contribute(server: PluginServerContext) {
  const settingsHandle = server.registerSettings(unitySettings);
  const defaults = unitySettings.schema.parse({});
  const settings = async (): Promise<UnitySettings> => {
    const state = await settingsHandle.read();
    return state.status === "ready" ? state.values : defaults;
  };

  server.handle(DetectProjectsRpc, async ({ directory }) => ({ projects: await detectProjects(directory) }));
  server.handle(ProjectStatusRpc, async ({ projectPath }) => projectStatus(projectPath, await settings()));
  server.handle(ListProjectsRpc, async (_input, { paseo }) => listProjects(paseo, await settings()));
  server.handle(OpenProjectRpc, async ({ projectPath, editorVersion }) => openProject(projectPath, editorVersion, await settings()));

  server.handle(ListScenesRpc, ({ projectPath }) => listScenes(projectPath));
  server.handle(OpenSceneRpc, async ({ projectPath, scenePath }) => openScene(projectPath, scenePath, await settings()));

  server.handle(ListJobsRpc, ({ projectPath, kind }) => ({ jobs: listJobs(projectPath, kind) }));
  server.handle(CancelJobRpc, ({ jobId }) => cancelJob(jobId));

  server.handle(BuildOptionsRpc, async ({ projectPath }) => buildOptions(projectPath, await settings()));
  server.handle(StartBuildRpc, async ({ projectPath, recipe }) => startBuild(projectPath, recipe, await settings()));
  server.handle(LaunchArtifactRpc, ({ jobId }) => launchArtifact(jobId));
  server.handle(QuickPlayRpc, async ({ projectPath, args, instances, force }) => quickPlay(projectPath, splitCommandLine(args), instances, force, await settings()));
  server.handle(ListPlayersRpc, async ({ projectPath }) => listPlayers(projectPath, await settings()));
  server.handle(LaunchPlayerRpc, async ({ projectPath, playerPath, args, instances }) => launchProjectPlayer(projectPath, playerPath, args, instances, await settings()));

  server.handle(ScanCacheRpc, ({ projectPath }) => scanCache(projectPath));
  server.handle(CleanCacheRpc, ({ projectPath, ids }) => cleanCache(projectPath, ids));

  server.handle(ListClonesRpc, ({ projectPath }) => listClones(projectPath));
  server.handle(CreateCloneRpc, ({ projectPath, copyLibrary }) => createClone(projectPath, copyLibrary));
  server.handle(DeleteCloneRpc, ({ projectPath, clonePath }) => deleteClone(projectPath, clonePath));
  server.handle(SetCloneArgumentRpc, ({ projectPath, clonePath, argument }) => setCloneArgument(projectPath, clonePath, argument));
  server.handle(OpenInstancesRpc, async ({ projectPath, paths }) => openInstances(projectPath, paths, await settings()));
  server.handle(InstallParrelSyncRpc, ({ projectPath }) => installParrelSync(projectPath));

  return () => cancelAll();
}

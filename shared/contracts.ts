import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// ── Projects and editors ──────────────────────────────────────────────

export const UnityProjectSchema = z.object({
  path: z.string(),
  name: z.string(),
  productName: z.string().nullable(),
  editorVersion: z.string().nullable(),
});

export const EditorInstallSchema = z.object({
  version: z.string(),
  executable: z.string(),
  modules: z.array(z.string()),
});

export const RunningEditorSchema = z.object({
  pid: z.number().int(),
  projectPath: z.string(),
  batchmode: z.boolean(),
});

export const ProjectPackagesSchema = z.object({
  parrelsync: z.boolean(),
  multiplayerPlayMode: z.boolean(),
  netcode: z.boolean(),
  pipeline: z.boolean(),
});

export const ProjectStatusSchema = z.object({
  project: UnityProjectSchema,
  editor: EditorInstallSchema.nullable(),
  running: z.array(RunningEditorSchema),
  lockfile: z.boolean(),
  liveEditor: z.boolean(),
  clone: z.object({ index: z.number().int(), originalPath: z.string() }).nullable(),
  git: z.object({ branch: z.string().nullable(), commit: z.string().nullable() }).nullable(),
  packages: ProjectPackagesSchema,
});

export const ProjectSourceSchema = z.enum(["hub", "paseo", "scan"]);

export const ProjectListItemSchema = UnityProjectSchema.extend({
  sources: z.array(ProjectSourceSchema),
  editorInstalled: z.boolean(),
  open: z.boolean(),
  missing: z.boolean(),
  lastModified: z.number().nullable(),
});

export const OpenResultSchema = z.object({
  status: z.enum(["launched", "already-open", "live"]),
  pid: z.number().int().nullable(),
  message: z.string(),
});

const ProjectInputSchema = z.object({ projectPath: z.string().min(1) });

export const DetectProjectsRpc = defineRpc({
  name: "unity.detect",
  input: z.object({ directory: z.string().min(1) }),
  output: z.object({ projects: z.array(UnityProjectSchema) }),
});

export const ProjectStatusRpc = defineRpc({
  name: "unity.status",
  input: ProjectInputSchema,
  output: ProjectStatusSchema,
});

export const ListProjectsRpc = defineRpc({
  name: "unity.projects",
  input: z.object({}),
  output: z.object({
    projects: z.array(ProjectListItemSchema),
    editors: z.array(EditorInstallSchema),
    cliAvailable: z.boolean(),
  }),
});

export const OpenProjectRpc = defineRpc({
  name: "unity.open",
  input: ProjectInputSchema.extend({ editorVersion: z.string().optional() }),
  output: OpenResultSchema,
});

// ── Scenes ────────────────────────────────────────────────────────────

export const SceneSchema = z.object({
  path: z.string(),
  name: z.string(),
  group: z.string(),
  buildIndex: z.number().int().nullable(),
  enabled: z.boolean(),
});

export const ListScenesRpc = defineRpc({
  name: "unity.scenes.list",
  input: ProjectInputSchema,
  output: z.object({ scenes: z.array(SceneSchema), lastOpened: z.string().nullable() }),
});

export const OpenSceneRpc = defineRpc({
  name: "unity.scenes.open",
  input: ProjectInputSchema.extend({ scenePath: z.string().min(1) }),
  output: OpenResultSchema,
});

// ── Jobs (builds and clone copies) ────────────────────────────────────

export const JobStateSchema = z.enum(["running", "succeeded", "failed", "cancelled"]);

export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum(["build", "clone"]),
  projectPath: z.string(),
  title: z.string(),
  state: JobStateSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  message: z.string().nullable(),
  logPath: z.string().nullable(),
  logTail: z.array(z.string()),
  errors: z.array(z.string()),
  artifactPath: z.string().nullable(),
});

export const ListJobsRpc = defineRpc({
  name: "unity.jobs.list",
  input: ProjectInputSchema.extend({ kind: z.enum(["build", "clone"]).optional() }),
  output: z.object({ jobs: z.array(JobSchema) }),
});

export const CancelJobRpc = defineRpc({
  name: "unity.jobs.cancel",
  input: z.object({ jobId: z.string().min(1) }),
  output: JobSchema,
});

// ── Builds ────────────────────────────────────────────────────────────

export const BuildTargetSchema = z.enum(["StandaloneLinux64", "StandaloneWindows64", "StandaloneOSX"]);

export const BuildRecipeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("method"), method: z.string().min(1) }),
  z.object({ kind: z.literal("profile"), profilePath: z.string().min(1) }),
  z.object({ kind: z.literal("target"), target: BuildTargetSchema }),
]);

export const BuildMethodSchema = z.object({
  method: z.string(),
  label: z.string(),
  file: z.string(),
  development: z.boolean(),
});

export const BuildProfileSchema = z.object({ path: z.string(), name: z.string() });

export const BuildTargetOptionSchema = z.object({
  target: BuildTargetSchema,
  label: z.string(),
  moduleInstalled: z.boolean(),
});

export const BuildOptionsRpc = defineRpc({
  name: "unity.build.options",
  input: ProjectInputSchema,
  output: z.object({
    methods: z.array(BuildMethodSchema),
    profiles: z.array(BuildProfileSchema),
    targets: z.array(BuildTargetOptionSchema),
    outputRoot: z.string(),
    supportsProfiles: z.boolean(),
  }),
});

export const StartBuildRpc = defineRpc({
  name: "unity.build.start",
  input: ProjectInputSchema.extend({ recipe: BuildRecipeSchema }),
  output: JobSchema,
});

export const LaunchArtifactRpc = defineRpc({
  name: "unity.build.launch",
  input: z.object({ jobId: z.string().min(1) }),
  output: z.object({ pid: z.number().int().nullable(), message: z.string() }),
});

// ── Cache cleaner ─────────────────────────────────────────────────────

export const CacheEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  paths: z.array(z.string()),
  description: z.string(),
  level: z.enum(["light", "full"]),
  bytes: z.number(),
  exists: z.boolean(),
});

export const ScanCacheRpc = defineRpc({
  name: "unity.cache.scan",
  input: ProjectInputSchema,
  output: z.object({ entries: z.array(CacheEntrySchema), editorOpen: z.boolean() }),
});

export const CleanCacheRpc = defineRpc({
  name: "unity.cache.clean",
  input: ProjectInputSchema.extend({ ids: z.array(z.string()).min(1) }),
  output: z.object({
    freedBytes: z.number(),
    removed: z.array(z.string()),
    skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  }),
});

// ── ParrelSync clones ─────────────────────────────────────────────────

export const CloneSchema = z.object({
  index: z.number().int(),
  path: z.string(),
  argument: z.string(),
  open: z.boolean(),
  brokenLinks: z.array(z.string()),
});

export const ListClonesRpc = defineRpc({
  name: "unity.clones.list",
  input: ProjectInputSchema,
  output: z.object({
    originalPath: z.string(),
    isClone: z.boolean(),
    originalOpen: z.boolean(),
    packages: ProjectPackagesSchema,
    clones: z.array(CloneSchema),
  }),
});

export const CreateCloneRpc = defineRpc({
  name: "unity.clones.create",
  input: ProjectInputSchema.extend({ copyLibrary: z.boolean() }),
  output: JobSchema,
});

export const DeleteCloneRpc = defineRpc({
  name: "unity.clones.delete",
  input: ProjectInputSchema.extend({ clonePath: z.string().min(1) }),
  output: z.object({ freedBytes: z.number() }),
});

export const SetCloneArgumentRpc = defineRpc({
  name: "unity.clones.argument",
  input: ProjectInputSchema.extend({ clonePath: z.string().min(1), argument: z.string().max(200) }),
  output: CloneSchema,
});

export const OpenInstancesRpc = defineRpc({
  name: "unity.clones.open",
  input: ProjectInputSchema.extend({ paths: z.array(z.string().min(1)).min(1) }),
  output: z.object({
    launched: z.array(z.object({ path: z.string(), pid: z.number().int().nullable() })),
    skipped: z.array(z.object({ path: z.string(), reason: z.string() })),
  }),
});

export const InstallParrelSyncRpc = defineRpc({
  name: "unity.clones.install",
  input: ProjectInputSchema,
  output: z.object({ changed: z.boolean(), message: z.string() }),
});

export type UnityProject = z.output<typeof UnityProjectSchema>;
export type EditorInstall = z.output<typeof EditorInstallSchema>;
export type RunningEditor = z.output<typeof RunningEditorSchema>;
export type ProjectStatus = z.output<typeof ProjectStatusSchema>;
export type ProjectPackages = z.output<typeof ProjectPackagesSchema>;
export type ProjectListItem = z.output<typeof ProjectListItemSchema>;
export type OpenResult = z.output<typeof OpenResultSchema>;
export type Scene = z.output<typeof SceneSchema>;
export type Job = z.output<typeof JobSchema>;
export type BuildTarget = z.output<typeof BuildTargetSchema>;
export type BuildRecipe = z.output<typeof BuildRecipeSchema>;
export type BuildMethod = z.output<typeof BuildMethodSchema>;
export type BuildProfile = z.output<typeof BuildProfileSchema>;
export type CacheEntry = z.output<typeof CacheEntrySchema>;
export type Clone = z.output<typeof CloneSchema>;

import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const unitySettings = defineSettings({
  id: "unity",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Folders scanned for Unity projects besides the Unity Hub list and Paseo workspaces. */
    projectRoots: z.array(z.string()).default([]),
    /** Extra editor install folders, laid out like `<root>/<version>/Editor/Unity`. */
    editorRoots: z.array(z.string()).default([]),
    /** Build output folder, relative to the project root. */
    buildOutputDir: z.string().min(1).default("Builds"),
    /** Talk to an open Editor through the Unity CLI (`unity command`) when it is connected. */
    useUnityCli: z.boolean().default(true),
  }),
});

export type UnitySettings = z.output<typeof unitySettings.schema>;

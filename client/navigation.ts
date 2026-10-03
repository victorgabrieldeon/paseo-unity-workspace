import type { PluginClientContext } from "@getpaseo/plugin/client";

export const PANELS = {
  overview: "unity",
  build: "unity-build",
  scenes: "unity-scenes",
  clones: "unity-clones",
  cache: "unity-cache",
  vcs: "unity-vcs",
} as const;

export type PanelId = (typeof PANELS)[keyof typeof PANELS];

let openPanel: PluginClientContext["openPanel"] | null = null;

/** Panels receive no opener in their props; the entry hands the client's opener over while the plugin runs. */
export function setPanelOpener(opener: PluginClientContext["openPanel"]): () => void {
  openPanel = opener;
  return () => {
    if (openPanel === opener) openPanel = null;
  };
}

export function openToolPanel(id: PanelId, workspaceId: string): void {
  openPanel?.(id, { workspaceId });
}

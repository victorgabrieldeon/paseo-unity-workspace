import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { ListScenesRpc, type UnityProject } from "../shared/contracts";
import { useJobs } from "./build";
import { PANELS, openToolPanel, type PanelId } from "./navigation";
import { QuickPlayCard } from "./play";
import { PanelShell, isProjectOpen, useProjectStatus } from "./project";
import { SceneRow, scenesKey } from "./scenes";
import { Chip, Section, type Styles } from "./ui";

const TOOLS: readonly { id: PanelId; title: string; description: string; icon: string }[] = [
  { id: PANELS.build, title: "Build", description: "Métodos, Build Profiles e plataformas", icon: "Hammer" },
  { id: PANELS.scenes, title: "Cenas", description: "Abrir o Unity direto numa cena", icon: "Clapperboard" },
  { id: PANELS.clones, title: "ParrelSync", description: "Clones para testar multiplayer", icon: "Users" },
  { id: PANELS.cache, title: "Cache", description: "Library, Temp, obj e afins", icon: "Trash2" },
  { id: PANELS.vcs, title: "Version Control", description: "Branch, mudanças, locks e changesets", icon: "GitBranch" },
];

export function OverviewPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <PanelShell theme={theme} layout={layout} workspaceId={workspaceId} title="Unity" subtitle="Cockpit do projeto: editor, build, cenas, clones e cache.">
      {(project, styles) => <Overview project={project} workspaceId={workspaceId} compact={layout.compact} theme={theme} styles={styles} />}
    </PanelShell>
  );
}

function Overview({ project, workspaceId, compact, theme, styles }: {
  readonly project: UnityProject;
  readonly workspaceId: string;
  readonly compact: boolean;
  readonly theme: PluginTheme;
  readonly styles: Styles;
}) {
  const status = useProjectStatus(project.path);
  const list = useRpc(ListScenesRpc);
  const scenes = useQuery({ queryKey: scenesKey(project.path), queryFn: () => list({ projectPath: project.path }) });
  const jobs = useJobs(project.path, "build");
  const lastBuild = jobs.data?.jobs[0] ?? null;
  const buildScenes = scenes.data?.scenes.filter((scene) => scene.buildIndex !== null).slice(0, 6) ?? [];
  const open = isProjectOpen(status.data);
  const live = status.data?.liveEditor ?? false;
  const packages = status.data?.packages;

  return (
    <>
      <QuickPlayCard project={project} theme={theme} styles={styles} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {TOOLS.map((tool) => (
          <Pressable
            key={tool.id}
            accessibilityRole="button"
            accessibilityLabel={`Abrir ${tool.title}`}
            accessibilityHint={tool.description}
            onPress={() => openToolPanel(tool.id, workspaceId)}
            style={({ pressed }) => [styles.card, { flexBasis: compact ? "100%" : "47%", flexGrow: 1, minHeight: 76 }, pressed && styles.pressed]}
          >
            <View style={styles.heading}>
              <Icon name={tool.icon} size={18} color={theme.colors.accent} />
              <View style={styles.grow}>
                <Text style={styles.sectionTitle}>{tool.title}</Text>
                <Text style={styles.small}>{tool.id === PANELS.build && lastBuild ? `Último: ${lastBuild.title} · ${lastBuild.state === "running" ? "rodando" : lastBuild.state === "succeeded" ? "ok" : lastBuild.state === "failed" ? "falhou" : "cancelado"}` : tool.description}</Text>
              </View>
              <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} />
            </View>
          </Pressable>
        ))}
      </View>

      <Section title="Cenas do build" hint={buildScenes.length > 0 ? "Toque para abrir o Unity nesta cena." : undefined} styles={styles}>
        {scenes.isSuccess && buildScenes.length === 0 ? <Text style={styles.muted}>Nenhuma cena no Build Settings. Veja todas em Cenas.</Text> : null}
        {buildScenes.length > 0 ? (
          <View style={styles.list}>
            {buildScenes.map((scene, index) => (
              <SceneRow key={scene.path} project={project} scene={scene} lastOpened={scenes.data?.lastOpened === scene.path} first={index === 0} disabled={open && !live} theme={theme} styles={styles} />
            ))}
          </View>
        ) : null}
      </Section>

      {packages ? (
        <Section title="Pacotes relevantes" styles={styles}>
          <View style={styles.inline}>
            <Chip label="Netcode" icon={packages.netcode ? "Check" : "Minus"} active={packages.netcode} styles={styles} theme={theme} />
            <Chip label="Multiplayer Play Mode" icon={packages.multiplayerPlayMode ? "Check" : "Minus"} active={packages.multiplayerPlayMode} styles={styles} theme={theme} />
            <Chip label="ParrelSync" icon={packages.parrelsync ? "Check" : "Minus"} active={packages.parrelsync} styles={styles} theme={theme} />
            <Chip label="Unity Pipeline (CLI)" icon={packages.pipeline ? "Check" : "Minus"} active={packages.pipeline} styles={styles} theme={theme} />
          </View>
          {packages.pipeline && open && !live ? <Text style={styles.small}>O Editor está aberto mas a Unity CLI não o encontrou; confira com `unity status` no terminal.</Text> : null}
        </Section>
      ) : null}

      {status.data && status.data.running.length > 0 ? (
        <Section title="Processos Unity deste projeto" styles={styles}>
          {status.data.running.map((editor) => (
            <Text key={editor.pid} style={styles.mono} selectable>PID {editor.pid}{editor.batchmode ? " · batch mode" : " · Editor"}</Text>
          ))}
        </Section>
      ) : status.data?.lockfile ? (
        <Text style={styles.small}>Temp/UnityLockfile existe mas nenhum Unity está rodando: sobra de um Editor que fechou de forma inesperada. Limpar Temp em Cache resolve.</Text>
      ) : null}
    </>
  );
}

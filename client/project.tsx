import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useSyncExternalStore } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { DetectProjectsRpc, OpenProjectRpc, ProjectStatusRpc, type ProjectStatus, type UnityProject } from "../shared/contracts";
import { Button, Chip, StatusDot, errorMessage, useStyles, type Styles } from "./ui";

// The project picked in one Unity panel is shared by every Unity panel of that workspace.
const selections = new Map<string, string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function selectProject(workspaceId: string, path: string) {
  selections.set(workspaceId, path);
  for (const listener of listeners) listener();
}

export const statusKey = (projectPath: string) => ["unity", "status", projectPath] as const;

export function useWorkspaceProject(workspaceId: string) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const detect = useRpc(DetectProjectsRpc);
  const query = useQuery({
    queryKey: ["unity", "detect", directory],
    queryFn: () => detect({ directory: directory ?? "" }),
    enabled: directory !== null && directory !== "",
    staleTime: 30_000,
  });
  const selected = useSyncExternalStore(subscribe, () => selections.get(workspaceId) ?? null);
  const projects = query.data?.projects ?? [];
  const project = projects.find((candidate) => candidate.path === selected) ?? projects[0] ?? null;
  return { directory, query, projects, project, select: (path: string) => selectProject(workspaceId, path) };
}

export function useProjectStatus(projectPath: string | null) {
  const status = useRpc(ProjectStatusRpc);
  return useQuery({
    queryKey: statusKey(projectPath ?? ""),
    queryFn: () => status({ projectPath: projectPath ?? "" }),
    enabled: projectPath !== null,
    refetchInterval: 4_000,
  });
}

export function isProjectOpen(status: ProjectStatus | undefined): boolean {
  return (status?.running.length ?? 0) > 0 || (status?.liveEditor ?? false);
}

/** Shared frame for every Unity workspace panel: title, project picker, status header, and empty/error states. */
export function PanelShell({ theme, layout, workspaceId, title, subtitle, trailing, children }: Pick<PluginWorkspacePanelProps, "theme" | "layout" | "workspaceId"> & {
  readonly title: string;
  readonly subtitle: string;
  readonly trailing?: React.ReactNode;
  readonly children: (project: UnityProject, styles: Styles) => React.ReactNode;
}) {
  const styles = useStyles(theme, layout.compact);
  const { directory, query, projects, project, select } = useWorkspaceProject(workspaceId);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.muted}>{subtitle}</Text>
        </View>
        {trailing}
      </View>
      {query.isPending && directory !== null ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {query.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {query.isSuccess && project === null ? (
        <View style={styles.card}>
          <Text style={styles.body}>Nenhum projeto Unity encontrado neste workspace.</Text>
          <Text style={styles.muted}>Procurei ProjectSettings/ProjectVersion.txt em {directory} (acima e até dois níveis abaixo). Use a tela Unity na barra lateral para abrir um projeto como workspace.</Text>
        </View>
      ) : null}
      {projects.length > 1 ? (
        <View style={styles.inline} accessibilityLabel="Projetos Unity neste workspace">
          {projects.map((candidate) => (
            <Chip key={candidate.path} label={candidate.name} icon="Box" active={candidate.path === project?.path} onPress={() => select(candidate.path)} styles={styles} theme={theme} />
          ))}
        </View>
      ) : null}
      {project !== null ? (
        <>
          <ProjectHeader project={project} theme={theme} styles={styles} />
          {children(project, styles)}
        </>
      ) : null}
    </ScrollView>
  );
}

export function ProjectHeader({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const status = useProjectStatus(project.path);
  const open = useRpc(OpenProjectRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const openMutation = useMutation({
    mutationFn: () => open({ projectPath: project.path }),
    onSuccess: (result) => {
      toast.show(result.message, { variant: result.status === "launched" ? "success" : "info" });
      void queryClient.invalidateQueries({ queryKey: statusKey(project.path) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const data = status.data;
  const isOpen = isProjectOpen(data);
  const batch = data?.running.some((editor) => editor.batchmode) ?? false;
  const stateLabel = batch ? "Batch mode" : isOpen ? `Aberto${data?.running[0] ? ` · PID ${data.running[0].pid}` : ""}` : "Fechado";
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.heading}>
        <StatusDot color={batch ? theme.colors.statusWarning : isOpen ? theme.colors.statusSuccess : theme.colors.foregroundMuted} styles={styles} />
        <View style={styles.grow}>
          <Text style={styles.sectionTitle} numberOfLines={1}>{project.productName ?? project.name}</Text>
          <Text style={styles.mono} numberOfLines={1} selectable>{project.path}</Text>
        </View>
        <Button label={isOpen ? "Aberto" : "Abrir no Unity"} icon="SquareArrowOutUpRight" small primary={!isOpen} disabled={isOpen} busy={openMutation.isPending} onPress={() => openMutation.mutate()} styles={styles} theme={theme} />
      </View>
      <View style={styles.inline}>
        <Chip label={stateLabel} icon={isOpen ? "Play" : "Square"} styles={styles} theme={theme} />
        {project.editorVersion ? <Chip label={`Unity ${project.editorVersion}${data && data.editor === null ? " · não instalado" : ""}`} icon={data && data.editor === null ? "TriangleAlert" : "Box"} styles={styles} theme={theme} /> : null}
        {data?.git?.branch ? <Chip label={`${data.git.branch}${data.git.commit ? ` @ ${data.git.commit}` : ""}`} icon="GitBranch" styles={styles} theme={theme} /> : null}
        {data?.clone ? <Chip label={`Clone ${data.clone.index}`} icon="Copy" styles={styles} theme={theme} /> : null}
        {data?.liveEditor ? <Chip label="Unity CLI conectada" icon="Plug" styles={styles} theme={theme} /> : null}
      </View>
      {data && data.editor === null && project.editorVersion ? (
        <View style={styles.inline}>
          <Icon name="TriangleAlert" size={14} color={theme.colors.statusWarning} />
          <Text style={[styles.warning, { flex: 1 }]}>Unity {project.editorVersion} não foi encontrado. Instale pelo Unity Hub ou configure a pasta do editor nas configurações do plugin.</Text>
        </View>
      ) : null}
      {status.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(status.error)}</Text> : null}
    </View>
  );
}

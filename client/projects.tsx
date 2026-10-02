import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, usePaseo, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { ListProjectsRpc, OpenProjectRpc, type ProjectListItem } from "../shared/contracts";
import { Button, Chip, Section, StatusDot, errorMessage, useStyles, type Styles } from "./ui";

const SOURCE_LABELS: Record<ProjectListItem["sources"][number], string> = { hub: "Unity Hub", paseo: "Paseo", scan: "Pasta" };
const projectsKey = ["unity", "projects"] as const;

export function ProjectsSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const styles = useStyles(theme, layout.compact);
  const list = useRpc(ListProjectsRpc);
  const query = useQuery({ queryKey: projectsKey, queryFn: () => list({}), refetchInterval: 10_000 });
  const [filter, setFilter] = useState("");
  const projects = query.data?.projects ?? [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle === "" ? projects : projects.filter((project) => `${project.name} ${project.productName ?? ""} ${project.path}`.toLowerCase().includes(needle));
  }, [projects, filter]);
  const openWorkspace = navigation?.openWorkspace;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={styles.title}>Unity</Text>
          <Text style={styles.muted}>Projetos do Unity Hub, dos workspaces do Paseo e das pastas configuradas.</Text>
        </View>
        {query.isFetching ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      </View>
      {query.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text> : null}
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Buscar projeto"
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="Buscar projeto Unity"
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.input}
      />
      <Section title={`${projects.length} projeto${projects.length === 1 ? "" : "s"}`} styles={styles}>
        {query.isSuccess && visible.length === 0 ? (
          <Text style={styles.empty}>{projects.length === 0 ? "Nenhum projeto Unity encontrado. Adicione pastas em Configurações → Plugins → unity-workspace." : "Nenhum projeto corresponde à busca."}</Text>
        ) : null}
        {visible.map((project) => (
          <ProjectCard key={project.path} project={project} onOpenWorkspace={openWorkspace} theme={theme} styles={styles} />
        ))}
      </Section>
      {query.data ? (
        <Section title="Editores instalados" hint={query.data.cliAvailable ? "Unity CLI encontrada: cenas trocam no Editor aberto quando o pacote com.unity.pipeline está instalado." : "Unity CLI não encontrada no PATH (opcional)."} styles={styles}>
          {query.data.editors.length === 0 ? <Text style={styles.muted}>Nenhum editor encontrado nas pastas do Unity Hub.</Text> : null}
          <View style={styles.list}>
            {query.data.editors.map((editor, index) => (
              <View key={editor.version} style={[styles.row, index > 0 && styles.rowDivider]}>
                <Icon name="Box" size={16} color={theme.colors.foregroundMuted} />
                <View style={styles.grow}>
                  <Text style={styles.rowTitle}>{editor.version}</Text>
                  <Text style={styles.small}>{editor.modules.length > 0 ? editor.modules.map((module) => module.replace(/Support$/u, "")).join(" · ") : "Sem módulos extras"}</Text>
                  <Text style={styles.mono} numberOfLines={1} selectable>{editor.executable}</Text>
                </View>
              </View>
            ))}
          </View>
        </Section>
      ) : null}
    </ScrollView>
  );
}

function ProjectCard({ project, onOpenWorkspace, theme, styles }: {
  readonly project: ProjectListItem;
  readonly onOpenWorkspace: ((input: { readonly workspaceId: string }) => void) | undefined;
  readonly theme: PluginTheme;
  readonly styles: Styles;
}) {
  const paseo = usePaseo();
  const open = useRpc(OpenProjectRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const openEditor = useMutation({
    mutationFn: () => open({ projectPath: project.path }),
    onSuccess: (result) => {
      toast.show(result.message, { variant: result.status === "launched" ? "success" : "info" });
      void queryClient.invalidateQueries({ queryKey: projectsKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const openInPaseo = useMutation({
    mutationFn: () => paseo.workspaces.open({ cwd: project.path }),
    onSuccess: (workspace) => {
      if (onOpenWorkspace) onOpenWorkspace({ workspaceId: workspace.id });
      else toast.show(`Workspace pronto: ${workspace.name ?? project.name}`, { variant: "success" });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <View style={[styles.card, project.missing && styles.disabled]}>
      <View style={styles.heading}>
        <StatusDot color={project.open ? theme.colors.statusSuccess : theme.colors.foregroundMuted} styles={styles} />
        <View style={styles.grow}>
          <Text style={styles.sectionTitle} numberOfLines={1}>{project.productName && project.productName !== project.name ? `${project.productName} (${project.name})` : project.name}</Text>
          <Text style={styles.mono} numberOfLines={1} selectable>{project.path}</Text>
        </View>
      </View>
      <View style={styles.inline}>
        {project.open ? <Chip label="Aberto" icon="Play" styles={styles} theme={theme} /> : null}
        {project.editorVersion ? <Chip label={`Unity ${project.editorVersion}${project.editorInstalled ? "" : " · não instalado"}`} icon={project.editorInstalled ? "Box" : "TriangleAlert"} styles={styles} theme={theme} /> : null}
        {project.missing ? <Chip label="Pasta não existe mais" icon="TriangleAlert" styles={styles} theme={theme} /> : null}
        {project.sources.map((source) => <Chip key={source} label={SOURCE_LABELS[source]} styles={styles} theme={theme} />)}
        {project.lastModified ? <Text style={styles.small}>{new Date(project.lastModified).toLocaleDateString()}</Text> : null}
      </View>
      {project.missing ? null : (
        <View style={styles.actions}>
          <Button label={project.open ? "Aberto no Unity" : "Abrir no Unity"} icon="SquareArrowOutUpRight" primary={!project.open} disabled={project.open || !project.editorInstalled} busy={openEditor.isPending} onPress={() => openEditor.mutate()} styles={styles} theme={theme} accessibilityLabel={`Abrir ${project.name} no Unity`} />
          <Button label="Abrir no Paseo" icon="PanelsTopLeft" busy={openInPaseo.isPending} onPress={() => openInPaseo.mutate()} styles={styles} theme={theme} accessibilityLabel={`Abrir ${project.name} como workspace do Paseo`} />
        </View>
      )}
    </View>
  );
}

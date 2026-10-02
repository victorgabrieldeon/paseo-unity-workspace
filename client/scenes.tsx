import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { ListScenesRpc, OpenSceneRpc, type Scene, type UnityProject } from "../shared/contracts";
import { PanelShell, isProjectOpen, statusKey, useProjectStatus } from "./project";
import { Button, Chip, Section, errorMessage, type Styles } from "./ui";

export const scenesKey = (projectPath: string) => ["unity", "scenes", projectPath] as const;

export function ScenesPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <PanelShell theme={theme} layout={layout} workspaceId={workspaceId} title="Cenas" subtitle="Abra o projeto direto na cena certa.">
      {(project, styles) => <SceneList project={project} theme={theme} styles={styles} />}
    </PanelShell>
  );
}

function SceneList({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const list = useRpc(ListScenesRpc);
  const status = useProjectStatus(project.path);
  const query = useQuery({ queryKey: scenesKey(project.path), queryFn: () => list({ projectPath: project.path }) });
  const [filter, setFilter] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [buildOnly, setBuildOnly] = useState(false);

  const scenes = query.data?.scenes ?? [];
  const groups = useMemo(() => [...new Set(scenes.map((scene) => scene.group))].sort(), [scenes]);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return scenes.filter(
      (scene) =>
        (!buildOnly || scene.buildIndex !== null) &&
        (group === null || scene.group === group) &&
        (needle === "" || scene.path.toLowerCase().includes(needle)),
    );
  }, [scenes, filter, group, buildOnly]);

  const open = isProjectOpen(status.data);
  const live = status.data?.liveEditor ?? false;
  return (
    <Section
      title={`${scenes.length} cena${scenes.length === 1 ? "" : "s"}`}
      hint={open ? (live ? "O Editor está aberto e conectado à Unity CLI: a cena troca no Editor (ele pede para salvar mudanças)." : "O Editor está aberto. Para trocar de cena daqui, feche-o ou conecte a Unity CLI (pacote com.unity.pipeline).") : "Abre o Unity já na cena escolhida."}
      trailing={<Button label="Atualizar" icon="RefreshCw" small busy={query.isFetching} onPress={() => void query.refetch()} styles={styles} theme={theme} />}
      styles={styles}
    >
      <TextInput
        value={filter}
        onChangeText={setFilter}
        placeholder="Filtrar por nome ou pasta"
        placeholderTextColor={theme.colors.foregroundMuted}
        accessibilityLabel="Filtrar cenas"
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.input}
      />
      <View style={styles.inline}>
        <Chip label="No build" icon="ListOrdered" active={buildOnly} onPress={() => setBuildOnly((value) => !value)} styles={styles} theme={theme} />
        <Chip label="Todas as pastas" active={group === null} onPress={() => setGroup(null)} styles={styles} theme={theme} />
        {groups.map((name) => (
          <Chip key={name} label={name} icon="Folder" active={group === name} onPress={() => setGroup(group === name ? null : name)} styles={styles} theme={theme} />
        ))}
      </View>
      {query.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {query.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {query.isSuccess && visible.length === 0 ? <Text style={styles.empty}>{scenes.length === 0 ? "Este projeto ainda não tem cenas em Assets/." : "Nenhuma cena corresponde ao filtro."}</Text> : null}
      {visible.length > 0 ? (
        <View style={styles.list}>
          {visible.map((scene, index) => (
            <SceneRow key={scene.path} project={project} scene={scene} lastOpened={query.data?.lastOpened === scene.path} first={index === 0} disabled={open && !live} theme={theme} styles={styles} />
          ))}
        </View>
      ) : null}
    </Section>
  );
}

export function SceneRow({ project, scene, lastOpened, first, disabled, theme, styles }: {
  readonly project: UnityProject;
  readonly scene: Scene;
  readonly lastOpened: boolean;
  readonly first: boolean;
  readonly disabled: boolean;
  readonly theme: PluginTheme;
  readonly styles: Styles;
}) {
  const openScene = useRpc(OpenSceneRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => openScene({ projectPath: project.path, scenePath: scene.path }),
    onSuccess: (result) => {
      toast.show(result.message, { variant: "success" });
      void queryClient.invalidateQueries({ queryKey: statusKey(project.path) });
      void queryClient.invalidateQueries({ queryKey: scenesKey(project.path) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const badge = scene.buildIndex === null ? null : `#${scene.buildIndex}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Abrir cena ${scene.name}`}
      accessibilityHint={scene.path}
      disabled={disabled || mutation.isPending}
      onPress={() => mutation.mutate()}
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.pressed]}
    >
      <Icon name={scene.buildIndex === null ? "Clapperboard" : "ListOrdered"} size={16} color={scene.buildIndex !== null && scene.enabled ? theme.colors.accent : theme.colors.foregroundMuted} />
      <View style={styles.grow}>
        <View style={styles.inline}>
          <Text style={styles.rowTitle} numberOfLines={1}>{scene.name}</Text>
          {badge ? <Text style={styles.small}>{badge}{scene.enabled ? "" : " · desativada"}</Text> : null}
          {lastOpened ? <Chip label="última aberta" styles={styles} theme={theme} /> : null}
        </View>
        <Text style={styles.mono} numberOfLines={1}>{scene.path}</Text>
      </View>
      {mutation.isPending ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : <Icon name="Play" size={16} color={disabled ? theme.colors.border : theme.colors.foreground} />}
    </Pressable>
  );
}

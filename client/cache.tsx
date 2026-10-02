import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { CleanCacheRpc, ScanCacheRpc, type CacheEntry, type UnityProject } from "../shared/contracts";
import { formatBytes } from "../shared/format";
import { PanelShell, statusKey } from "./project";
import { Button, Checkbox, Section, errorMessage, type Styles } from "./ui";

const FULL_PRESET = ["library", "temp", "obj"];

export function CachePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <PanelShell theme={theme} layout={layout} workspaceId={workspaceId} title="Cache" subtitle="Libere espaço e resolva imports e compilações quebradas.">
      {(project, styles) => <CacheCleaner project={project} theme={theme} styles={styles} />}
    </PanelShell>
  );
}

/** Library sub-entries are already covered when the whole Library is selected. */
function coveredByLibrary(entry: CacheEntry, selected: ReadonlySet<string>): boolean {
  return entry.id !== "library" && selected.has("library") && entry.paths.every((path) => path.startsWith("Library/"));
}

function CacheCleaner({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const scan = useRpc(ScanCacheRpc);
  const clean = useRpc(CleanCacheRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["unity", "cache", project.path] as const;
  const query = useQuery({ queryKey, queryFn: () => scan({ projectPath: project.path }), refetchOnWindowFocus: false });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  const entries = query.data?.entries ?? [];
  const editorOpen = query.data?.editorOpen ?? false;
  const effective = useMemo(() => entries.filter((entry) => selected.has(entry.id) && entry.exists && !coveredByLibrary(entry, selected)), [entries, selected]);
  const total = effective.reduce((sum, entry) => sum + entry.bytes, 0);
  const library = entries.find((entry) => entry.id === "library");

  const mutation = useMutation({
    mutationFn: () => clean({ projectPath: project.path, ids: effective.map((entry) => entry.id) }),
    onSuccess: (result) => {
      setConfirming(false);
      setSelected(new Set());
      const skipped = result.skipped.length > 0 ? ` ${result.skipped.length} item(ns) ignorado(s): ${result.skipped.map((item) => `${item.path} (${item.reason})`).join(", ")}.` : "";
      toast.show(`${formatBytes(result.freedBytes)} liberados.${skipped}`, { variant: result.skipped.length > 0 ? "warning" : "success", durationMs: 4_000 });
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: statusKey(project.path) });
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(errorMessage(error));
    },
  });

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const preset = (ids: readonly string[]) => setSelected(new Set(ids.filter((id) => entries.some((entry) => entry.id === id && entry.exists))));

  return (
    <>
      <View style={styles.card}>
        <View style={styles.heading}>
          <Icon name="HardDrive" size={18} color={theme.colors.foregroundMuted} />
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>{library ? formatBytes(library.bytes) : "…"} em Library</Text>
            <Text style={styles.small}>Assets, Packages, ProjectSettings e UserSettings nunca são tocados.</Text>
          </View>
          <Button label="Medir" icon="RefreshCw" small busy={query.isFetching} onPress={() => void query.refetch()} styles={styles} theme={theme} />
        </View>
        {editorOpen ? (
          <View style={styles.inline}>
            <Icon name="TriangleAlert" size={14} color={theme.colors.statusWarning} />
            <Text style={[styles.warning, { flex: 1 }]}>Feche o Unity Editor deste projeto para limpar; apagar o cache com o Editor aberto corrompe a Library.</Text>
          </View>
        ) : null}
      </View>
      <Section
        title="O que limpar"
        trailing={
          <View style={styles.inline}>
            <Button label="Leve" small onPress={() => preset(entries.filter((entry) => entry.level === "light" && entry.id !== "logs").map((entry) => entry.id))} styles={styles} theme={theme} accessibilityLabel="Selecionar limpeza leve" />
            <Button label="Completa" small onPress={() => preset(FULL_PRESET)} styles={styles} theme={theme} accessibilityLabel="Selecionar limpeza completa" />
          </View>
        }
        styles={styles}
      >
        {query.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {query.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text> : null}
        {entries.length > 0 ? (
          <View style={styles.list}>
            {entries.map((entry, index) => {
              const covered = coveredByLibrary(entry, selected);
              return (
                <View key={entry.id} style={index > 0 ? styles.rowDivider : undefined}>
                  <Checkbox
                    checked={selected.has(entry.id) || covered}
                    disabled={!entry.exists || covered || editorOpen}
                    label={`${entry.label} · ${entry.exists ? formatBytes(entry.bytes) : "vazio"}${entry.level === "full" ? " · reimporta" : ""}`}
                    hint={covered ? "Incluído na Library inteira." : `${entry.description} (${entry.paths.join(", ")})`}
                    onChange={(checked) => toggle(entry.id, checked)}
                    styles={styles}
                    theme={theme}
                  />
                </View>
              );
            })}
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button label={effective.length === 0 ? "Nada selecionado" : `Limpar ${formatBytes(total)}`} icon="Trash2" danger disabled={effective.length === 0 || editorOpen} onPress={() => setConfirming(true)} styles={styles} theme={theme} />
          {selected.size > 0 ? <Button label="Limpar seleção" onPress={() => setSelected(new Set())} styles={styles} theme={theme} /> : null}
        </View>
      </Section>
      <Modal title="Limpar cache do Unity" icon={<Icon name="Trash2" size={18} color={theme.colors.statusDanger} />} open={confirming} onOpenChange={setConfirming}>
        <Modal.Content>
          <Text style={styles.body}>Apagar {formatBytes(total)} de {project.name}?</Text>
          {effective.map((entry) => (
            <Text key={entry.id} style={styles.mono}>• {entry.paths.join(", ")} ({formatBytes(entry.bytes)})</Text>
          ))}
          {effective.some((entry) => entry.level === "full") ? <Text style={styles.warning}>A próxima abertura reimporta os assets e pode levar vários minutos.</Text> : null}
          <View style={styles.actions}>
            <Button label="Apagar" icon="Trash2" danger busy={mutation.isPending} onPress={() => mutation.mutate()} styles={styles} theme={theme} />
            <Button label="Cancelar" disabled={mutation.isPending} onPress={() => setConfirming(false)} styles={styles} theme={theme} />
          </View>
        </Modal.Content>
      </Modal>
    </>
  );
}

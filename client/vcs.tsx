import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { VcsChangesetFilesRpc, VcsOverviewRpc, type UnityProject, type VcsChange, type VcsChangeset } from "../shared/contracts";
import { PanelShell } from "./project";
import { Button, Chip, Section, StatusDot, errorMessage, type Styles } from "./ui";

const KIND_LABELS: Record<VcsChange["unityKind"], { label: string; icon: string }> = {
  scene: { label: "Cenas", icon: "Clapperboard" },
  prefab: { label: "Prefabs", icon: "Box" },
  script: { label: "Scripts", icon: "FileCode" },
  meta: { label: ".meta", icon: "FileCog" },
  settings: { label: "Settings/Packages", icon: "Settings2" },
  other: { label: "Outros", icon: "File" },
};
const PREVIEW_LIMIT = 60;

export function VcsPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <PanelShell theme={theme} layout={layout} workspaceId={workspaceId} title="Version Control" subtitle="Unity Version Control (Plastic): branch, mudanças, locks e changesets.">
      {(project, styles) => <VcsOverviewView project={project} theme={theme} styles={styles} />}
    </PanelShell>
  );
}

/** Short relative time for `yyyy-MM-ddTHH:mm:ss` dates printed by `cm` in local time. */
function ago(date: string): string {
  const time = Date.parse(date);
  if (Number.isNaN(time)) return date;
  const minutes = Math.round((Date.now() - time) / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return days < 30 ? `há ${days} d` : new Date(time).toLocaleDateString();
}

const shortUser = (owner: string) => owner.split("@")[0] ?? owner;

function VcsOverviewView({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const overview = useRpc(VcsOverviewRpc);
  const query = useQuery({ queryKey: ["unity", "vcs", project.path], queryFn: () => overview({ projectPath: project.path }), refetchInterval: 30_000 });
  const [kind, setKind] = useState<VcsChange["unityKind"] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const data = query.data;

  const lockedByOthers = useMemo(() => {
    if (!data) return [];
    const changed = new Set(data.changes.map((change) => change.path));
    return data.locks.filter((lock) => changed.has(lock.path));
  }, [data]);

  if (query.isPending) return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (query.error) return <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text>;
  if (!data) return null;
  if (!data.workspace || !data.available) {
    return (
      <View style={styles.card}>
        <Text style={styles.body}>{data.workspace ? "A CLI do Unity Version Control (`cm`) não foi encontrada." : "Este projeto não é um workspace do Unity Version Control."}</Text>
        <Text style={styles.muted}>{data.workspace ? "Instale o Unity Version Control (Plastic SCM) para ver branch, mudanças e locks aqui." : "Não há pasta .plastic na raiz. Para usar, crie ou conecte o workspace pelo Unity Hub, pelo Editor (Window → Unity Version Control) ou com `cm workspace create`."}</Text>
      </View>
    );
  }

  const visible = data.changes.filter((change) => kind === null || change.unityKind === kind);
  const kinds = (Object.keys(KIND_LABELS) as VcsChange["unityKind"][]).filter((key) => (data.summary.byKind[key] ?? 0) > 0);
  const risky = (data.summary.byKind["scene"] ?? 0) + (data.summary.byKind["prefab"] ?? 0);

  return (
    <>
      <View style={styles.card} accessibilityLiveRegion="polite">
        <View style={styles.heading}>
          <Icon name="GitBranch" size={18} color={theme.colors.accent} />
          <View style={styles.grow}>
            <Text style={styles.sectionTitle}>{data.header?.branch ?? "?"} · cs:{data.header?.changeset ?? "?"}</Text>
            <Text style={styles.mono} numberOfLines={1} selectable>{data.header?.repository ?? ""}</Text>
          </View>
          <Button label="Atualizar" icon="RefreshCw" small busy={query.isFetching} onPress={() => void query.refetch()} styles={styles} theme={theme} />
        </View>
        <View style={styles.inline}>
          {data.behind === 0 ? <Chip label="Em dia com o servidor" icon="Check" styles={styles} theme={theme} /> : null}
          {data.behind !== null && data.behind > 0 ? <Chip label={`${data.behind} changeset(s) para baixar`} icon="CloudDownload" active styles={styles} theme={theme} /> : null}
          <Chip label={`${data.summary.total} mudança(s) pendente(s)`} icon="FilePen" styles={styles} theme={theme} />
          <Chip label={`${data.locks.length} lock(s)`} icon="Lock" styles={styles} theme={theme} />
        </View>
        {data.behind !== null && data.behind > 0 ? <Text style={styles.warning}>O servidor tem changesets novos neste branch. Atualize o workspace (Editor ou `cm update`) antes de mexer em cenas e prefabs.</Text> : null}
        {lockedByOthers.length > 0 ? <Text style={styles.error}>Você alterou arquivo(s) com lock: {lockedByOthers.map((lock) => `${lock.path} (${shortUser(lock.owner)})`).join(", ")}. O checkin vai falhar.</Text> : null}
        {data.errors.map((error) => <Text key={error} style={styles.error}>{error}</Text>)}
      </View>

      <Section
        title="Mudanças pendentes"
        hint={risky > 0 ? `${risky} cena(s)/prefab(s) alterados: avise o time para evitar conflito de merge.` : "Arquivos alterados neste workspace, ainda sem checkin."}
        styles={styles}
      >
        {data.summary.total === 0 ? <Text style={styles.muted}>Nada pendente. Workspace limpo.</Text> : null}
        {kinds.length > 0 ? (
          <View style={styles.inline}>
            <Chip label={`Tudo ${data.summary.total}`} active={kind === null} onPress={() => setKind(null)} styles={styles} theme={theme} />
            {kinds.map((key) => (
              <Chip key={key} label={`${KIND_LABELS[key].label} ${data.summary.byKind[key]}`} icon={KIND_LABELS[key].icon} active={kind === key} onPress={() => setKind(kind === key ? null : key)} styles={styles} theme={theme} />
            ))}
          </View>
        ) : null}
        {data.metaProblems.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.warning}>{data.metaProblems.length} problema(s) de par .meta: o Unity perde referências se só um dos dois subir.</Text>
            {data.metaProblems.slice(0, 10).map((problem) => <Text key={problem} style={styles.mono}>{problem}</Text>)}
          </View>
        ) : null}
        {visible.length > 0 ? (
          <View style={styles.list}>
            {(showAll ? visible : visible.slice(0, PREVIEW_LIMIT)).map((change, index) => (
              <ChangeRow key={`${change.code}-${change.path}`} change={change} first={index === 0} theme={theme} styles={styles} />
            ))}
          </View>
        ) : null}
        {visible.length > PREVIEW_LIMIT && !showAll ? <Button label={`Mostrar todas (${visible.length})`} small onPress={() => setShowAll(true)} styles={styles} theme={theme} /> : null}
        {data.truncated ? <Text style={styles.small}>Lista limitada aos primeiros {data.changes.length} itens; os totais acima contam todos.</Text> : null}
      </Section>

      <Section title="Locks" hint="Arquivos travados para edição exclusiva (comum em cenas, prefabs e binários)." styles={styles}>
        {data.locks.length === 0 ? <Text style={styles.muted}>Nenhum lock ativo.</Text> : (
          <View style={styles.list}>
            {data.locks.map((lock, index) => (
              <View key={`${lock.path}-${lock.owner}`} style={[styles.row, index > 0 && styles.rowDivider]}>
                <Icon name="Lock" size={15} color={lockedByOthers.includes(lock) ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
                <View style={styles.grow}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{lock.path}</Text>
                  <Text style={styles.small}>{shortUser(lock.owner)} · {lock.workspace}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section title="Changesets" hint={`Últimos ${data.changesets.length} em ${data.header?.branch ?? "?"}. Toque para ver os arquivos.`} styles={styles}>
        <View style={styles.list}>
          {data.changesets.map((changeset, index) => (
            <ChangesetRow key={changeset.id} project={project} changeset={changeset} current={changeset.id === data.header?.changeset} first={index === 0} theme={theme} styles={styles} />
          ))}
        </View>
      </Section>

      <Section title="Branches" styles={styles}>
        <View style={styles.list}>
          {data.branches.map((branch, index) => (
            <View key={branch.name} style={[styles.row, index > 0 && styles.rowDivider]}>
              <StatusDot color={branch.name === data.header?.branch ? theme.colors.statusSuccess : theme.colors.foregroundMuted} styles={styles} />
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>{branch.name}{branch.name === data.header?.branch ? " · atual" : ""}</Text>
                <Text style={styles.small}>{shortUser(branch.owner)} · criado {ago(branch.date)}{branch.headChangeset !== null ? ` · cs:${branch.headChangeset}` : ""}</Text>
              </View>
            </View>
          ))}
        </View>
      </Section>
    </>
  );
}

function ChangeRow({ change, first, theme, styles }: { readonly change: VcsChange; readonly first: boolean; readonly theme: PluginTheme; readonly styles: Styles }) {
  const color = change.code === "AD" ? theme.colors.statusSuccess : change.code === "DE" || change.code === "LD" ? theme.colors.statusDanger : theme.colors.statusWarning;
  return (
    <View style={[styles.row, { minHeight: 40 }, !first && styles.rowDivider]}>
      <Text style={[styles.mono, { color, width: 26 }]}>{change.code}</Text>
      <Icon name={KIND_LABELS[change.unityKind].icon} size={14} color={change.unityKind === "scene" || change.unityKind === "prefab" ? theme.colors.statusWarning : theme.colors.foregroundMuted} />
      <Text style={[styles.mono, { flex: 1, color: theme.colors.foreground }]} numberOfLines={1} selectable>{change.path}</Text>
    </View>
  );
}

function ChangesetRow({ project, changeset, current, first, theme, styles }: {
  readonly project: UnityProject;
  readonly changeset: VcsChangeset;
  readonly current: boolean;
  readonly first: boolean;
  readonly theme: PluginTheme;
  readonly styles: Styles;
}) {
  const [open, setOpen] = useState(false);
  const files = useRpc(VcsChangesetFilesRpc);
  const query = useQuery({ queryKey: ["unity", "vcs", "cs", project.path, changeset.id], queryFn: () => files({ projectPath: project.path, changeset: changeset.id }), enabled: open, staleTime: Number.POSITIVE_INFINITY });
  return (
    <View style={!first ? styles.rowDivider : undefined}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Changeset ${changeset.id}: ${changeset.title}`} onPress={() => setOpen((value) => !value)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <Text style={[styles.mono, { color: current ? theme.colors.accent : theme.colors.foregroundMuted, width: 52 }]}>cs:{changeset.id}</Text>
        <View style={styles.grow}>
          <Text style={styles.rowTitle} numberOfLines={open ? undefined : 1}>{changeset.title || "(sem comentário)"}</Text>
          <Text style={styles.small}>{shortUser(changeset.owner)} · {ago(changeset.date)}{current ? " · seu workspace está aqui" : ""}</Text>
        </View>
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={16} color={theme.colors.foregroundMuted} />
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 10, gap: 4 }}>
          {changeset.comment.includes("\n") ? <Text style={styles.small} selectable>{changeset.comment}</Text> : null}
          {query.isPending ? <ActivityIndicator size="small" color={theme.colors.foregroundMuted} /> : null}
          {query.error ? <Text style={styles.error}>{errorMessage(query.error)}</Text> : null}
          {query.data ? <Text style={styles.small}>{query.data.files.length} arquivo(s)</Text> : null}
          {query.data?.files.slice(0, 80).map((file) => <Text key={`${file.code}-${file.path}`} style={styles.mono} numberOfLines={1}>{file.code} {file.path}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

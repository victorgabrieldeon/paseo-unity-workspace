import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import {
  CancelJobRpc,
  CreateCloneRpc,
  DeleteCloneRpc,
  InstallParrelSyncRpc,
  ListClonesRpc,
  OpenInstancesRpc,
  SetCloneArgumentRpc,
  type Clone,
  type UnityProject,
} from "../shared/contracts";
import { formatBytes } from "../shared/format";
import { jobsKey, useJobs } from "./build";
import { PanelShell } from "./project";
import { Button, Checkbox, Chip, LogView, Section, StatusDot, errorMessage, type Styles } from "./ui";

export function ClonesPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <PanelShell theme={theme} layout={layout} workspaceId={workspaceId} title="ParrelSync" subtitle="Clones do projeto para testar multiplayer com vários Editors.">
      {(project, styles) => <CloneManager project={project} theme={theme} styles={styles} />}
    </PanelShell>
  );
}

function CloneManager({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const list = useRpc(ListClonesRpc);
  const create = useRpc(CreateCloneRpc);
  const openInstances = useRpc(OpenInstancesRpc);
  const install = useRpc(InstallParrelSyncRpc);
  const cancel = useRpc(CancelJobRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ["unity", "clones", project.path] as const;
  const query = useQuery({ queryKey, queryFn: () => list({ projectPath: project.path }), refetchInterval: 4_000 });
  const data = query.data;
  const originalPath = data?.originalPath ?? project.path;
  const jobs = useJobs(originalPath, "clone");
  const [copyLibrary, setCopyLibrary] = useState(true);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: jobsKey(originalPath, "clone") });
  };

  const createMutation = useMutation({
    mutationFn: () => create({ projectPath: project.path, copyLibrary }),
    onSuccess: (job) => {
      toast.show(`${job.title}: criando…`, { variant: "info" });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const openMutation = useMutation({
    mutationFn: (paths: string[]) => openInstances({ projectPath: project.path, paths }),
    onSuccess: (result) => {
      const skipped = result.skipped.map((item) => `${item.path.split(/[\\/]/u).pop()}: ${item.reason}`).join("; ");
      toast.show(`${result.launched.length} Editor(es) abrindo.${skipped ? ` ${skipped}` : ""}`, { variant: result.launched.length > 0 ? "success" : "warning", durationMs: 4_000 });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const installMutation = useMutation({
    mutationFn: () => install({ projectPath: project.path }),
    onSuccess: (result) => {
      toast.show(result.message, { variant: result.changed ? "success" : "info", durationMs: 4_000 });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const job = jobs.data?.jobs.find((candidate) => candidate.state === "running") ?? null;
  const lastJob = jobs.data?.jobs.find((candidate) => candidate.state !== "running") ?? null;
  const clones = data?.clones ?? [];
  const closed = [...(data && !data.originalOpen ? [originalPath] : []), ...clones.filter((clone) => !clone.open && clone.brokenLinks.length === 0).map((clone) => clone.path)];

  return (
    <>
      {query.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {data ? (
        <View style={styles.card}>
          <View style={styles.inline}>
            <Chip label={data.packages.parrelsync ? "ParrelSync instalado" : "ParrelSync não instalado"} icon={data.packages.parrelsync ? "Check" : "Package"} styles={styles} theme={theme} />
            {data.packages.multiplayerPlayMode ? <Chip label="Multiplayer Play Mode" icon="Users" styles={styles} theme={theme} /> : null}
            {data.packages.netcode ? <Chip label="Netcode" icon="Network" styles={styles} theme={theme} /> : null}
            {data.isClone ? <Chip label="Você está num clone" icon="Copy" styles={styles} theme={theme} /> : null}
          </View>
          {data.packages.parrelsync ? null : (
            <>
              <Text style={styles.muted}>
                Os clones funcionam sem o pacote (Assets e ProjectSettings são links para o original). Com o ParrelSync instalado, o código do jogo lê o argumento do clone com ClonesManager.GetArgument() e o Editor do clone bloqueia edição acidental de assets.
              </Text>
              <View style={styles.actions}>
                <Button label="Adicionar ParrelSync ao manifest" icon="PackagePlus" busy={installMutation.isPending} onPress={() => installMutation.mutate()} styles={styles} theme={theme} />
              </View>
            </>
          )}
          {data.packages.multiplayerPlayMode ? <Text style={styles.small}>Este projeto também tem Multiplayer Play Mode (players virtuais no mesmo Editor). Clones são úteis quando você precisa de Editors realmente separados.</Text> : null}
        </View>
      ) : query.isPending ? (
        <ActivityIndicator color={theme.colors.foregroundMuted} />
      ) : null}

      {job ? (
        <View style={styles.card} accessibilityLiveRegion="polite">
          <View style={styles.heading}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <View style={styles.grow}>
              <Text style={styles.sectionTitle}>{job.title}</Text>
              <Text style={styles.small}>{job.logTail[job.logTail.length - 1] ?? "Preparando…"}</Text>
            </View>
            <Button label="Cancelar" small danger onPress={() => void cancel({ jobId: job.id }).then(refresh, (error: unknown) => toast.error(errorMessage(error)))} styles={styles} theme={theme} />
          </View>
        </View>
      ) : lastJob?.state === "failed" ? (
        <View style={styles.card}>
          <Text style={styles.error}>{lastJob.message}</Text>
          <LogView lines={lastJob.logTail.slice(-8)} styles={styles} theme={theme} label="Log da criação do clone" />
        </View>
      ) : null}

      {data ? (
        <Section
          title="Instâncias"
          hint="Cada instância é um Editor separado. O argumento fica em .parrelsyncarg (ex.: client, server, host, port=7778)."
          trailing={<Button label="Abrir todas" icon="Layers" small primary disabled={closed.length === 0} busy={openMutation.isPending} onPress={() => openMutation.mutate(closed)} styles={styles} theme={theme} />}
          styles={styles}
        >
          <View style={styles.list}>
            <View style={styles.row}>
              <StatusDot color={data.originalOpen ? theme.colors.statusSuccess : theme.colors.foregroundMuted} styles={styles} />
              <View style={styles.grow}>
                <Text style={styles.rowTitle}>Original</Text>
                <Text style={styles.mono} numberOfLines={1}>{originalPath}</Text>
              </View>
              <Button label={data.originalOpen ? "Aberto" : "Abrir"} small disabled={data.originalOpen} onPress={() => openMutation.mutate([originalPath])} styles={styles} theme={theme} />
            </View>
            {clones.map((clone) => (
              <CloneRow key={clone.path} clone={clone} projectPath={project.path} onChanged={refresh} onOpen={() => openMutation.mutate([clone.path])} theme={theme} styles={styles} />
            ))}
          </View>
          {clones.length === 0 ? <Text style={styles.muted}>Nenhum clone ainda.</Text> : null}
        </Section>
      ) : null}

      {data && !data.isClone ? (
        <Section title="Novo clone" hint={`Criado em ${originalPath}_clone_N, ao lado do projeto, igual ao ParrelSync.`} styles={styles}>
          <View style={styles.list}>
            <Checkbox
              checked={copyLibrary}
              label="Copiar a Library do original"
              hint="O clone abre sem reimportar tudo, mas ocupa o mesmo espaço da Library. Sem copiar, o primeiro Editor do clone reimporta os assets."
              onChange={setCopyLibrary}
              styles={styles}
              theme={theme}
            />
          </View>
          <View style={styles.actions}>
            <Button label="Criar clone" icon="CopyPlus" primary disabled={job !== null} busy={createMutation.isPending} onPress={() => createMutation.mutate()} styles={styles} theme={theme} />
          </View>
        </Section>
      ) : null}
    </>
  );
}

function CloneRow({ clone, projectPath, onChanged, onOpen, theme, styles }: {
  readonly clone: Clone;
  readonly projectPath: string;
  readonly onChanged: () => void;
  readonly onOpen: () => void;
  readonly theme: PluginTheme;
  readonly styles: Styles;
}) {
  const setArgument = useRpc(SetCloneArgumentRpc);
  const remove = useRpc(DeleteCloneRpc);
  const toast = useToast();
  const [argument, setDraft] = useState(clone.argument);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setDraft(clone.argument), [clone.argument]);

  const argumentMutation = useMutation({
    mutationFn: () => setArgument({ projectPath, clonePath: clone.path, argument }),
    onSuccess: (updated) => {
      toast.show(`Clone ${updated.index}: argumento "${updated.argument}"`, { variant: "success" });
      onChanged();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const removeMutation = useMutation({
    mutationFn: () => remove({ projectPath, clonePath: clone.path }),
    onSuccess: (result) => {
      setConfirming(false);
      toast.show(`Clone ${clone.index} removido (${formatBytes(result.freedBytes)} liberados).`, { variant: "success" });
      onChanged();
    },
    onError: (error) => {
      setConfirming(false);
      toast.error(errorMessage(error));
    },
  });

  return (
    <View style={[styles.rowDivider, { paddingVertical: 10, paddingHorizontal: 14, gap: 8 }]}>
      <View style={styles.heading}>
        <StatusDot color={clone.open ? theme.colors.statusSuccess : theme.colors.foregroundMuted} styles={styles} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>Clone {clone.index}{clone.open ? " · aberto" : ""}</Text>
          <Text style={styles.mono} numberOfLines={1}>{clone.path}</Text>
        </View>
        <Button label={clone.open ? "Aberto" : "Abrir"} small disabled={clone.open || clone.brokenLinks.length > 0} onPress={onOpen} styles={styles} theme={theme} accessibilityLabel={`Abrir clone ${clone.index}`} />
        <Button label="Remover" icon="Trash2" small danger disabled={clone.open} onPress={() => setConfirming(true)} styles={styles} theme={theme} accessibilityLabel={`Remover clone ${clone.index}`} />
      </View>
      {clone.brokenLinks.length > 0 ? <Text style={styles.error}>Links quebrados: {clone.brokenLinks.join(", ")}. Remova e recrie este clone.</Text> : null}
      <View style={styles.inline}>
        <TextInput
          value={argument}
          onChangeText={setDraft}
          placeholder="client"
          placeholderTextColor={theme.colors.foregroundMuted}
          accessibilityLabel={`Argumento do clone ${clone.index}`}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.input, { flex: 1, minWidth: 140 }]}
        />
        <Button label="Salvar" small disabled={argument.trim() === clone.argument || argument.trim() === ""} busy={argumentMutation.isPending} onPress={() => argumentMutation.mutate()} styles={styles} theme={theme} accessibilityLabel={`Salvar argumento do clone ${clone.index}`} />
      </View>
      <Modal title={`Remover clone ${clone.index}`} icon={<Icon name="Trash2" size={18} color={theme.colors.statusDanger} />} open={confirming} onOpenChange={setConfirming}>
        <Modal.Content>
          <Text style={styles.body}>Remover {clone.path}?</Text>
          <Text style={styles.muted}>Os links para Assets e ProjectSettings são desfeitos sem tocar no projeto original; a Library e os Packages copiados do clone são apagados.</Text>
          <View style={styles.actions}>
            <Button label="Remover clone" icon="Trash2" danger busy={removeMutation.isPending} onPress={() => removeMutation.mutate()} styles={styles} theme={theme} />
            <Button label="Cancelar" disabled={removeMutation.isPending} onPress={() => setConfirming(false)} styles={styles} theme={theme} />
          </View>
        </Modal.Content>
      </Modal>
    </View>
  );
}

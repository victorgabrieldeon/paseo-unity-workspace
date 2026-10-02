import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { CancelJobRpc, QuickPlayRpc, type UnityProject } from "../shared/contracts";
import { jobsKey, useJobs } from "./build";
import { isProjectOpen, useProjectStatus } from "./project";
import { Button, Chip, type Styles } from "./ui";

export const WINDOWED_ARGS = "-screen-fullscreen 0 -screen-width 1280 -screen-height 720";

/** One-click play without the Editor: incremental batch build for this machine, then launch. */
export function QuickPlayCard({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const play = useRpc(QuickPlayRpc);
  const cancel = useRpc(CancelJobRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useProjectStatus(project.path);
  const jobs = useJobs(project.path, "build");
  const [windowed, setWindowed] = useState(true);
  const [instances, setInstances] = useState(1);

  const job = jobs.data?.jobs.find((candidate) => candidate.title === "Jogar") ?? null;
  const running = job?.state === "running";
  const otherBuild = jobs.data?.jobs.some((candidate) => candidate.state === "running" && candidate.title !== "Jogar") ?? false;
  const mutation = useMutation({
    mutationFn: (force: boolean) => play({ projectPath: project.path, args: windowed ? WINDOWED_ARGS : "", instances, force }),
    onSuccess: (result) => {
      toast.show(result.message, { variant: result.job === null ? "success" : "info" });
      void queryClient.invalidateQueries({ queryKey: jobsKey(project.path, "build") });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message.replace(/^Request failed:\s*/u, "").replace(/\s+requestType=.*$/u, "") : "Falha ao jogar."),
  });
  const cancelMutation = useMutation({
    mutationFn: () => cancel({ jobId: job?.id ?? "" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: jobsKey(project.path, "build") }),
  });

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.heading}>
        <Icon name="Gamepad2" size={20} color={theme.colors.accent} />
        <View style={styles.grow}>
          <Text style={styles.sectionTitle}>Jogar sem abrir o Unity</Text>
          <Text style={styles.small}>Build rápido em batch mode e abre o jogo. Se nada mudou, abre na hora.</Text>
        </View>
      </View>
      {running ? (
        <View style={styles.heading}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
          <Text style={[styles.mono, { flex: 1 }]} numberOfLines={1}>{job?.logTail[job.logTail.length - 1] ?? "Iniciando o Unity em batch mode…"}</Text>
          <Button label="Cancelar" small danger busy={cancelMutation.isPending} onPress={() => cancelMutation.mutate()} styles={styles} theme={theme} />
        </View>
      ) : (
        <>
          <View style={styles.inline}>
            <Chip label="Em janela" icon="AppWindow" active={windowed} onPress={() => setWindowed((value) => !value)} styles={styles} theme={theme} />
            {[1, 2, 3, 4].map((count) => (
              <Chip key={count} label={count === 1 ? "1 jogador" : `${count} jogadores`} icon={count === 1 ? "User" : "Users"} active={instances === count} onPress={() => setInstances(count)} styles={styles} theme={theme} />
            ))}
          </View>
          <View style={styles.actions}>
            <Button label="Jogar" icon="Play" primary disabled={otherBuild} busy={mutation.isPending} onPress={() => mutation.mutate(false)} styles={styles} theme={theme} accessibilityLabel={`Jogar ${project.name} sem abrir o Unity`} />
            <Button label="Rebuildar e jogar" icon="RefreshCw" disabled={otherBuild || mutation.isPending} onPress={() => mutation.mutate(true)} styles={styles} theme={theme} />
          </View>
        </>
      )}
      {!running && job?.state === "failed" ? <Text style={styles.error}>{job.message}</Text> : null}
      {isProjectOpen(status.data) && !running ? <Text style={styles.small}>O Editor está aberto: se houver mudanças para buildar, feche-o ou use o Play do próprio Editor.</Text> : null}
    </View>
  );
}

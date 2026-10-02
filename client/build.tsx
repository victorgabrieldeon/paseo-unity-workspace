import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginWorkspacePanelProps, useRpc } from "@getpaseo/plugin/client";
import { copyText, Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { BuildOptionsRpc, CancelJobRpc, LaunchArtifactRpc, LaunchPlayerRpc, ListJobsRpc, ListPlayersRpc, StartBuildRpc, type BuildRecipe, type Job, type Player, type UnityProject } from "../shared/contracts";
import { formatDuration } from "../shared/format";
import { PanelShell, isProjectOpen, statusKey, useProjectStatus } from "./project";
import { Button, Chip, LogView, Section, StatusDot, errorMessage, type Styles } from "./ui";

export const jobsKey = (projectPath: string, kind: Job["kind"]) => ["unity", "jobs", kind, projectPath] as const;

export function BuildPanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  return (
    <PanelShell theme={theme} layout={layout} workspaceId={workspaceId} title="Build" subtitle="Builds em batch mode, com log ao vivo e histórico.">
      {(project, styles) => <BuildLauncher project={project} theme={theme} styles={styles} />}
    </PanelShell>
  );
}

export function useJobs(projectPath: string, kind: Job["kind"]) {
  const list = useRpc(ListJobsRpc);
  return useQuery({
    queryKey: jobsKey(projectPath, kind),
    queryFn: () => list({ projectPath, kind }),
    refetchInterval: (query) => (query.state.data?.jobs.some((job) => job.state === "running") ? 1_000 : 5_000),
  });
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function BuildLauncher({ project, theme, styles }: { readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const options = useRpc(BuildOptionsRpc);
  const start = useRpc(StartBuildRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const status = useProjectStatus(project.path);
  const optionsQuery = useQuery({ queryKey: ["unity", "build-options", project.path], queryFn: () => options({ projectPath: project.path }) });
  const jobs = useJobs(project.path, "build");
  const startMutation = useMutation({
    mutationFn: (recipe: BuildRecipe) => start({ projectPath: project.path, recipe }),
    onSuccess: (job) => {
      toast.show(`Build iniciado: ${job.title}`, { variant: "success" });
      void queryClient.invalidateQueries({ queryKey: jobsKey(project.path, "build") });
      void queryClient.invalidateQueries({ queryKey: statusKey(project.path) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const running = jobs.data?.jobs.find((job) => job.state === "running") ?? null;
  const history = jobs.data?.jobs.filter((job) => job.state !== "running") ?? [];
  const editorOpen = isProjectOpen(status.data) && running === null;
  const blocked = editorOpen || running !== null || startMutation.isPending;
  const data = optionsQuery.data;

  return (
    <>
      {editorOpen ? (
        <View style={styles.card}>
          <View style={styles.inline}>
            <Icon name="TriangleAlert" size={15} color={theme.colors.statusWarning} />
            <Text style={[styles.warning, { flex: 1 }]}>O Unity Editor está com este projeto aberto. Builds em batch mode precisam do projeto fechado; feche o Editor (salve antes) para buildar daqui.</Text>
          </View>
        </View>
      ) : null}
      {running ? <RunningJob job={running} project={project} theme={theme} styles={styles} /> : null}
      <Players project={project} lastFinished={history[0]?.endedAt ?? null} theme={theme} styles={styles} />
      {optionsQuery.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {optionsQuery.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(optionsQuery.error)}</Text> : null}
      {data ? (
        <>
          <Section title="Métodos de build do projeto" hint="Métodos estáticos públicos dos scripts de Editor que chamam BuildPipeline (executados com -executeMethod)." styles={styles}>
            {data.methods.length === 0 ? (
              <Text style={styles.muted}>Nenhum script com BuildPipeline.BuildPlayer encontrado em Assets/.</Text>
            ) : (
              <View style={styles.list}>
                {data.methods.map((method, index) => (
                  <View key={method.method} style={[styles.row, index > 0 && styles.rowDivider]}>
                    <Icon name={method.development ? "Bug" : "Package"} size={16} color={theme.colors.foregroundMuted} />
                    <View style={styles.grow}>
                      <View style={styles.inline}>
                        <Text style={styles.rowTitle}>{method.label}</Text>
                        <Chip label={method.development ? "Development" : "Release"} styles={styles} theme={theme} />
                      </View>
                      <Text style={styles.mono} numberOfLines={1}>{method.method}</Text>
                    </View>
                    <Button label="Build" icon="Hammer" small primary disabled={blocked} onPress={() => startMutation.mutate({ kind: "method", method: method.method })} styles={styles} theme={theme} accessibilityLabel={`Build ${method.label}`} />
                  </View>
                ))}
              </View>
            )}
          </Section>
          {data.supportsProfiles ? (
            <Section title="Build Profiles" hint="Perfis do Unity 6 (Assets/Settings/Build Profiles). Development/Release vêm das opções de cada perfil." styles={styles}>
              {data.profiles.length === 0 ? (
                <Text style={styles.muted}>Nenhum Build Profile salvo. Crie em File → Build Profiles para ter Development e Release separados.</Text>
              ) : (
                <View style={styles.list}>
                  {data.profiles.map((profile, index) => (
                    <View key={profile.path} style={[styles.row, index > 0 && styles.rowDivider]}>
                      <Icon name="SlidersHorizontal" size={16} color={theme.colors.foregroundMuted} />
                      <View style={styles.grow}>
                        <Text style={styles.rowTitle}>{profile.name}</Text>
                        <Text style={styles.mono} numberOfLines={1}>{profile.path}</Text>
                      </View>
                      <Button label="Build" icon="Hammer" small primary disabled={blocked} onPress={() => startMutation.mutate({ kind: "profile", profilePath: profile.path })} styles={styles} theme={theme} accessibilityLabel={`Build com o perfil ${profile.name}`} />
                    </View>
                  ))}
                </View>
              )}
            </Section>
          ) : null}
          <Section title="Plataformas" hint={`Player standalone com as cenas e Player Settings atuais, em ${data.outputRoot}/<Plataforma>/.`} styles={styles}>
            <View style={styles.list}>
              {data.targets.map((target, index) => (
                <View key={target.target} style={[styles.row, index > 0 && styles.rowDivider]}>
                  <Icon name="Monitor" size={16} color={theme.colors.foregroundMuted} />
                  <View style={styles.grow}>
                    <Text style={styles.rowTitle}>{target.label}</Text>
                    <Text style={target.moduleInstalled ? styles.small : styles.warning}>{target.moduleInstalled ? target.target : "Módulo não instalado neste editor"}</Text>
                  </View>
                  <Button label="Build" icon="Hammer" small disabled={blocked || !target.moduleInstalled} onPress={() => startMutation.mutate({ kind: "target", target: target.target })} styles={styles} theme={theme} accessibilityLabel={`Build ${target.label}`} />
                </View>
              ))}
            </View>
          </Section>
        </>
      ) : null}
      <Section title="Histórico" hint="Últimos builds desta sessão do daemon. Os logs completos ficam em Logs/paseo-build-*.log." styles={styles}>
        {history.length === 0 ? <Text style={styles.muted}>Nenhum build terminado ainda.</Text> : null}
        {history.map((job) => (
          <FinishedJob key={job.id} job={job} theme={theme} styles={styles} />
        ))}
      </Section>
    </>
  );
}

function RunningJob({ job, project, theme, styles }: { readonly job: Job; readonly project: UnityProject; readonly theme: PluginTheme; readonly styles: Styles }) {
  const cancel = useRpc(CancelJobRpc);
  const toast = useToast();
  const queryClient = useQueryClient();
  const now = useNow(true);
  const mutation = useMutation({
    mutationFn: () => cancel({ jobId: job.id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: jobsKey(project.path, "build") }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.heading}>
        <ActivityIndicator size="small" color={theme.colors.accent} />
        <View style={styles.grow}>
          <Text style={styles.sectionTitle}>{job.title}</Text>
          <Text style={styles.small}>Buildando há {formatDuration(now - Date.parse(job.startedAt))}</Text>
        </View>
        <Button label="Cancelar" icon="Square" small danger busy={mutation.isPending} onPress={() => mutation.mutate()} styles={styles} theme={theme} />
      </View>
      {job.errors.length > 0 ? <Text style={styles.error}>{job.errors.length} linha(s) de erro até agora</Text> : null}
      <LogView lines={job.logTail.slice(-14)} highlight={job.errors} styles={styles} theme={theme} label={`Log ao vivo de ${job.title}`} />
    </View>
  );
}

function FinishedJob({ job, theme, styles }: { readonly job: Job; readonly theme: PluginTheme; readonly styles: Styles }) {
  const launch = useRpc(LaunchArtifactRpc);
  const toast = useToast();
  const [expanded, setExpanded] = useState(job.state === "failed");
  const launchMutation = useMutation({
    mutationFn: () => launch({ jobId: job.id }),
    onSuccess: (result) => toast.show(result.message, { variant: "success" }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const color = job.state === "succeeded" ? theme.colors.statusSuccess : job.state === "failed" ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  const duration = job.endedAt === null ? null : formatDuration(Date.parse(job.endedAt) - Date.parse(job.startedAt));
  const label = job.state === "succeeded" ? "Sucesso" : job.state === "failed" ? "Falhou" : "Cancelado";

  async function copyPath(path: string) {
    try {
      await copyText(path);
      toast.show("Caminho copiado", { variant: "success" });
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie.");
    }
  }

  return (
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel={`${job.title}: ${label}`} onPress={() => setExpanded((value) => !value)} style={({ pressed }) => [styles.heading, pressed && styles.pressed]}>
        <StatusDot color={color} styles={styles} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>{job.title}</Text>
          <Text style={styles.small}>{label}{duration ? ` · ${duration}` : ""} · {new Date(job.startedAt).toLocaleString()}</Text>
        </View>
        <Icon name={expanded ? "ChevronUp" : "ChevronDown"} size={16} color={theme.colors.foregroundMuted} />
      </Pressable>
      {expanded ? (
        <>
          {job.message ? <Text style={job.state === "failed" ? styles.error : styles.muted}>{job.message}</Text> : null}
          {job.artifactPath ? <Text style={styles.mono} selectable>{job.artifactPath}</Text> : null}
          <View style={styles.inline}>
            {job.state === "succeeded" && job.artifactPath ? <Button label="Executar" icon="Play" small primary busy={launchMutation.isPending} onPress={() => launchMutation.mutate()} styles={styles} theme={theme} /> : null}
            {job.artifactPath ? <Button label="Copiar caminho" icon="Copy" small onPress={() => void copyPath(job.artifactPath ?? "")} styles={styles} theme={theme} /> : null}
            {job.logPath ? <Button label="Copiar caminho do log" icon="FileText" small onPress={() => void copyPath(job.logPath ?? "")} styles={styles} theme={theme} /> : null}
          </View>
          {job.errors.length > 0 ? <LogView lines={job.errors.slice(0, 15)} highlight={job.errors} styles={styles} theme={theme} label="Erros do build" /> : null}
          <LogView lines={job.logTail.slice(-20)} highlight={job.errors} styles={styles} theme={theme} label="Final do log do build" />
        </>
      ) : null}
    </View>
  );
}

const WINDOWED_ARGS = "-screen-fullscreen 0 -screen-width 1280 -screen-height 720";
const PLATFORM_LABELS: Record<Player["platform"], string> = { linux: "Linux", windows: "Windows", macos: "macOS" };

function Players({ project, lastFinished, theme, styles }: { readonly project: UnityProject; readonly lastFinished: string | null; readonly theme: PluginTheme; readonly styles: Styles }) {
  const list = useRpc(ListPlayersRpc);
  const launch = useRpc(LaunchPlayerRpc);
  const toast = useToast();
  // lastFinished in the key refreshes the list as soon as a build ends.
  const query = useQuery({ queryKey: ["unity", "players", project.path, lastFinished], queryFn: () => list({ projectPath: project.path }), refetchInterval: 15_000 });
  const [args, setArgs] = useState("");
  const [windowed, setWindowed] = useState(true);
  const [instances, setInstances] = useState(1);
  const mutation = useMutation({
    mutationFn: (player: Player) => launch({ projectPath: project.path, playerPath: player.path, args: [windowed ? WINDOWED_ARGS : "", args].join(" ").trim(), instances }),
    onSuccess: (result) => toast.show(result.message, { variant: "success" }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const players = query.data?.players ?? [];
  return (
    <Section title="Rodar no PC" hint={`Players encontrados em ${query.data?.root ?? "Builds"}/, do mais novo para o mais antigo.`} trailing={<Button label="Atualizar" icon="RefreshCw" small busy={query.isFetching} onPress={() => void query.refetch()} styles={styles} theme={theme} />} styles={styles}>
      {query.error ? <Text accessibilityRole="alert" style={styles.error}>{errorMessage(query.error)}</Text> : null}
      {query.isSuccess && players.length === 0 ? <Text style={styles.muted}>Nenhum player buildado ainda. Faça um build abaixo.</Text> : null}
      {players.length > 0 ? (
        <>
          <View style={styles.inline}>
            <Chip label="Em janela 1280×720" icon="AppWindow" active={windowed} onPress={() => setWindowed((value) => !value)} styles={styles} theme={theme} />
            {[1, 2, 3, 4].map((count) => (
              <Chip key={count} label={count === 1 ? "1 instância" : `${count} instâncias`} icon={count === 1 ? "User" : "Users"} active={instances === count} onPress={() => setInstances(count)} styles={styles} theme={theme} />
            ))}
          </View>
          <TextInput
            value={args}
            onChangeText={setArgs}
            placeholder="Argumentos extras (ex.: -logFile - -uisnapshot)"
            placeholderTextColor={theme.colors.foregroundMuted}
            accessibilityLabel="Argumentos extras do player"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={styles.list}>
            {players.map((player, index) => (
              <View key={player.path} style={[styles.row, index > 0 && styles.rowDivider]}>
                <Icon name={player.platform === "windows" ? "Monitor" : player.platform === "macos" ? "Apple" : "Terminal"} size={16} color={player.runnable ? theme.colors.accent : theme.colors.foregroundMuted} />
                <View style={styles.grow}>
                  <Text style={styles.rowTitle}>{player.folder}/{player.name}</Text>
                  <Text style={styles.small}>{PLATFORM_LABELS[player.platform]} · {new Date(player.modifiedAt).toLocaleString()}</Text>
                </View>
                <Button
                  label={player.runnable ? "Rodar" : "Outra plataforma"}
                  icon={player.runnable ? "Play" : undefined}
                  small
                  primary={player.runnable}
                  disabled={!player.runnable}
                  busy={mutation.isPending && mutation.variables?.path === player.path}
                  onPress={() => mutation.mutate(player)}
                  styles={styles}
                  theme={theme}
                  accessibilityLabel={`Rodar ${player.folder}/${player.name}`}
                />
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Section>
  );
}

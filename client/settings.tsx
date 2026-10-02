import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { unitySettings, type UnitySettings } from "../shared/settings";

type Draft = { projectRoots: string; editorRoots: string; buildOutputDir: string };

const toDraft = (values: UnitySettings): Draft => ({
  projectRoots: values.projectRoots.join("; "),
  editorRoots: values.editorRoots.join("; "),
  buildOutputDir: values.buildOutputDir,
});

const splitPaths = (text: string) => text.split(";").map((path) => path.trim()).filter(Boolean);

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(unitySettings);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.status === "ready" && draft === null) setDraft(toDraft(settings.values));
  }, [settings, draft]);

  if (settings.status === "loading" || (settings.status === "ready" && draft === null)) return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (settings.status === "error" || settings.status === "invalid") {
    return (
      <SettingsSection title="Unity">
        <SettingsCard>
          <SettingsAction label="Configurações inválidas" hint={settings.error} actionLabel="Restaurar padrão" onPress={() => void settings.reset()} />
        </SettingsCard>
      </SettingsSection>
    );
  }
  if (draft === null) return null;

  const buildDirError = /^([\\/]|[A-Za-z]:)|(^|[\\/])\.\.([\\/]|$)/u.test(draft.buildOutputDir.trim()) ? "Use um caminho relativo dentro do projeto." : null;
  const edit = (patch: Partial<Draft>) => {
    setSaved(false);
    setDraft({ ...draft, ...patch });
  };

  async function save() {
    if (settings.status !== "ready" || draft === null || buildDirError !== null) return;
    const ok = await settings.save(
      { ...settings.values, projectRoots: splitPaths(draft.projectRoots), editorRoots: splitPaths(draft.editorRoots), buildOutputDir: draft.buildOutputDir.trim() || "Builds" },
      settings.revision,
    );
    setSaved(ok);
  }

  return (
    <View style={{ gap: 24 }}>
      <SettingsSection title="Projetos">
        <SettingsCard>
          <SettingsInput
            label="Pastas de projetos"
            hint="Separadas por ponto e vírgula. Varridas até 3 níveis, além do Unity Hub e dos workspaces do Paseo. Ex.: ~/code/games; ~/Projects"
            initialValue={draft.projectRoots}
            placeholder="~/code/games"
            onChangeText={(projectRoots) => edit({ projectRoots })}
          />
          <SettingsInput
            label="Pastas extras de editores"
            hint="Para editores fora do Unity Hub, no formato <pasta>/<versão>/Editor/Unity."
            initialValue={draft.editorRoots}
            placeholder="/opt/unity/editors"
            onChangeText={(editorRoots) => edit({ editorRoots })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Build">
        <SettingsCard>
          <SettingsInput
            label="Pasta de saída"
            hint="Relativa ao projeto; cada plataforma ou perfil ganha uma subpasta."
            error={buildDirError}
            initialValue={draft.buildOutputDir}
            placeholder="Builds"
            onChangeText={(buildOutputDir) => edit({ buildOutputDir })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Editor aberto">
        <SettingsCard>
          <SettingsSwitch
            label="Usar a Unity CLI"
            hint="Com `unity` no PATH e o pacote com.unity.pipeline no projeto, troca de cena no Editor já aberto."
            value={settings.values.useUnityCli}
            disabled={settings.saving}
            onValueChange={(useUnityCli) => void settings.save({ ...settings.values, useUnityCli }, settings.revision)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsCard>
        <SettingsAction
          label={saved ? "Configurações salvas" : "Salvar pastas e saída de build"}
          error={settings.saveError}
          actionLabel={settings.saving ? "Salvando…" : "Salvar"}
          disabled={settings.saving || buildDirError !== null}
          onPress={() => void save()}
        />
      </SettingsCard>
      {saved ? <Text style={{ color: theme.colors.statusSuccess }}>Salvo. A lista de projetos usa as novas pastas na próxima atualização.</Text> : null}
    </View>
  );
}

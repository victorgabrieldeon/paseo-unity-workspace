import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import React, { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

export function useStyles(theme: PluginTheme, compact: boolean) {
  return useMemo(
    () =>
      StyleSheet.create({
        screen: { flex: 1, backgroundColor: theme.colors.surface0 },
        content: { padding: compact ? 16 : 24, gap: 16, paddingBottom: 48 },
        heading: { flexDirection: "row", alignItems: "center", gap: 12 },
        grow: { flex: 1, minWidth: 0, gap: 3 },
        title: { color: theme.colors.foreground, fontSize: compact ? 20 : 24, fontWeight: "700" },
        sectionTitle: { color: theme.colors.foreground, fontSize: 15, fontWeight: "600" },
        sectionHint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
        body: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
        muted: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
        small: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
        mono: { color: theme.colors.foregroundMuted, fontFamily: "monospace", fontSize: 12, lineHeight: 17 },
        error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
        warning: { color: theme.colors.statusWarning, fontSize: 13, lineHeight: 19 },
        success: { color: theme.colors.statusSuccess, fontSize: 13, lineHeight: 19 },
        section: { gap: 10 },
        card: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 12,
          padding: compact ? 12 : 16,
          gap: 10,
        },
        list: {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: 12,
          overflow: "hidden",
        },
        row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, paddingHorizontal: compact ? 12 : 14, paddingVertical: 8 },
        rowDivider: { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth },
        rowTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" },
        inline: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
        actions: { flexDirection: compact ? "column" : "row", alignItems: compact ? "stretch" : "center", flexWrap: "wrap", gap: 8 },
        button: { minHeight: 44, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 7, borderRadius: 9, paddingHorizontal: 14, backgroundColor: theme.colors.surface2 },
        smallButton: { minHeight: 36, paddingHorizontal: 10 },
        primaryButton: { backgroundColor: theme.colors.accent },
        dangerButton: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.statusDanger, borderWidth: 1 },
        buttonText: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" },
        primaryButtonText: { color: theme.colors.accentForeground },
        dangerButtonText: { color: theme.colors.statusDanger },
        pressed: { opacity: 0.55 },
        disabled: { opacity: 0.4 },
        chip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: theme.colors.surface2 },
        chipActive: { backgroundColor: theme.colors.accent },
        chipText: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "500" },
        chipTextActive: { color: theme.colors.accentForeground },
        dot: { width: 8, height: 8, borderRadius: 4 },
        logs: { backgroundColor: theme.colors.surface0, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 9, padding: 10, gap: 2 },
        input: {
          minHeight: 44,
          borderRadius: 9,
          paddingHorizontal: 12,
          color: theme.colors.foreground,
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
          borderWidth: StyleSheet.hairlineWidth,
          fontSize: 14,
        },
        checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: theme.colors.foregroundMuted, alignItems: "center", justifyContent: "center" },
        checkboxOn: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
        empty: { color: theme.colors.foregroundMuted, fontSize: 13, textAlign: "center", paddingVertical: 20 },
      }),
    [theme, compact],
  );
}

export type Styles = ReturnType<typeof useStyles>;

export function Button({ label, icon, primary = false, danger = false, small = false, busy = false, disabled = false, onPress, styles, theme, accessibilityLabel }: {
  readonly label: string;
  readonly icon?: string;
  readonly primary?: boolean;
  readonly danger?: boolean;
  readonly small?: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
  readonly styles: Styles;
  readonly theme: PluginTheme;
  readonly accessibilityLabel?: string;
}) {
  const color = primary ? theme.colors.accentForeground : danger ? theme.colors.statusDanger : theme.colors.foreground;
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, small && styles.smallButton, primary && styles.primaryButton, danger && styles.dangerButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : icon ? <Icon name={icon} size={15} color={color} /> : null}
      <Text style={[styles.buttonText, primary && styles.primaryButtonText, danger && styles.dangerButtonText]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, icon, active = false, onPress, styles, theme }: {
  readonly label: string;
  readonly icon?: string;
  readonly active?: boolean;
  readonly onPress?: () => void;
  readonly styles: Styles;
  readonly theme: PluginTheme;
}) {
  const content = (
    <>
      {icon ? <Icon name={icon} size={12} color={active ? theme.colors.accentForeground : theme.colors.foregroundMuted} /> : null}
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </>
  );
  if (onPress === undefined) return <View style={[styles.chip, active && styles.chipActive]}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export function Checkbox({ checked, label, hint, disabled = false, onChange, styles, theme }: {
  readonly checked: boolean;
  readonly label: string;
  readonly hint?: string;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly styles: Styles;
  readonly theme: PluginTheme;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked ? <Icon name="Check" size={14} color={theme.colors.accentForeground} /> : null}</View>
      <View style={styles.grow}>
        <Text style={styles.rowTitle}>{label}</Text>
        {hint ? <Text style={styles.small}>{hint}</Text> : null}
      </View>
    </Pressable>
  );
}

export function StatusDot({ color, styles }: { readonly color: string; readonly styles: Styles }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

export function Section({ title, hint, trailing, children, styles }: {
  readonly title: string;
  readonly hint?: string;
  readonly trailing?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly styles: Styles;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <View style={styles.grow}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
          {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
        </View>
        {trailing}
      </View>
      {children}
    </View>
  );
}

export function LogView({ lines, highlight, styles, theme, label }: {
  readonly lines: readonly string[];
  readonly highlight?: readonly string[];
  readonly styles: Styles;
  readonly theme: PluginTheme;
  readonly label: string;
}) {
  const marked = new Set(highlight ?? []);
  return (
    <View style={styles.logs} accessibilityLabel={label}>
      {lines.map((line, index) => (
        <Text key={`${index}-${line}`} selectable style={[styles.mono, marked.has(line) && { color: theme.colors.statusDanger }]}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Handler errors arrive as "Request failed: <message> requestType=… code=…"; show only the message. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Algo deu errado.";
  return error.message.replace(/^Request failed:\s*/u, "").replace(/\s+requestType=\S+(\s+code=\S+)?\s*$/u, "");
}

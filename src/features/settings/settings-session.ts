import { defaultSettingsState, type SettingsState } from "@/features/settings/settings-types";

const SETTINGS_SESSION_KEY = "enterprise-workspace.settings.v1";

type SettingsSessionStore = Pick<Storage, "getItem" | "setItem">;

function resolveStorage(storage?: SettingsSessionStore) {
  return storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
}

function isSettingsState(value: unknown): value is SettingsState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<SettingsState>;
  return Boolean(state.organization?.name && state.profile?.name && state.notifications);
}

export function cloneSettingsState(state: SettingsState): SettingsState {
  return structuredClone(state);
}

export function readSettingsSession(storage?: SettingsSessionStore): SettingsState {
  const target = resolveStorage(storage);
  if (!target) return cloneSettingsState(defaultSettingsState);
  try {
    const parsed = JSON.parse(target.getItem(SETTINGS_SESSION_KEY) ?? "null") as { version?: number; state?: unknown } | null;
    return parsed?.version === 1 && isSettingsState(parsed.state)
      ? cloneSettingsState(parsed.state)
      : cloneSettingsState(defaultSettingsState);
  } catch {
    return cloneSettingsState(defaultSettingsState);
  }
}

export function saveSettingsSession(state: SettingsState, storage?: SettingsSessionStore) {
  const target = resolveStorage(storage);
  if (!target) return;
  target.setItem(SETTINGS_SESSION_KEY, JSON.stringify({ version: 1, state }));
}

import { beforeEach, describe, expect, it } from "vitest";

import { defaultSettingsState } from "@/features/settings/settings-types";
import { readSettingsSession, saveSettingsSession } from "@/features/settings/settings-session";

describe("settings session", () => {
  beforeEach(() => window.localStorage.clear());

  it("round-trips settings through persistent browser storage", () => {
    const state = structuredClone(defaultSettingsState);
    state.organization.name = "量子星河集团";
    saveSettingsSession(state);

    expect(readSettingsSession()).toEqual(state);
  });

  it("falls back to defaults for corrupt storage", () => {
    window.localStorage.setItem("enterprise-workspace.settings.v1", "{broken");
    expect(readSettingsSession()).toEqual(defaultSettingsState);
  });
});

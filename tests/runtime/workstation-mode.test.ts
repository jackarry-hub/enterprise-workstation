import { describe, expect, it } from "vitest";

import {
  isDemoAuthEnabled,
  shouldAllowMockBusinessData,
} from "@/lib/runtime/workstation-mode";

function env(values: Record<string, string | undefined>) {
  return values as unknown as NodeJS.ProcessEnv;
}

describe("workstation runtime mode", () => {
  it("disables demo auth unless explicitly enabled", () => {
    expect(isDemoAuthEnabled(env({
      WORKSTATION_DEMO_ENABLED: "true",
    }))).toBe(true);
    expect(isDemoAuthEnabled(env({
      WORKSTATION_DEMO_ENABLED: "false",
    }))).toBe(false);
    expect(isDemoAuthEnabled(env({}))).toBe(false);
  });

  it("never allows mock business data in production, even when explicitly opted in", () => {
    expect(shouldAllowMockBusinessData(env({
      NODE_ENV: "production",
    }))).toBe(false);
    expect(shouldAllowMockBusinessData(env({
      WORKSTATION_ALLOW_MOCK_DATA: "true",
      NODE_ENV: "production",
    }))).toBe(false);
    expect(shouldAllowMockBusinessData(env({
      NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA: "true",
      NODE_ENV: "production",
    }))).toBe(false);
    expect(shouldAllowMockBusinessData(env({
      NODE_ENV: "development",
    }))).toBe(false);
    expect(shouldAllowMockBusinessData(env({
      NODE_ENV: "development",
      WORKSTATION_ALLOW_MOCK_DATA: "true",
    }))).toBe(true);
    expect(shouldAllowMockBusinessData(env({
      NODE_ENV: "test",
      NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA: "1",
    }))).toBe(true);
  });
});

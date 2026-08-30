import { describe, expect, it } from "vitest";
import { parseSettingsState } from "@/features/settings/settings-data";

export const settingsPayload = { organization: { name: "量子星河", shortName: "量子星河", logoUrl: "/brand/quantxy-logo.png", timezone: "asia-shanghai", language: "zh-cn", foundedDate: "2021-03-08", workWeekStart: "monday" }, profile: { name: "真实员工", email: "user@example.com", avatarUrl: "", source: "feishu" }, personal: { language: "zh-cn", dateFormat: "yyyy-mm-dd", followSystemTheme: false }, notifications: { inApp: true, email: false, dailyDigest: false }, scheduler: { workdayStart: "09:00", workdayEnd: "18:00", defaultPlanDays: 14, maxDailyHours: 8 }, versions: { organization: 2, personal: 1, notifications: 3, scheduler: 1 }, canManage: true, asOf: "2026-08-30T09:00:00Z" };

describe("workspace settings data", () => {
  it("accepts a complete server projection and rejects partial local-style data", () => {
    expect(parseSettingsState(settingsPayload)).toMatchObject({ organization: { name: "量子星河" }, profile: { source: "feishu" }, versions: { notifications: 3 } });
    expect(parseSettingsState({ organization: settingsPayload.organization })).toBeNull();
  });
});

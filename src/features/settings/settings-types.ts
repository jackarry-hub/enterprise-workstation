export type SettingsNamespace = "organization" | "personal" | "notifications" | "scheduler";

export interface SettingsState {
  organization: { name: string; shortName: string; logoUrl: string; timezone: string; language: string; foundedDate: string; workWeekStart: string };
  profile: { name: string; email: string; avatarUrl: string; source: "feishu" };
  personal: { language: string; dateFormat: string; followSystemTheme: boolean };
  notifications: { inApp: boolean; email: boolean; dailyDigest: boolean };
  scheduler: { workdayStart: string; workdayEnd: string; defaultPlanDays: number; maxDailyHours: number };
  versions: Record<SettingsNamespace, number>;
  canManage: boolean;
  asOf: string;
}

export const emptySettingsState: SettingsState = {
  organization: { name: "", shortName: "", logoUrl: "", timezone: "asia-shanghai", language: "zh-cn", foundedDate: "", workWeekStart: "monday" },
  profile: { name: "", email: "", avatarUrl: "", source: "feishu" },
  personal: { language: "zh-cn", dateFormat: "yyyy-mm-dd", followSystemTheme: false },
  notifications: { inApp: true, email: false, dailyDigest: false },
  scheduler: { workdayStart: "09:00", workdayEnd: "18:00", defaultPlanDays: 14, maxDailyHours: 8 },
  versions: { organization: 0, personal: 0, notifications: 0, scheduler: 0 },
  canManage: false,
  asOf: "",
};

export interface SettingsState {
  organization: {
    name: string;
    shortName: string;
    logoUrl: string;
    timezone: string;
    language: string;
    foundedDate: string;
    workWeekStart: string;
  };
  profile: {
    name: string;
    email: string;
    avatarUrl: string;
    currentPassword: string;
    newPassword: string;
  };
  notifications: {
    inApp: boolean;
    email: boolean;
    dailyDigest: boolean;
    followSystemTheme: boolean;
    dateFormat: string;
  };
}

export const defaultSettingsState: SettingsState = {
  organization: {
    name: "量子星河科技有限公司",
    shortName: "量子星河",
    logoUrl: "/brand/quantxy-logo.png",
    timezone: "asia-shanghai",
    language: "zh-cn",
    foundedDate: "2021-03-08",
    workWeekStart: "monday",
  },
  profile: {
    name: "李总",
    email: "ceo@quantxy.cn",
    avatarUrl: "",
    currentPassword: "",
    newPassword: "",
  },
  notifications: {
    inApp: true,
    email: true,
    dailyDigest: false,
    followSystemTheme: false,
    dateFormat: "yyyy-mm-dd",
  },
};

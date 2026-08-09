import type { Metadata } from "next";

import { SettingsPage } from "@/features/settings/settings-page";

export const metadata: Metadata = { title: "系统设置 | 企业工作站" };

export default function SettingsRoute() {
  return <SettingsPage />;
}

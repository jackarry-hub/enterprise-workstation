import type { Metadata } from "next";

import { SettingsPage } from "@/features/settings/settings-page";

export const metadata: Metadata = { title: "系统设置 | 量子智枢" };

export default function SettingsRoute() {
  return <SettingsPage />;
}

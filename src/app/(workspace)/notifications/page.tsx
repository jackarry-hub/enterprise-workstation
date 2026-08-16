import type { Metadata } from "next";

import { NotificationCenter } from "@/features/operations/notification-center";

export const metadata: Metadata = {
  title: "通知中心 | 量子智枢",
};

export default function NotificationsPage() {
  return <NotificationCenter />;
}

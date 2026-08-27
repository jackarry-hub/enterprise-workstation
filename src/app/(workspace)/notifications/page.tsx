import type { Metadata } from "next";

import { NotificationCenter } from "@/features/operations/notification-center";
import { loadNotificationInbox } from "@/features/operations/notification-inbox-data";

export const metadata: Metadata = {
  title: "通知中心 | 企业工作站",
};

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  return <NotificationCenter result={await loadNotificationInbox()} />;
}

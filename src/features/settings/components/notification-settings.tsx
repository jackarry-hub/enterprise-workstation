"use client";
import { Bell, CalendarDays, Mail, MessageCircle } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import type { SettingsState } from "@/features/settings/settings-types";

export function NotificationSettings({ value, onChange }: { value: SettingsState["notifications"]; onChange: (value: SettingsState["notifications"]) => void }) {
  const rows = [{ key: "inApp" as const, label: "站内通知", description: "任务、审批与业务动态", icon: MessageCircle }, { key: "email" as const, label: "邮件通知", description: "重要消息同步到企业邮箱", icon: Mail }, { key: "dailyDigest" as const, label: "每日工作摘要", description: "每日生成工作摘要", icon: CalendarDays }];
  return <section aria-labelledby="notification-settings-title"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-success/10 text-success"><Bell className="size-5" /></span><div><h2 id="notification-settings-title" className="text-xl font-semibold">通知设置</h2><p className="text-sm text-muted-foreground">按当前成员持久化消息渠道偏好。</p></div></div><div className="mt-5 grid gap-3 lg:grid-cols-2">{rows.map(({ key, label, description, icon: Icon }) => <div key={key} className="flex min-h-16 items-center gap-3 rounded-2xl border bg-background/60 px-4"><Icon className="size-5 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div><Toggle pressed={value[key]} onPressedChange={(pressed) => onChange({ ...value, [key]: pressed })} aria-label={label} className="h-7 w-12 justify-start rounded-full bg-muted p-1 data-[state=on]:justify-end data-[state=on]:bg-primary"><span className="size-5 rounded-full bg-background shadow-sm" /></Toggle></div>)}</div></section>;
}

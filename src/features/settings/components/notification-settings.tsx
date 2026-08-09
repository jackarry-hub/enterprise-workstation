"use client";

import { Bell, CalendarDays, Mail, MessageCircle, Moon } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import type { SettingsState } from "@/features/settings/settings-types";
import { cn } from "@/lib/utils";

type NotificationSettingsProps = {
  value: SettingsState["notifications"];
  onChange: (value: SettingsState["notifications"]) => void;
};

function PreferenceToggle({
  label,
  description,
  icon: Icon,
  pressed,
  onPressedChange,
}: {
  label: string;
  description: string;
  icon: typeof Bell;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 px-4 py-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
        <Icon aria-hidden="true" className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Toggle
        pressed={pressed}
        onPressedChange={onPressedChange}
        aria-label={label}
        className={cn(
          "h-7 w-12 justify-start rounded-full bg-muted p-1 data-[state=on]:justify-end data-[state=on]:bg-primary hover:bg-muted",
          pressed && "hover:bg-primary",
        )}
      >
        <span className="size-5 rounded-full bg-background shadow-sm" />
      </Toggle>
    </div>
  );
}

export function NotificationSettings({ value, onChange }: NotificationSettingsProps) {
  function patch(patchValue: Partial<SettingsState["notifications"]>) {
    onChange({ ...value, ...patchValue });
  }

  return (
    <section aria-labelledby="notification-settings-title">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-success/10 text-success">
          <Bell aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 id="notification-settings-title" className="text-xl font-semibold text-foreground">通知设置</h2>
          <p className="text-sm text-muted-foreground">管理消息接收渠道、每日摘要与界面显示偏好</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-glass-border bg-background/45 p-4">
          <div className="flex items-center gap-2">
            <Bell aria-hidden="true" className="size-4 text-primary" />
            <h3 className="font-semibold text-foreground">消息渠道</h3>
          </div>
          <div className="mt-3 grid gap-2">
            <PreferenceToggle
              label="站内通知"
              description="接收任务、审批和项目动态提醒"
              icon={MessageCircle}
              pressed={value.inApp}
              onPressedChange={(inApp) => patch({ inApp })}
            />
            <PreferenceToggle
              label="邮件通知"
              description="重要消息同步到企业邮箱"
              icon={Mail}
              pressed={value.email}
              onPressedChange={(email) => patch({ email })}
            />
            <PreferenceToggle
              label="每日工作摘要"
              description="每天 18:00 推送工作摘要"
              icon={CalendarDays}
              pressed={value.dailyDigest}
              onPressedChange={(dailyDigest) => patch({ dailyDigest })}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-glass-border bg-background/45 p-4">
          <div className="flex items-center gap-2">
            <Moon aria-hidden="true" className="size-4 text-primary" />
            <h3 className="font-semibold text-foreground">显示偏好</h3>
          </div>
          <div className="mt-3 grid gap-4">
            <label className="grid gap-2 text-sm font-medium text-foreground">
              日期格式
              <Select value={value.dateFormat} onValueChange={(dateFormat) => patch({ dateFormat })}>
                <SelectTrigger aria-label="日期格式" className="h-11 w-full bg-background/70">
                  <CalendarDays aria-hidden="true" className="size-4" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem>
                  <SelectItem value="yyyy-mm-dd-cn">YYYY年MM月DD日</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <PreferenceToggle
              label="深色模式跟随系统"
              description="根据设备外观自动切换"
              icon={Moon}
              pressed={value.followSystemTheme}
              onPressedChange={(followSystemTheme) => patch({ followSystemTheme })}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

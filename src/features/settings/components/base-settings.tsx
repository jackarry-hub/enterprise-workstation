"use client";

import { useState } from "react";
import { Bell, CalendarDays, Languages, Mail, MessageCircle, Moon, SlidersHorizontal } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

function PreferenceToggle({ label, description, icon: Icon, defaultPressed = true }: { label: string; description: string; icon: typeof Bell; defaultPressed?: boolean }) {
  const [pressed, setPressed] = useState(defaultPressed);
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 px-4 py-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden="true" className="size-4" /></span><div className="min-w-0 flex-1"><p className="font-medium text-foreground">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><Toggle pressed={pressed} onPressedChange={setPressed} aria-label={label} className={cn("h-7 w-12 justify-start rounded-full bg-muted p-1 data-[state=on]:justify-end data-[state=on]:bg-primary hover:bg-muted", pressed && "hover:bg-primary")}><span className="size-5 rounded-full bg-background shadow-sm" /></Toggle></div>
  );
}

export function BaseSettings() {
  return (
    <section aria-labelledby="base-settings-title">
      <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-success/10 text-success"><SlidersHorizontal aria-hidden="true" className="size-5" /></span><div><h2 id="base-settings-title" className="text-xl font-semibold text-foreground">基础配置</h2><p className="text-sm text-muted-foreground">设置通知渠道与系统使用偏好</p></div></div>
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-glass-border bg-background/45 p-4"><div className="flex items-center gap-2"><Bell aria-hidden="true" className="size-4 text-primary" /><h3 className="font-semibold text-foreground">通知设置</h3></div><div className="mt-3 grid gap-2"><PreferenceToggle label="站内通知" description="接收任务、审批和项目动态" icon={MessageCircle} /><PreferenceToggle label="邮件通知" description="重要消息同步到企业邮箱" icon={Mail} /><PreferenceToggle label="每日工作摘要" description="每天 18:00 推送工作摘要" icon={CalendarDays} defaultPressed={false} /></div></div>
        <div className="rounded-2xl border border-glass-border bg-background/45 p-4"><div className="flex items-center gap-2"><Languages aria-hidden="true" className="size-4 text-primary" /><h3 className="font-semibold text-foreground">系统偏好</h3></div><div className="mt-3 grid gap-4">
          <label className="grid gap-2 text-sm font-medium text-foreground">系统语言<Select defaultValue="zh-cn"><SelectTrigger aria-label="系统语言" className="h-11 w-full bg-background/70"><Languages aria-hidden="true" className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zh-cn">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></label>
          <label className="grid gap-2 text-sm font-medium text-foreground">日期格式<Select defaultValue="yyyy-mm-dd"><SelectTrigger aria-label="日期格式" className="h-11 w-full bg-background/70"><CalendarDays aria-hidden="true" className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="yyyy-mm-dd">YYYY-MM-DD</SelectItem><SelectItem value="yyyy-mm-dd-cn">YYYY年MM月DD日</SelectItem></SelectContent></Select></label>
          <PreferenceToggle label="深色模式跟随系统" description="根据设备外观自动切换" icon={Moon} defaultPressed={false} />
        </div></div>
      </div>
    </section>
  );
}

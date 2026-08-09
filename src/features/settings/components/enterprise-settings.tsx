import Image from "next/image";
import { Building2, CalendarDays, Clock3, ImageIcon, Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SettingsState } from "@/features/settings/settings-types";

type EnterpriseSettingsProps = {
  value: SettingsState["organization"];
  onChange: (value: SettingsState["organization"]) => void;
  onLogoSelect: (file: File) => void;
};

export function EnterpriseSettings({ value, onChange, onLogoSelect }: EnterpriseSettingsProps) {
  function patch(patchValue: Partial<SettingsState["organization"]>) {
    onChange({ ...value, ...patchValue });
  }
  return (
    <section aria-labelledby="enterprise-settings-title">
      <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 aria-hidden="true" className="size-5" /></span><div><h2 id="enterprise-settings-title" className="text-xl font-semibold">企业信息</h2><p className="text-sm text-muted-foreground">配置企业基本信息与系统区域、时间等基础参数</p></div></div>
      <div className="mt-5 grid gap-4 2xl:grid-cols-[1fr_.65fr_1.1fr_.7fr]">
        <div className="grid content-start gap-4"><label className="grid gap-2 text-sm font-medium" htmlFor="organization-name">企业名称<Input id="organization-name" value={value.name} onChange={(event) => patch({ name: event.target.value })} className="h-11 rounded-xl bg-background/70" /></label><label className="grid gap-2 text-sm font-medium" htmlFor="organization-short-name">企业简称<Input id="organization-short-name" value={value.shortName} onChange={(event) => patch({ shortName: event.target.value })} className="h-11 rounded-xl bg-background/70" /></label></div>
        <div><p className="text-sm font-medium">企业 Logo</p><div className="mt-2 flex min-h-28 items-center justify-center overflow-hidden rounded-2xl border border-glass-border bg-background/65 p-3"><Image src={value.logoUrl} alt="量子星河企业 Logo" width={210} height={74} unoptimized={value.logoUrl.startsWith("blob:")} className="h-auto max-h-20 w-40 object-contain" priority /></div><label className="mt-2 block"><input type="file" accept="image/*" aria-label="选择企业 Logo" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onLogoSelect(file); }} /><Button type="button" variant="outline" size="sm" className="pointer-events-none w-full rounded-xl"><ImageIcon data-icon="inline-start" />更换 Logo</Button></label></div>
        <div className="grid content-start gap-4"><label className="grid gap-2 text-sm font-medium">所在时区<Select value={value.timezone} onValueChange={(timezone) => patch({ timezone })}><SelectTrigger aria-label="所在时区" className="h-11 w-full bg-background/70"><Clock3 className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="asia-shanghai">(GMT+08:00) 上海、北京</SelectItem><SelectItem value="asia-singapore">(GMT+08:00) 新加坡</SelectItem></SelectContent></Select></label><label className="grid gap-2 text-sm font-medium">系统语言<Select value={value.language} onValueChange={(language) => patch({ language })}><SelectTrigger aria-label="系统语言" className="h-11 w-full bg-background/70"><Languages className="size-4" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="zh-cn">简体中文</SelectItem><SelectItem value="en">English</SelectItem></SelectContent></Select></label></div>
        <div className="grid content-start gap-4"><label className="grid gap-2 text-sm font-medium" htmlFor="founded-date">企业成立日期<div className="relative"><CalendarDays className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="founded-date" type="date" value={value.foundedDate} onChange={(event) => patch({ foundedDate: event.target.value })} className="h-11 rounded-xl bg-background/70 pl-9" /></div></label><label className="grid gap-2 text-sm font-medium">工作周开始于<Select value={value.workWeekStart} onValueChange={(workWeekStart) => patch({ workWeekStart })}><SelectTrigger aria-label="工作周开始于" className="h-11 w-full bg-background/70"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monday">周一</SelectItem><SelectItem value="sunday">周日</SelectItem></SelectContent></Select></label></div>
      </div>
    </section>
  );
}

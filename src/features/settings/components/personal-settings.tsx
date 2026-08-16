import Image from "next/image";
import { Camera, KeyRound, Mail, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SettingsState } from "@/features/settings/settings-types";

export function PersonalSettings({ value, identityLine, onChange, onAvatarSelect }: { value: SettingsState["profile"]; identityLine: string; onChange: (value: SettingsState["profile"]) => void; onAvatarSelect: (file: File) => void }) {
  function patch(patchValue: Partial<SettingsState["profile"]>) { onChange({ ...value, ...patchValue }); }
  return (
    <section aria-labelledby="personal-settings-title">
      <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-chart-3/10 text-chart-3"><UserRound className="size-5" /></span><div><h2 id="personal-settings-title" className="text-xl font-semibold">个人设置</h2><p className="text-sm text-muted-foreground">维护头像、个人资料与登录密码</p></div></div>
      <div className="mt-5 grid gap-4 xl:grid-cols-[260px_1fr]">
        <div className="rounded-2xl border border-glass-border bg-background/65 p-5 text-center"><div className="relative mx-auto w-fit"><Avatar className="size-24">{value.avatarUrl ? <Image src={value.avatarUrl} alt="个人头像" fill unoptimized className="rounded-full object-cover" /> : <AvatarFallback className="bg-linear-to-br from-primary to-chart-3 text-2xl font-semibold text-primary-foreground">{value.name.slice(0, 1)}</AvatarFallback>}</Avatar><span className="absolute right-0 bottom-0 grid size-8 place-items-center rounded-full border-2 border-background bg-primary text-primary-foreground"><Camera className="size-4" /></span></div><p className="mt-3 font-semibold">{value.name}</p><p className="text-xs text-muted-foreground">{identityLine}</p><label className="mt-4 block"><input type="file" accept="image/*" aria-label="选择个人头像" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) onAvatarSelect(file); }} /><Button type="button" variant="outline" size="sm" className="pointer-events-none rounded-xl">更换头像</Button></label></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-medium" htmlFor="display-name">姓名<div className="relative"><UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="display-name" value={value.name} onChange={(event) => patch({ name: event.target.value })} className="h-11 rounded-xl bg-background/70 pl-9" /></div></label><label className="grid gap-2 text-sm font-medium" htmlFor="work-email">企业邮箱<div className="relative"><Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="work-email" type="email" value={value.email} onChange={(event) => patch({ email: event.target.value })} className="h-11 rounded-xl bg-background/70 pl-9" /></div></label><div className="mt-1 border-t border-border/60 pt-4 sm:col-span-2"><div className="flex items-center gap-2"><KeyRound className="size-4 text-primary" /><h3 className="font-semibold">修改密码</h3></div></div><label className="grid gap-2 text-sm font-medium" htmlFor="current-password">当前密码<Input id="current-password" type="password" value={value.currentPassword} onChange={(event) => patch({ currentPassword: event.target.value })} placeholder="输入当前密码" className="h-11 rounded-xl bg-background/70" /></label><label className="grid gap-2 text-sm font-medium" htmlFor="new-password">新密码<Input id="new-password" aria-label="新密码" type="password" value={value.newPassword} onChange={(event) => patch({ newPassword: event.target.value })} placeholder="至少 8 位字符" className="h-11 rounded-xl bg-background/70" /></label></div>
      </div>
    </section>
  );
}

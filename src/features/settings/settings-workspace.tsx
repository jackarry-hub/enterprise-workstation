"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Building2, CheckCircle2, LockKeyhole, RotateCcw, Save, Settings2, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnterpriseSettings } from "@/features/settings/components/enterprise-settings";
import { NotificationSettings } from "@/features/settings/components/notification-settings";
import { PersonalSettings } from "@/features/settings/components/personal-settings";
import { PermissionMatrix } from "@/features/settings/components/permission-matrix";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import {
  cloneSettingsState,
  readSettingsSession,
  saveSettingsSession,
} from "@/features/settings/settings-session";
import { defaultSettingsState, type SettingsState } from "@/features/settings/settings-types";

type SettingsTab = "enterprise" | "personal" | "notifications" | "permissions";

const tabItems = [
  { value: "enterprise", label: "企业信息", icon: Building2 },
  { value: "personal", label: "个人设置", icon: UserRound },
  { value: "notifications", label: "通知设置", icon: Bell },
  { value: "permissions", label: "权限矩阵", icon: LockKeyhole },
] as const;

export function SettingsWorkspace() {
  const { actor } = useWorkspaceSession();
  const canManageEnterprise = actor.role === "executive" || actor.role === "hr";
  const canViewPermissions = actor.role === "executive";
  const visibleTabs = tabItems.filter(({ value }) => (
    (value !== "enterprise" || canManageEnterprise)
    && (value !== "permissions" || canViewPermissions)
  ));
  const [activeTab, setActiveTab] = useState<SettingsTab>(canManageEnterprise ? "enterprise" : "personal");
  const [settings, setSettings] = useState<SettingsState>(() => cloneSettingsState(defaultSettingsState));
  const [snapshot, setSnapshot] = useState<SettingsState>(() => cloneSettingsState(defaultSettingsState));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    const stored = readSettingsSession();
    setSettings(stored);
    setSnapshot(cloneSettingsState(stored));
    const requestedTab = new URLSearchParams(window.location.search).get("tab");
    if (
      requestedTab === "personal"
      || requestedTab === "notifications"
      || (requestedTab === "enterprise" && canManageEnterprise)
      || (requestedTab === "permissions" && canViewPermissions)
    ) {
      setActiveTab(requestedTab);
    }
  }, [canManageEnterprise, canViewPermissions]);

  useEffect(() => {
    const urls = objectUrls.current;
    return () => {
      if (typeof URL.revokeObjectURL !== "function") return;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function changeTab(value: string) {
    setActiveTab(value as SettingsTab);
    setSaved(false);
    setError("");
  }

  function save() {
    saveSettingsSession(settings);
    setSnapshot(cloneSettingsState(settings));
    setSaved(true);
    setError("");
  }

  function cancel() {
    setSettings(cloneSettingsState(snapshot));
    setSaved(false);
    setError("");
  }

  function imageUrl(file: File) {
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return null;
    }
    if (typeof URL.createObjectURL !== "function") return null;
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    setError("");
    setSaved(false);
    return url;
  }

  return (
    <main className="mx-auto flex w-full min-w-0 flex-col gap-3 px-4 pt-5 pb-5">
      <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-5 py-5 shadow-[0_18px_50px_rgba(60,105,170,0.08)]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:76%_center] opacity-75" />
        <div className="relative max-w-4xl">
          <PageHeader
            title="系统设置"
            description={canManageEnterprise ? "管理企业信息、个人资料与通知偏好。" : "管理与当前账号相关的个人资料和通知偏好。"}
            actions={canManageEnterprise ? <Badge variant="info" className="h-8 gap-1.5 rounded-xl px-3"><Settings2 aria-hidden="true" className="size-3.5" />基础配置</Badge> : undefined}
          />
        </div>
      </section>

      <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4">
        <Tabs value={activeTab} onValueChange={changeTab} className="min-w-0 gap-3">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-2xl bg-muted/55 p-1">
            {visibleTabs.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value} className="h-10 min-w-0 gap-2 rounded-xl px-2">
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="min-w-0 overflow-hidden rounded-3xl border border-glass-border bg-background/50 p-4">
            {activeTab !== "permissions" ? <div className="flex flex-col-reverse gap-3 border-b border-border/60 pb-4 sm:flex-row sm:items-center sm:justify-end">
              <div className="mr-auto min-h-5 text-xs">
                {error ? <p role="alert" className="font-medium text-destructive">{error}</p> : null}
                {saved ? <p role="status" className="inline-flex items-center gap-1.5 font-medium text-success"><CheckCircle2 aria-hidden="true" className="size-4" />设置已保存</p> : null}
                {!saved && !error ? <p className="text-muted-foreground">设置保存在当前浏览器，可在刷新后继续使用</p> : null}
              </div>
              <Button type="button" variant="outline" aria-label="取消" onClick={cancel} className="rounded-xl">
                <RotateCcw data-icon="inline-start" aria-hidden="true" />取消
              </Button>
              <Button type="button" aria-label="保存设置" onClick={save} className="rounded-xl">
                <Save data-icon="inline-start" aria-hidden="true" />保存设置
              </Button>
            </div> : null}

            <div className="mt-5">
              {activeTab === "enterprise" ? (
                <EnterpriseSettings
                  value={settings.organization}
                  onChange={(organization) => { setSettings((current) => ({ ...current, organization })); setSaved(false); }}
                  onLogoSelect={(file) => {
                    const logoUrl = imageUrl(file);
                    if (logoUrl) setSettings((current) => ({ ...current, organization: { ...current.organization, logoUrl } }));
                  }}
                />
              ) : null}
              {activeTab === "personal" ? (
                <PersonalSettings
                  value={settings.profile}
                  onChange={(profile) => { setSettings((current) => ({ ...current, profile })); setSaved(false); }}
                  onAvatarSelect={(file) => {
                    const avatarUrl = imageUrl(file);
                    if (avatarUrl) setSettings((current) => ({ ...current, profile: { ...current.profile, avatarUrl } }));
                  }}
                />
              ) : null}
              {activeTab === "notifications" ? (
                <NotificationSettings
                  value={settings.notifications}
                  onChange={(notifications) => { setSettings((current) => ({ ...current, notifications })); setSaved(false); }}
                />
              ) : null}
              {activeTab === "permissions" ? <PermissionMatrix /> : null}
            </div>
          </div>
        </Tabs>
      </GlassCard>

      <GlassCard className="grid gap-3 p-4">
        {[
          { icon: Bell, label: "通知渠道", value: `${Number(settings.notifications.inApp) + Number(settings.notifications.email)} 个已启用` },
          ...(canManageEnterprise ? [{ icon: Building2, label: "企业时区", value: settings.organization.timezone === "asia-shanghai" ? "Asia/Shanghai" : "Asia/Singapore" }] : []),
          { icon: UserRound, label: "当前账号", value: settings.profile.name },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="flex items-center gap-3 rounded-2xl bg-background/55 px-3 py-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Icon aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</p></div>
          </div>
        ))}
      </GlassCard>
    </main>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  Bot,
  Building2,
  CheckCircle2,
  Database,
  LockKeyhole,
  RotateCcw,
  Save,
  Settings2,
  UserRound,
  WandSparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EnterpriseSettings } from "@/features/settings/components/enterprise-settings";
import { EnterpriseActivation } from "@/features/settings/components/enterprise-activation";
import { AiProviderSettings } from "@/features/settings/components/ai-provider-settings";
import { NotificationSettings } from "@/features/settings/components/notification-settings";
import { PermissionMatrix } from "@/features/settings/components/permission-matrix";
import { PersonalSettings } from "@/features/settings/components/personal-settings";
import { SchedulerSettings } from "@/features/settings/components/scheduler-settings";
import { DataImportCenter } from "@/features/settings/components/data-import-center";
import { parseSettingsState } from "@/features/settings/settings-data";
import {
  emptySettingsState,
  type SettingsNamespace,
  type SettingsState,
} from "@/features/settings/settings-types";

type SettingsTab = SettingsNamespace | "ai" | "permissions" | "data";
const tabItems = [
  { value: "organization", label: "企业信息", icon: Building2 },
  { value: "data", label: "数据与资料", icon: Database },
  { value: "ai", label: "AI 模型", icon: Bot },
  { value: "personal", label: "个人设置", icon: UserRound },
  { value: "notifications", label: "通知设置", icon: Bell },
  { value: "scheduler", label: "调度参数", icon: WandSparkles },
  { value: "permissions", label: "当前权限", icon: LockKeyhole },
] as const;

function isSettingsNamespace(value: SettingsTab): value is SettingsNamespace {
  return ["organization", "personal", "notifications", "scheduler"].includes(value);
}

export function SettingsWorkspace() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("organization");
  const [settings, setSettings] = useState<SettingsState>(emptySettingsState);
  const [snapshot, setSnapshot] = useState<SettingsState>(emptySettingsState);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("正在同步服务器设置…");
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/workstation/settings", {
        cache: "no-store",
      });
      const parsed = parseSettingsState(await response.json());
      if (!response.ok || !parsed) throw new Error("settings_load_failed");
      setSettings(structuredClone(parsed));
      setSnapshot(structuredClone(parsed));
      setFeedback("");
    } catch {
      setFeedback("设置同步失败，请稍后重试。");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (tabItems.some(({ value }) => value === requested))
      setActiveTab(requested as SettingsTab);
    void load();
  }, []);

  async function save() {
    if (
      !isSettingsNamespace(activeTab) ||
      pending ||
      ((activeTab === "organization" || activeTab === "scheduler") &&
        !settings.canManage)
    )
      return;
    setPending(true);
    setSaved(false);
    setFeedback("正在保存到工作区…");
    try {
      const response = await fetch("/api/workstation/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          namespace: activeTab,
          settings: settings[activeTab],
          expectedVersion: settings.versions[activeTab],
        }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "settings_save_failed");
      await load();
      setSaved(true);
      setFeedback("");
    } catch (error) {
      setFeedback(
        error instanceof Error && error.message === "version_conflict"
          ? "设置已被其他人更新，请刷新后重试。"
          : "保存失败，请检查设置或稍后重试。",
      );
    } finally {
      setPending(false);
    }
  }
  const canEditActive =
    isSettingsNamespace(activeTab) && (
      activeTab === "personal" ||
      activeTab === "notifications" ||
      settings.canManage
    );
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-28 sm:px-4 lg:px-5 lg:pt-7 lg:pb-8">
      <section className="rounded-3xl border bg-background px-5 py-6 shadow-sm">
        <PageHeader
          title="系统设置"
          description="企业配置、个人偏好、通知与调度参数均以服务器为权威源。"
          actions={
            <Badge variant="info" className="h-8 gap-1.5 rounded-xl px-3">
              <Settings2 className="size-3.5" />
              版本化配置
            </Badge>
          }
        />
      </section>
      {feedback ? (
        <p
          role="status"
          className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary"
        >
          {feedback}
        </p>
      ) : null}
      <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as SettingsTab);
            setSaved(false);
            setFeedback("");
          }}
          className="gap-4 xl:grid xl:grid-cols-[220px_minmax(0,1fr)] xl:items-start"
        >
          <TabsList className="w-full justify-start overflow-x-auto rounded-2xl bg-muted/55 p-1 xl:sticky xl:top-22 xl:flex xl:flex-col xl:items-stretch xl:gap-1 xl:overflow-visible xl:p-2">
            {tabItems.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="h-11 gap-2 rounded-xl px-3 xl:flex-none xl:justify-start"
              >
                <Icon className="size-4" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-w-0 rounded-3xl border bg-background/50 p-4 sm:p-5 xl:min-h-130">
            {isSettingsNamespace(activeTab) ? (
              <div className="mb-5 flex flex-col-reverse gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-end">
                <div className="mr-auto min-h-5 text-xs">
                  {saved ? (
                    <p className="inline-flex items-center gap-1.5 font-medium text-success">
                      <CheckCircle2 className="size-4" />
                      设置已保存，刷新后仍有效
                    </p>
                  ) : !loading ? (
                    <p className="text-muted-foreground">
                      当前版本 v{settings.versions[activeTab]}
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="outline"
                  disabled={pending || loading}
                  onClick={() => {
                    setSettings(structuredClone(snapshot));
                    setSaved(false);
                    setFeedback("");
                  }}
                >
                  <RotateCcw data-icon="inline-start" />
                  取消
                </Button>
                {canEditActive ? (
                  <Button
                    disabled={pending || loading}
                    onClick={() => void save()}
                  >
                    <Save data-icon="inline-start" />
                    {pending ? "保存中…" : "保存设置"}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!loading ? (
              <>
                {activeTab === "organization" ? (
                  <>
                    <EnterpriseActivation />
                    <EnterpriseSettings
                      value={settings.organization}
                      onChange={(organization) =>
                        setSettings((current) => ({ ...current, organization }))
                      }
                      disabled={!settings.canManage}
                    />
                  </>
                ) : null}
                {activeTab === "data" ? <DataImportCenter /> : null}
                {activeTab === "ai" ? <AiProviderSettings /> : null}
                {activeTab === "personal" ? (
                  <PersonalSettings
                    profile={settings.profile}
                    value={settings.personal}
                    onChange={(personal) =>
                      setSettings((current) => ({ ...current, personal }))
                    }
                  />
                ) : null}
                {activeTab === "notifications" ? (
                  <NotificationSettings
                    value={settings.notifications}
                    onChange={(notifications) =>
                      setSettings((current) => ({ ...current, notifications }))
                    }
                  />
                ) : null}
                {activeTab === "scheduler" ? (
                  <SchedulerSettings
                    value={settings.scheduler}
                    onChange={(scheduler) =>
                      setSettings((current) => ({ ...current, scheduler }))
                    }
                    disabled={!settings.canManage}
                  />
                ) : null}
                {activeTab === "permissions" ? <PermissionMatrix /> : null}
              </>
            ) : (
              <div className="grid min-h-80 place-items-center text-sm text-muted-foreground">
                正在加载…
              </div>
            )}
          </div>
        </Tabs>
      </GlassCard>
      <GlassCard className="grid gap-3 p-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">配置来源</p>
          <p className="mt-1 font-semibold">PostgreSQL</p>
        </div>
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">身份来源</p>
          <p className="mt-1 font-semibold">飞书只读同步</p>
        </div>
        <div className="rounded-2xl bg-muted p-3">
          <p className="text-xs text-muted-foreground">更新时间</p>
          <p className="mt-1 text-sm font-semibold">
            {settings.asOf
              ? new Date(settings.asOf).toLocaleString("zh-CN")
              : "—"}
          </p>
        </div>
      </GlassCard>
    </main>
  );
}

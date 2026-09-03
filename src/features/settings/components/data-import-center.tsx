"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Upload,
  UsersRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CrmExchangeDialog } from "@/features/customers/components/crm-exchange-dialog";
import {
  ProjectFileTransportError,
  uploadVerifiedProjectFile,
  type VerifiedFileUploadPhase,
} from "@/features/files/verified-project-file-client";
import {
  parseDataImportBootstrap,
  type DataImportBootstrap,
} from "@/features/settings/data-import-types";

const phaseLabels: Record<VerifiedFileUploadPhase, string> = {
  hashing: "正在计算 SHA-256…",
  reserving: "正在申请安全上传通道…",
  uploading: "正在上传到企业对象存储…",
  verifying: "正在进行服务端完整性核验…",
  completed: "文件已核验入库",
};

function responseError(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown";
  const error = (value as Record<string, unknown>).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && !Array.isArray(error)) {
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : "unknown";
  }
  return "unknown";
}

function directoryFailureMessage(code: string) {
  if (code === "forbidden") return "当前账号没有组织同步权限。";
  if (code === "unauthorized") return "登录状态已失效，请重新登录。";
  if (code === "directory_configuration_invalid") return "飞书通讯录配置不完整，请先检查应用权限与密钥。";
  if (code === "directory_provider_unavailable") return "飞书通讯录暂不可用，请稍后重试。";
  return "同步未完成，系统已保留失败记录，请稍后重试。";
}

function titleFromFile(file: File) {
  const name = file.name.replace(/\.[^.]+$/, "").trim();
  return name || file.name;
}

export function DataImportCenter() {
  const [bootstrap, setBootstrap] = useState<DataImportBootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState("");
  const [crmOpen, setCrmOpen] = useState(false);
  const [crmFeedback, setCrmFeedback] = useState("");
  const [projectId, setProjectId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("企业资料");
  const [tags, setTags] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadFeedback, setUploadFeedback] = useState("");
  const [uploadTone, setUploadTone] = useState<"neutral" | "success" | "error">("neutral");
  const [uploadedFileId, setUploadedFileId] = useState("");
  const uploadAttempt = useRef<{ key: string; file: File } | null>(null);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/workstation/data-imports", { cache: "no-store" });
      const parsed = parseDataImportBootstrap(await response.json());
      if (!response.ok || !parsed) throw new Error("data_import_bootstrap_failed");
      setBootstrap(parsed);
      setProjectId((current) => (
        parsed.projects.some(({ id }) => id === current) ? current : parsed.projects[0]?.id ?? ""
      ));
    } catch {
      setBootstrap(null);
      setLoadError("数据导入能力暂不可用，请刷新后重试。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function syncDirectory() {
    if (!bootstrap?.capabilities.directorySync || syncing) return;
    setSyncing(true);
    setSyncFeedback("正在从当前企业飞书读取通讯录并写入工作区…");
    try {
      const response = await fetch("/api/workstation/directory-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (response.ok && payload.status === "completed") {
        setSyncFeedback("飞书通讯录同步完成，员工与部门已写入企业数据库。");
        return;
      }
      if (payload.status === "retry") {
        setSyncFeedback("本次同步已进入安全重试队列，请稍后查看员工目录。");
        return;
      }
      if (payload.status === "no_work") {
        setSyncFeedback(payload.reason === "active_lease"
          ? "已有通讯录同步正在执行，请稍后刷新员工目录。"
          : "当前没有可执行的通讯录同步任务，请检查飞书连接状态。");
        return;
      }
      setSyncFeedback(directoryFailureMessage(responseError(payload)));
    } catch {
      setSyncFeedback("网络连接中断，无法确认同步结果，请稍后到员工目录核对。");
    } finally {
      setSyncing(false);
    }
  }

  async function importMaterial(retry = false) {
    if (!bootstrap || uploading || !projectId || !file
        || (bootstrap.capabilities.knowledgeManage && !title.trim())) return;
    const attempt = retry && uploadAttempt.current?.file === file
      ? uploadAttempt.current
      : { key: crypto.randomUUID(), file };
    uploadAttempt.current = attempt;
    setUploading(true);
    setUploadedFileId("");
    setUploadTone("neutral");
    setUploadFeedback("正在准备安全上传…");
    try {
      const uploaded = await uploadVerifiedProjectFile({
        projectId,
        file: attempt.file,
        idempotencyKey: attempt.key,
        accessScope: "organization",
        onProgress: (phase) => setUploadFeedback(phaseLabels[phase]),
      });
      setUploadedFileId(uploaded.id);
      uploadAttempt.current = null;
      if (!bootstrap.capabilities.knowledgeManage) {
        setUploadTone("success");
        setUploadFeedback("文件已完成核验并保存到项目；请由知识库管理员继续建档。");
        return;
      }
      setUploadFeedback("文件已核验，正在创建知识草稿…");
      const response = await fetch("/api/workstation/knowledge/documents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          fileId: uploaded.id,
          title: title.trim(),
          summary: summary.trim(),
          category: category.trim() || "企业资料",
          tags: tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) {
        setUploadTone("error");
        setUploadFeedback("文件已安全入库，但知识草稿创建失败；可前往知识库从该文件继续建档。");
        return;
      }
      setUploadTone("success");
      setUploadFeedback("企业资料已安全入库，并创建知识草稿。审核发布后即可被检索与引用。");
      setFile(null);
      setTitle("");
      setSummary("");
      setTags("");
    } catch (error) {
      setUploadTone("error");
      setUploadFeedback(error instanceof Error ? error.message : "资料上传失败，请稍后重试。");
      if (!(error instanceof ProjectFileTransportError) || !error.retryable) {
        uploadAttempt.current = null;
      }
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <div className="grid min-h-80 place-items-center text-sm text-muted-foreground"><span className="inline-flex items-center gap-2"><LoaderCircle className="size-4 animate-spin" />正在读取真实数据接口…</span></div>;
  }

  if (!bootstrap) {
    return <div className="grid min-h-80 place-items-center text-center"><div><AlertCircle className="mx-auto size-8 text-destructive" /><p className="mt-3 text-sm text-destructive">{loadError}</p><Button type="button" variant="outline" className="mt-4 min-h-11" onClick={() => void load()}><RefreshCw />重新加载</Button></div></div>;
  }

  const canExchangeCustomers = bootstrap.capabilities.customerImport || bootstrap.capabilities.customerExport;
  const canUploadMaterial = bootstrap.capabilities.projectFileUpload
    && bootstrap.projectDataStatus === "ready" && bootstrap.projects.length > 0;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><ShieldCheck className="size-5" /></span>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{bootstrap.organizationName} · 真实数据入口</h2><Badge variant="success">Supabase</Badge></div><p className="mt-1 text-sm leading-6 text-muted-foreground">所有写入都经过当前账号权限、组织隔离、服务端校验和审计；这里不会生成演示数据。</p></div>
        </div>
      </section>

      <section aria-labelledby="data-onboarding-title">
        <div className="mb-3"><h2 id="data-onboarding-title" className="font-semibold">新企业启用顺序</h2><p className="mt-1 text-sm text-muted-foreground">按顺序完成后，员工、客户与企业知识即可进入协作流程。</p></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <GlassCard className="flex min-h-52 flex-col p-4"><span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 className="size-5" /></span><p className="mt-3 text-xs font-semibold text-primary">01 · 企业</p><h3 className="mt-1 font-semibold">维护企业基础信息</h3><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">企业名称、行业、时区、部门与岗位模板保存在工作区数据库。</p><Button asChild variant="outline" className="mt-3 min-h-11 w-full"><Link href="/settings?tab=organization">打开企业信息<ArrowRight /></Link></Button></GlassCard>
          <GlassCard className="flex min-h-52 flex-col p-4"><span className="grid size-10 place-items-center rounded-2xl bg-sky-100 text-sky-700"><UsersRound className="size-5" /></span><p className="mt-3 text-xs font-semibold text-sky-700">02 · 员工</p><h3 className="mt-1 font-semibold">同步飞书通讯录</h3><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">读取当前企业飞书的部门与成员，按组织范围增量落库，不会自动给员工发消息。</p><Button data-network-write="true" type="button" variant="outline" className="mt-3 min-h-11 w-full" disabled={!bootstrap.capabilities.directorySync || syncing} onClick={() => void syncDirectory()}>{syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{syncing ? "同步中…" : "同步通讯录"}</Button>{syncFeedback ? <p role="status" className="mt-2 text-xs leading-5 text-muted-foreground">{syncFeedback}</p> : null}</GlassCard>
          <GlassCard className="flex min-h-52 flex-col p-4"><span className="grid size-10 place-items-center rounded-2xl bg-violet-100 text-violet-700"><FileSpreadsheet className="size-5" /></span><p className="mt-3 text-xs font-semibold text-violet-700">03 · 客户</p><h3 className="mt-1 font-semibold">导入客户台账</h3><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">上传客户 JSON，先预检再逐行原子写入；重复项、错误行和权限问题会返回明细。</p><Button type="button" variant="outline" className="mt-3 min-h-11 w-full" disabled={!canExchangeCustomers} onClick={() => setCrmOpen(true)}><Database />客户数据交换</Button>{crmFeedback ? <p role="status" className="mt-2 text-xs leading-5 text-success">{crmFeedback}</p> : null}</GlassCard>
          <GlassCard className="flex min-h-52 flex-col p-4"><span className="grid size-10 place-items-center rounded-2xl bg-amber-100 text-amber-700"><BookOpen className="size-5" /></span><p className="mt-3 text-xs font-semibold text-amber-700">04 · 知识</p><h3 className="mt-1 font-semibold">上传企业资料</h3><p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">资料先绑定真实项目并完成存储核验，再生成可审核、发布、检索的知识草稿。</p><Button asChild variant="outline" className="mt-3 min-h-11 w-full"><Link href="#material-import">前往资料入库<ArrowRight /></Link></Button></GlassCard>
        </div>
      </section>

      <section id="material-import" aria-labelledby="material-import-title" className="scroll-mt-24 rounded-3xl border bg-background p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h2 id="material-import-title" className="font-semibold">企业资料入库</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">当前文件安全模型要求资料归属一个真实项目；完成核验后写入企业存储{bootstrap.capabilities.knowledgeManage ? "并自动创建知识草稿" : "，知识管理员可继续建档"}，不会只保存在浏览器。</p></div><Badge variant="info" className="self-start"><ShieldCheck />30 MB 上限</Badge></div>
        {bootstrap.projectDataStatus === "unavailable" ? <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">项目列表暂不可用，其他导入功能不受影响。</p> : null}
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid gap-3">
            <label className="grid gap-1.5 text-sm font-medium">归属项目<select aria-label="资料归属项目" className="h-11 min-w-0 rounded-xl border border-input bg-background px-3" value={projectId} disabled={!canUploadMaterial || uploading} onChange={(event) => setProjectId(event.target.value)}><option value="">请选择可协作项目</option>{bootstrap.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-medium">知识标题<Input aria-label="知识标题" value={title} maxLength={200} disabled={!canUploadMaterial || uploading} onChange={(event) => setTitle(event.target.value)} placeholder="例如：品牌视觉规范 2026" /></label>
            <label className="grid gap-1.5 text-sm font-medium">摘要<Textarea aria-label="知识摘要" rows={3} maxLength={2000} value={summary} disabled={!canUploadMaterial || uploading} onChange={(event) => setSummary(event.target.value)} placeholder="说明资料用途、适用范围与负责人" /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">分类<Input aria-label="知识分类" value={category} maxLength={80} disabled={!canUploadMaterial || uploading} onChange={(event) => setCategory(event.target.value)} /></label><label className="grid gap-1.5 text-sm font-medium">标签<Input aria-label="知识标签" value={tags} disabled={!canUploadMaterial || uploading} onChange={(event) => setTags(event.target.value)} placeholder="制度，品牌，运营" /></label></div>
          </div>
          <div className="flex flex-col">
            <label className={`flex min-h-52 flex-1 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed p-5 text-center transition-colors ${canUploadMaterial ? "border-primary/35 bg-primary/5 hover:bg-primary/10" : "cursor-not-allowed bg-muted/50"}`}>
              <input type="file" className="sr-only" aria-label="选择企业资料" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv" disabled={!canUploadMaterial || uploading} onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); setUploadedFileId(""); setUploadFeedback(""); setUploadTone("neutral"); uploadAttempt.current = null; if (next && !title.trim()) setTitle(titleFromFile(next)); event.currentTarget.value = ""; }} />
              {uploading ? <LoaderCircle className="size-7 animate-spin text-primary" /> : <Upload className="size-7 text-primary" />}<span className="mt-3 text-sm font-semibold">{file ? file.name : "选择本地企业资料"}</span><span className="mt-1 text-xs leading-5 text-muted-foreground">PDF、Word、Excel、PPT、文本、CSV · 服务端核验后入库</span>
            </label>
            {!bootstrap.capabilities.projectFileUpload ? <p className="mt-2 text-xs text-muted-foreground">当前账号没有项目文件上传权限。</p> : bootstrap.projects.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">请先创建一个项目或加入可协作项目，再上传企业资料。</p> : null}
            <Button data-network-write="true" type="button" className="mt-3 min-h-11 w-full" disabled={!canUploadMaterial || !file || (bootstrap.capabilities.knowledgeManage && !title.trim()) || uploading} onClick={() => void importMaterial()}>{uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}{uploading ? "正在入库…" : bootstrap.capabilities.knowledgeManage ? "上传并创建知识草稿" : "上传到企业存储"}</Button>
            {uploadFeedback ? <div role={uploadTone === "error" ? "alert" : "status"} className={`mt-3 rounded-xl px-3 py-2 text-xs leading-5 ${uploadTone === "success" ? "bg-success-soft text-success" : uploadTone === "error" ? "bg-danger-soft text-destructive" : "bg-brand-soft text-primary"}`}><span className="flex items-start gap-2">{uploadTone === "success" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : uploadTone === "error" ? <AlertCircle className="mt-0.5 size-4 shrink-0" /> : <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin" />}{uploadFeedback}</span>{uploadTone === "error" && uploadAttempt.current ? <Button type="button" size="sm" variant="outline" className="mt-2 min-h-11 w-full" disabled={uploading} onClick={() => void importMaterial(true)}><RefreshCw />使用原请求重试</Button> : null}{uploadedFileId ? <Button asChild type="button" size="sm" variant="outline" className="mt-2 min-h-11 w-full"><Link href="/knowledge">打开知识库<ArrowRight /></Link></Button> : null}</div> : null}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-muted/30 p-4"><h2 className="font-semibold">需要通过业务流程产生的数据</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-background p-3"><p className="text-sm font-medium">审批与费用</p><p className="mt-1 text-xs leading-5 text-muted-foreground">在“审批与财务”发起、审核、支付，保留版本和操作审计；不允许直接覆盖待审批状态。</p></div><div className="rounded-xl bg-background p-3"><p className="text-sm font-medium">薪资与任务</p><p className="mt-1 text-xs leading-5 text-muted-foreground">员工同步后由薪资策略、项目和任务流程生成；不以无校验表格直接写入正式记录。</p></div></div></section>

      <CrmExchangeDialog open={crmOpen} onOpenChange={setCrmOpen} canImport={bootstrap.capabilities.customerImport} canExport={bootstrap.capabilities.customerExport} canExportPii={bootstrap.capabilities.customerExportPii} onComplete={setCrmFeedback} />
    </div>
  );
}

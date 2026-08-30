import { Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";

const moduleLabels: Record<string, string> = { dashboard: "驾驶舱", organization: "组织", department: "部门", project: "项目", task: "任务", hr: "人事", salary: "薪资", approval: "审批", expense: "报账", knowledge: "知识", agent: "Agent", analytics: "分析", settings: "设置", customer: "客户", ai: "AI", files: "文件", employee: "员工" };

export function PermissionMatrix() {
  const session = useWorkspaceSession();
  const groups = session.permissionCodes.reduce<Record<string, string[]>>((result, permission) => { const permissionModule = permission.split(".")[0]; result[permissionModule] = [...(result[permissionModule] ?? []), permission]; return result; }, {});
  const grouped = Object.entries(groups);
  return <section aria-labelledby="permission-matrix-title"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></span><div><h2 id="permission-matrix-title" className="text-xl font-semibold">当前权限</h2><p className="text-sm text-muted-foreground">来自服务端 Session 的实际角色与权限，不展示预设矩阵。</p></div></div><div className="mt-4 flex items-start gap-3 rounded-2xl bg-success-soft p-4"><ShieldCheck className="size-5 text-success" /><div><p className="font-medium">{session.roleCodes.join(" / ")}</p><p className="text-sm text-muted-foreground">租户、组织、路由与数据库 RLS 会继续独立校验。</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{grouped.map(([module, permissions]) => <article key={module} className="rounded-2xl border p-4"><div className="flex items-center justify-between"><h3 className="font-semibold">{moduleLabels[module] ?? module}</h3><Badge variant="outline">{permissions.length}</Badge></div><ul className="mt-3 grid gap-2">{permissions.map((permission) => <li key={permission} className="flex items-center gap-2 text-sm text-muted-foreground"><Check className="size-4 text-success" />{permission}</li>)}</ul></article>)}</div>{grouped.length === 0 ? <p className="mt-5 rounded-2xl border p-8 text-center text-sm text-muted-foreground">当前身份没有额外管理权限。</p> : null}</section>;
}

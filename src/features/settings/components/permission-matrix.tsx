import { Check, Eye, LockKeyhole, ShieldCheck, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";

const roles = [
  { name: "决策人", scope: "全公司经营与最终决策", capabilities: ["下达命令与确认 AI 拆解", "查看全部项目和执行风险", "批准薪资并完成总验收"] },
  { name: "部门负责人", scope: "本部门项目与人员", capabilities: ["承接部门目标并分配任务", "处理任务验收和团队审批", "查看本部门分析数据"] },
  { name: "员工", scope: "本人任务与个人数据", capabilities: ["执行任务、上传成果和提交验收", "打卡、请假和查看工资单", "发起财务或人事协同"] },
  { name: "财务", scope: "预算、薪资与财务协同", capabilities: ["处理预算和采购协同", "核算与发放薪资", "查看本人考勤和申请"] },
  { name: "人事", scope: "组织、考勤与人事审批", capabilities: ["维护人员和考勤制度", "复核请假、补卡和加班", "完成薪资人员复核"] },
] as const;

export function PermissionMatrix() {
  return <section aria-labelledby="permission-matrix-title"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><LockKeyhole className="size-5" /></span><div><h2 id="permission-matrix-title" className="text-xl font-semibold">角色权限矩阵</h2><p className="text-sm text-muted-foreground">权限已按最小可见范围生效，敏感操作采用职责分离。</p></div></div><div className="mt-5 rounded-2xl border border-success/20 bg-success-soft/55 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 size-5 shrink-0 text-success" /><div><p className="font-medium">权限策略运行正常</p><p className="mt-1 text-sm leading-6 text-muted-foreground">页面导航、直接访问、任务验收、薪资审批和考勤封账均执行角色校验。决策、执行、复核和付款由不同岗位完成。</p></div></div></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{roles.map((role) => <article key={role.name} className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-primary"><UsersRound className="size-4" /></span><div className="min-w-0 flex-1"><h3 className="font-semibold">{role.name}</h3><p className="text-xs text-muted-foreground">{role.scope}</p></div><Badge variant="success">已启用</Badge></div><ul className="mt-4 grid gap-2">{role.capabilities.map((item) => <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground"><Check className="mt-0.5 size-4 shrink-0 text-success" />{item}</li>)}</ul></article>)}</div><div className="mt-4 flex items-start gap-3 rounded-2xl bg-muted/55 p-4"><Eye className="mt-0.5 size-4 shrink-0 text-primary" /><p className="text-sm leading-6 text-muted-foreground">当前页面只展示生效策略，不允许在本地试用环境中任意放大权限。正式接入企业身份系统后，可由系统管理员维护人员与角色的绑定关系。</p></div></section>;
}

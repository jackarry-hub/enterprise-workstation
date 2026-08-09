import { Banknote, CheckCircle2, FileSignature, Plane, ShoppingCart } from "lucide-react";

const templates = [
  { label: "请假申请流程", detail: "部门负责人 → HR", icon: Plane, tone: "bg-primary/10 text-primary" },
  { label: "报销申请流程", detail: "部门负责人 → 财务", icon: Banknote, tone: "bg-success/10 text-success" },
  { label: "采购申请流程", detail: "部门负责人 → 行政", icon: ShoppingCart, tone: "bg-chart-3/10 text-chart-3" },
  { label: "合同审批流程", detail: "部门负责人 → 法务", icon: FileSignature, tone: "bg-warning/10 text-warning" },
];

export function ApprovalAside() {
  return (
    <aside className="grid content-start gap-4">
      <section>
        <h2 className="text-base font-semibold text-foreground">审批流程模板</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">V0.9 固定流程</p>
        <div className="mt-3 grid gap-2">
          {templates.map(({ label, detail, icon: Icon, tone }) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 px-3 py-2.5">
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon aria-hidden="true" className="size-4" /></span>
              <div className="min-w-0"><p className="text-sm font-medium text-foreground">{label}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div>
              <span className="ml-auto rounded-full bg-success/10 px-2 py-1 text-[11px] font-medium text-success">使用中</span>
            </div>
          ))}
        </div>
      </section>
      <section className="border-t border-border/60 pt-4">
        <h2 className="text-base font-semibold text-foreground">最近审批动态</h2>
        <div className="mt-3 grid gap-3 text-sm">
          {["张伟的请假申请已提交", "王芳的报销等待财务复核", "周宁的请假申请已通过"].map((item, index) => (
            <div key={item} className="flex gap-2.5"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success/10 text-success"><CheckCircle2 aria-hidden="true" className="size-3" /></span><div><p className="text-foreground">{item}</p><p className="mt-0.5 text-xs text-muted-foreground">{index + 1} 小时前</p></div></div>
          ))}
        </div>
      </section>
    </aside>
  );
}

import { Banknote, FileSignature, ShoppingCart } from "lucide-react";

const templates = [
  { label: "费用报销审批", detail: "直属主管 → 财务复核", icon: Banknote, tone: "bg-success/10 text-success" },
  { label: "采购申请审批", detail: "直属主管 → 财务复核", icon: ShoppingCart, tone: "bg-chart-3/10 text-chart-3" },
  { label: "合同审批", detail: "直属主管 → 管理员复核", icon: FileSignature, tone: "bg-warning/10 text-warning" },
];

export function ApprovalAside() {
  return (
    <aside className="grid content-start gap-4">
      <section>
        <h2 className="text-base font-semibold text-foreground">审批流程模板</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">当前启用的固定流程</p>
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
      <p className="border-t border-border/60 pt-4 text-xs leading-5 text-muted-foreground">流程节点由服务器模板管理；页面只展示真实审批记录和当前账号可执行的操作。</p>
    </aside>
  );
}

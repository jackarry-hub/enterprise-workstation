import { cn } from "@/lib/utils";
import type { MobileTaskStatus } from "@/features/mobile-workstation/mobile-workstation-types";

const labels: Record<MobileTaskStatus, string> = { pending: "待开始", in_progress: "进行中", review: "待验收", blocked: "已阻塞", done: "已完成", cancelled: "已取消" };

export function MobileStatusPill({ status }: { status: MobileTaskStatus }) {
  return <span className={cn("mobile-status-pill", status === "done" && "is-done", status === "blocked" && "is-blocked")}>{labels[status]}</span>;
}


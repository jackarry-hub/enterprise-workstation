import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CheckSquare2,
  ClipboardCheck,
  FolderKanban,
  Gauge,
  Grid3X3,
  Landmark,
  Megaphone,
  Settings,
  UserCog,
  UserRound,
  UsersRound,
  WalletCards,
  Workflow,
} from "lucide-react";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import {
  getModuleCapabilities,
  getVisibleQuickWorkspaceActions,
  type CommercialModule,
} from "@/features/commercial/module-capabilities";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  module: CommercialModule;
  available: boolean;
};

export const navigationItems: readonly NavigationItem[] = [
  { label: "AI 决策调度台", href: "/dashboard", icon: Gauge, module: "dashboard", available: true },
  { label: "负责人推进台", href: "/department", icon: Workflow, module: "department", available: true },
  { label: "我的执行台", href: "/execution", icon: Grid3X3, module: "execution", available: true },
  { label: "财务执行中心", href: "/finance", icon: Landmark, module: "finance", available: true },
  { label: "人事协同中心", href: "/hr", icon: UserCog, module: "hr", available: true },
  { label: "项目管理", href: "/projects", icon: FolderKanban, module: "projects", available: true },
  { label: "活动推进", href: "/activities", icon: Megaphone, module: "activities", available: true },
  { label: "任务管理", href: "/tasks", icon: CheckSquare2, module: "tasks", available: true },
  { label: "组织人事", href: "/people", icon: UsersRound, module: "people", available: true },
  { label: "薪资管理", href: "/payroll", icon: WalletCards, module: "payroll", available: true },
  { label: "审批中心", href: "/approvals", icon: ClipboardCheck, module: "approvals", available: true },
  { label: "客户管理", href: "/customers", icon: UserRound, module: "customers", available: true },
  { label: "数据分析", href: "/analytics", icon: BarChart3, module: "analytics", available: true },
  { label: "系统设置", href: "/settings", icon: Settings, module: "settings", available: true },
];

export function getVisibleNavigationItems(session: WorkspaceSession) {
  const capabilities = getModuleCapabilities(session);
  return navigationItems.filter((item) => item.available && capabilities[item.module]);
}

export { getVisibleQuickWorkspaceActions };

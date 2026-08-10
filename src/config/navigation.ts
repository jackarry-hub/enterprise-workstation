import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BriefcaseBusiness,
  CalendarCheck2,
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
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  available: boolean;
  roles?: readonly WorkspaceRole[];
};

export const navigationItems: NavigationItem[] = [
  { label: "AI 决策调度台", href: "/dashboard", icon: Gauge, available: true, roles: ["executive"] },
  { label: "负责人推进台", href: "/department", icon: Workflow, available: true, roles: ["department_head"] },
  { label: "我的执行台", href: "/execution", icon: Grid3X3, available: true, roles: ["employee"] },
  { label: "财务执行中心", href: "/finance", icon: Landmark, available: true, roles: ["finance"] },
  { label: "人事协同中心", href: "/hr", icon: UserCog, available: true, roles: ["hr"] },
  { label: "项目管理", href: "/projects", icon: FolderKanban, available: true, roles: ["executive", "department_head"] },
  { label: "活动推进", href: "/activities", icon: Megaphone, available: true, roles: ["executive", "department_head"] },
  { label: "任务管理", href: "/tasks", icon: CheckSquare2, available: true, roles: ["executive", "department_head", "employee", "finance", "hr"] },
  { label: "组织人事", href: "/people", icon: UsersRound, available: true, roles: ["hr", "executive", "department_head"] },
  { label: "请假管理", href: "/leave", icon: CalendarCheck2, available: true, roles: ["hr", "department_head", "employee", "finance"] },
  { label: "薪资管理", href: "/payroll", icon: WalletCards, available: true, roles: ["hr", "finance", "executive", "employee"] },
  { label: "审批中心", href: "/approvals", icon: ClipboardCheck, available: true, roles: ["executive", "department_head", "employee", "finance", "hr"] },
  { label: "客户管理", href: "/customers", icon: UserRound, available: true, roles: ["executive"] },
  { label: "数据分析", href: "/analytics", icon: BarChart3, available: true, roles: ["executive", "department_head"] },
  { label: "系统设置", href: "/settings", icon: Settings, available: true, roles: ["executive"] },
];

export const quickWorkspaceActions = [
  { label: "项目协同", icon: BriefcaseBusiness },
  { label: "审批协作", icon: ClipboardCheck },
];

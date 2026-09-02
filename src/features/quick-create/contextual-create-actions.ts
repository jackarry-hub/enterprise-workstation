import type { WorkspacePermissionCode, WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { CommercialModule } from "@/features/commercial/module-capabilities";

export const QUICK_CREATE_EVENT = "quantxy:quick-create";
export type ContextualCreateAction = {
  readonly id: "project.create" | "activity.create" | "customer.create" | "expense.create" | "agent.create" | "agent.orchestration.create" | "agent.permission.request" | "assistant.conversation.create";
  readonly label: string;
  readonly icon: "folder" | "calendar" | "customer" | "receipt" | "bot" | "workflow" | "shield" | "message";
  readonly requiredPermission: WorkspacePermissionCode | null;
  readonly module: CommercialModule;
  readonly target: string;
};

const actions: readonly (ContextualCreateAction & { pathname: string })[] = [
  { pathname: "/projects", id: "project.create", label: "新建项目", icon: "folder", requiredPermission: "project.create", module: "projects", target: "project-create" },
  { pathname: "/activities", id: "activity.create", label: "新建活动", icon: "calendar", requiredPermission: "project.create", module: "activities", target: "activity-create" },
  { pathname: "/customers", id: "customer.create", label: "新建客户", icon: "customer", requiredPermission: "customer.manage", module: "customers", target: "customer-create" },
  { pathname: "/approvals", id: "expense.create", label: "发起费用报销", icon: "receipt", requiredPermission: "expense.submit", module: "approvals", target: "expense-create" },
  { pathname: "/finance", id: "expense.create", label: "发起费用报销", icon: "receipt", requiredPermission: "expense.submit", module: "approvals", target: "expense-create" },
  { pathname: "/agents", id: "agent.create", label: "新建 Agent", icon: "bot", requiredPermission: "agent.manage", module: "agents", target: "agent-editor" },
  { pathname: "/agents", id: "agent.orchestration.create", label: "新建 Agent 编排", icon: "workflow", requiredPermission: "agent.orchestrate", module: "agents", target: "orchestration-editor" },
  { pathname: "/agents", id: "agent.permission.request", label: "申请 Agent 权限", icon: "shield", requiredPermission: "approval.submit", module: "agents", target: "permission-request" },
  { pathname: "/assistant", id: "assistant.conversation.create", label: "新建 AI 会话", icon: "message", requiredPermission: null, module: "assistant", target: "conversation-create" },
];

export function getContextualCreateActions({ pathname, session, capabilities }: { pathname: string; session: WorkspaceSession; capabilities: Readonly<Record<CommercialModule, boolean>> }) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  return actions.filter((action) => action.pathname === normalized && capabilities[action.module] && (action.requiredPermission === null || session.permissionCodes.includes(action.requiredPermission))).map((action) => ({ id: action.id, label: action.label, icon: action.icon, requiredPermission: action.requiredPermission, module: action.module, target: action.target }));
}

export function dispatchContextualCreate(action: ContextualCreateAction) {
  window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT, { detail: { id: action.id, target: action.target } }));
}

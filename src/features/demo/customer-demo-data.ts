import type {
  DatabaseRoleCode,
  WorkspaceActor,
  WorkspacePermissionCode,
  WorkspaceRole,
  WorkspaceSession,
} from "@/features/auth/workspace-session-types";
import type { MemberSummary } from "@/features/projects/types";

export const CUSTOMER_DEMO_TENANT_ID = "90000000-0000-4000-8000-000000000000";
export const CUSTOMER_DEMO_ORGANIZATION_ID = "90000000-0000-4000-8000-000000000100";
export const CUSTOMER_DEMO_ORGANIZATION_NAME = "量子星河 · 客户演示企业";

export type CustomerDemoPerson = {
  id: string;
  employeeProfileId: string;
  memberId: string;
  organizationMemberId: number;
  authUserId: string;
  actorId: string;
  employeeNo: string;
  name: string;
  department: string;
  departmentCode: string;
  jobTitle: string;
  responsibility: string;
  role: WorkspaceRole;
  roleCode: Exclude<DatabaseRoleCode, "admin">;
  roleLabel: string;
  landingPath: string;
  managerId?: string;
  email: string;
  phone: string;
  hireDate: string;
  skills: readonly string[];
};

export const customerDemoPeople: readonly CustomerDemoPerson[] = [
  {
    id: "demo-executive",
    employeeProfileId: "61000000-0000-4000-8000-000000000010",
    memberId: "20000000-0000-4000-8000-000000000010",
    organizationMemberId: 1010,
    authUserId: "90000000-0000-4000-8000-000000000010",
    actorId: "actor-executive",
    employeeNo: "QXY-1001",
    name: "林远",
    department: "总经办",
    departmentCode: "GENERAL",
    jobTitle: "CEO",
    responsibility: "输入经营目标、确认方案下发、处理升级事项、完成总验收与归档。",
    role: "executive",
    roleCode: "owner",
    roleLabel: "决策人",
    landingPath: "/dashboard",
    email: "lin.yuan@demo.quantxy.cn",
    phone: "138 0000 1001",
    hireDate: "2021-03-08",
    skills: ["strategy", "governance", "decision"],
  },
  {
    id: "demo-product-head",
    employeeProfileId: "61000000-0000-4000-8000-000000000001",
    memberId: "20000000-0000-4000-8000-000000000001",
    organizationMemberId: 1001,
    authUserId: "90000000-0000-4000-8000-000000000001",
    actorId: "actor-manager",
    employeeNo: "QXY-1002",
    name: "张伟",
    department: "产品研发中心",
    departmentCode: "PRODUCT",
    jobTitle: "产品技术总监",
    responsibility: "承接技术目标、分配执行任务、协调阻塞并验收研发成果。",
    role: "department_head",
    roleCode: "department_head",
    roleLabel: "部门负责人",
    landingPath: "/department",
    managerId: "demo-executive",
    email: "zhang.wei@demo.quantxy.cn",
    phone: "138 0000 1002",
    hireDate: "2022-08-01",
    skills: ["product", "architecture", "delivery"],
  },
  {
    id: "demo-engineer",
    employeeProfileId: "61000000-0000-4000-8000-000000000004",
    memberId: "20000000-0000-4000-8000-000000000004",
    organizationMemberId: 1004,
    authUserId: "90000000-0000-4000-8000-000000000004",
    actorId: "actor-employee",
    employeeNo: "QXY-1003",
    name: "陈晨",
    department: "产品研发中心",
    departmentCode: "PRODUCT",
    jobTitle: "前端工程师",
    responsibility: "执行研发任务、更新进度、上传成果并提交负责人验收。",
    role: "employee",
    roleCode: "employee",
    roleLabel: "员工",
    landingPath: "/execution",
    managerId: "demo-product-head",
    email: "chen.chen@demo.quantxy.cn",
    phone: "138 0000 1003",
    hireDate: "2024-03-18",
    skills: ["frontend", "integration", "automation"],
  },
  {
    id: "demo-qa",
    employeeProfileId: "61000000-0000-4000-8000-000000000008",
    memberId: "20000000-0000-4000-8000-000000000008",
    organizationMemberId: 1008,
    authUserId: "90000000-0000-4000-8000-000000000008",
    actorId: "actor-qa",
    employeeNo: "QXY-1004",
    name: "郭敏",
    department: "产品研发中心",
    departmentCode: "PRODUCT",
    jobTitle: "测试工程师",
    responsibility: "执行回归测试、提交测试报告并为上线验收提供证据。",
    role: "employee",
    roleCode: "employee",
    roleLabel: "员工",
    landingPath: "/execution",
    managerId: "demo-product-head",
    email: "guo.min@demo.quantxy.cn",
    phone: "138 0000 1004",
    hireDate: "2024-06-10",
    skills: ["testing", "quality", "acceptance"],
  },
  {
    id: "demo-market-head",
    employeeProfileId: "61000000-0000-4000-8000-000000000002",
    memberId: "20000000-0000-4000-8000-000000000002",
    organizationMemberId: 1002,
    authUserId: "90000000-0000-4000-8000-000000000002",
    actorId: "actor-market",
    employeeNo: "QXY-1005",
    name: "王芳",
    department: "市场增长中心",
    departmentCode: "MARKET",
    jobTitle: "市场总监",
    responsibility: "完成客户调研、市场沟通并验收推广和案例成果。",
    role: "department_head",
    roleCode: "department_head",
    roleLabel: "部门负责人",
    landingPath: "/department",
    managerId: "demo-executive",
    email: "wang.fang@demo.quantxy.cn",
    phone: "138 0000 1005",
    hireDate: "2022-06-15",
    skills: ["research", "marketing", "content"],
  },
  {
    id: "demo-design-head",
    employeeProfileId: "61000000-0000-4000-8000-000000000003",
    memberId: "20000000-0000-4000-8000-000000000003",
    organizationMemberId: 1003,
    authUserId: "90000000-0000-4000-8000-000000000003",
    actorId: "actor-designer",
    employeeNo: "QXY-1006",
    name: "刘洋",
    department: "设计体验中心",
    departmentCode: "DESIGN",
    jobTitle: "设计总监",
    responsibility: "输出三角色工作流和视觉方案，完成设计交付与评审。",
    role: "department_head",
    roleCode: "department_head",
    roleLabel: "部门负责人",
    landingPath: "/department",
    managerId: "demo-executive",
    email: "liu.yang@demo.quantxy.cn",
    phone: "138 0000 1006",
    hireDate: "2023-02-20",
    skills: ["workflow", "prototype", "design"],
  },
  {
    id: "demo-customer-head",
    employeeProfileId: "61000000-0000-4000-8000-000000000005",
    memberId: "20000000-0000-4000-8000-000000000005",
    organizationMemberId: 1005,
    authUserId: "90000000-0000-4000-8000-000000000005",
    actorId: "actor-sales",
    employeeNo: "QXY-1007",
    name: "赵敏",
    department: "运营交付中心",
    departmentCode: "DELIVERY",
    jobTitle: "客户成功总监",
    responsibility: "制定客户试点和交付计划，负责客户侧上线验收。",
    role: "department_head",
    roleCode: "department_head",
    roleLabel: "部门负责人",
    landingPath: "/department",
    managerId: "demo-executive",
    email: "zhao.min@demo.quantxy.cn",
    phone: "138 0000 1007",
    hireDate: "2023-05-11",
    skills: ["customer", "delivery", "value"],
  },
  {
    id: "demo-operations",
    employeeProfileId: "61000000-0000-4000-8000-000000000009",
    memberId: "20000000-0000-4000-8000-000000000009",
    organizationMemberId: 1009,
    authUserId: "90000000-0000-4000-8000-000000000009",
    actorId: "actor-operations",
    employeeNo: "QXY-1008",
    name: "孙悦",
    department: "运营交付中心",
    departmentCode: "DELIVERY",
    jobTitle: "交付运营专员",
    responsibility: "安排培训、整理交付资料并回收客户使用反馈。",
    role: "employee",
    roleCode: "employee",
    roleLabel: "员工",
    landingPath: "/execution",
    managerId: "demo-customer-head",
    email: "sun.yue@demo.quantxy.cn",
    phone: "138 0000 1008",
    hireDate: "2025-07-28",
    skills: ["training", "operations", "feedback"],
  },
  {
    id: "demo-finance",
    employeeProfileId: "61000000-0000-4000-8000-000000000007",
    memberId: "20000000-0000-4000-8000-000000000007",
    organizationMemberId: 1007,
    authUserId: "90000000-0000-4000-8000-000000000007",
    actorId: "actor-finance",
    employeeNo: "QXY-1009",
    name: "周倩",
    department: "财务中心",
    departmentCode: "FINANCE",
    jobTitle: "财务经理",
    responsibility: "审核预算与采购申请，归档付款凭证和成本结果。",
    role: "finance",
    roleCode: "finance",
    roleLabel: "财务",
    landingPath: "/finance",
    managerId: "demo-executive",
    email: "zhou.qian@demo.quantxy.cn",
    phone: "138 0000 1009",
    hireDate: "2023-09-04",
    skills: ["budget", "procurement", "finance"],
  },
  {
    id: "demo-hr",
    employeeProfileId: "61000000-0000-4000-8000-000000000006",
    memberId: "20000000-0000-4000-8000-000000000006",
    organizationMemberId: 1006,
    authUserId: "90000000-0000-4000-8000-000000000006",
    actorId: "actor-hr",
    employeeNo: "QXY-1010",
    name: "李琪",
    department: "人力资源中心",
    departmentCode: "HR",
    jobTitle: "HRBP",
    responsibility: "处理人员调配、职责确认、培训安排和权限协同。",
    role: "hr",
    roleCode: "hr",
    roleLabel: "人事",
    landingPath: "/hr",
    managerId: "demo-executive",
    email: "li.qi@demo.quantxy.cn",
    phone: "138 0000 1010",
    hireDate: "2023-11-20",
    skills: ["raci", "staffing", "training"],
  },
];

const allPermissions: WorkspacePermissionCode[] = [
  "dashboard.read",
  "organization.manage",
  "department.manage",
  "project.manage",
  "task.manage",
  "hr.manage",
  "attendance.self",
  "attendance.manage",
  "salary.self",
  "salary.manage",
  "approval.self",
  "approval.manage",
  "files.manage",
];

const permissionsByRole: Record<WorkspaceRole, WorkspacePermissionCode[]> = {
  executive: allPermissions,
  department_head: ["department.manage", "project.manage", "task.manage", "approval.self", "approval.manage", "files.manage"],
  employee: ["task.manage", "attendance.self", "salary.self", "approval.self", "files.manage"],
  finance: ["task.manage", "salary.self", "salary.manage", "approval.self", "approval.manage", "files.manage"],
  hr: ["organization.manage", "hr.manage", "attendance.manage", "salary.manage", "approval.self", "approval.manage", "files.manage"],
};

export const customerDemoProjectMembers = customerDemoPeople.map<MemberSummary>((person) => ({
  id: person.memberId,
  displayName: person.name,
  department: person.department,
  title: person.jobTitle,
}));

export const customerDemoActors = customerDemoPeople.map<WorkspaceActor>((person) => ({
  id: person.actorId,
  memberId: person.memberId,
  name: person.name,
  role: person.role,
  roleLabel: person.roleLabel,
  department: person.department,
  title: person.jobTitle,
  landingPath: person.landingPath,
}));

export const customerDemoSessions = customerDemoPeople.map<WorkspaceSession>((person) => ({
  tenantId: CUSTOMER_DEMO_TENANT_ID,
  authUserId: person.authUserId,
  identity: {
    providerCode: "customer-demo",
    authProvider: "customer-demo",
    providerSubject: `customer-demo:${person.id}`,
  },
  organization: {
    id: CUSTOMER_DEMO_ORGANIZATION_ID,
    name: CUSTOMER_DEMO_ORGANIZATION_NAME,
  },
  member: {
    id: person.organizationMemberId,
    employeeProfileId: person.employeeProfileId,
    status: "active",
  },
  profile: {
    displayName: person.name,
    avatarUrl: null,
    departmentName: person.department,
    jobTitle: person.jobTitle,
    skills: [...person.skills],
  },
  roleCodes: [person.roleCode],
  permissionCodes: [...permissionsByRole[person.role]],
  primaryRole: person.role,
  landingPath: person.landingPath,
  isAdmin: false,
  actor: {
    id: person.authUserId,
    memberId: String(person.organizationMemberId),
    name: person.name,
    role: person.role,
    roleLabel: person.roleLabel,
    department: person.department,
    title: person.jobTitle,
    landingPath: person.landingPath,
  },
}));

export function getCustomerDemoPerson(id: string) {
  return customerDemoPeople.find((person) => person.id === id);
}

export function getCustomerDemoPersonByActorId(actorId: string) {
  return customerDemoPeople.find((person) => person.actorId === actorId);
}

export function getCustomerDemoPersonByMemberId(memberId: string) {
  return customerDemoPeople.find((person) => person.memberId === memberId);
}

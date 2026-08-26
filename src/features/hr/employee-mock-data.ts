import type {
  Department,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
  EmployeeProfile,
} from "@/features/hr/employee-types";

export const mockDepartments: Department[] = [
  { id: "62000000-0000-4000-8000-000000000001", code: "GENERAL", name: "总经办", status: "active", sortOrder: 10 },
  { id: "62000000-0000-4000-8000-000000000002", code: "PRODUCT", name: "产品研发部", status: "active", sortOrder: 20 },
  { id: "62000000-0000-4000-8000-000000000003", code: "RD", name: "技术研发部", status: "active", sortOrder: 30 },
  { id: "62000000-0000-4000-8000-000000000004", code: "HR", name: "人力资源部", status: "active", sortOrder: 40 },
  { id: "62000000-0000-4000-8000-000000000005", code: "FINANCE", name: "财务部", status: "active", sortOrder: 50 },
  { id: "62000000-0000-4000-8000-000000000006", code: "ADMIN", name: "行政部", status: "active", sortOrder: 60 },
  { id: "62000000-0000-4000-8000-000000000007", code: "SALES", name: "市场销售部", status: "active", sortOrder: 70 },
];

const ids = {
  linYuan: "61000000-0000-4000-8000-000000000001",
  wangFang: "61000000-0000-4000-8000-000000000002",
  zhangWei: "61000000-0000-4000-8000-000000000003",
  liuYang: "61000000-0000-4000-8000-000000000004",
  zhouNing: "61000000-0000-4000-8000-000000000005",
  chenChen: "61000000-0000-4000-8000-000000000006",
  liQi: "61000000-0000-4000-8000-000000000007",
  zhaoMin: "61000000-0000-4000-8000-000000000008",
  sunYue: "61000000-0000-4000-8000-000000000009",
  xuAn: "61000000-0000-4000-8000-000000000010",
};

const profiles: EmployeeProfile[] = [
  {
    id: ids.linYuan,
    employeeNo: "QXY-1001",
    displayName: "林远",
    departmentId: mockDepartments[0].id,
    jobTitle: "董事长兼 CEO",
    employmentType: "full_time",
    employmentStatus: "active",
    account: { organizationMemberId: "1", status: "active", roles: [{ code: "owner", name: "老板" }] },
  },
  {
    id: ids.wangFang,
    employeeNo: "QXY-1002",
    displayName: "王芳",
    departmentId: mockDepartments[3].id,
    jobTitle: "人力资源总监",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "active",
    account: { organizationMemberId: "2", status: "active", roles: [{ code: "hr", name: "HR" }] },
  },
  {
    id: ids.zhangWei,
    employeeNo: "QXY-1003",
    displayName: "张伟",
    departmentId: mockDepartments[2].id,
    jobTitle: "技术研发总监",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "active",
    account: { organizationMemberId: "3", status: "active", roles: [{ code: "department_head", name: "部门负责人" }] },
  },
  {
    id: ids.liuYang,
    employeeNo: "QXY-1004",
    displayName: "刘洋",
    departmentId: mockDepartments[1].id,
    jobTitle: "高级产品经理",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "active",
    account: { organizationMemberId: "4", status: "active", roles: [{ code: "department_head", name: "部门负责人" }] },
  },
  {
    id: ids.zhouNing,
    employeeNo: "QXY-1028",
    displayName: "周宁",
    departmentId: mockDepartments[1].id,
    jobTitle: "产品设计师",
    managerEmployeeId: ids.liuYang,
    employmentType: "full_time",
    employmentStatus: "probation",
  },
  {
    id: ids.chenChen,
    employeeNo: "QXY-1012",
    displayName: "陈晨",
    departmentId: mockDepartments[2].id,
    jobTitle: "前端工程师",
    managerEmployeeId: ids.zhangWei,
    employmentType: "full_time",
    employmentStatus: "active",
    account: { organizationMemberId: "6", status: "active", roles: [{ code: "employee", name: "普通员工" }] },
  },
  {
    id: ids.liQi,
    employeeNo: "QXY-1016",
    displayName: "李琪",
    departmentId: mockDepartments[2].id,
    jobTitle: "数据分析师",
    managerEmployeeId: ids.zhangWei,
    employmentType: "full_time",
    employmentStatus: "active",
    account: { organizationMemberId: "7", status: "active", roles: [{ code: "employee", name: "普通员工" }] },
  },
  {
    id: ids.zhaoMin,
    employeeNo: "QXY-1008",
    displayName: "赵敏",
    departmentId: mockDepartments[4].id,
    jobTitle: "财务经理",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "on_leave",
    account: { organizationMemberId: "8", status: "suspended", roles: [{ code: "finance", name: "财务" }] },
  },
  {
    id: ids.sunYue,
    employeeNo: "QXY-1029",
    displayName: "孙悦",
    departmentId: mockDepartments[5].id,
    jobTitle: "行政专员",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "probation",
    account: { organizationMemberId: "9", status: "invited", roles: [{ code: "employee", name: "普通员工" }] },
  },
  {
    id: ids.xuAn,
    employeeNo: "QXY-1009",
    displayName: "徐安",
    departmentId: mockDepartments[6].id,
    jobTitle: "商务拓展经理",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "departed",
  },
];

const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
const departmentById = new Map(mockDepartments.map((department) => [department.id, department]));

export const mockEmployees: EmployeeDirectoryItem[] = profiles.map((profile) => {
  const manager = profile.managerEmployeeId
    ? profileById.get(profile.managerEmployeeId)
    : undefined;

  return {
    profile,
    department: profile.departmentId ? departmentById.get(profile.departmentId) : undefined,
    manager: manager
      ? { id: manager.id, displayName: manager.displayName }
      : undefined,
  };
});

export const employeeDirectoryMockResult: EmployeeDirectoryResult = {
  source: "mock",
  data: {
    employees: mockEmployees,
    departments: mockDepartments,
    stats: {
      total: mockEmployees.length,
      active: mockEmployees.filter(({ profile }) => profile.employmentStatus === "active").length,
      probation: mockEmployees.filter(({ profile }) => profile.employmentStatus === "probation").length,
      departments: mockDepartments.filter(({ status }) => status === "active").length,
    },
  },
};

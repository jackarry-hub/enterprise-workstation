import type {
  Department,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
  EmployeeProfile,
} from "@/features/hr/employee-types";

const organizationId = "10000000-0000-4000-8000-000000000001";

export const mockDepartments: Department[] = [
  { id: "62000000-0000-4000-8000-000000000001", organizationId, code: "GENERAL", name: "总经办", status: "active", sortOrder: 10 },
  { id: "62000000-0000-4000-8000-000000000002", organizationId, code: "PRODUCT", name: "产品研发部", status: "active", sortOrder: 20 },
  { id: "62000000-0000-4000-8000-000000000003", organizationId, code: "RD", name: "技术研发部", status: "active", sortOrder: 30 },
  { id: "62000000-0000-4000-8000-000000000004", organizationId, code: "HR", name: "人力资源部", status: "active", sortOrder: 40 },
  { id: "62000000-0000-4000-8000-000000000005", organizationId, code: "FINANCE", name: "财务部", status: "active", sortOrder: 50 },
  { id: "62000000-0000-4000-8000-000000000006", organizationId, code: "ADMIN", name: "行政部", status: "active", sortOrder: 60 },
  { id: "62000000-0000-4000-8000-000000000007", organizationId, code: "SALES", name: "市场销售部", status: "active", sortOrder: 70 },
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
    organizationId,
    employeeNo: "QXY-1001",
    displayName: "林远",
    workEmail: "lin.yuan@quantxy.cn",
    phone: "138 0000 1001",
    departmentId: mockDepartments[0].id,
    jobTitle: "董事长兼 CEO",
    employmentType: "full_time",
    employmentStatus: "active",
    hireDate: "2021-03-08",
    account: { organizationMemberId: "1", status: "active", roles: [{ code: "owner", name: "老板" }] },
  },
  {
    id: ids.wangFang,
    organizationId,
    employeeNo: "QXY-1002",
    displayName: "王芳",
    workEmail: "wang.fang@quantxy.cn",
    phone: "138 0000 1002",
    departmentId: mockDepartments[3].id,
    jobTitle: "人力资源总监",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "active",
    hireDate: "2022-06-15",
    account: { organizationMemberId: "2", status: "active", roles: [{ code: "hr", name: "HR" }] },
  },
  {
    id: ids.zhangWei,
    organizationId,
    employeeNo: "QXY-1003",
    displayName: "张伟",
    workEmail: "zhang.wei@quantxy.cn",
    phone: "138 0000 1003",
    departmentId: mockDepartments[2].id,
    jobTitle: "技术研发总监",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "active",
    hireDate: "2022-08-01",
    account: { organizationMemberId: "3", status: "active", roles: [{ code: "department_head", name: "部门负责人" }] },
  },
  {
    id: ids.liuYang,
    organizationId,
    employeeNo: "QXY-1004",
    displayName: "刘洋",
    workEmail: "liu.yang@quantxy.cn",
    phone: "138 0000 1004",
    departmentId: mockDepartments[1].id,
    jobTitle: "高级产品经理",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "active",
    hireDate: "2023-02-20",
    account: { organizationMemberId: "4", status: "active", roles: [{ code: "department_head", name: "部门负责人" }] },
  },
  {
    id: ids.zhouNing,
    organizationId,
    employeeNo: "QXY-1028",
    displayName: "周宁",
    workEmail: "zhou.ning@quantxy.cn",
    phone: "138 0000 1028",
    departmentId: mockDepartments[1].id,
    jobTitle: "产品设计师",
    managerEmployeeId: ids.liuYang,
    employmentType: "full_time",
    employmentStatus: "probation",
    hireDate: "2026-08-01",
  },
  {
    id: ids.chenChen,
    organizationId,
    employeeNo: "QXY-1012",
    displayName: "陈晨",
    workEmail: "chen.chen@quantxy.cn",
    phone: "138 0000 1012",
    departmentId: mockDepartments[2].id,
    jobTitle: "前端工程师",
    managerEmployeeId: ids.zhangWei,
    employmentType: "full_time",
    employmentStatus: "active",
    hireDate: "2024-03-18",
    account: { organizationMemberId: "6", status: "active", roles: [{ code: "employee", name: "普通员工" }] },
  },
  {
    id: ids.liQi,
    organizationId,
    employeeNo: "QXY-1016",
    displayName: "李琪",
    workEmail: "li.qi@quantxy.cn",
    phone: "138 0000 1016",
    departmentId: mockDepartments[2].id,
    jobTitle: "数据分析师",
    managerEmployeeId: ids.zhangWei,
    employmentType: "full_time",
    employmentStatus: "active",
    hireDate: "2024-09-09",
    account: { organizationMemberId: "7", status: "active", roles: [{ code: "employee", name: "普通员工" }] },
  },
  {
    id: ids.zhaoMin,
    organizationId,
    employeeNo: "QXY-1008",
    displayName: "赵敏",
    workEmail: "zhao.min@quantxy.cn",
    phone: "138 0000 1008",
    departmentId: mockDepartments[4].id,
    jobTitle: "财务经理",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "on_leave",
    hireDate: "2023-05-11",
    account: { organizationMemberId: "8", status: "suspended", roles: [{ code: "finance", name: "财务" }] },
  },
  {
    id: ids.sunYue,
    organizationId,
    employeeNo: "QXY-1029",
    displayName: "孙悦",
    workEmail: "sun.yue@quantxy.cn",
    phone: "138 0000 1029",
    departmentId: mockDepartments[5].id,
    jobTitle: "行政专员",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "probation",
    hireDate: "2026-07-28",
    account: { organizationMemberId: "9", status: "invited", roles: [{ code: "employee", name: "普通员工" }] },
  },
  {
    id: ids.xuAn,
    organizationId,
    employeeNo: "QXY-1009",
    displayName: "徐安",
    workEmail: "xu.an@quantxy.cn",
    phone: "138 0000 1009",
    departmentId: mockDepartments[6].id,
    jobTitle: "商务拓展经理",
    managerEmployeeId: ids.linYuan,
    employmentType: "full_time",
    employmentStatus: "departed",
    hireDate: "2023-08-21",
    departureDate: "2026-07-31",
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
      ? { id: manager.id, displayName: manager.displayName, jobTitle: manager.jobTitle }
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

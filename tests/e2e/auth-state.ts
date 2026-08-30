import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { parseWorkspaceAccess } from "../../src/features/auth/workspace-access";
import type {
  WorkspaceRole,
  WorkspaceSession,
} from "../../src/features/auth/workspace-session-types";

type AuthStateName =
  | WorkspaceRole
  | "unknown"
  | "suspended"
  | "departed"
  | "second-provider"
  | "admin"
  | "supervisor";

type RoleCode =
  | "owner"
  | "department_head"
  | "employee"
  | "finance"
  | "hr";

type RoleFixture = {
  state: WorkspaceRole;
  employeeNo: string;
  displayName: string;
  roleCode: RoleCode;
  departmentCode: "AI" | "FIN" | "HR";
  email: string;
  providerSubject: string;
  providerMatchKeys: readonly string[];
};

type AdditionalRoleFixture = Omit<RoleFixture, "state" | "roleCode"> & {
  state: "admin" | "supervisor";
  additionalRole: "admin" | "supervisor";
};

type StoredCookieOptions = {
  domain?: string;
  expires?: Date;
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: boolean | "lax" | "strict" | "none";
  secure?: boolean;
};

type CookieJarItem = {
  value: string;
  options: StoredCookieOptions;
};

type SignedInIdentity = {
  client: SupabaseClient;
  session: WorkspaceSession | null;
};

type HarnessEnvironment = {
  supabaseUrl: string;
  publishableKey: string;
  serviceRoleKey: string;
  appBaseUrl: string;
};

const QUANTXY_TENANT_SLUG = "quantxy";
const QUANTXY_ORGANIZATION_SLUG = "quantum-galaxy";
const SECOND_TENANT = {
  name: "E2E 隔离企业",
  slug: "phase1-e2e-isolation",
  organizationName: "E2E 隔离组织",
  organizationSlug: "phase1-e2e-organization",
  providerCode: "e2e_oidc",
  authProvider: "custom:e2e-oidc",
  providerTenantKey: "tenant_phase1_e2e_isolation",
} as const;

const BLOCKED_FIXTURES = {
  suspended: {
    employeeNo: "E2E-SUSPENDED",
    displayName: "E2E 停用员工",
    email: "phase1-suspended@example.test",
    providerSubject: "open_id:e2e-suspended",
  },
  departed: {
    employeeNo: "E2E-DEPARTED",
    displayName: "E2E 离职员工",
    email: "phase1-departed@example.test",
    providerSubject: "open_id:e2e-departed",
  },
} as const;

const UNKNOWN_EMAIL = "phase1-unknown@example.test";
const SECOND_PROVIDER_FIXTURE = {
  employeeNo: "E2E-SECOND-PROVIDER",
  displayName: "E2E 第二 Provider 员工",
  email: "phase1-second-provider@example.test",
  providerSubject: "email:phase1-second-provider@example.test",
  providerMatchKeys: ["email:phase1-second-provider@example.test"],
} as const;

export const roleFixtures: Readonly<Record<WorkspaceRole, RoleFixture>> = {
  executive: {
    state: "executive",
    employeeNo: "E2E-OWNER",
    displayName: "E2E 企业负责人",
    roleCode: "owner",
    departmentCode: "AI",
    email: "phase1-executive@example.test",
    providerSubject: "open_id:e2e-executive",
    providerMatchKeys: [
      "open_id:e2e-executive",
      "email:phase1-executive@example.test",
    ],
  },
  department_head: {
    state: "department_head",
    employeeNo: "E2E-MANAGER",
    displayName: "E2E 部门负责人",
    roleCode: "department_head",
    departmentCode: "AI",
    email: "phase1-department-head@example.test",
    providerSubject: "open_id:e2e-department-head",
    providerMatchKeys: [
      "open_id:e2e-department-head",
      "email:phase1-department-head@example.test",
    ],
  },
  employee: {
    state: "employee",
    employeeNo: "E2E-EMPLOYEE",
    displayName: "E2E 普通员工",
    roleCode: "employee",
    departmentCode: "AI",
    email: "phase1-employee@example.test",
    providerSubject: "open_id:e2e-employee",
    providerMatchKeys: [
      "open_id:e2e-employee",
      "email:phase1-employee@example.test",
    ],
  },
  finance: {
    state: "finance",
    employeeNo: "E2E-FINANCE",
    displayName: "E2E 财务员工",
    roleCode: "finance",
    departmentCode: "FIN",
    email: "phase1-finance@example.test",
    providerSubject: "open_id:e2e-finance",
    providerMatchKeys: [
      "open_id:e2e-finance",
      "email:phase1-finance@example.test",
    ],
  },
  hr: {
    state: "hr",
    employeeNo: "E2E-HR",
    displayName: "E2E 人事员工",
    roleCode: "hr",
    departmentCode: "HR",
    email: "phase1-hr@example.test",
    providerSubject: "open_id:e2e-hr",
    providerMatchKeys: [
      "open_id:e2e-hr",
      "email:phase1-hr@example.test",
    ],
  },
};

export const additionalRoleFixtures: Readonly<Record<"admin" | "supervisor", AdditionalRoleFixture>> = {
  admin: {
    state: "admin",
    employeeNo: "E2E-ADMIN",
    displayName: "E2E 系统管理员",
    additionalRole: "admin",
    departmentCode: "AI",
    email: "phase1-admin@example.test",
    providerSubject: "open_id:e2e-admin",
    providerMatchKeys: ["open_id:e2e-admin", "email:phase1-admin@example.test"],
  },
  supervisor: {
    state: "supervisor",
    employeeNo: "E2E-SUPERVISOR",
    displayName: "E2E 直属主管",
    additionalRole: "supervisor",
    departmentCode: "AI",
    email: "phase1-supervisor@example.test",
    providerSubject: "open_id:e2e-supervisor",
    providerMatchKeys: ["open_id:e2e-supervisor", "email:phase1-supervisor@example.test"],
  },
};

export function authStatePath(state: AuthStateName) {
  return path.resolve("playwright", ".auth", `${state}.json`);
}

export function assertLocalSupabaseUrl(value: string | undefined) {
  const message = "E2E 只允许连接本机 Supabase";
  if (!value || value !== value.trim()) throw new Error(message);

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
  if (
    !["http:", "https:"].includes(url.protocol)
    || !localHosts.has(hostname)
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new Error(message);
  }

  return url.origin;
}

function requiredEnvironment(env: NodeJS.ProcessEnv, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`E2E 本地配置缺失：${key}`);
  return value;
}

function safeAppBaseUrl(value: string | undefined) {
  const raw = value?.trim() || "http://127.0.0.1:3000";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("E2E 应用地址无效：PLAYWRIGHT_BASE_URL");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol)
    || !new Set(["127.0.0.1", "localhost", "::1"]).has(hostname)
    || url.username.length > 0
    || url.password.length > 0
  ) {
    throw new Error("E2E 应用地址必须是本机地址");
  }
  return url.origin;
}

export function getAuthHarnessEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): HarnessEnvironment {
  // Security boundary: validate the Supabase URL before reading any secret.
  const supabaseUrl = assertLocalSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const publishableKey = requiredEnvironment(
    env,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
  const serviceRoleKey = requiredEnvironment(env, "SUPABASE_SERVICE_ROLE_KEY");
  return {
    supabaseUrl,
    publishableKey,
    serviceRoleKey,
    appBaseUrl: safeAppBaseUrl(env.PLAYWRIGHT_BASE_URL),
  };
}

function failure(label: string, error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      && typeof error.code === "string"
      ? `（${error.code}）`
      : "";
  throw new Error(`${label}失败${code}`);
}

async function findOrCreateUser(
  admin: SupabaseClient,
  email: string,
  password: string,
) {
  const normalizedEmail = email.toLowerCase();
  let page = 1;
  while (true) {
    const listed = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) failure("读取本地 E2E 用户", listed.error);
    const existing = listed.data.users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail,
    );
    if (existing) {
      const updated = await admin.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (updated.error) failure(`更新本地 E2E 用户 ${email}`, updated.error);
      return existing.id;
    }
    if (listed.data.users.length < 1000) break;
    page += 1;
  }

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    failure(`创建本地 E2E 用户 ${email}`, created.error);
  }
  return created.data.user.id;
}

function sameSite(value: StoredCookieOptions["sameSite"]) {
  if (value === "strict") return "Strict" as const;
  if (value === "none") return "None" as const;
  return "Lax" as const;
}

async function signInAndWriteState(
  environment: HarnessEnvironment,
  state: AuthStateName,
  email: string,
  password: string,
): Promise<SignedInIdentity> {
  const jar = new Map<string, CookieJarItem>();
  const client = createServerClient(
    environment.supabaseUrl,
    environment.publishableKey,
    {
      cookies: {
        getAll: () => [...jar].map(([name, item]) => ({
          name,
          value: item.value,
        })),
        setAll: (items) => items.forEach(({ name, value, options }) => {
          jar.set(name, { value, options });
        }),
      },
    },
  );
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) failure(`登录本地 E2E 用户 ${email}`, signedIn.error);

  const workspaceAccess = await client.rpc("current_workspace_access");
  if (workspaceAccess.error) {
    failure(`读取本地 E2E 工作身份 ${email}`, workspaceAccess.error);
  }
  const session = parseWorkspaceAccess(workspaceAccess.data);

  const appUrl = new URL(environment.appBaseUrl);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cookies = [...jar].map(([name, item]) => ({
    name,
    value: item.value,
    domain: appUrl.hostname,
    path: item.options.path || "/",
    expires:
      typeof item.options.maxAge === "number"
        ? nowSeconds + item.options.maxAge
        : item.options.expires instanceof Date
          ? Math.floor(item.options.expires.getTime() / 1000)
          : -1,
    httpOnly: item.options.httpOnly ?? false,
    secure: appUrl.protocol === "https:",
    sameSite: sameSite(item.options.sameSite),
  }));
  if (cookies.length === 0) {
    throw new Error(`本地 E2E 登录未生成 SSR Cookie：${email}`);
  }

  const filePath = authStatePath(state);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ cookies, origins: [] }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  return { client, session };
}

async function assertIdentityClaim(
  client: SupabaseClient,
  email: string,
  expected: "not_provisioned" | "suspended" | "departed",
) {
  const claimed = await client.rpc("claim_current_identity");
  if (claimed.error) {
    failure(`验证本地 E2E 身份状态 ${email}`, claimed.error);
  }
  if (claimed.data !== expected) {
    throw new Error(
      `本地 E2E 身份状态不匹配：${email}（期望 ${expected}，实际 ${String(claimed.data)}）`,
    );
  }
}

async function getTenantAndProvider(admin: SupabaseClient) {
  const tenant = await admin
    .from("tenants")
    .select("id, public_id")
    .eq("slug", QUANTXY_TENANT_SLUG)
    .eq("status", "active")
    .single();
  if (tenant.error || !tenant.data) {
    failure("读取量子星河本地测试租户", tenant.error);
  }
  const provider = await admin
    .from("identity_providers")
    .select("provider_tenant_key")
    .eq("tenant_id", tenant.data.id)
    .eq("provider_code", "feishu")
    .eq("status", "active")
    .single();
  if (provider.error || !provider.data) {
    failure("读取本地飞书 Provider", provider.error);
  }
  return {
    tenantId: tenant.data.id as number,
    tenantPublicId: tenant.data.public_id as string,
    providerTenantKey: provider.data.provider_tenant_key as string,
  };
}

async function provisionIdentity(
  admin: SupabaseClient,
  input: {
    tenantSlug: string;
    organizationSlug: string;
    employeeNo: string;
    displayName: string;
    departmentCode: string;
    roleCode: RoleCode;
    providerCode: string;
    providerTenantKey: string;
    providerSubject: string;
    providerMatchKeys: readonly string[];
    email: string;
  },
) {
  const provisioned = await admin.rpc("provision_employee_identity", {
    p_tenant_slug: input.tenantSlug,
    p_organization_slug: input.organizationSlug,
    p_employee_no: input.employeeNo,
    p_display_name: input.displayName,
    p_department_code: input.departmentCode,
    p_job_title: "自动化测试岗位",
    p_role_code: input.roleCode,
    p_provider_code: input.providerCode,
    p_provider_tenant_key: input.providerTenantKey,
    p_provider_subject: input.providerSubject,
    p_provider_match_keys: [...input.providerMatchKeys],
    p_skills: ["phase1 verification"],
    p_work_email: input.email,
  });
  if (provisioned.error) {
    failure(`预开通本地 E2E 员工 ${input.employeeNo}`, provisioned.error);
  }
}

async function bindIdentity(
  admin: SupabaseClient,
  input: {
    tenantSlug: string;
    providerCode: string;
    providerTenantKey: string;
    providerSubject: string;
    authUserId: string;
    employeeNo: string;
  },
) {
  const bound = await admin.rpc("bind_preprovisioned_identity", {
    p_tenant_slug: input.tenantSlug,
    p_provider_code: input.providerCode,
    p_provider_tenant_key: input.providerTenantKey,
    p_provider_subject: input.providerSubject,
    p_auth_user_id: input.authUserId,
  });
  if (bound.error) {
    failure(`绑定本地 E2E 员工 ${input.employeeNo}`, bound.error);
  }
}

async function assignAdditionalRole(
  admin: SupabaseClient,
  employeeNo: string,
  roleCode: "admin" | "supervisor",
) {
  const profile = await admin
    .from("employee_profiles")
    .select("tenant_id, organization_member_id, public_id")
    .eq("employee_no", employeeNo)
    .is("deleted_at", null)
    .single();
  if (profile.error || !profile.data) failure(`读取附加岗位 ${employeeNo}`, profile.error);
  const roles = await admin
    .from("roles")
    .select("id, code")
    .eq("tenant_id", profile.data.tenant_id)
    .in("code", ["employee", roleCode])
    .is("organization_id", null);
  if (roles.error) failure(`读取附加角色 ${roleCode}`, roles.error);
  const target = (roles.data ?? []).find((role) => role.code === roleCode);
  const employee = (roles.data ?? []).find((role) => role.code === "employee");
  if (!target || !employee) throw new Error(`本地 E2E 附加角色不存在：${roleCode}`);
  const assignment = await admin.from("member_roles").upsert({
    tenant_id: profile.data.tenant_id,
    member_id: profile.data.organization_member_id,
    role_id: target.id,
    assignment_source: "bootstrap",
  }, { onConflict: "tenant_id,member_id,role_id" });
  if (assignment.error) failure(`分配附加角色 ${roleCode}`, assignment.error);
  if (roleCode === "supervisor") {
    const removed = await admin
      .from("member_roles")
      .delete()
      .eq("tenant_id", profile.data.tenant_id)
      .eq("member_id", profile.data.organization_member_id)
      .eq("role_id", employee.id);
    if (removed.error) failure("移除主管的普通员工基线角色", removed.error);
  }
  return profile.data.public_id as string;
}

async function restoreEmployeeForSetup(
  admin: SupabaseClient,
  employeeNo: string,
) {
  const profile = await admin
    .from("employee_profiles")
    .select("tenant_id, organization_member_id")
    .eq("employee_no", employeeNo)
    .is("deleted_at", null)
    .maybeSingle();
  if (profile.error) failure(`读取本地 E2E 员工 ${employeeNo}`, profile.error);
  if (!profile.data) return;

  const profileUpdate = await admin
    .from("employee_profiles")
    .update({ employment_status: "active", departure_date: null })
    .eq("tenant_id", profile.data.tenant_id)
    .eq("organization_member_id", profile.data.organization_member_id);
  if (profileUpdate.error) {
    failure(`恢复本地 E2E 员工 ${employeeNo}`, profileUpdate.error);
  }
  const memberUpdate = await admin
    .from("organization_members")
    .update({ status: "active" })
    .eq("tenant_id", profile.data.tenant_id)
    .eq("id", profile.data.organization_member_id);
  if (memberUpdate.error) {
    failure(`恢复本地 E2E 成员 ${employeeNo}`, memberUpdate.error);
  }
}

async function setEmployeeBlockedStatus(
  admin: SupabaseClient,
  employeeNo: string,
  status: "suspended" | "departed",
) {
  const profile = await admin
    .from("employee_profiles")
    .select("tenant_id, organization_member_id")
    .eq("employee_no", employeeNo)
    .is("deleted_at", null)
    .single();
  if (profile.error || !profile.data) {
    failure(`读取拒绝场景员工 ${employeeNo}`, profile.error);
  }
  const updated = status === "suspended"
    ? await admin
        .from("organization_members")
        .update({ status: "suspended" })
        .eq("tenant_id", profile.data.tenant_id)
        .eq("id", profile.data.organization_member_id)
    : await admin
        .from("employee_profiles")
        .update({ employment_status: "departed", departure_date: "2026-08-10" })
        .eq("tenant_id", profile.data.tenant_id)
        .eq("organization_member_id", profile.data.organization_member_id);
  if (updated.error) failure(`设置拒绝场景 ${employeeNo}`, updated.error);
}

async function ensureSecondTenant(admin: SupabaseClient) {
  let tenant = await admin
    .from("tenants")
    .select("id, public_id")
    .eq("slug", SECOND_TENANT.slug)
    .maybeSingle();
  if (tenant.error) failure("读取第二测试租户", tenant.error);
  if (!tenant.data) {
    tenant = await admin
      .from("tenants")
      .insert({ name: SECOND_TENANT.name, slug: SECOND_TENANT.slug, status: "active" })
      .select("id, public_id")
      .single();
  } else {
    tenant = await admin
      .from("tenants")
      .update({ name: SECOND_TENANT.name, status: "active" })
      .eq("id", tenant.data.id)
      .select("id, public_id")
      .single();
  }
  if (tenant.error || !tenant.data) failure("准备第二测试租户", tenant.error);
  const secondTenantId = tenant.data.id as number;

  let organization = await admin
    .from("organizations")
    .select("id, public_id")
    .eq("tenant_id", tenant.data.id)
    .eq("slug", SECOND_TENANT.organizationSlug)
    .maybeSingle();
  if (organization.error) failure("读取第二测试组织", organization.error);
  if (!organization.data) {
    organization = await admin
      .from("organizations")
      .insert({
        tenant_id: tenant.data.id,
        name: SECOND_TENANT.organizationName,
        slug: SECOND_TENANT.organizationSlug,
      })
      .select("id, public_id")
      .single();
  } else {
    organization = await admin
      .from("organizations")
      .update({ name: SECOND_TENANT.organizationName })
      .eq("tenant_id", tenant.data.id)
      .eq("id", organization.data.id)
      .select("id, public_id")
      .single();
  }
  if (organization.error || !organization.data) {
    failure("准备第二测试组织", organization.error);
  }

  const department = await admin
    .from("departments")
    .select("id")
    .eq("tenant_id", tenant.data.id)
    .eq("organization_id", organization.data.id)
    .eq("code", "AI")
    .is("deleted_at", null)
    .maybeSingle();
  if (department.error) failure("读取第二测试租户部门", department.error);
  if (!department.data) {
    const inserted = await admin.from("departments").insert({
      tenant_id: tenant.data.id,
      organization_id: organization.data.id,
      code: "AI",
      name: "E2E 测试部门",
      description: "仅供本地身份与租户隔离验证",
      sort_order: 10,
    });
    if (inserted.error) failure("创建第二测试租户部门", inserted.error);
  }

  const roleDefinitions = [
    ["owner", "老板", "企业全局经营数据与全部业务查看权限"],
    ["admin", "管理员", "系统配置、成员、角色与权限管理"],
    ["department_head", "部门负责人", "本部门业务管理"],
    ["employee", "普通员工", "本人任务与申请"],
    ["finance", "财务", "财务业务管理"],
    ["hr", "HR", "组织人事管理"],
  ] as const;
  const roleIds = new Map<string, number>();
  for (const [code, name, description] of roleDefinitions) {
    let role = await admin
      .from("roles")
      .select("id")
      .eq("tenant_id", tenant.data.id)
      .eq("code", code)
      .is("organization_id", null)
      .maybeSingle();
    if (role.error) failure(`读取第二租户角色 ${code}`, role.error);
    if (!role.data) {
      role = await admin
        .from("roles")
        .insert({
          tenant_id: tenant.data.id,
          organization_id: null,
          code,
          name,
          description,
          is_system: true,
          is_enabled: true,
        })
        .select("id")
        .single();
    }
    if (role.error || !role.data) failure(`准备第二租户角色 ${code}`, role.error);
    roleIds.set(code, role.data.id as number);
  }

  const permissions = await admin.from("permissions").select("id, code");
  if (permissions.error) failure("读取第二租户权限", permissions.error);
  const permissionIds = new Map(
    (permissions.data ?? []).map((permission) => [
      permission.code as string,
      permission.id as number,
    ]),
  );
  const allPermissions = [...permissionIds.keys()];
  const matrix: Record<string, readonly string[]> = {
    owner: allPermissions,
    admin: allPermissions,
    department_head: ["department.manage", "project.manage", "task.manage", "approval.self", "approval.manage", "files.manage"],
    employee: ["task.manage", "salary.self", "approval.self", "files.manage"],
    finance: ["salary.manage", "approval.self", "approval.manage", "files.manage"],
    hr: ["hr.manage", "salary.self", "salary.manage", "approval.self", "approval.manage", "files.manage"],
  };
  const assignments = Object.entries(matrix).flatMap(([roleCode, codes]) =>
    codes.map((permissionCode) => ({
      tenant_id: secondTenantId,
      role_id: roleIds.get(roleCode),
      permission_id: permissionIds.get(permissionCode),
    })),
  );
  if (assignments.some(({ role_id, permission_id }) => !role_id || !permission_id)) {
    throw new Error("第二测试租户的角色或权限基础数据不完整");
  }
  const rolePermissions = await admin
    .from("role_permissions")
    .upsert(assignments, { onConflict: "tenant_id,role_id,permission_id" });
  if (rolePermissions.error) {
    failure("准备第二测试租户角色权限", rolePermissions.error);
  }

  let provider = await admin
    .from("identity_providers")
    .select("id")
    .eq("tenant_id", tenant.data.id)
    .eq("provider_code", SECOND_TENANT.providerCode)
    .maybeSingle();
  if (provider.error) failure("读取第二测试 Provider", provider.error);
  if (!provider.data) {
    provider = await admin
      .from("identity_providers")
      .insert({
        tenant_id: tenant.data.id,
        provider_code: SECOND_TENANT.providerCode,
        auth_provider: SECOND_TENANT.authProvider,
        provider_tenant_key: SECOND_TENANT.providerTenantKey,
        display_name: "E2E OIDC Provider",
        status: "active",
      })
      .select("id")
      .single();
  }
  if (provider.error || !provider.data) {
    failure("准备第二测试 Provider", provider.error);
  }
  return {
    tenantId: tenant.data.id as number,
    tenantPublicId: tenant.data.public_id as string,
    organizationId: organization.data.id as number,
    organizationPublicId: organization.data.public_id as string,
  };
}

async function assertCrossTenantIsolation(
  tenantAClient: SupabaseClient,
  tenantBClient: SupabaseClient,
  tenantAOrganizationPublicId: string,
  tenantBOrganizationPublicId: string,
) {
  const aReadsB = await tenantAClient
    .from("organizations")
    .select("public_id")
    .eq("public_id", tenantBOrganizationPublicId);
  if (aReadsB.error) failure("验证租户 A 读取隔离", aReadsB.error);
  if ((aReadsB.data ?? []).length !== 0) {
    throw new Error("跨租户隔离失败：租户 A 可以读取租户 B");
  }

  const bReadsA = await tenantBClient
    .from("organizations")
    .select("public_id")
    .eq("public_id", tenantAOrganizationPublicId);
  if (bReadsA.error) failure("验证租户 B 读取隔离", bReadsA.error);
  if ((bReadsA.data ?? []).length !== 0) {
    throw new Error("跨租户隔离失败：租户 B 可以读取租户 A");
  }

  const aActsOnB = await tenantAClient
    .from("organizations")
    .update({ name: SECOND_TENANT.organizationName })
    .eq("public_id", tenantBOrganizationPublicId)
    .select("public_id");
  if (aActsOnB.error && aActsOnB.error.code !== "42501") {
    failure("验证租户 A 写入隔离", aActsOnB.error);
  }
  if ((aActsOnB.data ?? []).length !== 0) {
    throw new Error("跨租户隔离失败：租户 A 可以修改租户 B");
  }
}

async function quantxyOrganizationPublicId(admin: SupabaseClient, tenantId: number) {
  const organization = await admin
    .from("organizations")
    .select("public_id")
    .eq("tenant_id", tenantId)
    .eq("slug", QUANTXY_ORGANIZATION_SLUG)
    .single();
  if (organization.error || !organization.data) {
    failure("读取量子星河组织", organization.error);
  }
  return organization.data.public_id as string;
}

export async function prepareAuthStates(env: NodeJS.ProcessEnv = process.env) {
  const environment = getAuthHarnessEnvironment(env);
  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const password = `${randomBytes(24).toString("base64url")}A1!`;
  const quantxy = await getTenantAndProvider(admin);
  const quantxyOrganizationId = await quantxyOrganizationPublicId(
    admin,
    quantxy.tenantId,
  );
  const signedInByRole = new Map<WorkspaceRole, SignedInIdentity>();

  for (const fixture of Object.values(roleFixtures)) {
    await restoreEmployeeForSetup(admin, fixture.employeeNo);
    const authUserId = await findOrCreateUser(admin, fixture.email, password);
    await provisionIdentity(admin, {
      tenantSlug: QUANTXY_TENANT_SLUG,
      organizationSlug: QUANTXY_ORGANIZATION_SLUG,
      employeeNo: fixture.employeeNo,
      displayName: fixture.displayName,
      departmentCode: fixture.departmentCode,
      roleCode: fixture.roleCode,
      providerCode: "feishu",
      providerTenantKey: quantxy.providerTenantKey,
      providerSubject: fixture.providerSubject,
      providerMatchKeys: fixture.providerMatchKeys,
      email: fixture.email,
    });
    await bindIdentity(admin, {
      tenantSlug: QUANTXY_TENANT_SLUG,
      providerCode: "feishu",
      providerTenantKey: quantxy.providerTenantKey,
      providerSubject: fixture.providerSubject,
      authUserId,
      employeeNo: fixture.employeeNo,
    });
    const signedIn = await signInAndWriteState(
      environment,
      fixture.state,
      fixture.email,
      password,
    );
    if (
      !signedIn.session
      || signedIn.session.primaryRole !== fixture.state
      || signedIn.session.authUserId !== authUserId
      || signedIn.session.tenantId !== quantxy.tenantPublicId
    ) {
      throw new Error(`本地 E2E 岗位会话不匹配：${fixture.state}`);
    }
    signedInByRole.set(fixture.state, signedIn);
  }

  const additionalProfiles = new Map<"admin" | "supervisor", string>();
  for (const fixture of Object.values(additionalRoleFixtures)) {
    await restoreEmployeeForSetup(admin, fixture.employeeNo);
    const authUserId = await findOrCreateUser(admin, fixture.email, password);
    await provisionIdentity(admin, {
      tenantSlug: QUANTXY_TENANT_SLUG,
      organizationSlug: QUANTXY_ORGANIZATION_SLUG,
      employeeNo: fixture.employeeNo,
      displayName: fixture.displayName,
      departmentCode: fixture.departmentCode,
      roleCode: "employee",
      providerCode: "feishu",
      providerTenantKey: quantxy.providerTenantKey,
      providerSubject: fixture.providerSubject,
      providerMatchKeys: fixture.providerMatchKeys,
      email: fixture.email,
    });
    await bindIdentity(admin, {
      tenantSlug: QUANTXY_TENANT_SLUG,
      providerCode: "feishu",
      providerTenantKey: quantxy.providerTenantKey,
      providerSubject: fixture.providerSubject,
      authUserId,
      employeeNo: fixture.employeeNo,
    });
    additionalProfiles.set(
      fixture.state,
      await assignAdditionalRole(admin, fixture.employeeNo, fixture.additionalRole),
    );
    const signedIn = await signInAndWriteState(environment, fixture.state, fixture.email, password);
    if (
      !signedIn.session
      || !signedIn.session.roleCodes.includes(fixture.additionalRole)
      || signedIn.session.authUserId !== authUserId
      || signedIn.session.tenantId !== quantxy.tenantPublicId
      || (fixture.state === "admin" && !signedIn.session.isAdmin)
      || (fixture.state === "supervisor" && signedIn.session.primaryRole !== "employee")
    ) throw new Error(`本地 E2E 附加岗位会话不匹配：${fixture.state}`);
  }

  const executive = signedInByRole.get("executive");
  const supervisorProfileId = additionalProfiles.get("supervisor");
  if (!executive || !supervisorProfileId) throw new Error("缺少 E2E 企业负责人或直属主管会话");
  const employeeProfile = await admin
    .from("employee_profiles")
    .select("public_id, manager_employee_id, manager_version")
    .eq("employee_no", roleFixtures.employee.employeeNo)
    .is("deleted_at", null)
    .single();
  if (employeeProfile.error || !employeeProfile.data) failure("读取 E2E 直属员工", employeeProfile.error);
  const supervisorInternal = await admin
    .from("employee_profiles")
    .select("id")
    .eq("public_id", supervisorProfileId)
    .single();
  if (supervisorInternal.error || !supervisorInternal.data) failure("读取 E2E 直属主管", supervisorInternal.error);
  if (employeeProfile.data.manager_employee_id !== supervisorInternal.data.id) {
    const assigned = await executive.client.rpc("assign_current_member_manager", {
      p_target_employee_public_id: employeeProfile.data.public_id,
      p_manager_employee_public_id: supervisorProfileId,
      p_expected_manager_version: employeeProfile.data.manager_version,
      p_reason: "本地商业验收固定直属主管范围",
      request_id: randomUUID(),
      idempotency_key: randomUUID(),
    });
    if (assigned.error) failure("配置 E2E 直属主管范围", assigned.error);
  }
  const supervisorFixture = additionalRoleFixtures.supervisor;
  const supervisorSession = await signInAndWriteState(
    environment,
    "supervisor",
    supervisorFixture.email,
    password,
  );
  if (!supervisorSession.session?.supervisorScopeEmployeeIds.includes(employeeProfile.data.public_id)) {
    throw new Error("E2E 直属主管范围未包含固定直属员工");
  }

  const unknownUserId = await findOrCreateUser(admin, UNKNOWN_EMAIL, password);
  const unknownBinding = await admin
    .from("external_identities")
    .select("id")
    .eq("auth_user_id", unknownUserId);
  if (unknownBinding.error) failure("检查未知员工绑定", unknownBinding.error);
  if ((unknownBinding.data ?? []).length > 0) {
    throw new Error("未知 E2E 员工已存在身份绑定，请重置本地数据库");
  }
  const unknown = await signInAndWriteState(
    environment,
    "unknown",
    UNKNOWN_EMAIL,
    password,
  );
  if (unknown.session) throw new Error("未知 E2E 员工不应获得工作身份");
  await assertIdentityClaim(unknown.client, UNKNOWN_EMAIL, "not_provisioned");

  for (const status of ["suspended", "departed"] as const) {
    const fixture = BLOCKED_FIXTURES[status];
    await restoreEmployeeForSetup(admin, fixture.employeeNo);
    const authUserId = await findOrCreateUser(admin, fixture.email, password);
    await provisionIdentity(admin, {
      tenantSlug: QUANTXY_TENANT_SLUG,
      organizationSlug: QUANTXY_ORGANIZATION_SLUG,
      employeeNo: fixture.employeeNo,
      displayName: fixture.displayName,
      departmentCode: "AI",
      roleCode: "employee",
      providerCode: "feishu",
      providerTenantKey: quantxy.providerTenantKey,
      providerSubject: fixture.providerSubject,
      providerMatchKeys: [fixture.providerSubject, `email:${fixture.email}`],
      email: fixture.email,
    });
    await bindIdentity(admin, {
      tenantSlug: QUANTXY_TENANT_SLUG,
      providerCode: "feishu",
      providerTenantKey: quantxy.providerTenantKey,
      providerSubject: fixture.providerSubject,
      authUserId,
      employeeNo: fixture.employeeNo,
    });
    await setEmployeeBlockedStatus(admin, fixture.employeeNo, status);
    const blocked = await signInAndWriteState(
      environment,
      status,
      fixture.email,
      password,
    );
    if (blocked.session) {
      throw new Error(`拒绝场景员工仍获得工作身份：${status}`);
    }
    await assertIdentityClaim(blocked.client, fixture.email, status);
  }

  const secondTenant = await ensureSecondTenant(admin);
  await restoreEmployeeForSetup(admin, SECOND_PROVIDER_FIXTURE.employeeNo);
  const secondProviderUserId = await findOrCreateUser(
    admin,
    SECOND_PROVIDER_FIXTURE.email,
    password,
  );
  await provisionIdentity(admin, {
    tenantSlug: SECOND_TENANT.slug,
    organizationSlug: SECOND_TENANT.organizationSlug,
    employeeNo: SECOND_PROVIDER_FIXTURE.employeeNo,
    displayName: SECOND_PROVIDER_FIXTURE.displayName,
    departmentCode: "AI",
    roleCode: "employee",
    providerCode: SECOND_TENANT.providerCode,
    providerTenantKey: SECOND_TENANT.providerTenantKey,
    providerSubject: SECOND_PROVIDER_FIXTURE.providerSubject,
    providerMatchKeys: SECOND_PROVIDER_FIXTURE.providerMatchKeys,
    email: SECOND_PROVIDER_FIXTURE.email,
  });
  await bindIdentity(admin, {
    tenantSlug: SECOND_TENANT.slug,
    providerCode: SECOND_TENANT.providerCode,
    providerTenantKey: SECOND_TENANT.providerTenantKey,
    providerSubject: SECOND_PROVIDER_FIXTURE.providerSubject,
    authUserId: secondProviderUserId,
    employeeNo: SECOND_PROVIDER_FIXTURE.employeeNo,
  });
  const secondProvider = await signInAndWriteState(
    environment,
    "second-provider",
    SECOND_PROVIDER_FIXTURE.email,
    password,
  );
  if (
    !secondProvider.session
    || secondProvider.session.primaryRole !== "employee"
    || secondProvider.session.identity.providerCode !== SECOND_TENANT.providerCode
    || secondProvider.session.identity.authProvider !== SECOND_TENANT.authProvider
    || secondProvider.session.tenantId !== secondTenant.tenantPublicId
  ) {
    throw new Error("第二 Provider 未产生相同的 WorkspaceSession 合同");
  }

  await assertCrossTenantIsolation(
    executive.client,
    secondProvider.client,
    quantxyOrganizationId,
    secondTenant.organizationPublicId,
  );
}

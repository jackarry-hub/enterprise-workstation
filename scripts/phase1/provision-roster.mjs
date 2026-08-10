import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

const { loadEnvConfig } = nextEnv;

const PHASE1_ROOT = Object.freeze({
  tenantSlug: "quantxy",
  organizationSlug: "quantum-galaxy",
  providerCode: "feishu",
});

const ROOT_FIELDS = new Set([
  "tenantSlug",
  "organizationSlug",
  "providerCode",
  "employees",
]);
const EMPLOYEE_FIELDS = new Set([
  "employeeNo",
  "displayName",
  "departmentCode",
  "jobTitle",
  "roleCode",
  "workEmail",
  "feishuUnionId",
  "feishuOpenId",
  "skills",
]);
const ALLOWED_ROLES = new Set([
  "owner",
  "department_head",
  "employee",
  "finance",
  "hr",
]);
const ALLOWED_DEPARTMENTS = new Set(["AI", "ECOM", "OPS", "FIN", "HR"]);

function requiredString(value, fieldLabel, rowNumber) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`名单数据不合法：第 ${rowNumber} 名员工缺少${fieldLabel}`);
  }
  return value.trim();
}

function optionalIdentifier(value, fieldLabel, rowNumber) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的${fieldLabel}不合法`);
  }
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 200) {
    throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的${fieldLabel}不合法`);
  }
  return normalized;
}

function normalizeEmail(value, rowNumber) {
  const normalized = optionalIdentifier(value, "企业邮箱", rowNumber);
  if (
    normalized &&
    (normalized.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
  ) {
    throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的企业邮箱不合法`);
  }
  return normalized;
}

function normalizeSkills(value, rowNumber) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) {
    throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的技能标签不合法`);
  }

  const normalized = [];
  const seen = new Set();
  for (const skill of value) {
    if (typeof skill !== "string") {
      throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的技能标签不合法`);
    }
    const item = skill.trim().toLowerCase();
    if (item.length < 1 || item.length > 40) {
      throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的技能标签不合法`);
    }
    if (!seen.has(item)) {
      seen.add(item);
      normalized.push(item);
    }
  }
  return normalized;
}

function assertOnlyFields(record, allowed, message) {
  const unsupported = Object.keys(record).filter((key) => !allowed.has(key));
  if (unsupported.length > 0) throw new Error(message);
}

export function validateRoster(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("名单数据不合法：名单顶层必须是对象");
  }
  assertOnlyFields(payload, ROOT_FIELDS, "名单数据不合法：名单顶层字段不受支持");
  if (
    payload.tenantSlug !== PHASE1_ROOT.tenantSlug ||
    payload.organizationSlug !== PHASE1_ROOT.organizationSlug ||
    payload.providerCode !== PHASE1_ROOT.providerCode
  ) {
    throw new Error("名单数据不合法：当前只支持量子星河和已启用的飞书登录");
  }
  if (!Array.isArray(payload.employees) || payload.employees.length === 0) {
    throw new Error("名单数据不合法：至少需要一名员工");
  }

  const employeeNos = new Set();
  const providerIdentifiers = new Set();
  const employees = payload.employees.map((record, index) => {
    const rowNumber = index + 1;
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`名单数据不合法：第 ${rowNumber} 名员工必须是对象`);
    }
    assertOnlyFields(
      record,
      EMPLOYEE_FIELDS,
      `名单数据不合法：第 ${rowNumber} 名员工字段不受支持`,
    );

    const employeeNo = requiredString(record.employeeNo, "工号", rowNumber).toUpperCase();
    const displayName = requiredString(record.displayName, "姓名", rowNumber);
    const departmentCode = requiredString(
      record.departmentCode,
      "部门代码",
      rowNumber,
    ).toUpperCase();
    const jobTitle = requiredString(record.jobTitle, "职位", rowNumber);
    const roleCode = requiredString(record.roleCode, "角色", rowNumber).toLowerCase();
    if (!ALLOWED_ROLES.has(roleCode) || !ALLOWED_DEPARTMENTS.has(departmentCode)) {
      throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的角色或部门不受支持`);
    }
    if (employeeNos.has(employeeNo)) {
      throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的工号重复`);
    }
    employeeNos.add(employeeNo);

    const feishuUnionId = optionalIdentifier(
      record.feishuUnionId,
      "飞书 union_id",
      rowNumber,
    );
    const feishuOpenId = optionalIdentifier(
      record.feishuOpenId,
      "飞书 open_id",
      rowNumber,
    );
    const workEmail = normalizeEmail(record.workEmail, rowNumber);
    const identifiers = [feishuUnionId, feishuOpenId, workEmail].filter(Boolean);
    if (identifiers.length === 0) {
      throw new Error(
        `名单数据不合法：第 ${rowNumber} 名员工至少提供一个飞书标识或企业邮箱`,
      );
    }
    for (const identifier of identifiers) {
      if (providerIdentifiers.has(identifier)) {
        throw new Error(`名单数据不合法：第 ${rowNumber} 名员工的身份匹配标识重复`);
      }
      providerIdentifiers.add(identifier);
    }

    return {
      employeeNo,
      displayName,
      departmentCode,
      jobTitle,
      roleCode,
      workEmail,
      feishuUnionId,
      feishuOpenId,
      skills: normalizeSkills(record.skills, rowNumber),
    };
  });

  return { ...PHASE1_ROOT, employees };
}

export function toProvisionRpcArgs(root, employee, providerTenantKey) {
  const providerMatchKeys = [
    employee.feishuUnionId,
    employee.feishuOpenId,
    employee.workEmail,
  ].filter(Boolean);

  return {
    p_tenant_slug: root.tenantSlug,
    p_organization_slug: root.organizationSlug,
    p_employee_no: employee.employeeNo,
    p_display_name: employee.displayName,
    p_department_code: employee.departmentCode,
    p_job_title: employee.jobTitle,
    p_role_code: employee.roleCode,
    p_provider_code: root.providerCode,
    p_provider_tenant_key: providerTenantKey,
    p_provider_subject:
      employee.feishuOpenId ?? employee.feishuUnionId ?? employee.workEmail,
    p_provider_match_keys: providerMatchKeys,
    p_skills: employee.skills,
    p_work_email: employee.workEmail,
  };
}

function requiredEnvironment(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`名单导入配置缺失：${name}`);
  }
  return value.trim();
}

function validateSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Supabase 项目地址不正确，请检查 NEXT_PUBLIC_SUPABASE_URL");
  }
  const isLocal = new Set(["localhost", "127.0.0.1", "::1"]).has(url.hostname);
  if (url.protocol !== "https:" && !(isLocal && url.protocol === "http:")) {
    throw new Error("Supabase 项目地址不正确：远程项目必须使用 HTTPS");
  }
  return url.href.replace(/\/$/, "");
}

function safeRpcCode(error) {
  return typeof error?.code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(error.code)
    ? error.code
    : "UNKNOWN";
}

export async function provisionRoster(env = process.env, dependencies = {}) {
  const rosterPath = requiredEnvironment(env, "PHASE1_ROSTER_PATH");
  const supabaseUrl = validateSupabaseUrl(
    requiredEnvironment(env, "NEXT_PUBLIC_SUPABASE_URL"),
  );
  const serviceRoleKey = requiredEnvironment(env, "SUPABASE_SERVICE_ROLE_KEY");
  const providerTenantKey = requiredEnvironment(env, "FEISHU_TENANT_KEY");
  const readFileImpl = dependencies.readFileImpl ?? readFile;
  let source;
  try {
    source = await readFileImpl(rosterPath, "utf8");
  } catch {
    throw new Error("未找到名单文件，请检查 PHASE1_ROSTER_PATH 指向的文件");
  }

  let payload;
  try {
    payload = JSON.parse(source);
  } catch {
    throw new Error("名单文件不是有效的 JSON，请检查文件格式");
  }
  const normalized = validateRoster(payload);

  const createClientImpl = dependencies.createClientImpl ?? createClient;
  let client;
  try {
    client = createClientImpl(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    throw new Error("无法初始化名单导入连接，请检查 Supabase 配置");
  }

  for (const employee of normalized.employees) {
    let result;
    try {
      result = await client.rpc(
        "provision_employee_identity",
        toProvisionRpcArgs(normalized, employee, providerTenantKey),
      );
    } catch {
      throw new Error(`员工 ${employee.employeeNo} 导入失败（错误码：NETWORK）`);
    }
    if (!result || typeof result !== "object" || !("error" in result)) {
      throw new Error(`员工 ${employee.employeeNo} 导入失败（错误码：UNKNOWN）`);
    }
    if (result.error) {
      throw new Error(
        `员工 ${employee.employeeNo} 导入失败（错误码：${safeRpcCode(result.error)}）`,
      );
    }
  }

  return {
    count: normalized.employees.length,
    employeeNos: normalized.employees.map((employee) => employee.employeeNo),
  };
}

export async function runCli({
  env = process.env,
  dependencies,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  try {
    const result = await provisionRoster(env, dependencies);
    stdout(`员工名单导入完成：${result.count} 人（${result.employeeNos.join("、")}）`);
    return 0;
  } catch (error) {
    stderr(error instanceof Error ? error.message : "名单导入失败，请联系管理员");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvConfig(process.cwd());
  process.exitCode = await runCli();
}

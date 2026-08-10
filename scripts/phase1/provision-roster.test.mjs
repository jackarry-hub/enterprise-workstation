import assert from "node:assert/strict";
import test from "node:test";

import {
  provisionRoster,
  runCli,
  toProvisionRpcArgs,
  validateRoster,
} from "./provision-roster.mjs";

const fixedRoot = {
  tenantSlug: "quantxy",
  organizationSlug: "quantum-galaxy",
  providerCode: "feishu",
};

function employee(overrides = {}) {
  return {
    employeeNo: "QXY-001",
    displayName: "测试员工",
    departmentCode: "AI",
    jobTitle: "产品经理",
    roleCode: "employee",
    feishuUnionId: "on_employee_1",
    feishuOpenId: "ou_employee_1",
    workEmail: "employee@quantxy.example",
    skills: ["Product"],
    ...overrides,
  };
}

function roster(employees = [employee()], overrides = {}) {
  return { ...fixedRoot, employees, ...overrides };
}

test("accepts a non-empty roster containing all five database roles", () => {
  const roles = ["owner", "department_head", "employee", "finance", "hr"];
  const result = validateRoster(
    roster(
      roles.map((roleCode, index) =>
        employee({
          employeeNo: `QXY-${index + 1}`,
          roleCode,
          departmentCode:
            roleCode === "finance" ? "FIN" : roleCode === "hr" ? "HR" : "AI",
          feishuUnionId: `on_${index + 1}`,
          feishuOpenId: `ou_${index + 1}`,
          workEmail: `${roleCode}@quantxy.example`,
        }),
      ),
    ),
  );

  assert.equal(result.employees.length, 5);
  assert.deepEqual(
    result.employees.map((item) => item.roleCode),
    roles,
  );
});

test("rejects roles and departments outside the Phase 1 database seed", () => {
  assert.throws(
    () => validateRoster(roster([employee({ roleCode: "admin" })])),
    /角色或部门不受支持/,
  );
  assert.throws(
    () => validateRoster(roster([employee({ departmentCode: "UNKNOWN" })])),
    /角色或部门不受支持/,
  );
});

test("rejects unsupported tenant, organization, and provider values", () => {
  for (const [field, value] of [
    ["tenantSlug", "another-company"],
    ["organizationSlug", "another-organization"],
    ["providerCode", "entra"],
  ]) {
    assert.throws(
      () => validateRoster(roster(undefined, { [field]: value })),
      /当前只支持量子星河和已启用的飞书登录/,
    );
  }
});

test("rejects unknown root fields and an empty employee list", () => {
  assert.throws(
    () => validateRoster({ ...roster(), tenantKey: "must-not-be-in-roster" }),
    /名单顶层字段不受支持/,
  );
  assert.throws(() => validateRoster(roster([])), /至少需要一名员工/);
});

test("rejects missing identity keys and unsupported employee fields", () => {
  assert.throws(
    () =>
      validateRoster(
        roster([
          employee({
            feishuUnionId: undefined,
            feishuOpenId: undefined,
            workEmail: undefined,
          }),
        ]),
      ),
    /至少提供一个飞书标识或企业邮箱/,
  );
  assert.throws(
    () => validateRoster(roster([employee({ password: "must-not-be-accepted" })])),
    /员工字段不受支持/,
  );
});

test("rejects duplicate employee numbers after trimming and case normalization", () => {
  assert.throws(
    () =>
      validateRoster(
        roster([
          employee(),
          employee({
            employeeNo: " qxy-001 ",
            feishuUnionId: "on_2",
            feishuOpenId: "ou_2",
            workEmail: "second@quantxy.example",
          }),
        ]),
      ),
    /工号重复/,
  );
});

test("rejects duplicate provider match identifiers after normalization", () => {
  assert.throws(
    () =>
      validateRoster(
        roster([
          employee({ feishuOpenId: " OU_Shared " }),
          employee({
            employeeNo: "QXY-002",
            feishuUnionId: "on_2",
            feishuOpenId: "ou_shared",
            workEmail: "second@quantxy.example",
          }),
        ]),
      ),
    /身份匹配标识重复/,
  );
});

test("normalizes email and Feishu identifiers consistently", () => {
  const result = validateRoster(
    roster([
      employee({
        employeeNo: " qxy-001 ",
        workEmail: " Employee@QuantXY.Example ",
        feishuUnionId: " ON_EMPLOYEE_1 ",
        feishuOpenId: " OU_EMPLOYEE_1 ",
      }),
    ]),
  );
  const item = result.employees[0];

  assert.equal(item.employeeNo, "QXY-001");
  assert.equal(item.workEmail, "employee@quantxy.example");
  assert.equal(item.feishuUnionId, "on_employee_1");
  assert.equal(item.feishuOpenId, "ou_employee_1");
});

test("enforces database-safe prefixed provider identifier and email limits", () => {
  assert.throws(
    () => validateRoster(roster([employee({ feishuOpenId: "x".repeat(193) })])),
    /open_id不合法/,
  );
  assert.throws(
    () => validateRoster(roster([employee({ workEmail: "not-an-email" })])),
    /企业邮箱不合法/,
  );
  assert.throws(
    () =>
      validateRoster(
        roster([employee({ workEmail: `${"a".repeat(309)}@example.com` })]),
      ),
    /企业邮箱不合法/,
  );
  assert.equal(
    validateRoster(roster([employee({ feishuOpenId: "x".repeat(192) })])).employees[0]
      .feishuOpenId.length,
    192,
  );
});

test("normalizes, lowercases, and deduplicates skills", () => {
  const result = validateRoster(
    roster([employee({ skills: [" Strategy ", "strategy", "数据分析"] })]),
  );

  assert.deepEqual(result.employees[0].skills, ["strategy", "数据分析"]);
});

test("rejects invalid skill values and every skills size limit", () => {
  for (const skills of [
    "strategy",
    [""],
    [" ".repeat(2)],
    ["x".repeat(41)],
    [1],
    Array.from({ length: 31 }, (_, index) => `skill-${index}`),
  ]) {
    assert.throws(
      () => validateRoster(roster([employee({ skills })])),
      /技能标签不合法/,
    );
  }

  const thirty = Array.from({ length: 30 }, (_, index) => `skill-${index}`);
  assert.equal(validateRoster(roster([employee({ skills: thirty })])).employees[0].skills.length, 30);
  assert.equal(
    validateRoster(roster([employee({ skills: ["x", "x".repeat(40)] })])).employees[0]
      .skills.length,
    2,
  );
});

test("maps Feishu adapter fields to provider-neutral RPC arguments", () => {
  const item = validateRoster(roster()).employees[0];
  const args = toProvisionRpcArgs(fixedRoot, item, "tenant_qxy");

  assert.deepEqual(args, {
    p_tenant_slug: "quantxy",
    p_organization_slug: "quantum-galaxy",
    p_employee_no: "QXY-001",
    p_display_name: "测试员工",
    p_department_code: "AI",
    p_job_title: "产品经理",
    p_role_code: "employee",
    p_provider_code: "feishu",
    p_provider_tenant_key: "tenant_qxy",
    p_provider_subject: "open_id:ou_employee_1",
    p_provider_match_keys: [
      "open_id:ou_employee_1",
      "union_id:on_employee_1",
      "email:employee@quantxy.example",
    ],
    p_skills: ["product"],
    p_work_email: "employee@quantxy.example",
  });
  assert.equal(Object.keys(args).some((key) => key.includes("feishu")), false);
});

test("uses the same provider-neutral subject priority for open, union, and email-only rosters", () => {
  const openOnly = validateRoster(
    roster([
      employee({
        feishuUnionId: undefined,
        workEmail: undefined,
      }),
    ]),
  ).employees[0];
  const unionOnly = validateRoster(
    roster([
      employee({
        feishuOpenId: undefined,
        workEmail: undefined,
      }),
    ]),
  ).employees[0];
  const emailOnly = validateRoster(
    roster([
      employee({
        feishuUnionId: undefined,
        feishuOpenId: undefined,
      }),
    ]),
  ).employees[0];

  assert.deepEqual(toProvisionRpcArgs(fixedRoot, openOnly, "tenant_qxy"), {
    p_tenant_slug: "quantxy",
    p_organization_slug: "quantum-galaxy",
    p_employee_no: "QXY-001",
    p_display_name: "测试员工",
    p_department_code: "AI",
    p_job_title: "产品经理",
    p_role_code: "employee",
    p_provider_code: "feishu",
    p_provider_tenant_key: "tenant_qxy",
    p_provider_subject: "open_id:ou_employee_1",
    p_provider_match_keys: ["open_id:ou_employee_1"],
    p_skills: ["product"],
    p_work_email: null,
  });
  assert.equal(
    toProvisionRpcArgs(fixedRoot, unionOnly, "tenant_qxy").p_provider_subject,
    "union_id:on_employee_1",
  );
  assert.deepEqual(
    toProvisionRpcArgs(fixedRoot, unionOnly, "tenant_qxy").p_provider_match_keys,
    ["union_id:on_employee_1"],
  );
  assert.equal(
    toProvisionRpcArgs(fixedRoot, emailOnly, "tenant_qxy").p_provider_subject,
    "email:employee@quantxy.example",
  );
  assert.deepEqual(
    toProvisionRpcArgs(fixedRoot, emailOnly, "tenant_qxy").p_provider_match_keys,
    ["email:employee@quantxy.example"],
  );
});

test("imports through the generic idempotent RPC and returns only safe summary data", async () => {
  const calls = [];
  const createClientImpl = (url, key, options) => {
    assert.equal(url, "https://project.supabase.co");
    assert.equal(key, "service-role-secret");
    assert.deepEqual(options, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return {
      rpc: async (name, args) => {
        calls.push({ name, args });
        return { data: 101, error: null };
      },
    };
  };

  const result = await provisionRoster(
    {
      PHASE1_ROSTER_PATH: "private/phase1-roster.json",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      FEISHU_TENANT_KEY: "tenant_qxy",
    },
    {
      readFileImpl: async () => JSON.stringify(roster()),
      createClientImpl,
    },
  );

  assert.deepEqual(result, { count: 1, employeeNos: ["QXY-001"] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "provision_employee_identity");
  assert.equal(Object.keys(calls[0].args).some((key) => key.includes("feishu")), false);
});

test("missing environment and missing roster paths produce safe actionable messages", async () => {
  await assert.rejects(() => provisionRoster({}), /名单导入配置缺失：PHASE1_ROSTER_PATH/);
  await assert.rejects(
    () =>
      provisionRoster(
        {
          PHASE1_ROSTER_PATH: "private/secret-roster.json",
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
          FEISHU_TENANT_KEY: "tenant_qxy",
        },
        {
          readFileImpl: async () => {
            const error = new Error("private/secret-roster.json");
            error.code = "ENOENT";
            throw error;
          },
        },
      ),
    (error) => {
      assert.match(error.message, /未找到名单文件/);
      assert.doesNotMatch(error.message, /secret-roster|service-role-secret/);
      return true;
    },
  );
});

test("RPC failures expose an employee number and safe code but never secret details", async () => {
  await assert.rejects(
    () =>
      provisionRoster(
        {
          PHASE1_ROSTER_PATH: "private/phase1-roster.json",
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
          FEISHU_TENANT_KEY: "tenant_qxy",
        },
        {
          readFileImpl: async () => JSON.stringify(roster()),
          createClientImpl: () => ({
            rpc: async () => ({
              data: null,
              error: {
                code: "PGRST202",
                message: "service-role-secret was rejected",
                details: JSON.stringify(roster()),
              },
            }),
          }),
        },
      ),
    (error) => {
      assert.match(error.message, /QXY-001/);
      assert.match(error.message, /PGRST202/);
      assert.doesNotMatch(error.message, /service-role-secret|测试员工|employee@/);
      return true;
    },
  );
});

test("malformed RPC responses fail closed instead of reporting a successful import", async () => {
  await assert.rejects(
    () =>
      provisionRoster(
        {
          PHASE1_ROSTER_PATH: "private/phase1-roster.json",
          NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
          FEISHU_TENANT_KEY: "tenant_qxy",
        },
        {
          readFileImpl: async () => JSON.stringify(roster()),
          createClientImpl: () => ({ rpc: async () => undefined }),
        },
      ),
    /QXY-001.*UNKNOWN/,
  );
});

test("CLI main behavior is testable without network access", async () => {
  const output = [];
  const errors = [];
  const exitCode = await runCli({
    env: {
      PHASE1_ROSTER_PATH: "private/phase1-roster.json",
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-secret",
      FEISHU_TENANT_KEY: "tenant_qxy",
    },
    dependencies: {
      readFileImpl: async () => JSON.stringify(roster()),
      createClientImpl: () => ({ rpc: async () => ({ data: 101, error: null }) }),
    },
    stdout: (message) => output.push(message),
    stderr: (message) => errors.push(message),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(output, ["员工名单导入完成：1 人（QXY-001）"]);
});

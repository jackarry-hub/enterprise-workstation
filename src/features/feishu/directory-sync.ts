export type FeishuDirectoryEnv = {
  appId: string;
  appSecret: string;
};

export type FeishuDirectorySnapshot = {
  complete: true;
  departments: Array<{
    externalId: string;
    departmentId: string | null;
    parentExternalId: string | null;
    name: string;
    leaderOpenId: string | null;
  }>;
  positions: Array<{ externalId: string; name: string }>;
  employees: Array<{
    openId: string;
    userId: string | null;
    email: string | null;
    name: string;
    primaryDepartmentExternalId: string | null;
    jobTitleExternalId: string | null;
    jobTitle: string;
    isActive: boolean;
  }>;
};

type JsonRecord = Record<string, unknown>;
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function object(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function feishuJson(
  fetchImpl: FetchLike,
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const response = await fetchImpl(input, init);
  const body = object(await response.json().catch(() => null));
  if (!response.ok || !body || body.code !== 0) {
    throw new Error("feishu_api_unavailable");
  }
  return body;
}

async function tenantAccessToken(env: FeishuDirectoryEnv, fetchImpl: FetchLike) {
  const body = await feishuJson(
    fetchImpl,
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: env.appId, app_secret: env.appSecret }),
    },
  );
  const token = text(body.tenant_access_token);
  if (!token) throw new Error("feishu_token_unavailable");
  return token;
}

async function pagedItems(
  baseUrl: string,
  token: string,
  fetchImpl: FetchLike,
) {
  const rows: JsonRecord[] = [];
  let pageToken: string | null = null;
  for (let page = 0; page < 1000; page += 1) {
    const url = new URL(baseUrl);
    if (pageToken) url.searchParams.set("page_token", pageToken);
    const body = await feishuJson(fetchImpl, url, {
      headers: { authorization: `Bearer ${token}` },
    });
    const data = object(body.data) ?? {};
    if (Array.isArray(data.items)) {
      data.items.forEach((item) => {
        const row = object(item);
        if (row) rows.push(row);
      });
    }
    if (data.has_more !== true) return rows;
    pageToken = text(data.page_token);
    if (!pageToken) throw new Error("feishu_pagination_invalid");
  }
  throw new Error("feishu_directory_too_large");
}

function isActiveUser(row: JsonRecord) {
  const status = object(row.status) ?? {};
  return status.is_activated !== false
    && status.is_exited !== true
    && status.is_frozen !== true
    && status.is_resigned !== true
    && status.is_unjoin !== true;
}

function jobTitleExternalId(jobTitle: string | null) {
  return jobTitle ? `job-title:${jobTitle.toLocaleLowerCase("zh-CN")}` : null;
}

export function getFeishuDirectoryEnv(
  env: NodeJS.ProcessEnv = process.env,
): FeishuDirectoryEnv {
  const appId = env.FEISHU_APP_ID?.trim();
  const appSecret = env.FEISHU_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("feishu_directory_not_configured");
  return { appId, appSecret };
}

export async function loadFeishuDirectorySnapshot(
  env: FeishuDirectoryEnv,
  fetchImpl: FetchLike = fetch,
): Promise<FeishuDirectorySnapshot> {
  const token = await tenantAccessToken(env, fetchImpl);
  const departmentRows = await pagedItems(
    "https://open.feishu.cn/open-apis/contact/v3/departments/0/children?department_id_type=open_department_id&user_id_type=open_id&fetch_child=true&page_size=50",
    token,
    fetchImpl,
  );
  const departments = departmentRows.flatMap((row) => {
    const externalId = text(row.open_department_id);
    const name = text(row.name);
    if (!externalId || !name) return [];
    const parent = text(row.parent_department_id);
    return [{
      externalId,
      departmentId: text(row.department_id),
      parentExternalId: parent && parent !== "0" ? parent : null,
      name,
      leaderOpenId: text(row.leader_user_id),
    }];
  });

  const users = new Map<string, FeishuDirectorySnapshot["employees"][number]>();
  const departmentScopes = [null, ...departments.map(({ externalId }) => externalId)];
  for (const departmentExternalId of departmentScopes) {
    const departmentId = departmentExternalId ?? "0";
    const rows = await pagedItems(
      `https://open.feishu.cn/open-apis/contact/v3/users/find_by_department?department_id=${encodeURIComponent(departmentId)}&department_id_type=open_department_id&user_id_type=open_id&page_size=50`,
      token,
      fetchImpl,
    );
    rows.forEach((row) => {
      const openId = text(row.open_id)?.toLocaleLowerCase("en-US");
      const name = text(row.name);
      if (!openId || !name) return;
      const existing = users.get(openId);
      const jobTitle = text(row.job_title) ?? existing?.jobTitle ?? "";
      users.set(openId, {
        openId,
        userId: text(row.user_id) ?? existing?.userId ?? null,
        email: text(row.email)?.toLocaleLowerCase("en-US") ?? existing?.email ?? null,
        name,
        primaryDepartmentExternalId:
          existing?.primaryDepartmentExternalId ?? departmentExternalId,
        jobTitleExternalId: jobTitleExternalId(jobTitle),
        jobTitle,
        isActive: isActiveUser(row),
      });
    });
  }

  const positions = new Map<string, string>();
  users.forEach((employee) => {
    if (employee.jobTitleExternalId) {
      positions.set(employee.jobTitleExternalId, employee.jobTitle);
    }
  });

  return {
    complete: true,
    departments,
    positions: [...positions].map(([externalId, name]) => ({ externalId, name })),
    employees: [...users.values()],
  };
}

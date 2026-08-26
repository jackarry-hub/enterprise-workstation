import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { OrganizationCommand } from "@/features/organization/organization-command-types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FEISHU_OWNED_FIELDS = new Set([
  "source", "externalId", "externalIdentifiers", "openDepartmentId", "jobTitleId",
  "leaderOpenId", "parentExternalId", "providerTenantKey",
]);
const ROLE_CODES = new Set(["admin", "department_head", "employee", "finance", "hr"]);

export type OrganizationRpc = (
  functionName: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string } | null }>;

export type OrganizationCommandDependencies = {
  session: WorkspaceSession | null;
  rpc: OrganizationRpc;
};

export class OrganizationCommandStoreError extends Error {
  constructor(readonly code: string | undefined) {
    super("Organization command failed");
    this.name = "OrganizationCommandStoreError";
  }
}

export async function handleOrganizationCommand(
  request: Request,
  dependencies: OrganizationCommandDependencies,
) {
  const session = dependencies.session;
  if (!session) return json({ error: "unauthorized" }, 401);

  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!isUuid(idempotencyKey)) return json({ error: "invalid_idempotency_key" }, 400);

  const body = await readObject(request);
  if (!body) return json({ error: "invalid_request" }, 400);
  if ([...FEISHU_OWNED_FIELDS].some((field) => field in body)) {
    return json({ error: "feishu_owned_field" }, 400);
  }
  const command = parseCommand(body, idempotencyKey);
  if (!command) return json({ error: "invalid_request" }, 400);

  const requiredPermission = command.type === "assign_member_role"
    ? "role.manage"
    : "organization.manage";
  if (session.member.status !== "active" || !session.permissionCodes.includes(requiredPermission)) {
    return json({ error: "forbidden" }, 403);
  }

  try {
    const data = await invokeCommand(command, dependencies.rpc);
    return json(data, command.type === "create_department" ? 201 : 200);
  } catch (error) {
    return mapCommandError(error);
  }
}

async function invokeCommand(command: OrganizationCommand, rpc: OrganizationRpc) {
  const [functionName, args] = command.type === "create_department"
    ? ["create_current_department", {
      p_code: command.code,
      p_name: command.name,
      p_description: command.description,
      p_sort_order: command.sortOrder,
      request_id: command.idempotencyKey,
    }]
    : command.type === "update_department"
      ? ["update_current_department", {
        p_department_public_id: command.departmentId,
        p_name: command.name,
        p_description: command.description,
        p_sort_order: command.sortOrder,
        p_version: command.version,
        request_id: command.idempotencyKey,
      }]
      : command.type === "upsert_position"
        ? ["upsert_current_position", {
          p_position_public_id: command.positionId,
          p_code: command.code,
          p_name: command.name,
          p_category: command.category,
          p_description: command.description,
          p_department_public_id: command.departmentId,
          p_version: command.version,
          request_id: command.idempotencyKey,
        }]
        : ["assign_current_member_role", {
          p_member_id: command.memberId,
          p_role_code: command.roleCode,
          p_version: command.version,
          request_id: command.idempotencyKey,
        }];
  const result = await rpc(functionName, args);
  if (result.error) throw new OrganizationCommandStoreError(result.error.code);
  if (!result.data || typeof result.data !== "object") {
    throw new OrganizationCommandStoreError("P0001");
  }
  return result.data;
}

function parseCommand(body: Record<string, unknown>, idempotencyKey: string): OrganizationCommand | null {
  const type = body.type;
  if (type === "create_department") {
    const code = upperText(body.code, 80);
    const name = text(body.name, 120, true);
    const description = text(body.description ?? "", 1000);
    const sortOrder = nonnegativeInteger(body.sortOrder ?? 0);
    return code && name && description !== null && sortOrder !== null
      ? { type, code, name, description, sortOrder, idempotencyKey }
      : null;
  }
  if (type === "update_department") {
    const departmentId = uuid(body.departmentId);
    const name = text(body.name, 120, true);
    const description = text(body.description ?? "", 1000);
    const sortOrder = nonnegativeInteger(body.sortOrder ?? 0);
    const version = positiveInteger(body.version);
    return departmentId && name && description !== null && sortOrder !== null && version
      ? { type, departmentId, name, description, sortOrder, version, idempotencyKey }
      : null;
  }
  if (type === "upsert_position") {
    const positionId = body.positionId === undefined || body.positionId === null ? null : uuid(body.positionId);
    const code = upperText(body.code, 80);
    const name = text(body.name, 120, true);
    const category = text(body.category, 80, true);
    const description = text(body.description ?? "", 1000);
    const departmentId = body.departmentId === undefined || body.departmentId === null ? null : uuid(body.departmentId);
    const version = nonnegativeInteger(body.version);
    if ((body.positionId !== undefined && body.positionId !== null && !positionId)
      || (body.departmentId !== undefined && body.departmentId !== null && !departmentId)) return null;
    if (positionId === null && version !== 0) return null;
    if (positionId !== null && version === 0) return null;
    return code && name && category && description !== null && version !== null
      ? { type, positionId, code, name, category, description, departmentId, version, idempotencyKey }
      : null;
  }
  if (type === "assign_member_role") {
    const memberId = positiveInteger(body.memberId);
    const roleCode = typeof body.roleCode === "string" && ROLE_CODES.has(body.roleCode)
      ? body.roleCode as "admin" | "department_head" | "employee" | "finance" | "hr"
      : null;
    const version = positiveInteger(body.version);
    return memberId && roleCode && version
      ? { type, memberId, roleCode, version, idempotencyKey }
      : null;
  }
  return null;
}

function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return (!required || parsed.length > 0) && parsed.length <= maximum ? parsed : null;
}

function upperText(value: unknown, maximum: number) {
  const parsed = text(value, maximum, true);
  return parsed && parsed === parsed.toUpperCase() ? parsed : null;
}

function nonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown) {
  const parsed = nonnegativeInteger(value);
  return parsed && parsed > 0 ? parsed : null;
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

function isUuid(value: string | null): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function mapCommandError(error: unknown): Response {
  if (!(error instanceof OrganizationCommandStoreError)) throw error;
  if (error.code === "42501") return json({ error: "forbidden" }, 403);
  if (error.code === "P0002") return json({ error: "not_found" }, 404);
  if (error.code === "40001") return json({ error: "stale_version" }, 409);
  if (error.code === "23505") return json({ error: "duplicate_request" }, 409);
  if (error.code?.startsWith("22")) return json({ error: "invalid_request" }, 400);
  return json({ error: "command_failed" }, 409);
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

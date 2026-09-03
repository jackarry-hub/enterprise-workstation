import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { WorkspacePermissionCode } from "@/features/auth/workspace-session-types";
import { loadActiveWorkspaceScope } from "@/features/projects/data/active-workspace-data";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type DataImportSession = {
  organization: { name: string };
  permissionCodes: readonly WorkspacePermissionCode[];
  isAdmin: boolean;
};

type DataImportProjectResult = {
  source: "supabase" | "mock";
  projects: readonly {
    id: string;
    code: string;
    name: string;
    viewerRole: "owner" | "manager" | "member" | "viewer" | "none";
  }[];
};

export type DataImportBootstrapDependencies = {
  loadSession: () => Promise<DataImportSession | null>;
  loadProjects: () => Promise<DataImportProjectResult>;
};

function hasPermission(session: DataImportSession, permission: WorkspacePermissionCode) {
  return session.permissionCodes.includes(permission);
}

function canContribute(project: DataImportProjectResult["projects"][number], isAdmin: boolean) {
  return isAdmin || ["owner", "manager", "member"].includes(project.viewerRole);
}

export function createDataImportBootstrapHandler(dependencies: DataImportBootstrapDependencies) {
  return async function getDataImportBootstrap() {
    const session = await dependencies.loadSession();
    if (!session) {
      return Response.json({ error: "unauthorized" }, {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const capabilities = {
      directorySync: hasPermission(session, "organization.manage"),
      customerImport: hasPermission(session, "customer.import"),
      customerExport: hasPermission(session, "customer.export"),
      customerExportPii: hasPermission(session, "customer.export_pii"),
      projectFileUpload: hasPermission(session, "project.files"),
      knowledgeManage: hasPermission(session, "knowledge.manage"),
    };
    let projects: Array<{ id: string; code: string; name: string }> = [];
    let projectDataStatus: "ready" | "unavailable" = "ready";
    if (capabilities.projectFileUpload) {
      try {
        const result = await dependencies.loadProjects();
        if (result.source !== "supabase") throw new Error("non_authoritative_source");
        projects = result.projects
          .filter((project) => canContribute(project, session.isAdmin))
          .map(({ id, code, name }) => ({ id, code, name }));
      } catch {
        projectDataStatus = "unavailable";
      }
    }
    return Response.json({
      source: "supabase",
      organizationName: session.organization.name,
      capabilities,
      projects,
      projectDataStatus,
    }, { headers: { "Cache-Control": "no-store" } });
  };
}

export const defaultDataImportBootstrapDependencies: DataImportBootstrapDependencies = {
  loadSession: getWorkspaceSession,
  async loadProjects() {
    const client = await getSupabaseServerClient();
    const scope = await loadActiveWorkspaceScope(client);
    const projectResponse = await client
      .from("projects")
      .select("id, public_id, code, name, owner_member_id")
      .eq("tenant_id", scope.tenantId)
      .eq("organization_id", scope.organizationId)
      .is("deleted_at", null)
      .order("name")
      .limit(500);
    if (projectResponse.error) throw projectResponse.error;
    const projectRows = (projectResponse.data ?? []) as Array<{
      id: number;
      public_id: string;
      code: string;
      name: string;
      owner_member_id: number;
    }>;
    const membershipResponse = projectRows.length
      ? await client
        .from("project_members")
        .select("project_id, role")
        .eq("tenant_id", scope.tenantId)
        .eq("organization_id", scope.organizationId)
        .eq("member_id", scope.memberId)
        .is("left_at", null)
        .in("project_id", projectRows.map(({ id }) => id))
      : { data: [], error: null };
    if (membershipResponse.error) throw membershipResponse.error;
    const membershipByProject = new Map(
      ((membershipResponse.data ?? []) as Array<{
        project_id: number;
        role: "owner" | "manager" | "member" | "viewer";
      }>).map(({ project_id, role }) => [project_id, role]),
    );
    return {
      source: "supabase",
      projects: projectRows.map((project) => ({
        id: project.public_id,
        code: project.code,
        name: project.name,
        viewerRole: project.owner_member_id === scope.memberId
          ? "owner" as const
          : membershipByProject.get(project.id) ?? "none" as const,
      })),
    };
  },
};

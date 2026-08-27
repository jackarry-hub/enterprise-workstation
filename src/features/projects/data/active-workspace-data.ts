import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;

type ExternalIdentityRow = {
  tenant_id: number;
  organization_id: number;
  organization_member_id: number;
  identity_provider_id: number;
};

type StatusRow = { status: string };
type OrganizationRow = { public_id: string };
type MemberRow = StatusRow & { public_id: string; user_id: string | null };
type ProfileRow = { public_id: string; employment_status: string };

export type ActiveWorkspaceScope = {
  authUserId: string;
  tenantId: number;
  organizationId: number;
  organizationPublicId: string;
  memberId: number;
  memberPublicId: string;
  employeePublicId: string;
};

export async function loadActiveWorkspaceScope(
  client: SupabaseServerClient,
): Promise<ActiveWorkspaceScope> {
  const userResponse = await client.auth.getUser();
  if (userResponse.error) throw userResponse.error;
  const authUserId = userResponse.data.user?.id;
  if (!authUserId) throw new Error("workspace_session_missing");

  const identityResponse = await client
    .from("external_identities")
    .select("tenant_id, organization_id, organization_member_id, identity_provider_id")
    .eq("auth_user_id", authUserId)
    .eq("status", "active")
    .maybeSingle();
  if (identityResponse.error) throw identityResponse.error;
  const identity = identityResponse.data as ExternalIdentityRow | null;
  if (!identity) throw new Error("active_workspace_identity_missing");

  const [tenantResponse, providerResponse, organizationResponse, memberResponse, profileResponse] = await Promise.all([
    client.from("tenants").select("status").eq("id", identity.tenant_id).maybeSingle(),
    client.from("identity_providers").select("status").eq("tenant_id", identity.tenant_id).eq("id", identity.identity_provider_id).maybeSingle(),
    client.from("organizations").select("public_id").eq("tenant_id", identity.tenant_id).eq("id", identity.organization_id).maybeSingle(),
    client.from("organization_members").select("public_id, user_id, status")
      .eq("tenant_id", identity.tenant_id)
      .eq("organization_id", identity.organization_id)
      .eq("id", identity.organization_member_id)
      .maybeSingle(),
    client.from("employee_profiles").select("public_id, employment_status")
      .eq("tenant_id", identity.tenant_id)
      .eq("organization_id", identity.organization_id)
      .eq("organization_member_id", identity.organization_member_id)
      .is("deleted_at", null)
      .maybeSingle(),
  ]);
  const error = [tenantResponse, providerResponse, organizationResponse, memberResponse, profileResponse]
    .find((response) => response.error)?.error;
  if (error) throw error;

  const tenant = tenantResponse.data as StatusRow | null;
  const provider = providerResponse.data as StatusRow | null;
  const organization = organizationResponse.data as OrganizationRow | null;
  const member = memberResponse.data as MemberRow | null;
  const profile = profileResponse.data as ProfileRow | null;
  if (tenant?.status !== "active" || provider?.status !== "active"
      || !organization || member?.status !== "active"
      || member.user_id !== authUserId || !["probation", "active", "on_leave"].includes(profile?.employment_status ?? "")
      || !organization.public_id || !member.public_id || !profile?.public_id) {
    throw new Error("active_workspace_scope_invalid");
  }

  return {
    authUserId,
    tenantId: identity.tenant_id,
    organizationId: identity.organization_id,
    organizationPublicId: organization.public_id,
    memberId: identity.organization_member_id,
    memberPublicId: member.public_id,
    employeePublicId: profile.public_id,
  };
}

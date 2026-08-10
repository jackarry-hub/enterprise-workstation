import type {
  WorkspaceActor,
  WorkspaceRole,
  WorkspaceSession,
} from "@/features/auth/workspace-session-types";

type OperationFixtureBinding = {
  tenantId: string;
  authUserId: string;
  memberId: string;
  role: WorkspaceRole;
  fixtureActorId: string;
  fixtureMemberId: string;
};

const operationFixtureBindings: readonly OperationFixtureBinding[] = [
  {
    tenantId: "10000000-0000-4000-8000-000000000000",
    authUserId: "10000000-0000-4000-8000-000000000001",
    memberId: "10",
    role: "executive",
    fixtureActorId: "actor-executive",
    fixtureMemberId: "20000000-0000-4000-8000-000000000010",
  },
] as const;

export type OperationFixtureContext = {
  tenantId: string;
  authUserId: string;
  memberId: string;
  actor: WorkspaceActor | null;
  storageNamespace: string | null;
};

export type OperationFixtureIdentity = {
  tenantId: string;
  authUserId: string;
  memberId: string;
  primaryRole: WorkspaceRole;
  actor: WorkspaceActor;
};

function findIdentityBinding(identity: OperationFixtureIdentity) {
  return operationFixtureBindings.find((binding) => (
    binding.tenantId === identity.tenantId
    && binding.authUserId === identity.authUserId
    && binding.memberId === identity.memberId
    && binding.role === identity.primaryRole
    && identity.actor.id === identity.authUserId
    && identity.actor.memberId === identity.memberId
    && identity.actor.role === identity.primaryRole
  ));
}

export function createOperationFixtureContextForIdentity(
  identity: OperationFixtureIdentity,
): OperationFixtureContext {
  const binding = findIdentityBinding(identity);
  const actor = binding ? {
    ...identity.actor,
    id: binding.fixtureActorId,
    memberId: binding.fixtureMemberId,
  } : null;
  return {
    tenantId: identity.tenantId,
    authUserId: identity.authUserId,
    memberId: identity.memberId,
    actor,
    storageNamespace: actor
      ? `${identity.tenantId}:${identity.authUserId}:${identity.memberId}`
      : null,
  };
}

export function toOperationFixtureActor(session: WorkspaceSession): WorkspaceActor | null {
  return createOperationFixtureContext(session).actor;
}

export function createOperationFixtureContext(
  session: WorkspaceSession,
): OperationFixtureContext {
  return createOperationFixtureContextForIdentity({
    tenantId: session.tenantId,
    authUserId: session.authUserId,
    memberId: String(session.member.id),
    primaryRole: session.primaryRole,
    actor: session.actor,
  });
}

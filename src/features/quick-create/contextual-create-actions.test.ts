import { describe, expect, it } from "vitest";
import { getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { getContextualCreateActions } from "@/features/quick-create/contextual-create-actions";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

function context(pathname: string, permissions: typeof executiveWorkspaceSession.permissionCodes) { const session = { ...executiveWorkspaceSession, permissionCodes: permissions }; return { pathname, session, capabilities: getModuleCapabilities(session) }; }
describe("page-context quick create", () => {
  it("shows only Agent-related, authorized actions on Agent Center", () => { expect(getContextualCreateActions(context("/agents", ["agent.manage", "agent.orchestrate", "approval.submit"])).map(({ id }) => id)).toEqual(["agent.create", "agent.orchestration.create", "agent.permission.request"]); });
  it("does not leak task creation into Agent Center", () => { expect(getContextualCreateActions(context("/agents", ["agent.manage"])).map(({ id }) => id)).toEqual(["agent.create"]); });
  it("hides quick create on read-only analytics", () => { expect(getContextualCreateActions(context("/analytics", ["analytics.read"]))).toEqual([]); });
  it("offers the durable conversation command on AI assistant", () => { expect(getContextualCreateActions(context("/assistant", [])).map(({ id }) => id)).toEqual(["assistant.conversation.create"]); });
});

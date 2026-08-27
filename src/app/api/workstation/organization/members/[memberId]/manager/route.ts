import {
  createManagerScopeHandlers,
  defaultManagerScopeDependencies,
} from "@/features/organization/manager-scope-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handlers = createManagerScopeHandlers(defaultManagerScopeDependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;

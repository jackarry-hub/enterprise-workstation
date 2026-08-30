import {
  createReadinessHandler,
  defaultReadinessDependencies,
} from "@/app/api/health/ready/handler";

export const dynamic = "force-dynamic";

export const GET = createReadinessHandler(defaultReadinessDependencies);

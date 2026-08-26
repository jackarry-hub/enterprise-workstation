import {
  createSkillVerificationHandler,
  defaultSkillVerificationDependencies,
} from "@/features/work-profile/skill-verification-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createSkillVerificationHandler(defaultSkillVerificationDependencies);

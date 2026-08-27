import {
  defaultApprovalCommandDependencies,
  handleApprovalSubmission,
} from "@/features/approvals/approval-command-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return await handleApprovalSubmission(request, await defaultApprovalCommandDependencies());
  } catch {
    return Response.json({ error: "approval_command_unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

import {
  defaultApprovalCommandDependencies,
  handleApprovalAction,
} from "@/features/approvals/approval-command-handler";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  try {
    const { approvalId } = await context.params;
    return await handleApprovalAction(
      request, approvalId, await defaultApprovalCommandDependencies(),
    );
  } catch {
    return Response.json({ error: "approval_command_unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

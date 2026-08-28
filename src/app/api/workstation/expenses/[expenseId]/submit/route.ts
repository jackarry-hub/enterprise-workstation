import {
  defaultExpenseCommandDependencies,
  handleExpenseSubmission,
} from "@/features/expenses/expense-command-handler";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ expenseId: string }> },
) {
  try {
    const { expenseId } = await context.params;
    return await handleExpenseSubmission(
      request, expenseId, await defaultExpenseCommandDependencies(),
    );
  } catch {
    return Response.json({ error: "expense_command_unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

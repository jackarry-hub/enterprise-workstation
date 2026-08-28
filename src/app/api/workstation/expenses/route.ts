import {
  defaultExpenseCommandDependencies,
  handleExpenseCollection,
} from "@/features/expenses/expense-command-handler";

export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    return await handleExpenseCollection(request, await defaultExpenseCommandDependencies());
  } catch {
    return Response.json({ error: "expense_command_unavailable" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}

export const POST = handle;
export const PATCH = handle;

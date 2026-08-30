import type { ApprovalResult } from "@/features/approvals/approval-types";
import { ApprovalsWorkspace } from "@/features/approvals/approvals-workspace";
import type { ExpenseFormOptions } from "@/features/expenses/expense-data";

export function ApprovalsPage({
  result,
  expenseOptions,
}: {
  result: ApprovalResult;
  expenseOptions?: ExpenseFormOptions;
}) {
  return <ApprovalsWorkspace result={result} expenseOptions={expenseOptions} />;
}

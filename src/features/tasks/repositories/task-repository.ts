import type {
  OperationCommand,
  OperationTask,
  OperationWorkstream,
  OperationsState,
} from "@/features/operations/operations-types";
import type { AiExecutionSummary } from "@/features/ai-dispatch/summary-contract";

export type RuntimeDispatchWrite = {
  workstream: OperationWorkstream;
  command: OperationCommand;
  tasks: OperationTask[];
  event: OperationsState["events"][number];
};

export type RuntimeTaskSubmissionInput = {
  description: string;
  url?: string;
  attachmentName?: string;
  note?: string;
};

export interface TaskRepository {
  createTasks(input: RuntimeDispatchWrite): Promise<OperationsState>;
  getTasks(): Promise<OperationTask[]>;
  getTasksByUser(actorId: string): Promise<OperationTask[]>;
  acceptTask(taskId: string): Promise<OperationsState>;
  startTask(taskId: string): Promise<OperationsState>;
  updateProgress(taskId: string, progress: number): Promise<OperationsState>;
  submitTask(taskId: string, submission: RuntimeTaskSubmissionInput): Promise<OperationsState>;
  approveTask(taskId: string, comment: string): Promise<OperationsState>;
  rejectTask(taskId: string, reason: string): Promise<OperationsState>;
  resetActiveAiDispatch(): Promise<OperationsState>;
  saveDispatchSummary(summary: AiExecutionSummary, model: string): Promise<OperationsState>;
  archiveDispatch(): Promise<OperationsState>;
}

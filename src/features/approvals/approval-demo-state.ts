"use client";

import { useEffect, useState } from "react";

import type { Approval } from "@/features/approvals/approval-types";
import { CUSTOMER_DEMO_RESET_EVENT } from "@/features/demo/customer-demo-state";

export const APPROVAL_DEMO_STORAGE_KEY = "enterprise-workspace.approvals.v1:customer-demo-shared";
export const APPROVAL_DEMO_CHANGED_EVENT = "enterprise-workspace:approvals-changed";

type StoredApprovalState = {
  version: 1;
  approvals: Record<string, Approval>;
};

type ApprovalDecisionInput = {
  decision: "approve" | "reject";
  feedback: string;
  actedAt?: string;
};

function targetStorage(storage?: Pick<Storage, "getItem" | "setItem">) {
  return storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
}

function readStoredState(storage?: Pick<Storage, "getItem" | "setItem">): StoredApprovalState {
  const target = targetStorage(storage);
  if (!target) return { version: 1, approvals: {} };
  try {
    const parsed = JSON.parse(target.getItem(APPROVAL_DEMO_STORAGE_KEY) ?? "null") as StoredApprovalState | null;
    return parsed?.version === 1 && parsed.approvals
      ? parsed
      : { version: 1, approvals: {} };
  } catch {
    return { version: 1, approvals: {} };
  }
}

function shanghaiTimestamp() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date()).replace("T", " ");
}

export function readDemoApprovals(
  seeds: readonly Approval[],
  storage?: Pick<Storage, "getItem" | "setItem">,
) {
  const saved = readStoredState(storage).approvals;
  return seeds.map((approval) => saved[approval.id] ?? approval);
}

export function saveDemoApproval(
  approval: Approval,
  storage?: Pick<Storage, "getItem" | "setItem">,
) {
  const target = targetStorage(storage);
  if (!target) return;
  const current = readStoredState(target);
  target.setItem(APPROVAL_DEMO_STORAGE_KEY, JSON.stringify({
    version: 1,
    approvals: { ...current.approvals, [approval.id]: approval },
  } satisfies StoredApprovalState));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(APPROVAL_DEMO_CHANGED_EVENT, { detail: { approvalId: approval.id } }));
  }
}

export function applyApprovalDecision(
  approval: Approval,
  { decision, feedback, actedAt = shanghaiTimestamp() }: ApprovalDecisionInput,
): Approval {
  const comment = feedback.trim() || (decision === "approve" ? "同意申请" : "退回申请人补充资料");
  const ownerId = approval.owner.id;

  if (decision === "reject") {
    let rejectedCurrentStep = false;
    const steps = approval.steps.map((step) => {
      if (!rejectedCurrentStep && step.status === "pending" && step.approver?.id === ownerId) {
        rejectedCurrentStep = true;
        return { ...step, status: "rejected" as const, actedAt, comment };
      }
      if (step.status === "pending") return { ...step, status: "skipped" as const };
      return step;
    });
    return {
      ...approval,
      status: "rejected",
      currentStep: "已退回申请人",
      steps,
      actions: [...approval.actions, {
        id: `approval-reject-${approval.id}-${Date.now()}`,
        actor: approval.owner,
        actionType: "reject",
        content: comment,
        createdAt: actedAt,
      }],
    };
  }

  const stepsAfterCurrentOwner = approval.steps.map((step) => (
    step.status === "pending" && step.approver?.id === ownerId
      ? { ...step, status: "approved" as const, actedAt, comment }
      : step
  ));
  const nextResponsibleStep = stepsAfterCurrentOwner.find((step) => (
    step.status === "pending" && step.approver && step.approver.id !== ownerId
  ));
  const completed = !nextResponsibleStep;
  const steps = completed
    ? stepsAfterCurrentOwner.map((step) => step.status === "pending"
      ? { ...step, status: "approved" as const, actedAt, comment: "流程完成" }
      : step)
    : stepsAfterCurrentOwner;

  return {
    ...approval,
    status: completed ? "approved" : "pending",
    currentStep: completed ? "流程完成" : nextResponsibleStep.name,
    owner: completed ? approval.owner : nextResponsibleStep.approver!,
    steps,
    actions: [...approval.actions, {
      id: `approval-approve-${approval.id}-${Date.now()}`,
      actor: approval.owner,
      actionType: "approve",
      content: comment,
      createdAt: actedAt,
    }],
  };
}

export function useDemoApprovals(seeds: readonly Approval[], enabled = true) {
  const [approvals, setApprovals] = useState<Approval[]>(() => [...seeds]);

  useEffect(() => {
    if (!enabled) {
      setApprovals([...seeds]);
      return;
    }
    const sync = () => setApprovals(readDemoApprovals(seeds));
    const syncStorage = (event: StorageEvent) => {
      if (event.key === APPROVAL_DEMO_STORAGE_KEY) sync();
    };
    sync();
    window.addEventListener(APPROVAL_DEMO_CHANGED_EVENT, sync);
    window.addEventListener(CUSTOMER_DEMO_RESET_EVENT, sync);
    window.addEventListener("storage", syncStorage);
    return () => {
      window.removeEventListener(APPROVAL_DEMO_CHANGED_EVENT, sync);
      window.removeEventListener(CUSTOMER_DEMO_RESET_EVENT, sync);
      window.removeEventListener("storage", syncStorage);
    };
  }, [enabled, seeds]);

  return approvals;
}

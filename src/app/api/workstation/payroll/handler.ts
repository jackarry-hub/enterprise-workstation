import { NextResponse } from "next/server";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type PayrollSession = {
  member: { id: number };
  permissionCodes: readonly string[];
};

type PayrollInput = {
  actorMemberId: number;
  employeeMemberId: number;
  payrollMonth: string;
  baseSalary: number;
  performanceBonus: number;
  projectBonus: number;
  otherBonus: number;
  socialSecurity: number;
  individualIncomeTax: number;
  otherDeduction: number;
  bonus: number;
  deductions: number;
  netSalary: number;
  status: "draft" | "processing" | "paid";
};

export type WorkstationPayrollDependencies = {
  loadSession: () => Promise<PayrollSession | null>;
  savePayroll: (input: PayrollInput) => Promise<unknown>;
};

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100_000_000
    ? Math.round(parsed * 100) / 100
    : null;
}

function memberId(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^m([1-9]\d*)$/.exec(value);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePayroll(value: unknown): Omit<PayrollInput, "actorMemberId"> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const employeeMemberId = memberId(body.memberId);
  const payrollMonth = typeof body.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)
    ? `${body.month}-01`
    : null;
  const baseSalary = money(body.baseSalary);
  const performanceBonus = money(body.performanceBonus);
  const projectBonus = money(body.projectBonus);
  const otherBonus = money(body.otherBonus);
  const socialSecurity = money(body.socialSecurity);
  const individualIncomeTax = money(body.individualIncomeTax);
  const otherDeduction = money(body.otherDeduction);
  const status = ["draft", "processing", "paid"].includes(String(body.status))
    ? body.status as PayrollInput["status"]
    : null;
  const values = [baseSalary, performanceBonus, projectBonus, otherBonus, socialSecurity, individualIncomeTax, otherDeduction];
  if (!employeeMemberId || !payrollMonth || !status || values.some((item) => item === null)) return null;
  const bonus = performanceBonus! + projectBonus! + otherBonus!;
  const deductions = socialSecurity! + individualIncomeTax! + otherDeduction!;
  const netSalary = baseSalary! + bonus - deductions;
  if (netSalary < 0) return null;
  return {
    employeeMemberId,
    payrollMonth,
    baseSalary: baseSalary!,
    performanceBonus: performanceBonus!,
    projectBonus: projectBonus!,
    otherBonus: otherBonus!,
    socialSecurity: socialSecurity!,
    individualIncomeTax: individualIncomeTax!,
    otherDeduction: otherDeduction!,
    bonus,
    deductions,
    netSalary,
    status,
  };
}

export const defaultWorkstationPayrollDependencies: WorkstationPayrollDependencies = {
  loadSession: getWorkspaceSession,
  async savePayroll(input) {
    const client = await getSupabaseServerClient();
    const memberResult = await client.from("organization_members")
      .select("organization_id")
      .eq("id", input.actorMemberId)
      .single();
    if (memberResult.error || !memberResult.data) throw memberResult.error ?? new Error("organization_not_found");
    const organizationId = memberResult.data.organization_id;
    const profileResult = await client.from("employee_profiles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("organization_member_id", input.employeeMemberId)
      .is("deleted_at", null)
      .single();
    if (profileResult.error || !profileResult.data) throw profileResult.error ?? new Error("employee_not_found");

    const values = {
      organization_id: organizationId,
      employee_profile_id: profileResult.data.id,
      payroll_month: input.payrollMonth,
      base_salary: input.baseSalary,
      performance_bonus: input.performanceBonus,
      project_bonus: input.projectBonus,
      other_bonus: input.otherBonus,
      social_security: input.socialSecurity,
      individual_income_tax: input.individualIncomeTax,
      other_deduction: input.otherDeduction,
      bonus: input.bonus,
      deductions: input.deductions,
      net_salary: input.netSalary,
      status: input.status,
      paid_at: input.status === "paid" ? new Date().toISOString() : null,
    };
    const existing = await client.from("salary")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("employee_profile_id", profileResult.data.id)
      .eq("payroll_month", input.payrollMonth)
      .is("deleted_at", null)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const result = existing.data
      ? await client.from("salary").update(values).eq("id", existing.data.id)
      : await client.from("salary").insert(values);
    if (result.error) throw result.error;
    return { status: "saved", memberId: `m${input.employeeMemberId}`, month: input.payrollMonth.slice(0, 7) };
  },
};

export function createWorkstationPayrollHandler(
  dependencies: WorkstationPayrollDependencies,
) {
  return async function savePayroll(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!session.permissionCodes.includes("salary.manage")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "invalid_request" }, { status: 400 }); }
    const input = parsePayroll(body);
    if (!input) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    try {
      return NextResponse.json(await dependencies.savePayroll({ actorMemberId: session.member.id, ...input }));
    } catch {
      return NextResponse.json({ error: "payroll_update_failed" }, { status: 409 });
    }
  };
}

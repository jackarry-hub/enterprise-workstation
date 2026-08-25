export type CompensationEmployee = {
  employeeProfileId: number;
  departmentId: number | null;
  salaryGradeCode: string;
  jobLevel: number;
};

export type SalaryGradePolicyInput = {
  id: string;
  departmentId: number | null;
  salaryGradeCode: string;
  jobLevel: number;
  baseSalary: number;
  performanceWeight: number;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type TaskBonusAllocationInput = {
  employeeProfileId: number;
  payrollMonth: string;
  amount: number;
};

export type MonthlyCompensationInput = {
  payrollMonth: string;
  employee: CompensationEmployee;
  policies: readonly SalaryGradePolicyInput[];
  taskBonusAllocations: readonly TaskBonusAllocationInput[];
  performanceScore: number;
  otherBonus: number;
  deductions: {
    socialSecurity: number;
    individualIncomeTax: number;
    otherDeduction: number;
  };
};

export type MonthlyCompensationResult = {
  policyId: string;
  payrollMonth: string;
  baseSalary: number;
  performanceBonus: number;
  projectBonus: number;
  otherBonus: number;
  bonus: number;
  deductions: number;
  netSalary: number;
  detail: {
    departmentPolicyMatched: boolean;
    performanceWeight: number;
    performanceScore: number;
    allocationCount: number;
  };
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function isEffective(policy: SalaryGradePolicyInput, payrollMonth: string) {
  return policy.effectiveFrom <= payrollMonth
    && (!policy.effectiveTo || policy.effectiveTo >= payrollMonth);
}

function findPolicy(input: MonthlyCompensationInput) {
  const matching = input.policies
    .filter((policy) =>
      policy.salaryGradeCode === input.employee.salaryGradeCode
      && policy.jobLevel === input.employee.jobLevel
      && isEffective(policy, input.payrollMonth),
    )
    .sort((left, right) => {
      const leftDepartmentMatch = left.departmentId === input.employee.departmentId ? 1 : 0;
      const rightDepartmentMatch = right.departmentId === input.employee.departmentId ? 1 : 0;
      if (leftDepartmentMatch !== rightDepartmentMatch) {
        return rightDepartmentMatch - leftDepartmentMatch;
      }
      return right.effectiveFrom.localeCompare(left.effectiveFrom);
    });

  return matching.find((policy) =>
    policy.departmentId === input.employee.departmentId || policy.departmentId === null,
  );
}

export function calculateMonthlyCompensation(
  input: MonthlyCompensationInput,
): MonthlyCompensationResult {
  const policy = findPolicy(input);
  if (!policy) throw new Error("salary_policy_not_found");

  const allocations = input.taskBonusAllocations.filter((allocation) =>
    allocation.employeeProfileId === input.employee.employeeProfileId
    && allocation.payrollMonth === input.payrollMonth,
  );
  const projectBonus = roundMoney(allocations.reduce((sum, allocation) => sum + allocation.amount, 0));
  const performanceScore = Math.max(0, Math.min(100, input.performanceScore));
  const performanceBonus = roundMoney(policy.baseSalary * policy.performanceWeight * (performanceScore / 100));
  const otherBonus = roundMoney(input.otherBonus);
  const bonus = roundMoney(performanceBonus + projectBonus + otherBonus);
  const deductions = roundMoney(
    input.deductions.socialSecurity
    + input.deductions.individualIncomeTax
    + input.deductions.otherDeduction,
  );

  return {
    policyId: policy.id,
    payrollMonth: input.payrollMonth,
    baseSalary: roundMoney(policy.baseSalary),
    performanceBonus,
    projectBonus,
    otherBonus,
    bonus,
    deductions,
    netSalary: roundMoney(policy.baseSalary + bonus - deductions),
    detail: {
      departmentPolicyMatched: policy.departmentId === input.employee.departmentId,
      performanceWeight: policy.performanceWeight,
      performanceScore,
      allocationCount: allocations.length,
    },
  };
}

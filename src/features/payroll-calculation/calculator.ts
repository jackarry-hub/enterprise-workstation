import { formatMoney, multiplyRate, parseMoney, parseRate } from "./money";
import { calculateCumulativeTax } from "./tax";
import type {
  PayrollCalculationInput,
  PayrollCalculationResult,
  PayrollPolicyInput,
  PriorPayrollTotals,
} from "./types";

function clamp(value: bigint, minimum: bigint, maximum: bigint): bigint {
  if (minimum > maximum) {
    throw new Error("invalid_contribution_base_range");
  }
  if (value < minimum) return minimum;
  if (value > maximum) return maximum;
  return value;
}

export function calculatePayroll(
  policy: PayrollPolicyInput,
  input: PayrollCalculationInput,
  prior: PriorPayrollTotals,
): PayrollCalculationResult {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    throw new Error("invalid_payroll_month");
  }

  const baseSalary = parseMoney(input.baseSalary);
  const performanceBonus = parseMoney(input.performanceBonus);
  const projectBonus = parseMoney(input.projectBonus);
  const otherBonus = parseMoney(input.otherBonus);
  const otherIncome = parseMoney(input.otherIncome);
  const taxExemptIncome = parseMoney(input.taxExemptIncome);
  const specialAdditionalDeduction = parseMoney(input.specialAdditionalDeduction);
  const otherStatutoryDeduction = parseMoney(input.otherStatutoryDeduction);
  const taxRelief = parseMoney(input.taxRelief);
  const otherDeduction = parseMoney(input.otherDeduction);

  if (otherDeduction > BigInt(0) && !input.manualAdjustmentReason.trim()) {
    throw new Error("missing_adjustment_reason");
  }

  const bonus = performanceBonus + projectBonus + otherBonus;
  const grossSalary = baseSalary + bonus + otherIncome;

  const socialBase = clamp(
    parseMoney(input.socialBase),
    parseMoney(policy.socialBaseMin),
    parseMoney(policy.socialBaseMax),
  );
  const housingFundBase = clamp(
    parseMoney(input.housingFundBase),
    parseMoney(policy.housingBaseMin),
    parseMoney(policy.housingBaseMax),
  );

  const pensionEmployee = multiplyRate(
    socialBase,
    parseRate(policy.pensionEmployeeRate),
  );
  const medicalEmployee = multiplyRate(
    socialBase,
    parseRate(policy.medicalEmployeeRate),
  ) + parseMoney(policy.medicalEmployeeFixedAmount);
  const unemploymentEmployee = multiplyRate(
    socialBase,
    parseRate(policy.unemploymentEmployeeRate),
  );
  const housingFundEmployee = multiplyRate(
    housingFundBase,
    parseRate(policy.housingFundEmployeeRate),
  );
  const socialSecurity = pensionEmployee
    + medicalEmployee
    + unemploymentEmployee
    + housingFundEmployee;

  const cumulativeIncome = parseMoney(input.openingCumulativeIncome)
    + prior.cumulativeIncome
    + grossSalary;
  const cumulativeTaxExemptIncome = parseMoney(
    input.openingCumulativeTaxExemptIncome,
  ) + prior.cumulativeTaxExemptIncome + taxExemptIncome;
  const cumulativeSpecialDeduction = parseMoney(
    input.openingCumulativeSpecialDeduction,
  ) + prior.cumulativeSpecialDeduction + socialSecurity;
  const cumulativeSpecialAdditionalDeduction = parseMoney(
    input.openingCumulativeSpecialAdditionalDeduction,
  ) + prior.cumulativeSpecialAdditionalDeduction + specialAdditionalDeduction;
  const cumulativeOtherStatutoryDeduction = parseMoney(
    input.openingCumulativeOtherStatutoryDeduction,
  ) + prior.cumulativeOtherStatutoryDeduction + otherStatutoryDeduction;
  const cumulativeTaxRelief = parseMoney(input.openingCumulativeTaxRelief)
    + prior.cumulativeTaxRelief
    + taxRelief;
  const previouslyWithheld = parseMoney(input.openingCumulativeTaxWithheld)
    + prior.cumulativeTaxWithheld;

  const tax = calculateCumulativeTax({
    income: cumulativeIncome,
    taxExemptIncome: cumulativeTaxExemptIncome,
    employmentMonthsYtd: input.employmentMonthsYtd,
    specialDeduction: cumulativeSpecialDeduction,
    specialAdditionalDeduction: cumulativeSpecialAdditionalDeduction,
    otherStatutoryDeduction: cumulativeOtherStatutoryDeduction,
    taxRelief: cumulativeTaxRelief,
    previouslyWithheld,
  });
  const deductions = socialSecurity + tax.currentTax + otherDeduction;
  const netSalary = grossSalary - deductions;

  if (netSalary < BigInt(0)) {
    throw new Error("negative_net_salary");
  }

  return {
    grossSalary: formatMoney(grossSalary),
    bonus: formatMoney(bonus),
    pensionEmployee: formatMoney(pensionEmployee),
    medicalEmployee: formatMoney(medicalEmployee),
    unemploymentEmployee: formatMoney(unemploymentEmployee),
    housingFundEmployee: formatMoney(housingFundEmployee),
    socialSecurity: formatMoney(socialSecurity),
    cumulativeTaxableIncome: formatMoney(tax.taxable),
    individualIncomeTax: formatMoney(tax.currentTax),
    deductions: formatMoney(deductions),
    netSalary: formatMoney(netSalary),
    taxBracket: {
      rate: tax.bracket.rate,
      quickDeduction: tax.bracket.quickDeduction,
    },
    cumulative: {
      income: formatMoney(cumulativeIncome),
      taxExemptIncome: formatMoney(cumulativeTaxExemptIncome),
      specialDeduction: formatMoney(cumulativeSpecialDeduction),
      specialAdditionalDeduction: formatMoney(cumulativeSpecialAdditionalDeduction),
      otherStatutoryDeduction: formatMoney(cumulativeOtherStatutoryDeduction),
      taxRelief: formatMoney(cumulativeTaxRelief),
      taxWithheld: formatMoney(previouslyWithheld + tax.currentTax),
    },
  };
}

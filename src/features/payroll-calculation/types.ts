export type PayrollPolicyInput = {
  id: string;
  effectiveMonth: string;
  pensionEmployeeRate: string;
  medicalEmployeeRate: string;
  medicalEmployeeFixedAmount: string;
  unemploymentEmployeeRate: string;
  housingFundEmployeeRate: string;
  socialBaseMin: string;
  socialBaseMax: string;
  housingBaseMin: string;
  housingBaseMax: string;
};

export type PayrollCalculationInput = {
  month: string;
  employmentMonthsYtd: number;
  baseSalary: string;
  performanceBonus: string;
  projectBonus: string;
  otherBonus: string;
  otherIncome: string;
  socialBase: string;
  housingFundBase: string;
  taxExemptIncome: string;
  specialAdditionalDeduction: string;
  otherStatutoryDeduction: string;
  taxRelief: string;
  otherDeduction: string;
  manualAdjustmentReason: string;
  openingCumulativeIncome: string;
  openingCumulativeTaxExemptIncome: string;
  openingCumulativeSpecialDeduction: string;
  openingCumulativeSpecialAdditionalDeduction: string;
  openingCumulativeOtherStatutoryDeduction: string;
  openingCumulativeTaxRelief: string;
  openingCumulativeTaxWithheld: string;
};

export type PriorPayrollTotals = {
  cumulativeIncome: bigint;
  cumulativeTaxExemptIncome: bigint;
  cumulativeSpecialDeduction: bigint;
  cumulativeSpecialAdditionalDeduction: bigint;
  cumulativeOtherStatutoryDeduction: bigint;
  cumulativeTaxRelief: bigint;
  cumulativeTaxWithheld: bigint;
};

export type PayrollCalculationResult = {
  grossSalary: string;
  bonus: string;
  pensionEmployee: string;
  medicalEmployee: string;
  unemploymentEmployee: string;
  housingFundEmployee: string;
  socialSecurity: string;
  cumulativeTaxableIncome: string;
  individualIncomeTax: string;
  deductions: string;
  netSalary: string;
  taxBracket: {
    rate: string;
    quickDeduction: string;
  };
  cumulative: {
    income: string;
    taxExemptIncome: string;
    specialDeduction: string;
    specialAdditionalDeduction: string;
    otherStatutoryDeduction: string;
    taxRelief: string;
    taxWithheld: string;
  };
};

export type CumulativeTaxInput = {
  income: bigint;
  taxExemptIncome: bigint;
  employmentMonthsYtd: number;
  specialDeduction: bigint;
  specialAdditionalDeduction: bigint;
  otherStatutoryDeduction: bigint;
  taxRelief: bigint;
  previouslyWithheld: bigint;
};

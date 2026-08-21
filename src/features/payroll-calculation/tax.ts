import { formatMoney, multiplyRate } from "./money";
import type { CumulativeTaxInput } from "./types";

const MONTHLY_STANDARD_DEDUCTION = BigInt(500_000);

const BRACKETS = [
  { max: BigInt(3_600_000), ratePpm: BigInt(30_000), rate: "3", quick: BigInt(0) },
  { max: BigInt(14_400_000), ratePpm: BigInt(100_000), rate: "10", quick: BigInt(252_000) },
  { max: BigInt(30_000_000), ratePpm: BigInt(200_000), rate: "20", quick: BigInt(1_692_000) },
  { max: BigInt(42_000_000), ratePpm: BigInt(250_000), rate: "25", quick: BigInt(3_192_000) },
  { max: BigInt(66_000_000), ratePpm: BigInt(300_000), rate: "30", quick: BigInt(5_292_000) },
  { max: BigInt(96_000_000), ratePpm: BigInt(350_000), rate: "35", quick: BigInt(8_592_000) },
  { max: null, ratePpm: BigInt(450_000), rate: "45", quick: BigInt(18_192_000) },
] as const;

function maxZero(value: bigint): bigint {
  return value < BigInt(0) ? BigInt(0) : value;
}

export function taxBracket(taxableCents: bigint) {
  const row = BRACKETS.find(({ max }) => (
    max === null || taxableCents <= max
  ));

  if (!row) {
    throw new Error("tax_bracket_missing");
  }

  return {
    ...row,
    quickDeduction: formatMoney(row.quick),
  };
}

export function calculateCumulativeTax(input: CumulativeTaxInput) {
  if (!Number.isInteger(input.employmentMonthsYtd)
    || input.employmentMonthsYtd < 1
    || input.employmentMonthsYtd > 12) {
    throw new Error("invalid_employment_months");
  }

  const taxable = maxZero(
    input.income
      - input.taxExemptIncome
      - MONTHLY_STANDARD_DEDUCTION * BigInt(input.employmentMonthsYtd)
      - input.specialDeduction
      - input.specialAdditionalDeduction
      - input.otherStatutoryDeduction,
  );
  const bracket = taxBracket(taxable);
  const cumulativeTax = maxZero(
    multiplyRate(taxable, bracket.ratePpm)
      - bracket.quick
      - input.taxRelief,
  );

  return {
    taxable,
    cumulativeTax,
    currentTax: maxZero(cumulativeTax - input.previouslyWithheld),
    bracket,
  };
}

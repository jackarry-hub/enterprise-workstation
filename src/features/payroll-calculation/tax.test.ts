import { describe, expect, it } from "vitest";

import { parseMoney } from "./money";
import { calculateCumulativeTax, taxBracket } from "./tax";

describe("resident salary cumulative withholding", () => {
  it.each([
    ["0.00", "3", "0.00"],
    ["36000.00", "3", "0.00"],
    ["36000.01", "10", "2520.00"],
    ["144000.01", "20", "16920.00"],
    ["300000.01", "25", "31920.00"],
    ["420000.01", "30", "52920.00"],
    ["660000.01", "35", "85920.00"],
    ["960000.01", "45", "181920.00"],
  ])(
    "selects the official bracket at cumulative taxable income %s",
    (taxable, rate, quickDeduction) => {
      expect(taxBracket(parseMoney(taxable))).toMatchObject({
        rate,
        quickDeduction,
      });
    },
  );

  it("subtracts cumulative deductions, relief, and tax already withheld", () => {
    const result = calculateCumulativeTax({
      income: parseMoney("100000.00"),
      taxExemptIncome: parseMoney("1000.00"),
      employmentMonthsYtd: 2,
      specialDeduction: parseMoney("5000.00"),
      specialAdditionalDeduction: parseMoney("3000.00"),
      otherStatutoryDeduction: parseMoney("1000.00"),
      taxRelief: parseMoney("100.00"),
      previouslyWithheld: parseMoney("1000.00"),
    });

    expect(result.taxable).toBe(parseMoney("80000.00"));
    expect(result.cumulativeTax).toBe(parseMoney("5380.00"));
    expect(result.currentTax).toBe(parseMoney("4380.00"));
    expect(result.bracket).toMatchObject({ rate: "10", quickDeduction: "2520.00" });
  });

  it("floors taxable income and this-month tax at zero", () => {
    const result = calculateCumulativeTax({
      income: parseMoney("5000.00"),
      taxExemptIncome: BigInt(0),
      employmentMonthsYtd: 1,
      specialDeduction: BigInt(0),
      specialAdditionalDeduction: BigInt(0),
      otherStatutoryDeduction: BigInt(0),
      taxRelief: BigInt(0),
      previouslyWithheld: parseMoney("100.00"),
    });

    expect(result.taxable).toBe(BigInt(0));
    expect(result.cumulativeTax).toBe(BigInt(0));
    expect(result.currentTax).toBe(BigInt(0));
  });

  it.each([0, 13])("rejects invalid employment months %s", (months) => {
    expect(() => calculateCumulativeTax({
      income: BigInt(0),
      taxExemptIncome: BigInt(0),
      employmentMonthsYtd: months,
      specialDeduction: BigInt(0),
      specialAdditionalDeduction: BigInt(0),
      otherStatutoryDeduction: BigInt(0),
      taxRelief: BigInt(0),
      previouslyWithheld: BigInt(0),
    })).toThrow("invalid_employment_months");
  });
});

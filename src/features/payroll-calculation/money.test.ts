import { describe, expect, it } from "vitest";

import {
  formatMoney,
  multiplyRate,
  parseFractionRate,
  parseMoney,
  parseRate,
} from "./money";

describe("payroll decimal arithmetic", () => {
  it("parses and formats RMB without binary floating-point arithmetic", () => {
    expect(parseMoney("0")).toBe(BigInt(0));
    expect(parseMoney("1234.5")).toBe(BigInt(123450));
    expect(parseMoney("1234.56")).toBe(BigInt(123456));
    expect(formatMoney(BigInt(123456))).toBe("1234.56");
    expect(formatMoney(BigInt(-123456))).toBe("-1234.56");
  });

  it.each(["", "-1", "1.001", "NaN", "1000000000"])(
    "rejects invalid money value %s",
    (value) => {
      expect(() => parseMoney(value)).toThrow("invalid_money");
    },
  );

  it("parses UI percentages and persisted fractional rates to parts per million", () => {
    expect(parseRate("10.5")).toBe(BigInt(105000));
    expect(parseRate("100.0000")).toBe(BigInt(1000000));
    expect(parseFractionRate("0.105000")).toBe(BigInt(105000));
    expect(parseFractionRate("1.000000")).toBe(BigInt(1000000));
  });

  it.each(["-0.1", "100.0001", "101", "1.00000.0"])(
    "rejects invalid percentage %s",
    (value) => {
      expect(() => parseRate(value)).toThrow("invalid_rate");
    },
  );

  it.each(["-0.1", "1.000001", "2", "0.0000001"])(
    "rejects invalid persisted fractional rate %s",
    (value) => {
      expect(() => parseFractionRate(value)).toThrow("invalid_fraction_rate");
    },
  );

  it("rounds percentage multiplication to the nearest cent", () => {
    expect(multiplyRate(BigInt(10005), BigInt(50000))).toBe(BigInt(500));
    expect(multiplyRate(BigInt(10010), BigInt(50000))).toBe(BigInt(501));
  });
});

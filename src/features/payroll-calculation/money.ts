const MONEY = /^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/;
const RATE = /^(?:0|[1-9]\d?|100)(?:\.\d{1,4})?$/;
const FRACTION_RATE = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/;

export function parseMoney(value: string): bigint {
  const match = MONEY.exec(value.trim());
  if (!match) {
    throw new Error("invalid_money");
  }

  return BigInt(match[1]) * BigInt(100)
    + BigInt((match[2] ?? "").padEnd(2, "0"));
}

export function formatMoney(cents: bigint): string {
  if (cents < BigInt(0)) {
    return `-${formatMoney(-cents)}`;
  }

  return `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}`;
}

export function parseRate(value: string): bigint {
  const normalized = value.trim();
  if (!RATE.test(normalized)) {
    throw new Error("invalid_rate");
  }

  const [whole, fraction = ""] = normalized.split(".");
  if (whole === "100" && /[1-9]/.test(fraction)) {
    throw new Error("invalid_rate");
  }

  return BigInt(whole) * BigInt(10_000)
    + BigInt(fraction.padEnd(4, "0"));
}

export function parseFractionRate(value: string): bigint {
  const normalized = value.trim();
  if (!FRACTION_RATE.test(normalized)) {
    throw new Error("invalid_fraction_rate");
  }

  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * BigInt(1_000_000)
    + BigInt(fraction.padEnd(6, "0"));
}

function requireNormalizedRate(partsPerMillion: bigint): void {
  if (partsPerMillion < BigInt(0) || partsPerMillion > BigInt(1_000_000)) {
    throw new Error("invalid_normalized_rate");
  }
}

export function formatFractionRate(partsPerMillion: bigint): string {
  requireNormalizedRate(partsPerMillion);
  const whole = partsPerMillion / BigInt(1_000_000);
  const fraction = String(partsPerMillion % BigInt(1_000_000)).padStart(6, "0");
  return `${whole}.${fraction}`;
}

export function formatRatePercent(partsPerMillion: bigint): string {
  requireNormalizedRate(partsPerMillion);
  const whole = partsPerMillion / BigInt(10_000);
  const fraction = String(partsPerMillion % BigInt(10_000))
    .padStart(4, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export function multiplyRate(
  cents: bigint,
  partsPerMillion: bigint,
): bigint {
  return (cents * partsPerMillion + BigInt(500_000)) / BigInt(1_000_000);
}

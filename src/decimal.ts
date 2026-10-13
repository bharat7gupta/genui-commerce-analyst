export type ExactDecimal = Readonly<{ coefficient: bigint; scale: number }>;

// DuckDB DECIMAL values are strings. Preserve every digit with BigInt;
// numeric inputs are accepted only when they are safe integers.
export function parseExactDecimal(value: unknown): ExactDecimal | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    value = String(value);
  }
  if (typeof value !== "string" || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const negative = value.startsWith("-");
  const unsigned = value.replace(/^[+-]/, "");
  const [integer = "", fraction = ""] = unsigned.split(".");
  const significantFraction = fraction.replace(/0+$/, "");
  return {
    coefficient: BigInt(`${negative ? "-" : ""}${integer}${significantFraction}`),
    scale: significantFraction.length,
  };
}

export function decimalToCents(value: unknown): bigint {
  const decimal = parseExactDecimal(value);
  if (decimal === null || decimal.scale > 2) {
    throw new Error("Expected an exact decimal with at most two fractional digits");
  }
  return decimal.coefficient * 10n ** BigInt(2 - decimal.scale);
}

export function formatHundredths(value: bigint): string {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? "-" : ""}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, "0")}`;
}

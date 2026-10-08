export type NumericalVerdict = Readonly<{ pass: boolean; reason: string }>;

export type ScalarExpectation = Readonly<{ field: string; amount: string }>;

/** Grades rows only; does not call a provider or execute a query. */
export function gradeScalarNumericalResult(
  rows: unknown,
  expected: ScalarExpectation,
): NumericalVerdict {
  const expectedDecimal = exactDecimal(expected.amount);
  if (expectedDecimal === null) {
    throw new Error("Expected amount must be a plain decimal string");
  }
  if (!Array.isArray(rows)) {
    return { pass: false, reason: "Expected an array of result rows" };
  }
  if (rows.length !== 1) {
    return { pass: false, reason: `Expected exactly one row; received ${rows.length}` };
  }
  const row: unknown = rows[0];
  if (
    typeof row !== "object" || row === null || Array.isArray(row) ||
    !Object.hasOwn(row, expected.field)
  ) {
    return { pass: false, reason: `Missing expected field: ${expected.field}` };
  }
  const value: unknown = Reflect.get(row, expected.field);
  const actualDecimal = exactDecimal(value);
  if (actualDecimal === null) {
    return {
      pass: false,
      reason: `${expected.field} must be a plain decimal string or safe integer`,
    };
  }
  if (actualDecimal !== expectedDecimal) {
    return {
      pass: false,
      reason: `Expected ${expected.field} = ${expected.amount}; received ${String(value)}`,
    };
  }
  return { pass: true, reason: `${expected.field} equals ${expected.amount} exactly` };
}

// DuckDB DECIMAL values are strings. BigInt preserves all digits, with no
// rounding: normalize leading integer zeros and trailing fractional zeros.
// Numeric inputs are accepted only when they are safe integers.
function exactDecimal(value: unknown): string | null {
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
  const coefficient = BigInt(`${negative ? "-" : ""}${integer}${significantFraction}`);
  return `${coefficient}:${significantFraction.length}`;
}

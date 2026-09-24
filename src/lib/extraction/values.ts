export type Parsed<T> = { ok: true; value: T } | { ok: false; why: string };

// Digits either plain ("1248") or grouped in exact threes ("1,248"); "12,48" matches neither.
const MONEY_PATTERN = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?:\s*\/\s*([a-zA-Z]+))?$/;
// Period as the thousands separator, comma as the decimal: the European style we refuse.
const EUROPEAN_MONEY_PATTERN = /^\$?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const QUANTITY_PATTERN = /^(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/;
const PERCENT_PATTERN = /(\d+(?:\.\d+)?)\s*%/;

export function parseMoney(raw: string): Parsed<{ cents: number; per: string | null }> {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, why: "is empty" };
  }
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return { ok: false, why: "is in brackets, which usually means a credit and we don't infer that" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, why: "is negative, which we don't handle" };
  }
  if (EUROPEAN_MONEY_PATTERN.test(trimmed)) {
    return { ok: false, why: "uses a comma as the decimal separator" };
  }

  const match = MONEY_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, why: "isn't a plain money amount" };
  }

  const [, dollarsDigits, centsDigits, per] = match;
  const dollars = Number(dollarsDigits.replace(/,/g, ""));
  const cents = dollars * 100 + Number(centsDigits ?? "0");
  return { ok: true, value: { cents, per: per ?? null } };
}

export function parseQuantity(raw: string): Parsed<number> {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { ok: false, why: "is empty" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, why: "is negative, which we don't handle" };
  }

  const match = QUANTITY_PATTERN.exec(trimmed);
  if (!match) {
    return { ok: false, why: "isn't a plain number" };
  }

  const [, wholeDigits, decimalPart] = match;
  const value = Number(wholeDigits.replace(/,/g, "") + (decimalPart ?? ""));
  return { ok: true, value };
}

export function parsePercent(label: string): number | null {
  const match = PERCENT_PATTERN.exec(label);
  return match ? Number(match[1]) : null;
}

export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const grouped = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsStr = remainder.toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${grouped}.${centsStr}`;
}

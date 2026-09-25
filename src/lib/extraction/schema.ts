import { z } from "zod";

export const Evidence = z.object({
  page: z.number().int().min(1),
  sourceText: z.string().min(1), // the whole text line, runs joined by single spaces
});

export const SourcedNumber = z.object({
  value: z.number(),
  raw: z.string().min(1),
  evidence: Evidence,
});

export const SourcedMoney = SourcedNumber.extend({
  per: z.string().nullable(), // "carton" for "$74.00 /carton"
});

export const SourcedText = z.object({
  label: z.string(),
  raw: z.string().min(1),
  evidence: Evidence,
});

export const Measurement = SourcedNumber.extend({
  label: z.string(), // the column it came from, e.g. "Weight"
  unit: z.string(),
  basis: z.enum(["line", "each"]), // for the whole line, or for each unit of the quantity
});

export const LineItem = z.object({
  id: z.string(), // "p1-l3"
  page: z.number().int().min(1),
  evidence: Evidence,
  code: z.string().nullable(),
  description: z.string(),
  quantity: SourcedNumber.nullable(),
  unit: z.string().nullable(),
  unitPrice: SourcedMoney.nullable(),
  amount: SourcedMoney.nullable(),
  otherColumns: z.array(SourcedText), // every non-core column as written, e.g. Weight
  measurements: z.array(Measurement), // other-column cells we could read as a number and unit
  warningIds: z.array(z.string()),
});

export const FindingCode = z.enum([
  "NO_TEXT_LAYER",     // page is an image
  "PAGE_UNREADABLE",   // parser failed on this page
  "NO_TABLE_FOUND",    // text but no recognisable line-item table
  "ROW_UNPARSEABLE",   // row doesn't fit the table's columns
  "VALUE_UNPARSEABLE", // a cell in a number format we won't guess at
  "NOT_STATED",        // the document never gives this value
  "AMBIGUOUS",         // stated, but its meaning is unclear
  "CONTRADICTION",     // two statements disagree
  "DOES_NOT_ADD_UP",   // arithmetic between stated values fails
  "NOT_AN_INVOICE_PAGE",
  "MISSING_SECTION",
]);

export const Finding = z.object({
  id: z.string(),
  code: FindingCode,
  scope: z.enum(["document", "page", "line", "field"]),
  page: z.number().int().nullable(),
  lineItemId: z.string().nullable(),
  subject: z.string(),              // "Total (incl GST)", "Number of cartons", "Page 4"
  reason: z.string(),               // plain English, with the specific values
  evidence: z.array(Evidence),      // empty for NO_TEXT_LAYER, 2+ for CONTRADICTION
  calculation: z.string().nullable(), // "$1,270.00 + $190.50 = $1,460.50"
});

export const Totals = z.object({
  subtotal: SourcedMoney.nullable(),
  gst: SourcedMoney.extend({ ratePercent: z.number().nullable() }).nullable(),
  total: SourcedMoney.extend({ includesGst: z.boolean().nullable() }).nullable(),
});

export const PageSummary = z.object({
  page: z.number().int().min(1),
  status: z.enum(["read", "refused"]),
  title: z.string().nullable(),
  lineItemCount: z.number().int(),
});

export const ExtractionResult = z.object({
  fileName: z.string(),
  pageCount: z.number().int(),
  outcome: z.enum(["complete", "partial", "nothing_extracted"]),
  pages: z.array(PageSummary),
  fields: z.array(SourcedText), // Document No, Date, Bill to, Job ref...
  lineItems: z.array(LineItem),
  totals: Totals,
  refusals: z.array(Finding), // things we did not extract
  warnings: z.array(Finding), // things we extracted but a person should check
});

export const ErrorCode = z.enum([
  "NO_FILE", "EMPTY_FILE", "NOT_A_PDF", "FILE_TOO_LARGE",
  "PDF_ENCRYPTED", "PDF_CORRUPT", "INTERNAL",
]);

export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string() }),
});

export type Evidence = z.infer<typeof Evidence>;
export type SourcedNumber = z.infer<typeof SourcedNumber>;
export type SourcedMoney = z.infer<typeof SourcedMoney>;
export type SourcedText = z.infer<typeof SourcedText>;
export type Measurement = z.infer<typeof Measurement>;
export type LineItem = z.infer<typeof LineItem>;
export type FindingCode = z.infer<typeof FindingCode>;
export type Finding = z.infer<typeof Finding>;
export type Totals = z.infer<typeof Totals>;
export type PageSummary = z.infer<typeof PageSummary>;
export type ExtractionResult = z.infer<typeof ExtractionResult>;
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ErrorBody = z.infer<typeof ErrorBody>;

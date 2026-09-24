import type { Row } from "./rows";
import { matchTotalsRow } from "./document";
import { parseMoney, parseQuantity } from "./values";
import type { Evidence, Finding, LineItem, SourcedMoney, SourcedNumber, SourcedText } from "./schema";

export type Column = {
  label: string;
  x: number;
  role: "code" | "description" | "qty" | "unit" | "unitPrice" | "amount" | "other";
};

export type TableParse = {
  header: Row;
  columns: Column[];
  lineItems: LineItem[];
  rowFindings: Finding[];
  headerIndex: number;
  endIndex: number;
};

const DASHED_ROW = /^[-_=]+$/;
// A footer label line: "Subtotal:", "GST (15%):", "Warehouse notes: ..."
const LABEL_ROW = /^[A-Za-z][A-Za-z0-9 ()%]*:/;

const ROLE_BY_LABEL: Record<string, Column["role"]> = {
  code: "code",
  description: "description",
  qty: "qty",
  quantity: "qty",
  unit: "unit",
  uom: "unit",
  "unit price": "unitPrice",
  price: "unitPrice",
  rate: "unitPrice",
  amount: "amount",
  "line total": "amount",
  total: "amount",
};

const FIELD_LABELS = { quantity: "Quantity", unitPrice: "Unit price", amount: "Amount" } as const;
type MoneyField = "unitPrice" | "amount";

function roleForLabel(label: string): Column["role"] {
  const normalised = label.trim().replace(/\.$/, "").replace(/\s*\([^)]*\)$/, "").toLowerCase();
  return ROLE_BY_LABEL[normalised] ?? "other";
}

function isHeaderRow(row: Row): boolean {
  const roles = row.items.map((item) => roleForLabel(item.str));
  return roles.includes("description") && roles.includes("qty");
}

function buildColumns(header: Row): Column[] {
  return header.items.map((item) => ({
    label: item.str.trim(),
    x: item.x,
    role: roleForLabel(item.str),
  }));
}

// Greatest column x <= item.x + 2; falls through to the first column when nothing qualifies.
function columnIndexForX(columns: Column[], x: number): number {
  let best = 0;
  let bestX = -Infinity;
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].x <= x + 2 && columns[i].x > bestX) {
      best = i;
      bestX = columns[i].x;
    }
  }
  return best;
}

function buildCells(row: Row, columns: Column[]): string[] {
  const cells = columns.map(() => "");
  for (const item of row.items) {
    const idx = columnIndexForX(columns, item.x);
    const text = item.str.trim();
    cells[idx] = cells[idx] === "" ? text : `${cells[idx]} ${text}`;
  }
  return cells;
}

export function hasDescriptionAndQty(row: Row, columns: Column[]): boolean {
  const cells = buildCells(row, columns);
  const descIdx = columns.findIndex((c) => c.role === "description");
  const qtyIdx = columns.findIndex((c) => c.role === "qty");
  return Boolean(cells[descIdx]) && Boolean(cells[qtyIdx]);
}

function rowUnparseableFinding(page: number, n: number, row: Row, missingDescription: boolean, missingQty: boolean): Finding {
  const missing = missingDescription && missingQty ? "description or quantity" : missingDescription ? "description" : "quantity";
  return {
    id: `row:p${page}-l${n}`,
    code: "ROW_UNPARSEABLE",
    scope: "line",
    page,
    lineItemId: null,
    subject: `Row ${n} on page ${page}`,
    reason: `This row has no ${missing}, so we didn't treat it as a line item.`,
    evidence: [{ page, sourceText: row.text }],
    calculation: null,
  };
}

function valueUnparseableFinding(
  page: number,
  lineItemId: string,
  field: keyof typeof FIELD_LABELS,
  raw: string,
  why: string,
  row: Row,
  subjectName: string,
): Finding {
  const label = FIELD_LABELS[field];
  return {
    id: `value:${lineItemId}:${field}`,
    code: "VALUE_UNPARSEABLE",
    scope: "field",
    page,
    lineItemId,
    subject: `${label} for ${subjectName}`,
    reason: `The ${label.toLowerCase()} "${raw}" ${why}, so we didn't use it.`,
    evidence: [{ page, sourceText: row.text }],
    calculation: null,
  };
}

function parseMoneyCell(
  cells: string[],
  columns: Column[],
  field: MoneyField,
  page: number,
  lineItemId: string,
  row: Row,
  subjectName: string,
  findings: Finding[],
): SourcedMoney | null {
  const idx = columns.findIndex((c) => c.role === field);
  if (idx === -1 || !cells[idx]) return null;

  const raw = cells[idx];
  const parsed = parseMoney(raw);
  if (!parsed.ok) {
    findings.push(valueUnparseableFinding(page, lineItemId, field, raw, parsed.why, row, subjectName));
    return null;
  }
  return { value: parsed.value.cents / 100, raw, per: parsed.value.per, evidence: { page, sourceText: row.text } };
}

function buildLineItem(row: Row, columns: Column[], page: number, n: number): { item: LineItem | null; findings: Finding[] } {
  const cells = buildCells(row, columns);
  const descIdx = columns.findIndex((c) => c.role === "description");
  const qtyIdx = columns.findIndex((c) => c.role === "qty");
  const description = cells[descIdx];
  const qtyRaw = cells[qtyIdx];

  if (!description || !qtyRaw) {
    return { item: null, findings: [rowUnparseableFinding(page, n, row, !description, !qtyRaw)] };
  }

  const id = `p${page}-l${n}`;
  const evidence: Evidence = { page, sourceText: row.text };
  const findings: Finding[] = [];

  const codeIdx = columns.findIndex((c) => c.role === "code");
  const code = codeIdx !== -1 && cells[codeIdx] ? cells[codeIdx] : null;
  const subjectName = code ?? description;

  const unitIdx = columns.findIndex((c) => c.role === "unit");
  const unit = unitIdx !== -1 && cells[unitIdx] ? cells[unitIdx] : null;

  let quantity: SourcedNumber | null = null;
  const qtyParsed = parseQuantity(qtyRaw);
  if (qtyParsed.ok) {
    quantity = { value: qtyParsed.value, raw: qtyRaw, evidence };
  } else {
    findings.push(valueUnparseableFinding(page, id, "quantity", qtyRaw, qtyParsed.why, row, subjectName));
  }

  const unitPrice = parseMoneyCell(cells, columns, "unitPrice", page, id, row, subjectName, findings);
  const amount = parseMoneyCell(cells, columns, "amount", page, id, row, subjectName, findings);

  const otherColumns: SourcedText[] = columns
    .map((col, idx) => ({ col, idx }))
    .filter(({ col, idx }) => col.role === "other" && cells[idx])
    .map(({ col, idx }) => ({ label: col.label, raw: cells[idx], evidence }));

  const item: LineItem = {
    id,
    page,
    evidence,
    code,
    description,
    quantity,
    unit,
    unitPrice,
    amount,
    otherColumns,
    warningIds: [],
  };

  return { item, findings };
}

export function parseTable(rows: Row[], page: number): TableParse | null {
  const headerIndex = rows.findIndex(isHeaderRow);
  if (headerIndex === -1) return null;

  const header = rows[headerIndex];
  const columns = buildColumns(header);

  const dataRowIndices: number[] = [];
  for (let i = headerIndex + 1; i < rows.length; i++) {
    if (!DASHED_ROW.test(rows[i].text)) dataRowIndices.push(i);
  }

  if (dataRowIndices.length === 0) {
    return { header, columns, lineItems: [], rowFindings: [], headerIndex, endIndex: rows.length };
  }

  const baseline = header.y - rows[dataRowIndices[0]].y;
  const tableRowIndices: number[] = [];
  let prevY: number | null = null;
  let endIndex = rows.length;

  for (const idx of dataRowIndices) {
    const row = rows[idx];
    const labelled = LABEL_ROW.test(row.items[0].str.trim());
    const farBelow = prevY !== null && prevY - row.y > 1.5 * baseline;
    // A colon or a gap can't end the table on a row that reads as a line item, or that row would vanish.
    if (matchTotalsRow(row) || ((labelled || farBelow) && !hasDescriptionAndQty(row, columns))) {
      endIndex = idx;
      break;
    }
    tableRowIndices.push(idx);
    prevY = row.y;
  }

  const lineItems: LineItem[] = [];
  const rowFindings: Finding[] = [];

  tableRowIndices.forEach((idx, position) => {
    const { item, findings } = buildLineItem(rows[idx], columns, page, position + 1);
    if (item) lineItems.push(item);
    rowFindings.push(...findings);
  });

  return { header, columns, lineItems, rowFindings, headerIndex, endIndex };
}

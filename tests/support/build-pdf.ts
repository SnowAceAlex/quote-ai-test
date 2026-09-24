import { degrees, PDFDocument, StandardFonts } from "pdf-lib";

export type Cell = { x: number; text: string };
export type Line = { cells: Cell[]; gap?: number };
export type PageSpec = { lines: Line[]; rotate?: number } | { image: true } | { blank: true };
export type Column = { x: number; label: string };

// Same geometry as the Ironbark samples: left-aligned cells, 17pt rows, footers ~35pt below.
export const LEFT = 42.5;
export const STANDARD_COLUMNS: Column[] = [
  { x: 42.5, label: "Code" },
  { x: 93.5, label: "Description" },
  { x: 320.3, label: "Qty" },
  { x: 382.7, label: "Unit" },
  { x: 440, label: "Unit Price" },
  { x: 501.7, label: "Amount" },
];

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

export const text = (value: string, gap?: number): Line => ({ cells: [{ x: LEFT, text: value }], gap });
export const totalLine = (label: string, value: string, gap?: number): Line => ({
  cells: [
    { x: 337, text: label },
    { x: 501.7, text: value },
  ],
  gap,
});

type Invoice = {
  company?: string;
  title?: string;
  fields?: Array<[string, string]>;
  columns?: Column[];
  rows: Array<Array<string | null>>;
  totals?: Array<[string, string]>;
  notes?: string[];
};

export function invoice(spec: Invoice): PageSpec {
  const columns = spec.columns ?? STANDARD_COLUMNS;
  const lines: Line[] = [text(spec.company ?? "Acme Trade Supplies Ltd", 0), text(spec.title ?? "Tax Invoice", 20)];
  (spec.fields ?? [["Document No", "AC-1001"]]).forEach(([k, v], i) => lines.push(text(`${k}: ${v}`, i === 0 ? 20 : 14)));
  lines.push({ cells: columns.map((c) => ({ x: c.x, text: c.label })), gap: 36 });
  lines.push({ cells: [{ x: LEFT, text: "-".repeat(118) }], gap: 5.67 });
  spec.rows.forEach((cells) =>
    lines.push({ cells: cells.flatMap((t, c) => (t ? [{ x: columns[c].x, text: t }] : [])) }),
  );
  (spec.totals ?? []).forEach(([label, value], i) => lines.push(totalLine(label, value, i === 0 ? 35 : 17)));
  (spec.notes ?? []).forEach((note, i) => lines.push(text(note, i === 0 ? 35 : 17)));
  return { lines };
}

export async function buildPdf(pages: PageSpec[]): Promise<Uint8Array<ArrayBuffer>> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const spec of pages) {
    const page = doc.addPage([595.28, 841.89]);
    if ("image" in spec) {
      const png = await doc.embedPng(Buffer.from(ONE_PIXEL_PNG, "base64"));
      page.drawImage(png, { x: 40, y: 400, width: 500, height: 400 });
      continue;
    }
    if ("blank" in spec) continue;
    if (spec.rotate) page.setRotation(degrees(spec.rotate));
    let y = 785;
    for (const line of spec.lines) {
      y -= line.gap ?? 17;
      for (const cell of line.cells) page.drawText(cell.text, { x: cell.x, y, size: 9, font });
    }
  }
  return new Uint8Array(await doc.save());
}

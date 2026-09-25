# Supplier document reader

Insta Quote AI take-home (Full Stack Engineer).

- **Part A:** `POST /api/extract` takes a PDF and returns JSON. The JSON lists the line items it could extract, each carrying the page and the exact source line, and a separate list of everything it refused to extract, with the reason.
- **Part B:** a single page that uploads a file to Part A and shows the result. Refusals come first, in plain language.

**Live:** _deployment URL goes here_ · Stack: Next.js 16, TypeScript, zod, `unpdf` (pdf.js), Vitest, deployed on Vercel.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:3000, with "Try a sample" buttons for the six PDFs
pnpm test         # 253 unit/integration tests
pnpm e2e          # 12 browser tests against a production build (uses installed Edge; E2E_CHANNEL=chrome to switch)
pnpm typecheck && pnpm lint && pnpm build
```

```bash
curl -F file=@public/samples/IB-56150.pdf http://localhost:3000/api/extract
```

## What happens to the six samples

| File | What's wrong with it | What the service does |
|---|---|---|
| IB-55871 | Nothing | 4 lines, subtotal, GST and total, all checked. `complete`, no refusals. |
| IB-55902 | A scanned image with no text layer | Refuses page 1: "a scanned image with no readable text". Returns HTTP 200 with `nothing_extracted`, not an error. |
| IB-56010 | No Amount column and no totals. Weights mix kg and g, and only one says "total". Labelled Tax Invoice but shows no GST. | Extracts quantities and unit prices, keeping the price basis (`$74.00 /carton`). Reads `640g total` as 640 g for the whole line. Refuses the other three weights one line at a time, because "20kg" for 3 cartons could mean either. Also refuses line amounts, GST and total weight. It never multiplies anything out. |
| IB-56088 | Says "9 cartons dispatched" and "11 cartons picked" | Refuses the carton count and quotes both lines. Keeps the stated `$2,050.00` total, but refuses GST because it can't tell whether the total includes GST. |
| IB-56150 | Total (incl GST) is $1,501.80, but $1,270.00 + $190.50 = $1,460.50 | Keeps the subtotal and GST. Refuses the total and shows the calculation and all three source lines. |
| IB-STMT47 | 8 pages. Page 4 is a scan. Pages 5–8 aren't invoices but still list priced lines. No totals. | 21 lines from the 7 readable pages. Refuses only page 4. Warns that invoice 4 of 4 is missing and that pages 5–8 may repeat or offset invoice lines. Refuses a document total. |

`tests/samples.test.ts` pins every row of this table. It also checks the evidence rule on all six files: every extracted value's `raw` text appears in its `sourceText`, and every `sourceText` is a real line on the page it names.

## Testing beyond the samples

- **Edge cases on generated PDFs** (`tests/edge-cases.test.ts`). `pdf-lib` builds invoices with the samples' geometry, then varies one thing at a time: header synonyms, no Code column, a discount column, credit lines, `approx 20`, European number formats, blank amounts, wrong line maths, wrong subtotal and GST, 10% GST, `Total (excl GST)`, unknown labels like `Amount due:`, conflicting box counts, tables continued across pages (with and without a repeated header), blank and scanned pages mixed in, per-invoice subtotals, rotated pages, a 60-page document. Every result also goes through the evidence check.
- **Corruption fuzz** (`tests/corruption.test.ts`). Seeded random byte flips and truncations of the six samples. The rule: either a typed load error (`PDF_CORRUPT` / `PDF_ENCRYPTED`) or a result that passes the evidence check. A 900-mutant run produced 403 load errors, 361 fully refused, 133 partial and 3 complete, with no crash and no untraceable value. CI runs 90.
- **API** (`route.test.ts`). Missing file, wrong form field, JSON body, empty file, over 4 MB, text posing as a PDF, corrupt PDF, password-protected PDF, a real PDF with a `.jpg` name.
- **Browser** (`e2e/upload.spec.ts`). Clicks every sample and checks what a person sees. Forces each failure path (client-side type check, server 415, network down, Vercel's HTML 413, a malformed reply, cancel), and asserts the page never says "something went wrong".

Writing these found three real bugs, now fixed:
- a discount column made correct lines look wrong;
- a figure labelled `Amount due:` vanished without a refusal;
- the carton refusal repeated its source lines inside the reason.

## The contract

`src/lib/extraction/schema.ts` defines the contract as zod schemas. Both the API and the UI validate against it.

- **`lineItems[]`:** each number is `{ value, raw, evidence: { page, sourceText } }`. `raw` is the text exactly as printed.
- **`measurements`:** cells in extra columns that read as a number with a unit (`20kg`, `3m each`, `2.5 m²`), whatever the column is called. A cell is only kept when it says what it covers, or the header does (`total` means the whole line; `each`, `per …`, `/carton` mean each unit). Otherwise that cell is refused on its own. `otherColumns` keeps every extra cell exactly as written.
- **`totals`:** subtotal, GST (with the rate read from its label, never hard-coded) and total. A figure that fails a check is **removed** from here and moved into `refusals`, so everything left can be used without reading the refusals first.
- **`refusals[]`:** what wasn't extracted. Each entry has a code, a subject, a plain-English reason, the source lines and, for arithmetic, the `calculation`.
- **`warnings[]`:** extracted, but a person should check it. Line items point to their warnings through `warningIds`.
- **Refusals are HTTP 200.** 4xx/5xx is only for uploads that can't be processed at all: no file, empty, not a PDF, over 4 MB, password-protected, corrupt. Each has its own code and message.

## How it's built

`src/lib/extraction/` has no framework code, so it runs in plain Node tests:

- **Load:** `pdf.ts` loads each page lazily.
- **Rows:** `rows.ts` groups text items into lines.
- **Table:** `table.ts` finds the header row (`Description` + `Qty`), maps cells to columns by x position and builds line items.
- **Header and totals:** `document.ts` reads the title, header fields and totals rows.
- **Rules:** `rules/` holds the checks. `arithmetic` does qty × price, lines → subtotal → GST → total. `contradictions` finds counts stated twice differently. `completeness` covers things the document never states. `sections` covers multi-invoice statements.
- **Containment:** `extract.ts` reads each page inside its own try/catch, so a scanned or broken page becomes a page refusal and the other pages still extract.

On the UI side, `src/lib/client/extract-client.ts` never throws, and turns every way a request can fail into a specific title and explanation:

- the server's own error message
- Vercel's non-JSON 413 page, rewritten as "this file is 6.2 MB, the limit is 4 MB"
- a 504 timeout
- a network failure
- a reply that doesn't match the contract

A test checks that none of these messages says "something went wrong".

## The hardest decision

**No LLM in the extraction path.** For a product called Insta Quote *AI*, the obvious move was to send the PDF to a model and ask for JSON. I didn't:

- **Why:** the hard rule is that every number must point to its source. A model can paraphrase a line, normalise `$1,248.00` to `1248`, or invent a value that looks plausible, and I would then need a deterministic check that each value really appears on the page. Once that check exists, it does most of the work anyway.
- **What I built instead:** the whole path is deterministic. Evidence is exact by construction, and the behaviour is fully testable.
- **The cost:** it only understands layouts it has rules for. An unfamiliar layout fails closed (`NO_TABLE_FOUND`, or rows refused) rather than being guessed at. I think that's the right direction for the failure, but it means lower recall on documents I haven't seen.

**Close second: warn or refuse on IB-STMT47 pages 5–8.** Their lines are stated plainly, so refusing them would throw away real data. But "Credit Note Reference" lines with positive amounts could be credits, and a "Signed Delivery Confirmation" could duplicate invoiced lines.

I extract them, attach a page-level warning to every one of those lines, and never add up a statement total. If the product were pricing directly from this output, I'd lean toward refusing them instead.

## Where I'm not confident

- **I've seen one supplier.** All six samples come from the same generator. Table detection relies on a header row containing `Description` and `Qty`, and on left-aligned columns. Right-aligned numbers under a narrow header can land in the wrong column. This usually fails safe (the value doesn't parse and becomes a refusal), but not always.
- **The totals vocabulary is a whitelist.** It recognises `Subtotal`, `GST (15%)`, `Total`, `Total (incl GST)`, `Total due` and a few variants. Any other `Label: $amount` row (e.g. `Amount due: $500.00`) is refused as "not recognised" rather than used. That's safe, but it means an unusual invoice layout comes back mostly refused.
- **Discounts.** On a table with a discount column, the qty × price check is skipped entirely, because I don't know how each supplier applies the discount.
- **The rules are narrower than their names.** The contradiction rule only looks for counts of cartons, boxes, pallets, packages, parcels and bundles. Measurement cells are recognised by a fixed list of units (kg, g, t, lb, mm, cm, m, km, L, mL, m², m³). Section detection relies on page titles that say "Invoice N of M".
- **No OCR.** Scanned pages are refused. That's correct under the rules, but it means a scanned invoice returns nothing.
- **Structural assumptions.** The first two lines of a page are assumed to be the company name and the document title. A line's evidence text is its text runs joined by single spaces. That matches the visible line, but it isn't byte-for-byte what's in the PDF content stream.
- **A crash in a rule fails the whole request (500)** instead of being contained per rule. I chose this deliberately, because a rule that crashed must not look like a check that passed. Even so, it means one bug can hide an otherwise good result.
- **Currency.** Values keep their `$` symbol. The service never claims NZD or AUD, even though a 15% GST suggests NZ.
- **The UI** is covered by the client tests and 12 Playwright tests in Edge. It hasn't been tested in Safari or Firefox, or audited for accessibility beyond sensible defaults.

## With three more days

1. **Real documents from more suppliers**, turned into fixtures. Widen table detection (right-aligned columns, header synonyms, tables that continue across pages) and the totals vocabulary against what they show, rather than guessing.
2. **Show the evidence on the page.** Render the PDF page and highlight the bounding box of the line a value came from. pdf.js already gives the coordinates. For someone checking a quote, that beats a quoted string.
3. **OCR for scanned pages, gated.** Values would be marked `source: "ocr"`, and a row would be accepted only when its own arithmetic checks out (qty × price = amount). Everything else stays refused.
4. **An LLM fallback for unknown layouts,** used only to propose a table mapping. Any value it returns that isn't found verbatim in that page's text is dropped into refusals.
5. **Move closer to the team's stack:** a tRPC procedure over the same engine, and Supabase to keep uploads and results so a person can mark refusals as resolved.

## How this was made

- **Tools:** built with Claude Code as the coding agent. The phase plan is in `docs/plans/`. Each phase is a branch merged into `main`, so the history shows the order the work was done in.
- **Review:** in Phase 1, each task was reviewed separately, then the whole branch was reviewed. Those reviews caught real bugs:
  - `Total cartons: 11` was being read as a $11 total.
  - A `GST No:` registration number was being read as a GST amount.
  - A data row containing `2:1` could end the table and silently drop the rows after it.
  
  Each of these now has a regression test. After that I switched to a leaner process to fit the time budget.

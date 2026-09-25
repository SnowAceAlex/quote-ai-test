import type { ExtractionResult, SourcedMoney } from "@/lib/extraction/schema";
import { FindingCard } from "./finding-card";
import { LineItemsTable } from "./line-items-table";
import { OtherColumnsTables } from "./other-columns-tables";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function summary(r: ExtractionResult): string {
  const lines = plural(r.lineItems.length, "line item");
  if (r.outcome === "nothing_extracted") return "We couldn't extract any line items from this document. Here's why:";
  if (r.outcome === "partial") {
    return `We extracted ${lines}, but there ${r.refusals.length === 1 ? "is 1 thing" : `are ${r.refusals.length} things`} we couldn't extract. They're listed first.`;
  }
  return `We extracted ${lines}. Every figure below shows where it came from.`;
}

function TotalRow({ label, value }: { label: string; value: SourcedMoney | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
      <dt className="text-sm text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="text-right">
        {value ? (
          <>
            <span className="font-medium tabular-nums">{value.raw}</span>
            <span className="block text-xs text-zinc-500">
              Page {value.evidence.page} · <q className="font-mono">{value.evidence.sourceText}</q>
            </span>
          </>
        ) : (
          <span className="text-sm italic text-zinc-400 dark:text-zinc-500">not reported</span>
        )}
      </dd>
    </div>
  );
}

export function ResultView({ result }: { result: ExtractionResult }) {
  const { totals } = result;
  const hasTotals = totals.subtotal || totals.gst || totals.total || result.lineItems.length > 0;

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">{result.fileName}</h2>
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">{summary(result)}</p>
        {result.fields.length > 0 && (
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {result.fields.map((f) => (
              <div key={`${f.label}:${f.raw}`} className="contents">
                <dt className="text-zinc-500">{f.label}</dt>
                <dd title={`Page ${f.evidence.page}: ${f.evidence.sourceText}`}>{f.raw}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {result.pages.map((p) => (
            <span
              key={p.page}
              className={`rounded px-2 py-0.5 text-xs ${
                p.status === "read"
                  ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              }`}
            >
              Page {p.page}: {p.status === "read" ? plural(p.lineItemCount, "line") : "couldn't read"}
            </span>
          ))}
        </div>
      </section>

      {result.refusals.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">What we couldn&apos;t extract</h2>
          {result.refusals.map((f) => (
            <FindingCard key={f.id} finding={f} tone="refusal" />
          ))}
        </section>
      )}

      {result.warnings.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Worth checking</h2>
          {result.warnings.map((f) => (
            <FindingCard key={f.id} finding={f} tone="warning" />
          ))}
        </section>
      )}

      {result.lineItems.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Line items</h2>
          <p className="text-sm text-zinc-500">Click a row to see the exact line it was read from.</p>
          <LineItemsTable items={result.lineItems} refusals={result.refusals} />
        </section>
      )}

      <OtherColumnsTables items={result.lineItems} refusals={result.refusals} />

      {hasTotals && (
        <section>
          <h2 className="text-lg font-semibold">Totals as stated</h2>
          <dl className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800">
            <TotalRow label="Subtotal" value={totals.subtotal} />
            <TotalRow label={totals.gst?.ratePercent ? `GST (${totals.gst.ratePercent}%)` : "GST"} value={totals.gst} />
            <TotalRow label={totals.total?.includesGst ? "Total (incl GST)" : "Total"} value={totals.total} />
          </dl>
        </section>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-zinc-500">Show raw JSON</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
          {JSON.stringify(result, null, 2)}
        </pre>
      </details>
    </div>
  );
}

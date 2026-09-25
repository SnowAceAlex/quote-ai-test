import { slug, unitWord } from "@/lib/extraction/measurements";
import type { Finding, LineItem } from "@/lib/extraction/schema";

function ColumnTable({ label, items, refusals }: { label: string; items: LineItem[]; refusals: Finding[] }) {
  const rows = items.flatMap((item) => {
    const cell = item.otherColumns.find((c) => c.label === label);
    if (!cell) return [];
    const measurement = item.measurements.find((m) => m.label === label);
    const refusal = refusals.find((r) => r.id === `measure:${item.id}:${slug(label)}`);
    return [{ item, cell, measurement, refusal }];
  });
  const isMeasure = rows.some((r) => r.measurement || r.refusal);

  return (
    <section className="space-y-3">
      <h3 className="font-medium">{label}</h3>
      {!isMeasure && (
        <p className="text-sm text-zinc-500">Shown as written. This column isn&apos;t read as a number.</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">As written</th>
              {isMeasure && <th className="px-3 py-2 font-medium">Read as</th>}
              {isMeasure && <th className="px-3 py-2 font-medium">Covers</th>}
              <th className="px-3 py-2 font-medium">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map(({ item, cell, measurement, refusal }) => (
              <tr key={item.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{item.code ?? "—"}</td>
                <td className="px-3 py-2">{item.description}</td>
                <td className="px-3 py-2 text-right tabular-nums">{item.quantity?.raw ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{cell.raw}</td>
                {isMeasure && (
                  <td className="px-3 py-2 tabular-nums">
                    {measurement ? (
                      `${measurement.value} ${measurement.unit}`
                    ) : (
                      <a
                        href={refusal ? `#${refusal.id}` : undefined}
                        className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        not used
                      </a>
                    )}
                  </td>
                )}
                {isMeasure && (
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">
                    {measurement ? (measurement.basis === "line" ? "whole line" : `each ${unitWord(item)}`) : "unclear"}
                  </td>
                )}
                <td className="px-3 py-2 whitespace-nowrap text-zinc-500">p. {cell.evidence.page}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function OtherColumnsTables({ items, refusals }: { items: LineItem[]; refusals: Finding[] }) {
  const labels = [...new Set(items.flatMap((i) => i.otherColumns.map((c) => c.label)))];
  if (labels.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Other columns</h2>
      {labels.map((label) => (
        <ColumnTable key={label} label={label} items={items} refusals={refusals} />
      ))}
    </section>
  );
}

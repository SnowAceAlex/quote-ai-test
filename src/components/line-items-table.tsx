"use client";

import { Fragment, useState } from "react";
import type { Finding, LineItem } from "@/lib/extraction/schema";

function Cell({ value, missing }: { value: string | null | undefined; missing: string }) {
  if (value) return <>{value}</>;
  return <span className="italic text-zinc-400 dark:text-zinc-500">{missing}</span>;
}

export function LineItemsTable({ items, refusals }: { items: LineItem[]; refusals: Finding[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const refusedFor = (id: string) => refusals.filter((r) => r.lineItemId === id);

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2 font-medium">Code</th>
            <th className="px-3 py-2 font-medium">Description</th>
            <th className="px-3 py-2 text-right font-medium">Qty</th>
            <th className="px-3 py-2 font-medium">Unit</th>
            <th className="px-3 py-2 text-right font-medium">Unit price</th>
            <th className="px-3 py-2 text-right font-medium">Amount</th>
            <th className="px-3 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {items.map((item) => {
            const notes = [...refusedFor(item.id).map((r) => r.id), ...item.warningIds];
            const isOpen = open === item.id;
            return (
              <Fragment key={item.id}>
                <tr
                  onClick={() => setOpen(isOpen ? null : item.id)}
                  className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                >
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{item.code ?? "—"}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Cell value={item.quantity?.raw} missing="unclear" />
                  </td>
                  <td className="px-3 py-2">
                    <Cell value={item.unit ?? item.unitPrice?.per} missing="not stated" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Cell value={item.unitPrice?.raw} missing="not stated" />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Cell value={item.amount?.raw} missing={refusedFor(item.id).some((r) => r.id.endsWith(":amount") && !r.id.startsWith("missing:")) ? "refused" : "not stated"} />
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-zinc-500">
                    p. {item.page}
                    {notes.length > 0 && (
                      <a
                        href={`#${notes[0]}`}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
                      >
                        check
                      </a>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="bg-zinc-50 dark:bg-zinc-900/60">
                    <td colSpan={7} className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400">
                      Page {item.evidence.page} ·{" "}
                      <q className="font-mono text-zinc-800 dark:text-zinc-200">{item.evidence.sourceText}</q>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

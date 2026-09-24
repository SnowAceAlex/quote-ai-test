import type { Finding } from "@/lib/extraction/schema";

const KIND_LABEL: Record<Finding["code"], string> = {
  NO_TEXT_LAYER: "Unreadable page",
  PAGE_UNREADABLE: "Unreadable page",
  NO_TABLE_FOUND: "No line items found",
  ROW_UNPARSEABLE: "Unreadable row",
  VALUE_UNPARSEABLE: "Unclear number",
  NOT_STATED: "Not in the document",
  AMBIGUOUS: "Unclear",
  CONTRADICTION: "Contradiction",
  DOES_NOT_ADD_UP: "Doesn't add up",
  NOT_AN_INVOICE_PAGE: "Check this page",
  MISSING_SECTION: "Missing section",
};

const TONE = {
  refusal: "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30",
  warning: "border-sky-200 bg-sky-50 dark:border-sky-800/60 dark:bg-sky-950/30",
};

export function FindingCard({ finding, tone }: { finding: Finding; tone: keyof typeof TONE }) {
  return (
    <article id={finding.id} className={`scroll-mt-6 rounded-lg border p-4 ${TONE[tone]}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{finding.subject}</h3>
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          {KIND_LABEL[finding.code]}
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">{finding.reason}</p>
      {finding.calculation && (
        <p className="mt-2 font-mono text-sm text-zinc-800 dark:text-zinc-200">{finding.calculation}</p>
      )}
      {finding.evidence.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Where this comes from</p>
          <ul className="mt-1 space-y-1">
            {finding.evidence.map((e, i) => (
              <li key={i} className="text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">Page {e.page} · </span>
                <q className="font-mono text-[0.8rem] text-zinc-800 dark:text-zinc-200">{e.sourceText}</q>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

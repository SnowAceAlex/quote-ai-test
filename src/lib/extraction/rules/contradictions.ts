import type { Row } from "../rows";
import type { Rule } from "./types";
import { finding, rowEvidence } from "./finding";

const COUNT = /(\d[\d,]*)\s+(cartons?|boxes|box|pallets?|packages?|parcels?|bundles?)\b/gi;

function singular(noun: string): string {
  const n = noun.toLowerCase();
  if (n === "boxes") return "box";
  return n.endsWith("s") ? n.slice(0, -1) : n;
}

function plural(noun: string): string {
  return noun === "box" ? "boxes" : `${noun}s`;
}

type Mention = { value: string; row: Row; page: number };

export const contradictions: Rule = (ctx) => {
  const mentions = new Map<string, Mention[]>();
  for (const page of ctx.pages) {
    for (const row of page.freeText) {
      for (const m of row.text.matchAll(COUNT)) {
        const noun = singular(m[2]);
        const list = mentions.get(noun) ?? [];
        list.push({ value: m[1].replace(/,/g, ""), row, page: page.page });
        mentions.set(noun, list);
      }
    }
  }

  const refusals = [...mentions.entries()]
    .filter(([, list]) => new Set(list.map((m) => m.value)).size > 1)
    .map(([noun, list]) => {
      const values = [...new Set(list.map((m) => m.value))];
      const stated = `${values.slice(0, -1).join(", ")} in one place and ${values.at(-1)} in another`;
      return finding({
        id: `count:${noun}`,
        code: "CONTRADICTION",
        subject: `Number of ${plural(noun)}`,
        reason: `The document gives the number of ${plural(noun)} as ${stated}. We can't tell which is right, so we haven't reported a ${noun} count.`,
        evidence: list.map((m) => rowEvidence(m.row, m.page)),
      });
    });

  return { refusals, warnings: [] };
};

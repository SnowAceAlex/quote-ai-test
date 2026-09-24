import type { TextItem } from "./pdf";

export type Row = { y: number; items: TextItem[]; text: string };

export function buildRows(items: TextItem[]): Row[] {
  const nonBlank = items.filter((item) => item.str.trim() !== "");
  const sorted = nonBlank.sort((a, b) => b.y - a.y);

  const groups: TextItem[][] = [];
  for (const item of sorted) {
    const current = groups.at(-1);
    // Anchor to the row's first item so a row can't drift in y as items join it
    if (current && Math.abs(item.y - current[0].y) <= 2) {
      current.push(item);
    } else {
      groups.push([item]);
    }
  }

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    return {
      y: group[0].y,
      items: ordered,
      text: ordered.map((item) => item.str.trim()).join(" "),
    };
  });
}

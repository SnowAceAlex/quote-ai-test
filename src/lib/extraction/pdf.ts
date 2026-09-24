import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

export type TextItem = { str: string; x: number; y: number; width: number };
export type LoadedPage = { page: number; items: TextItem[]; imageCount: number };

export class PdfLoadError extends Error {
  code: "PDF_ENCRYPTED" | "PDF_CORRUPT";

  constructor(code: "PDF_ENCRYPTED" | "PDF_CORRUPT", cause: unknown) {
    super(
      code === "PDF_ENCRYPTED" ? "The PDF is password protected." : "The PDF could not be read.",
      { cause },
    );
    this.name = "PdfLoadError";
    this.code = code;
  }
}

export async function loadPdf(
  bytes: Uint8Array,
): Promise<{ pageCount: number; getPage(n: number): Promise<LoadedPage> }> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Fresh copy: pdf.js rejects Buffers and may detach what it's given
    pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (error) {
    const code = error instanceof Error && error.name === "PasswordException" ? "PDF_ENCRYPTED" : "PDF_CORRUPT";
    throw new PdfLoadError(code, error);
  }

  return {
    pageCount: pdf.numPages,
    async getPage(n: number): Promise<LoadedPage> {
      const page = await pdf.getPage(n);
      const textContent = await page.getTextContent();

      const items: TextItem[] = [];
      for (const entry of textContent.items) {
        if (!("str" in entry)) continue; // marked-content markers, not text
        items.push({ str: entry.str, x: entry.transform[4], y: entry.transform[5], width: entry.width });
      }

      // imageCount only explains an empty page, so skip the slow operator walk when there's text.
      let imageCount = 0;
      if (items.length === 0) {
        const ops = await page.getOperatorList();
        const { OPS } = await getResolvedPDFJS();
        imageCount = ops.fnArray.filter(
          (fn) =>
            fn === OPS.paintImageXObject ||
            fn === OPS.paintInlineImageXObject ||
            fn === OPS.paintImageMaskXObject,
        ).length;
      }

      return { page: n, items, imageCount };
    },
  };
}

import { extractDocument } from "@/lib/extraction/extract";
import { PdfLoadError } from "@/lib/extraction/pdf";
import type { ErrorBody } from "@/lib/extraction/schema";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";

export const maxDuration = 30;

function fail(status: number, code: ErrorBody["error"]["code"], message: string): Response {
  return Response.json({ error: { code, message } } satisfies ErrorBody, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdf(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-");
}

export async function POST(request: Request): Promise<Response> {
  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return fail(400, "NO_FILE", "The upload didn't include a file. Choose a PDF and try again.");
  }
  if (!(file instanceof File)) {
    return fail(400, "NO_FILE", "The upload didn't include a file. Choose a PDF and try again.");
  }
  if (file.size === 0) {
    return fail(400, "EMPTY_FILE", `"${file.name}" is empty (0 bytes), so there's nothing to read.`);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return fail(413, "FILE_TOO_LARGE", `"${file.name}" is ${megabytes(file.size)}. The limit is 4 MB.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPdf(bytes)) {
    return fail(415, "NOT_A_PDF", `"${file.name}" isn't a PDF file, so we can't read it. Upload a PDF instead.`);
  }

  try {
    const result = await extractDocument(bytes, file.name);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PdfLoadError) {
      return error.code === "PDF_ENCRYPTED"
        ? fail(422, "PDF_ENCRYPTED", `"${file.name}" is password-protected, so we can't open it. Remove the password and upload it again.`)
        : fail(422, "PDF_CORRUPT", `"${file.name}" looks like a PDF but is damaged, so we couldn't open it. Try re-saving or re-exporting it.`);
    }
    console.error("extract failed", file.name, error);
    return fail(500, "INTERNAL", `Something broke on our side while reading "${file.name}". This is our bug, not a problem with your file.`);
  }
}

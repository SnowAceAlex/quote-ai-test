import { ErrorBody, ExtractionResult } from "@/lib/extraction/schema";
import { MAX_UPLOAD_BYTES } from "@/lib/limits";

export type Failure = {
  title: string;
  explanation: string;
  status: number | null;
  code: string | null;
};

export type Outcome =
  | { kind: "result"; data: ExtractionResult }
  | { kind: "failed"; failure: Failure }
  | { kind: "cancelled" };

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function tooLarge(file: File, status: number | null): Failure {
  return {
    title: "This file is too large",
    explanation: `"${file.name}" is ${formatSize(file.size)}. The limit is ${formatSize(MAX_UPLOAD_BYTES)}. Try a smaller export of the document.`,
    status,
    code: "FILE_TOO_LARGE",
  };
}

export function checkBeforeUpload(file: File): Failure | null {
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge(file, null);
  const looksLikePdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) {
    return {
      title: "This isn't a PDF",
      explanation: `"${file.name}" isn't a PDF file, so we can't read it. Upload a PDF instead.`,
      status: null,
      code: "NOT_A_PDF",
    };
  }
  return null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function failureFromStatus(file: File, status: number): Failure {
  // Vercel answers these itself with an HTML page, so there's no JSON error to show.
  if (status === 413) return tooLarge(file, status);
  if (status === 504) {
    return {
      title: "Reading the file took too long",
      explanation: `The server gave up on "${file.name}" before it finished. Your file wasn't processed; try again, or try a smaller file.`,
      status,
      code: null,
    };
  }
  return {
    title: "The server couldn't process this file",
    explanation: `The server failed while reading "${file.name}" and didn't say why (HTTP ${status}). Your file wasn't processed.`,
    status,
    code: null,
  };
}

export async function uploadForExtraction(file: File, signal?: AbortSignal): Promise<Outcome> {
  const body = new FormData();
  body.append("file", file);

  let response: Response;
  try {
    response = await fetch("/api/extract", { method: "POST", body, signal });
  } catch {
    if (signal?.aborted) return { kind: "cancelled" };
    return {
      kind: "failed",
      failure: {
        title: "Couldn't reach the server",
        explanation: "Check your connection and try again. Your file wasn't processed.",
        status: null,
        code: null,
      },
    };
  }

  const json = await readJson(response);

  if (!response.ok) {
    const error = ErrorBody.safeParse(json);
    if (error.success) {
      return {
        kind: "failed",
        failure: {
          title: "We couldn't read this file",
          explanation: error.data.error.message,
          status: response.status,
          code: error.data.error.code,
        },
      };
    }
    return { kind: "failed", failure: failureFromStatus(file, response.status) };
  }

  const result = ExtractionResult.safeParse(json);
  if (!result.success) {
    const where = result.error.issues[0]?.path.join(".") || "the response";
    return {
      kind: "failed",
      failure: {
        title: "The server's reply was incomplete",
        explanation: `We got an answer for "${file.name}" but part of it was missing or malformed (at ${where}), so we're not showing any of it rather than showing it wrong.`,
        status: response.status,
        code: null,
      },
    };
  }
  return { kind: "result", data: result.data };
}

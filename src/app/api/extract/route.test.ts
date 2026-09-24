import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSample } from "@/lib/extraction/test-helpers";
import { POST } from "./route";

function upload(bytes: Uint8Array<ArrayBuffer> | string, name: string): Request {
  const body = new FormData();
  body.append("file", new File([bytes], name));
  return new Request("http://localhost/api/extract", { method: "POST", body });
}

async function errorCode(res: Response) {
  return [res.status, (await res.json()).error.code];
}

describe("POST /api/extract", () => {
  it("returns a scanned document's refusal as a normal result, not an error", async () => {
    const res = await POST(upload(loadSample("IB-55902.pdf"), "IB-55902.pdf"));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("nothing_extracted");
  });

  it("names the specific reason it can't process an upload", async () => {
    expect(await errorCode(await POST(new Request("http://localhost/api/extract", { method: "POST", body: new FormData() })))).toEqual([400, "NO_FILE"]);
    expect(await errorCode(await POST(upload("", "empty.pdf")))).toEqual([400, "EMPTY_FILE"]);
    expect(await errorCode(await POST(upload("just some text", "notes.pdf")))).toEqual([415, "NOT_A_PDF"]);
    expect(await errorCode(await POST(upload("%PDF-1.4 garbage", "broken.pdf")))).toEqual([422, "PDF_CORRUPT"]);
    const encrypted = new Uint8Array(readFileSync("tests/fixtures/encrypted.pdf"));
    expect(await errorCode(await POST(upload(encrypted, "locked.pdf")))).toEqual([422, "PDF_ENCRYPTED"]);
  });

  it("handles uploads that aren't shaped the way it expects", async () => {
    const wrongField = new FormData();
    wrongField.append("document", new File([loadSample("IB-55871.pdf")], "IB-55871.pdf"));
    const post = (body: BodyInit, headers?: HeadersInit) =>
      POST(new Request("http://localhost/api/extract", { method: "POST", body, headers }));

    expect(await errorCode(await post(wrongField))).toEqual([400, "NO_FILE"]);
    expect(await errorCode(await post(JSON.stringify({ file: "x" }), { "content-type": "application/json" }))).toEqual([400, "NO_FILE"]);
    expect(await errorCode(await POST(upload(new Uint8Array(4 * 1024 * 1024 + 1), "huge.pdf")))).toEqual([413, "FILE_TOO_LARGE"]);
  });

  it("reads a real PDF even when it's named like something else", async () => {
    const res = await POST(upload(loadSample("IB-55871.pdf"), "scan.jpg"));
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("complete");
  });
});

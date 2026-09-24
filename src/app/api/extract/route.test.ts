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
});

"use client";

import { useRef, useState } from "react";
import {
  checkBeforeUpload,
  formatSize,
  uploadForExtraction,
  type Failure,
} from "@/lib/client/extract-client";
import type { ExtractionResult } from "@/lib/extraction/schema";
import { ResultView } from "./result-view";

const SAMPLES = ["IB-55871", "IB-55902", "IB-56010", "IB-56088", "IB-56150", "IB-STMT47"];

type State =
  | { status: "idle" }
  | { status: "busy"; message: string }
  | { status: "failed"; failure: Failure }
  | { status: "done"; result: ExtractionResult };

export function UploadPanel() {
  const [state, setState] = useState<State>({ status: "idle" });
  const [dragging, setDragging] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const busy = state.status === "busy";

  async function run(file: File) {
    const problem = checkBeforeUpload(file);
    if (problem) return setState({ status: "failed", failure: problem });

    abort.current = new AbortController();
    setState({ status: "busy", message: `Reading ${file.name} (${formatSize(file.size)})…` });
    const outcome = await uploadForExtraction(file, abort.current.signal);
    if (outcome.kind === "cancelled") setState({ status: "idle" });
    else if (outcome.kind === "failed") setState({ status: "failed", failure: outcome.failure });
    else setState({ status: "done", result: outcome.data });
  }

  async function runSample(name: string) {
    setState({ status: "busy", message: `Fetching sample ${name}.pdf…` });
    try {
      const response = await fetch(`/samples/${name}.pdf`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      await run(new File([await response.blob()], `${name}.pdf`, { type: "application/pdf" }));
    } catch (error) {
      setState({
        status: "failed",
        failure: {
          title: "Couldn't load the sample",
          explanation: `We couldn't fetch ${name}.pdf from this site (${error instanceof Error ? error.message : "no response"}).`,
          status: null,
          code: null,
        },
      });
    }
  }

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file && !busy) run(file);
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-10 text-center transition-colors ${
            dragging
              ? "border-zinc-500 bg-zinc-50 dark:bg-zinc-900"
              : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700"
          } ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <span className="font-medium">Drop a PDF here, or click to choose one</span>
          <span className="mt-1 text-sm text-zinc-500">Invoices, packing lists, delivery dockets · up to 4 MB</span>
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) run(file);
            }}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">Or try a sample:</span>
          {SAMPLES.map((name) => (
            <button
              key={name}
              type="button"
              disabled={busy}
              onClick={() => runSample(name)}
              className="rounded border border-zinc-300 px-2 py-1 font-mono text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {name}
            </button>
          ))}
        </div>
      </section>

      <div aria-live="polite">
        {state.status === "busy" && (
          <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <span className="flex items-center gap-3">
              <span className="size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-700" />
              {state.message}
            </span>
            <button type="button" onClick={() => abort.current?.abort()} className="text-sm text-zinc-500 underline">
              Cancel
            </button>
          </div>
        )}

        {state.status === "failed" && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800/60 dark:bg-red-950/30">
            <h2 className="font-medium">{state.failure.title}</h2>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{state.failure.explanation}</p>
            {(state.failure.status || state.failure.code) && (
              <p className="mt-2 font-mono text-xs text-zinc-500">
                {[state.failure.status && `HTTP ${state.failure.status}`, state.failure.code].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        )}

        {state.status === "done" && <ResultView result={state.result} />}
      </div>
    </div>
  );
}

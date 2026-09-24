import { UploadPanel } from "@/components/upload-panel";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Supplier document reader</h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Upload a supplier PDF and we&apos;ll pull out its line items. Every figure shows the page and line it
          came from. Anything we can&apos;t read reliably is listed with the reason, instead of being guessed.
        </p>
      </header>
      <UploadPanel />
    </main>
  );
}

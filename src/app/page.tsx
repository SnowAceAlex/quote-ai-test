import { UploadPanel } from "@/components/upload-panel";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Supplier document reader</h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Created by Bui Cong Vinh - <a href="mailto:alexvinh2911@gmail.com" className="hover:underline">alexvinh2911@gmail.com</a>
        </p>
      </header>
      <UploadPanel />
    </main>
  );
}

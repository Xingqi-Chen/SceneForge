import Link from "next/link";
import { ArrowLeft, Settings } from "lucide-react";

const linkClassName =
  "inline-flex h-9 items-center justify-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400";

export default function SettingsPage() {
  return (
    <main className="sf-app-shell flex min-h-0 flex-col overflow-hidden bg-slate-100 font-sans text-slate-950 selection:bg-blue-100 selection:text-blue-900">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700">
            <Settings className="size-4" />
          </div>
          <h1 className="truncate text-sm font-bold text-slate-900">Settings</h1>
        </div>
        <Link className={linkClassName} href="/">
          <ArrowLeft className="size-3.5" />
          Timeline
        </Link>
      </header>
      <section className="flex min-h-0 flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md rounded-md border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-600 shadow-xl shadow-slate-200/70">
          Settings are reserved for the next implementation slice. Secrets and local paths are not displayed here.
        </div>
      </section>
    </main>
  );
}

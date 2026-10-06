"use client";

import { WarningCircleIcon } from "@phosphor-icons/react";

/**
 * What is left when the page itself throws while rendering. The runs do not
 * depend on this page: they keep going on the server, and showing the page
 * again opens a new connection to it.
 */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-[var(--paper)] p-5">
      <div role="alert" className="flex max-w-md items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
        <WarningCircleIcon className="mt-0.5 shrink-0" size={15} weight="fill" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-medium">The console could not display this page.</p>
          <p className="mt-0.5 text-[11px] leading-relaxed">Your runs keep going on the local server. Show the page again to get back to them.</p>
          <p className="mt-1 break-words font-mono text-[10px]">{error.message}</p>
          <button type="button" onClick={reset} className="mt-1 rounded-md text-[11px] font-medium underline underline-offset-2">Show the page again</button>
        </div>
      </div>
    </main>
  );
}

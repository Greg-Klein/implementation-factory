"use client";

import { CircleNotchIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { RecipeResponse } from "@/lib/types";

const secondary = "flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--raised)] px-3.5 py-2 text-xs font-medium text-[var(--ink)] transition hover:bg-[var(--paper)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

function writtenLabel(updatedAt: string) {
  return new Date(updatedAt).toLocaleString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/**
 * What the console keeps about starting and reaching the app of one repository,
 * and hands to every run of it. Read-only, with one gesture: forgetting it, so
 * the next run writes a new one. `revision` moves when the server answered that
 * gesture, which is when the content is read again.
 */
export function RecipeDialog({ repository, revision, connected, onForget, onClose }: {
  repository: string;
  revision: number;
  connected: boolean;
  onForget: () => void;
  onClose: () => void;
}) {
  const [response, setResponse] = useState<RecipeResponse>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch(`/api/repositories/recipe?repository=${encodeURIComponent(repository)}`, { signal: controller.signal })
      .then(async (result) => {
        const body = await result.json() as RecipeResponse;
        if (!result.ok) throw new Error(body.error ?? "Impossible de lire la recette.");
        setResponse(body);
      })
      .catch((error) => { if (!controller.signal.aborted) setResponse({ repository, recipe: null, error: error instanceof Error ? error.message : "Impossible de lire la recette." }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repository, revision]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const recipe = response?.recipe;
  return (
    <div role="dialog" aria-modal="true" aria-label="Recette d'exécution" className="fixed inset-0 z-50 grid place-items-center bg-[#17201bb8] p-4 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="flex max-h-[88vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-5 border border-white/15 bg-[var(--surface)] shadow-[0_32px_90px_-28px_rgba(0,0,0,.6)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold">Recette d&apos;exécution</p>
            <p className="mt-1 truncate font-mono text-[10px] text-[var(--muted)]" title={repository}>{repository}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer" className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--line)] transition hover:bg-[var(--raised)] active:scale-95"><XIcon size={14} /></button>
        </header>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto bg-[var(--raised)] p-6">
          {loading ? <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><CircleNotchIcon className="animate-spin" size={14} />Lecture de la recette…</div>
            : response?.error ? <p role="alert" className="text-xs leading-relaxed text-red-700">{response.error}</p>
            : recipe ? <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--ink)]">{recipe.content}</pre>
            : <p className="text-xs leading-relaxed text-[var(--muted)]">Aucune recette pour ce dépôt. Le prochain run qui démarre son application en écrira une.</p>}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed text-[var(--muted)]">
            {recipe ? `Écrite par un run le ${writtenLabel(recipe.updatedAt)}. Elle est remise à chaque run de ce dépôt, qui la vérifie et la corrige.` : "Elle dit comment lancer l'application, s'y connecter et atteindre un écran."}
          </p>
          {recipe && <button type="button" disabled={!connected} onClick={onForget} title="Le prochain run de ce dépôt repartira sans recette et en écrira une nouvelle. Un run déjà en cours garde la sienne." className={secondary}><TrashIcon size={12} /> Oublier la recette</button>}
        </footer>
      </section>
    </div>
  );
}

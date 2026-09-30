import type { PlanTask } from "./types";

const ABSTRACT_LIMIT = 240;

/**
 * A sentence ends on . ! or ? followed by a capital or the end of the text, so
 * the dot of `useChat.ts` or `e.g.` inside a sentence does not cut it short.
 */
const SENTENCE_END = /[.!?](?=\s+[A-ZÀ-ÖØ-Þ("«]|\s*$)/g;

function leadSentence(text: string) {
  const flat = text.replace(/\s+/g, " ").trim();
  const end = (flat.matchAll(SENTENCE_END).next().value?.index ?? -1) + 1;
  if (end > 0 && end <= ABSTRACT_LIMIT) return flat.slice(0, end);
  if (flat.length <= ABSTRACT_LIMIT) return flat;
  const cut = flat.lastIndexOf(" ", ABSTRACT_LIMIT);
  return `${flat.slice(0, cut > 0 ? cut : ABSTRACT_LIMIT).replace(/[\s,;:]+$/, "")}…`;
}

/**
 * What the task detail leads with: the planner's summary, or for a plan written
 * before it had one, the first sentence of the developer-facing description.
 */
export function taskAbstract(task: Pick<PlanTask, "summary" | "description">) {
  if (task.summary) return task.summary;
  return task.description ? leadSentence(task.description) : undefined;
}

/** Whether the full description says more than the abstract already shown. */
export function hasMoreDetail(task: Pick<PlanTask, "summary" | "description">) {
  if (!task.description) return false;
  return taskAbstract(task) !== task.description.replace(/\s+/g, " ").trim();
}

/**
 * The developer-facing description as paragraphs. Plans written before the
 * contract asked for short paragraphs put a whole specification in one block:
 * a long block is split on its sentences, so it can be read line by line.
 */
export function detailParagraphs(description: string) {
  return description.split(/\n{2,}/).flatMap((paragraph) => {
    const flat = paragraph.replace(/\s+/g, " ").trim();
    if (flat.length <= ABSTRACT_LIMIT) return flat ? [flat] : [];
    const sentences: string[] = [];
    let start = 0;
    for (const match of flat.matchAll(SENTENCE_END)) {
      sentences.push(flat.slice(start, match.index + 1).trim());
      start = match.index + 1;
    }
    const rest = flat.slice(start).trim();
    return rest ? [...sentences, rest] : sentences;
  });
}

const CODE_LIKE = new RegExp([
  // A path has two slashes or an extension, so that the French "et/ou" stays prose.
  String.raw`[\w.-]*\/[\w.-]+\/[\w./-]*\w`,
  String.raw`[\w-]+\/[\w-]+\.\w+`,
  // File names and calls come before bare identifiers, or `useChat.ts` would be quoted without its extension.
  String.raw`[\w-]+\.(?:tsx?|jsx?|mjs|cjs|md|json|css|scss|ya?ml|py|go|rb)`,
  String.raw`\w+\(\)`,
  String.raw`[a-z]+[A-Z]\w*`,
  String.raw`[A-Z][a-z0-9]+[A-Z]\w*`,
].map((pattern) => `(?:${pattern})`).join("|"), "g");

/**
 * Plans written before the contract asked for backticks name paths and
 * identifiers bare, and a sentence of them reads as one block. Code-like words
 * are put between backticks so InlineText sets them in mono; what is already
 * quoted, and links, are left alone.
 */
export function markCode(text: string) {
  return text.split(/(`[^`\n]+`|https?:\/\/\S+)/).map((part, index) => index % 2 === 1
    ? part
    : part.replace(CODE_LIKE, (match, offset: number, whole: string) => {
      const before = whole[offset - 1];
      const after = whole[offset + match.length];
      return (before && /\w/.test(before)) || (after && /\w/.test(after)) ? match : `\`${match}\``;
    })).join("");
}

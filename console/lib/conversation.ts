export type MessageBlock = { kind: "text" | "code"; content: string };
export type InlineSegment = { kind: "plain" | "strong" | "code" | "link"; value: string; href?: string };

const INLINE = /\*\*([^*]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`)\]]+)/g;

/** Fenced blocks and tables stay monospace; the rest is prose with its line breaks kept. */
export function messageBlocks(text: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  let kind: MessageBlock["kind"] = "text";
  let fenced = false;
  let lines: string[] = [];

  const flush = () => {
    const content = lines.join("\n").replace(/^\n+|\n+$/g, "");
    if (content.trim()) blocks.push({ kind, content: kind === "text" ? content.replace(/^#{1,6}\s+(.+)$/gm, "**$1**") : content });
    lines = [];
  };

  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      flush();
      fenced = !fenced;
      kind = fenced ? "code" : "text";
      continue;
    }
    if (!fenced) {
      const wanted = line.trimStart().startsWith("|") ? "code" : "text";
      if (wanted !== kind) { flush(); kind = wanted; }
    }
    lines.push(line);
  }
  flush();
  return blocks;
}

export function inlineSegments(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let index = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > index) segments.push({ kind: "plain", value: text.slice(index, match.index) });
    index = match.index + match[0].length;
    if (match[1] !== undefined) segments.push({ kind: "strong", value: match[1] });
    else if (match[2] !== undefined) segments.push({ kind: "code", value: match[2] });
    else if (match[4] !== undefined) segments.push({ kind: "link", value: match[3] ?? match[4], href: match[4] });
    else {
      // A sentence ending right after a link must not swallow the punctuation.
      const bare = match[5] ?? "";
      const trailing = bare.match(/[.,;:!?]+$/)?.[0] ?? "";
      const href = bare.slice(0, bare.length - trailing.length);
      segments.push({ kind: "link", value: href, href });
      if (trailing) segments.push({ kind: "plain", value: trailing });
    }
  }
  if (index < text.length) segments.push({ kind: "plain", value: text.slice(index) });
  return segments;
}

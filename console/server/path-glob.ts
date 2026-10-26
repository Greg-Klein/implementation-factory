/**
 * The glob of `IMPL_SENSITIVE_PATHS` and of a review guide's ignored paths:
 * `**` crosses directories, `*` stays inside one, and a pattern without a
 * slash matches a name at any depth unless `rooted` holds it to the root.
 * A pattern that contains a slash is matched from the repository root.
 */
export function pathMatches(pattern: string, file: string, rooted = false) {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  const anchored = rooted || trimmed.includes("/") ? trimmed : `**/${trimmed}`;
  const source = anchored.split(/(\*\*\/|\*\*|\*)/).map((part) => {
    if (part === "**/") return "(?:.*/)?";
    if (part === "**") return ".*";
    if (part === "*") return "[^/]*";
    return part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${source}$`).test(file);
}

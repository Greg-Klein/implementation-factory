const ASSIGNMENT = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/**
 * Mirrors process.loadEnvFile: a quoted value ends at the first matching quote,
 * only \n is an escape, and only inside double quotes.
 */
function decode(right) {
  const value = right.trim();
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end === -1 ? { unterminated: true, value: value.slice(1) } : { value: value.slice(1, end) };
  }
  if (value.startsWith('"')) {
    const end = value.indexOf('"', 1);
    if (end === -1) return { unterminated: true, value: value.slice(1) };
    return { value: value.slice(1, end).replace(/\\n/g, "\n") };
  }
  return { value: value.split(/\s+#/)[0].trim() };
}

export function parseEnvFile(text) {
  if (text === "") return [];
  const raw = text.split("\n");
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();
  return raw.map((line) => {
    if (!line.trim()) return { kind: "blank", raw: line };
    if (line.trimStart().startsWith("#")) return { kind: "comment", raw: line };
    const match = ASSIGNMENT.exec(line);
    if (!match) return { kind: "unknown", raw: line };
    const decoded = decode(match[4]);
    return {
      kind: "assignment", raw: line, indent: match[1], exported: Boolean(match[2]),
      key: match[3], value: decoded.value, unterminated: Boolean(decoded.unterminated),
    };
  });
}

/** The last assignment wins, exactly like process.loadEnvFile. */
export function readValues(text) {
  const values = {};
  for (const line of parseEnvFile(text)) {
    if (line.kind === "assignment") values[line.key] = line.value;
  }
  return values;
}

export function serializeValue(value) {
  if (!value.includes("'")) return `'${value}'`;
  // Node stops a double-quoted value at the first quote and turns \n into a
  // newline, so these two characters have no representation next to an
  // apostrophe. Failing loudly beats writing a value that reads back wrong.
  if (value.includes('"')) throw new Error("a value cannot contain both an apostrophe and a double quote");
  if (value.includes("\\n")) throw new Error("a value containing an apostrophe cannot contain the sequence \\n");
  return `"${value.replace(/\n/g, "\\n")}"`;
}

/**
 * Rewrites only the targeted assignments. Comments, blank lines, ordering and
 * hand-written keys this parser does not understand are copied verbatim.
 */
export function applyEdits(text, edits, schema = []) {
  const lines = parseEnvFile(text);
  const pending = new Map(Object.entries(edits));
  const lastIndex = new Map();
  lines.forEach((line, index) => {
    if (line.kind === "assignment" && !line.unterminated) lastIndex.set(line.key, index);
  });

  const output = lines.map((line, index) => {
    if (line.kind !== "assignment" || lastIndex.get(line.key) !== index || !pending.has(line.key)) return line.raw;
    const value = pending.get(line.key);
    pending.delete(line.key);
    return `${line.indent}${line.exported ? "export " : ""}${line.key}=${serializeValue(value)}`;
  });

  for (const [key, value] of pending) {
    if (output.length > 0 && output[output.length - 1].trim() !== "") output.push("");
    const comment = schema.find((entry) => entry.key === key)?.comment;
    if (comment) output.push(`# ${comment}`);
    output.push(`${key}=${serializeValue(value)}`);
  }

  return output.length === 0 ? "" : `${output.join("\n")}\n`;
}

export function unterminatedKeys(text) {
  return parseEnvFile(text).filter((line) => line.kind === "assignment" && line.unterminated).map((line) => line.key);
}

export function renderExample(schema) {
  return `${schema.map((entry) => `# ${entry.comment}\n${entry.key}=${serializeValue(entry.fallback)}`).join("\n\n")}\n`;
}

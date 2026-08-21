/** Minimal flat YAML frontmatter parser. Flat string/number keys only, which is all an
 *  episode uses — deliberately not a YAML dependency. */
export function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split("\n")) {
    const mm = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!mm) continue;
    const v = mm[2].trim().replace(/^["']|["']$/g, "");
    data[mm[1]] = /^\d+$/.test(v) ? Number(v) : v;
  }
  return { data, body: m[2] };
}

export function writeFrontmatterField(file, key, value, fs) {
  let raw = fs.readFileSync(file, "utf8");
  raw = new RegExp(`^${key}:`, "m").test(raw)
    ? raw.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: "${value}"`)
    : raw.replace(/^(episodeNumber:.*)$/m, `$1\n${key}: "${value}"`);
  fs.writeFileSync(file, raw);
}

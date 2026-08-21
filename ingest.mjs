#!/usr/bin/env node
/**
 * Pull the posts you want to turn into episodes into sources/, as plain text.
 *
 *   node ingest.mjs --from https://example.com/feed                 # RSS or Atom
 *   node ingest.mjs --from https://example.com/sitemap.xml --source sitemap
 *   node ingest.mjs --from https://example.com --source wordpress
 *   node ingest.mjs --from ./content/posts --source local
 *   node ingest.mjs --from <url> --list                             # just show what it found
 *
 * Deliberately dumb and deterministic: it fetches and strips, it does not summarise or
 * select. Choosing which posts deserve an episode is the writing step's job, and that is
 * the step your own AI does — see AGENTS.md.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toText, title } from "./ingest/html.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCES = path.join(HERE, "sources");
const args = process.argv.slice(2);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const from = val("--from");
const kind = val("--source") || (from && /sitemap.*\.xml$/i.test(from) ? "sitemap" : "rss");
const limit = Number(val("--limit") || 25);
if (!from) { console.error("Usage: node ingest.mjs --from <feed|sitemap|site|dir> [--source rss|sitemap|wordpress|local] [--limit N] [--list]"); process.exit(2); }

const adapter = await import(`./ingest/${kind}.mjs`).catch(() => {
  console.error(`Unknown --source "${kind}". Options: rss, sitemap, wordpress, local`);
  process.exit(2);
});

const found = (await adapter.discover(from)).slice(0, limit);
if (!found.length) { console.error(`Nothing found at ${from}`); process.exit(1); }

if (args.includes("--list")) { found.forEach((u, i) => console.log(`${String(i + 1).padStart(3)}. ${u}`)); process.exit(0); }

fs.mkdirSync(SOURCES, { recursive: true });
const index = [];
for (let i = 0; i < found.length; i++) {
  const src = found[i];
  const n = String(i + 1).padStart(2, "0");
  let html;
  try {
    html = /^https?:\/\//.test(src) ? await (await fetch(src, { redirect: "follow" })).text() : fs.readFileSync(src, "utf8");
  } catch (e) { console.log(`  ✗ ${src} — ${e.message}`); continue; }
  const text = toText(html);
  const t = title(html) || path.basename(src);
  fs.writeFileSync(path.join(SOURCES, `${n}.txt`), `SOURCE: ${src}\nTITLE: ${t}\n\n${text}\n`);
  index.push({ file: `sources/${n}.txt`, url: src, title: t, words: text.split(/\s+/).length });
  console.log(`  ✓ ${n}.txt  ${t.slice(0, 60)}  (${text.split(/\s+/).length}w)`);
}
fs.writeFileSync(path.join(SOURCES, "index.json"), JSON.stringify(index, null, 2));
console.log(`\n${index.length} source(s) in sources/. Now ask your agent to write episodes — see AGENTS.md.`);

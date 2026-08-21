/** Spoken-form fixes applied to script text immediately before synthesis.
 *
 *  The page keeps the correct text; only the TTS input is rewritten. Two things reliably
 *  need entries: bare domains (TTS fuses "example.com" into one word) and acronyms you want
 *  letter-spelled. Keep the map small — plain English needs no help.
 *
 *  Data lives in pronunciations.json so adding one is not a code edit.
 */
import fs from "node:fs";
import path from "node:path";

export function loadPronunciations(root) {
  const file = path.join(root, "pronunciations.json");
  const map = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const keys = Object.keys(map).filter((k) => !k.startsWith("_")).sort((a, b) => b.length - a.length);
  return (text) => {
    let out = text;
    for (const key of keys) {
      const esc = key.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      // Boundary-guarded so a short key never fires inside a longer word.
      const left = /^\w/.test(key) ? "(?<![\\w])" : "";
      const right = /\w$/.test(key) ? "(?![\\w])" : "";
      out = out.replace(new RegExp(`${left}${esc}${right}`, "g"), map[key]);
    }
    return out;
  };
}

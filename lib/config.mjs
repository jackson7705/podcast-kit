/** Config + env loading. Everything show-specific lives in show.config.json; nothing
 *  show-specific may live in code. If you find yourself editing a .mjs to change a show,
 *  that value belongs here instead. */
import fs from "node:fs";
import path from "node:path";

export function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i > 0) process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}

const DEFAULTS = {
  // Defaults to the keyless provider on purpose: an absent config should render, not fail.
  tts: { provider: "local", modelId: "eleven_multilingual_v2", stability: 0.5, similarity: 0.75 },
  // Measured per voice. A wrong wpm silently misses your runtime target; generate.mjs
  // reports the real figure after the first render so you can correct it.
  wpm: 200,
  audio: {
    chunkTargetDb: -26.0,   // per-paragraph TTS chunks are matched to this before concat
    voiceTargetDb: -25.0,   // whole voice track is lifted to this so music sits right
    overlapIn: 3.0,         // seconds the voice overlaps the intro's fade-out tail
    overlapOut: 2.5,        // seconds the outro fades in under the closing line
    paragraphBeat: 0.45,    // silence between paragraphs: a breath, not a gap
    hookGap: 0.6,
  },
  host: { provider: "r2" },
};

function deepMerge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) ? deepMerge(a[k] || {}, v) : v;
  }
  return out;
}

export function loadConfig(root) {
  const file = path.join(root, "show.config.json");
  if (!fs.existsSync(file)) {
    throw new Error(`No show.config.json in ${root}\n  cp show.config.example.json show.config.json`);
  }
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  const cfg = deepMerge(DEFAULTS, raw);
  // 🔴 NO CROSS-SHOW DEFAULT. An earlier version of this pipeline fell back to another
  // show's domain and shipped a feed whose ten enclosures pointed at someone else's site.
  cfg.audioBaseUrl = (process.env.AUDIO_BASE_URL || cfg.audioBaseUrl || "").replace(/\/$/, "");
  return cfg;
}

/** Strip keys beginning with "_" so notes/annotations in show.config.json never reach output. */
export const stripNotes = (o) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));

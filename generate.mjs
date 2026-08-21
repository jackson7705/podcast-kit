#!/usr/bin/env node
/**
 * podcast-kit — episodes/*.mdx  ->  TTS  ->  ffmpeg mix  ->  output/feed.xml
 *
 *   node generate.mjs --dry-run     validate every script, no synthesis, no key needed
 *   node generate.mjs               render every episode that has no audio yet
 *   node generate.mjs --slug foo    one episode
 *   node generate.mjs --force       re-render even if episode.mp3 exists
 *   node generate.mjs --feed-only   rebuild feed.xml from what is already rendered
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnv, loadConfig } from "./lib/config.mjs";
import { parseFrontmatter, writeFrontmatterField } from "./lib/frontmatter.mjs";
import { loadPronunciations } from "./lib/pronunciations.mjs";
import { ffmpeg, duration, meanDb, silence, haveBinary, fmtDuration, FFMPEG, FFPROBE } from "./lib/audio.mjs";
import { speak, getProvider } from "./tts/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EPISODES_DIR = path.join(HERE, "episodes");
const OUTPUT_DIR = path.join(HERE, "output");
const ASSETS_DIR = path.join(HERE, "assets");
const FEED_PATH = path.join(OUTPUT_DIR, "feed.xml");

loadEnv(path.join(HERE, ".env"));
const cfg = loadConfig(HERE);
const pronounce = loadPronunciations(HERE);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const DRY = has("--dry-run"), FORCE = has("--force"), FEED_ONLY = has("--feed-only"), SLUG = val("--slug");

// ---- episodes --------------------------------------------------------------
function loadEpisodes() {
  if (!fs.existsSync(EPISODES_DIR)) return [];
  return fs.readdirSync(EPISODES_DIR)
    .filter((f) => f.endsWith(".mdx"))
    .map((f) => {
      const file = path.join(EPISODES_DIR, f);
      const { data, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
      const [hookRaw, ...rest] = body.split("<!--hook-->");
      const strip = (s) => s.split("\n").filter((l) => l.trim() !== "---" && !l.trim().startsWith("<!--")).join("\n").trim();
      return {
        file,
        slug: data.slug || f.replace(/\.mdx$/, ""),
        title: data.title || f,
        episodeNumber: data.episodeNumber || 0,
        publishedAt: data.publishedAt || "",
        description: data.description || "",
        topicUrl: data.topicUrl || "",
        hook: strip(hookRaw || ""),
        body: strip(rest.join("<!--hook-->")),
        hasHookMarker: rest.length > 0,
      };
    })
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
}

// ---- mix -------------------------------------------------------------------
// Voice-only unless assets/intro.mp3 or assets/outro.mp3 exist. Music does not hard-cut:
// it overlaps and ducks under the host at both edges.
function mixEpisode(dir) {
  const hook = path.join(dir, "hook.mp3");
  const bodyF = path.join(dir, "body.mp3");
  const out = path.join(dir, "episode.mp3");
  const asset = (n) => (fs.existsSync(path.join(ASSETS_DIR, n)) ? path.join(ASSETS_DIR, n) : null);
  const intro = asset("intro.mp3"), outro = asset("outro.mp3");

  const gap = path.join(dir, "_gap.mp3");
  silence(gap, cfg.audio.hookGap);
  const voice = path.join(dir, "_voice.mp3");
  ffmpeg(["-i", hook, "-i", gap, "-i", bodyF, "-filter_complex", "[0:a][1:a][2:a]concat=n=3:v=0:a=1[o]",
    "-map", "[o]", "-c:a", "libmp3lame", "-b:a", "128k", voice]);

  const cleanup = () => { for (const t of [gap, voice]) fs.existsSync(t) && fs.unlinkSync(t); };
  if (!intro && !outro) { fs.copyFileSync(voice, out); cleanup(); return out; }

  const { overlapIn: OVL_IN, overlapOut: OVL_OUT, voiceTargetDb } = cfg.audio;
  const Vd = duration(voice);
  const Id = intro ? duration(intro) : 0;
  const voiceDelay = intro ? Math.max(0, Id - OVL_IN) : 0;
  const outroStart = voiceDelay + Vd - (outro ? OVL_OUT : 0);
  const ms = (s) => Math.round(s * 1000);

  // 🔴 VOICE AUTO-GAIN. Music stings are cut to a fixed level, so a quiet voice gets buried
  // under them. Two measured voice clones rendered 6.5 dB apart (-25.1 vs -31.6) on identical
  // settings — the second sat under its own theme music. Measure and lift, rather than
  // hard-coding a number that is correct for exactly one voice.
  let vGain = 0;
  const db = meanDb(voice);
  if (db !== null) {
    vGain = Math.max(-6, Math.min(12, Math.round((voiceTargetDb - db) * 10) / 10));
    if (Math.abs(vGain) >= 0.5) console.log(`      voice ${db.toFixed(1)} dB -> ${vGain > 0 ? "+" : ""}${vGain} dB to hit ${voiceTargetDb}`);
  }
  const vPre = Math.abs(vGain) >= 0.5 ? `volume=${vGain}dB,` : "";

  const ins = ["-i", voice];
  let filt = `[0:a]${vPre}adelay=${ms(voiceDelay)}|${ms(voiceDelay)}[v];`;
  const mix = ["[v]"];
  let idx = 1;
  if (intro) { ins.push("-i", intro); mix.push(`[${idx}:a]`); idx++; }
  if (outro) { ins.push("-i", outro); filt += `[${idx}:a]adelay=${ms(outroStart)}|${ms(outroStart)}[ot];`; mix.push("[ot]"); idx++; }
  filt += `${mix.join("")}amix=inputs=${mix.length}:duration=longest:normalize=0[m];[m]alimiter=limit=0.95[out]`;
  ffmpeg([...ins, "-filter_complex", filt, "-map", "[out]", "-c:a", "libmp3lame", "-b:a", "128k", out]);

  cleanup();
  return out;
}

// ---- feed ------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Deterministic UUIDv5 of the feed URL under the Podcast Index namespace, per podcast:guid. */
function uuidv5(name, namespace) {
  const ns = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const b = crypto.createHash("sha1").update(ns).update(Buffer.from(name, "utf8")).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const x = b.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

function buildFeed(episodes) {
  const hostedPath = path.join(OUTPUT_DIR, "hosted.json");
  const hosted = fs.existsSync(hostedPath) ? JSON.parse(fs.readFileSync(hostedPath, "utf8")) : {};
  const site = (cfg.link || "").replace(/\/$/, "");
  // 🔴 This becomes <atom:link rel="self"> and MUST equal the URL you submit to Apple.
  // Left stale after a host move, Podcasts Connect answers only "An error has occurred."
  const feedUrl = hosted._feedSelf || cfg.feedUrl || `${cfg.audioBaseUrl}/feed.xml`;
  const image = hosted._cover || cfg.image || "";
  const author = cfg.author || "";
  const email = cfg.email || "";
  const showLink = hosted._showPage || site + "/";

  const live = episodes.filter((e) => fs.existsSync(path.join(OUTPUT_DIR, e.slug, "episode.mp3")));
  const items = live.map((e) => {
    const mp3 = path.join(OUTPUT_DIR, e.slug, "episode.mp3");
    const len = fs.statSync(mp3).size;
    const dur = fmtDuration(duration(mp3));
    const pub = e.publishedAt ? new Date(e.publishedAt).toUTCString() : new Date(0).toUTCString();
    const audioUrl = hosted[e.slug] || `${cfg.audioBaseUrl}/${e.slug}/episode.mp3`;
    const itemLink = e.topicUrl || showLink;
    const descHtml = e.topicUrl
      ? `<description><![CDATA[<p>${e.description}</p><p><a href="${e.topicUrl}">Episode page and full write-up &rarr;</a></p>]]></description>`
      : `<description>${esc(e.description)}</description>`;
    return `    <item>
      <title>${esc(e.title)}</title>
      ${descHtml}
      <link>${esc(itemLink)}</link>
      <pubDate>${pub}</pubDate>
      <guid isPermaLink="false">${esc(site)}/podcast/${e.slug}</guid>
      <enclosure url="${esc(audioUrl)}" type="audio/mpeg" length="${len}" />
      <itunes:episode>${e.episodeNumber}</itunes:episode>
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:duration>${esc(dur)}</itunes:duration>
      <itunes:summary>${esc(e.description)}</itunes:summary>
      <itunes:author>${esc(author)}</itunes:author>
      <itunes:explicit>false</itunes:explicit>
    </item>`;
  }).join("\n");

  const newest = live.reduce((a, e) => (e.publishedAt > a ? e.publishedAt : a), "1970-01-01");
  const categories = Array.isArray(cfg.categories) && cfg.categories.length ? cfg.categories : [{ text: "Education", sub: "How To" }];

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${esc(cfg.title || "")}</title>
    <description>${esc(cfg.description || "")}</description>
    <itunes:summary>${esc(cfg.description || "")}</itunes:summary>
    <link>${esc(showLink)}</link>
    <language>${esc(cfg.language || "en-us")}</language>
    <copyright>${esc(cfg.copyright || author)}</copyright>
    <generator>podcast-kit</generator>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <pubDate>${new Date(newest).toUTCString()}</pubDate>
    <atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml" />
    <podcast:guid>${uuidv5(feedUrl.replace(/^https?:\/\//, ""), "ead4c236-bf58-58c6-a2c6-a6b28d128cb6")}</podcast:guid>
    <managingEditor>${esc(email)} (${esc(author)})</managingEditor>
    <itunes:author>${esc(author)}</itunes:author>
    <itunes:owner>
      <itunes:name>${esc(author)}</itunes:name>
      <itunes:email>${esc(email)}</itunes:email>
    </itunes:owner>
${categories.map((c) => c.sub
    ? `    <itunes:category text="${esc(c.text)}">\n      <itunes:category text="${esc(c.sub)}" />\n    </itunes:category>`
    : `    <itunes:category text="${esc(c.text)}" />`).join("\n")}
    <itunes:image href="${esc(image)}" />
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>
${items}
  </channel>
</rss>`;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(FEED_PATH, feed);
  return live.length;
}

// ---- main ------------------------------------------------------------------
async function main() {
  const episodes = loadEpisodes();
  if (!episodes.length) { console.error(`No .mdx episodes in ${EPISODES_DIR}`); process.exit(1); }

  if (FEED_ONLY) { console.log(`feed.xml: ${buildFeed(episodes)} episode(s)`); return; }

  const ffOk = haveBinary(FFMPEG) && haveBinary(FFPROBE);

  if (DRY) {
    console.log(`DRY RUN — ${episodes.length} episode(s). ffmpeg/ffprobe: ${ffOk ? "OK" : "MISSING"}\n`);
    let ready = 0;
    for (const e of episodes) {
      const words = (e.hook + " " + e.body).split(/\s+/).filter(Boolean).length;
      const problems = [];
      if (!e.hasHookMarker) problems.push("no <!--hook--> marker");
      if (!e.hook) problems.push("empty hook");
      if (!e.body) problems.push("empty body");
      if (!e.publishedAt) problems.push("no publishedAt");
      else if (new Date(e.publishedAt) > new Date()) problems.push(`publishedAt is in the FUTURE (${e.publishedAt}) — Apple will hide this episode`);
      if (!e.description) problems.push("no description");
      if (/\bTODO\b|\[DRAFT\]/i.test(e.hook + e.body)) problems.push("contains TODO/[DRAFT]");
      if (/—/.test(e.hook + e.body)) problems.push("contains an em-dash (TTS does not pause on it)");
      if (!problems.length) ready++;
      console.log(`  ${problems.length ? "✗" : "✓"} ${String(e.episodeNumber).padStart(2)}. ${e.slug}  (${words}w ≈ ${fmtDuration((words / cfg.wpm) * 60)})${problems.length ? "\n       - " + problems.join("\n       - ") : ""}`);
    }
    console.log(`\n${ready}/${episodes.length} script(s) ready.`);
    return;
  }

  const provider = await getProvider(cfg);
  const problem = provider.check?.(cfg);
  if (problem) { console.error(`TTS provider "${provider.name}": ${problem}`); process.exit(1); }
  if (!ffOk) { console.error("ffmpeg/ffprobe not found. brew install ffmpeg"); process.exit(1); }

  const targets = SLUG ? episodes.filter((e) => e.slug === SLUG) : episodes;
  if (SLUG && !targets.length) { console.error(`No episode "${SLUG}". Have: ${episodes.map((e) => e.slug).join(", ")}`); process.exit(1); }

  for (const e of targets) {
    const dir = path.join(OUTPUT_DIR, e.slug);
    const mp3 = path.join(dir, "episode.mp3");
    console.log(`\nEp ${e.episodeNumber}: ${e.title}`);
    if (fs.existsSync(mp3) && !FORCE) { console.log("  skip (exists; --force to rebuild)"); continue; }
    if (!e.hasHookMarker || !e.hook || !e.body) { console.error("  ERROR: needs a <!--hook--> marker with hook + body"); continue; }
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  [1/3] TTS via ${provider.name}...`);
    await speak({ script: e.hook, outPath: path.join(dir, "hook.mp3"), cfg, pronounce });
    await speak({ script: e.body, outPath: path.join(dir, "body.mp3"), cfg, pronounce });
    console.log("  [2/3] mixing...");
    mixEpisode(dir);
    const secs = duration(mp3);
    writeFrontmatterField(e.file, "duration", fmtDuration(secs), fs);
    const words = (e.hook + " " + e.body).split(/\s+/).filter(Boolean).length;
    console.log(`  [3/3] episode.mp3 — ${fmtDuration(secs)}  (measured ${Math.round(words / (secs / 60))} wpm; config says ${cfg.wpm})`);
  }

  console.log(`\nfeed.xml: ${buildFeed(episodes)} episode(s).`);
  console.log("Next: publish to your host, then `node preflight.mjs <your feed url>` before submitting.");
}

main().catch((e) => { console.error(e); process.exit(1); });

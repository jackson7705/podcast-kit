#!/usr/bin/env node
/**
 * podcast-kit preflight — run this against your LIVE feed URL before submitting anywhere.
 *
 *   node preflight.mjs                      # uses feedUrl from show.config.json
 *   node preflight.mjs https://.../feed.xml # any feed, including ones podcast-kit did not build
 *
 * This is not an XML validator. castfeedvalidator.com already tells you whether the XML is
 * well-formed. Every check below is something that PASSES generic validation and still gets
 * you rejected by Apple, silently hides your episodes, or breaks playback — collected from
 * feeds that actually failed.
 *
 * Exit code 0 only if there are no failures.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const ok = (m, d) => results.push({ level: "ok", m, d });
const warn = (m, d) => results.push({ level: "warn", m, d });
const fail = (m, d) => results.push({ level: "fail", m, d });

const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? null;
const attr = (xml, re) => xml.match(re)?.[1] ?? null;

async function head(url) {
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: AbortSignal.timeout(30000) });
    // Some hosts refuse HEAD but serve GET. Apple requires HEAD to work for artwork, so we
    // report the difference rather than silently retrying everything as GET.
    if (r.status === 405 || r.status === 501) return { status: r.status, headers: r.headers, headRefused: true };
    return { status: r.status, headers: r.headers };
  } catch (e) { return { error: e.message }; }
}

/** Image dimensions from the first bytes. PNG IHDR and JPEG SOFn only — no dependency. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { type: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: "jpeg", h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function main() {
  let feedUrl = process.argv[2];
  if (!feedUrl) {
    const cfgPath = path.join(HERE, "show.config.json");
    if (fs.existsSync(cfgPath)) feedUrl = JSON.parse(fs.readFileSync(cfgPath, "utf8")).feedUrl;
  }
  if (!feedUrl) { console.error("Usage: node preflight.mjs <feed url>   (or set feedUrl in show.config.json)"); process.exit(2); }

  console.log(`\n  Feed  ${feedUrl}\n`);

  // ---- the feed document ---------------------------------------------------
  let res, xml;
  try {
    res = await fetch(feedUrl, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    xml = await res.text();
  } catch (e) { fail(`Could not fetch the feed: ${e.message}`); return report(); }

  if (res.status !== 200) fail(`Feed returned HTTP ${res.status}`, "Apple must be able to fetch it anonymously.");
  else ok(`200, ${res.headers.get("content-type") || "no content-type"}`);

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (/html/.test(ct) || /^\s*<!doctype html/i.test(xml)) {
    fail("The feed URL is serving HTML, not XML.",
      "Usually the file was never uploaded, or the host rejected it. WordPress media refuses .xml uploads, so this is a common one after moving hosts.");
  } else if (!/xml/.test(ct)) {
    warn(`content-type is "${ct}"`, "Not fatal, but application/rss+xml is what readers expect.");
  }

  if (!/<rss[\s>]/.test(xml)) { fail("No <rss> element found."); return report(); }

  // ---- the one-way door ----------------------------------------------------
  const self = attr(xml, /<atom:link[^>]*rel=["']self["'][^>]*href=["']([^"']+)["']/) ||
               attr(xml, /<atom:link[^>]*href=["']([^"']+)["'][^>]*rel=["']self["']/);
  if (!self) warn("No <atom:link rel=\"self\">", "Apple treats this as the canonical feed location. Add it.");
  else if (self.replace(/\/$/, "") !== feedUrl.replace(/\/$/, "")) {
    fail(`<atom:link rel="self"> is ${self}`,
      `It must equal the URL you submit (${feedUrl}). Left stale after a host move, Podcasts Connect fails with only "An error has occurred. Try again later."`);
  } else ok("<atom:link rel=\"self\"> matches this URL");

  // ---- required channel tags ----------------------------------------------
  const channel = xml.split(/<item[\s>]/)[0];
  const required = { title: tag(channel, "title"), description: tag(channel, "description"), link: tag(channel, "link"), "itunes:author": tag(channel, "itunes:author") };
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) fail(`Channel is missing: ${missing.join(", ")}`);
  else ok("Channel tags present");

  if (!/<itunes:category/.test(channel)) fail("No <itunes:category>", "Apple requires at least one, from its own taxonomy.");
  if (!/<itunes:explicit>/.test(channel)) warn("No <itunes:explicit>", "Apple treats it as required.");

  const ownerEmail = tag(channel, "itunes:email");
  if (!ownerEmail) fail("No <itunes:owner><itunes:email>", "Spotify emails the ownership-verification code here. There is no other way in.");
  else warn(`Ownership email is ${ownerEmail}`, "Confirm a human actually reads this inbox before you submit.");

  const link = required.link;
  if (link) {
    const r = await head(link);
    if (r.error || r.status >= 400) warn(`Channel <link> ${link} returned ${r.status || r.error}`);
    else ok(`Channel <link> resolves (${link})`);
  }

  // ---- artwork -------------------------------------------------------------
  const image = attr(channel, /<itunes:image[^>]*href=["']([^"']+)["']/);
  if (!image) fail("No <itunes:image href>", "Artwork is the single most common rejection reason.");
  else {
    const h = await head(image);
    if (h.error || h.status !== 200) {
      fail(`Artwork ${image} returned ${h.status || h.error}`);
    } else {
      if (h.headRefused) fail("Artwork host refuses HEAD requests", "Apple requires HEAD to work on the artwork URL.");
      const itype = (h.headers?.get("content-type") || "").toLowerCase();
      if (!/jpeg|jpg|png/.test(itype)) fail(`Artwork content-type is "${itype}"`, "Must be JPEG or PNG.");
      try {
        const g = await fetch(image, { headers: { Range: "bytes=0-65535" }, signal: AbortSignal.timeout(30000) });
        const size = imageSize(Buffer.from(await g.arrayBuffer()));
        if (!size) warn("Could not read artwork dimensions from its header.");
        else if (size.w !== size.h) fail(`Artwork is ${size.w}x${size.h}`, "Must be square.");
        else if (size.w < 1400 || size.w > 3000) fail(`Artwork is ${size.w}x${size.w}`, "Must be between 1400x1400 and 3000x3000.");
        else ok(`Artwork ${size.w}x${size.h} ${size.type}`);
      } catch { warn("Could not range-fetch the artwork to check dimensions."); }
      warn("If you changed the image, change its FILENAME too",
        "Apple caches artwork by filename, and a CDN in front of your bucket will keep serving the old file even after you overwrite the key.");
    }
  }

  // ---- items ---------------------------------------------------------------
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
  if (!items.length) { fail("No <item> elements — a feed with no episodes cannot be submitted."); return report(); }
  ok(`${items.length} episode(s)`);

  const now = Date.now();
  const future = [];
  let audioChecked = 0;
  for (const it of items) {
    const t = tag(it, "title") || "(untitled)";
    const pub = tag(it, "pubDate");
    if (!pub) fail(`"${t}" has no <pubDate>`);
    else if (new Date(pub).getTime() > now) future.push(`${t} (${pub})`);
    if (!/<guid/.test(it)) fail(`"${t}" has no <guid>`, "Without a stable guid, edits create duplicate episodes.");

    const url = attr(it, /<enclosure[^>]*url=["']([^"']+)["']/);
    const len = Number(attr(it, /<enclosure[^>]*length=["'](\d+)["']/) || 0);
    if (!url) { fail(`"${t}" has no <enclosure url>`); continue; }
    const h = await head(url);
    if (h.error || h.status !== 200) { fail(`"${t}" audio returned ${h.status || h.error}`, url); continue; }
    const atype = (h.headers?.get("content-type") || "").toLowerCase();
    if (!/^audio\//.test(atype)) fail(`"${t}" audio content-type is "${atype}"`, "Must be audio/mpeg for an mp3. Object storage often defaults to application/octet-stream.");
    const actual = Number(h.headers?.get("content-length") || 0);
    if (len && actual && len !== actual) {
      fail(`"${t}" length="${len}" but the file is ${actual} bytes`, "The feed was built before the last render. Rebuild the feed after uploading.");
    }
    audioChecked++;
  }
  if (audioChecked === items.length) ok(`${audioChecked}/${items.length} enclosures reachable`);
  if (future.length) {
    fail(`${future.length} episode(s) have a pubDate in the FUTURE`,
      `Apple and Spotify will not show these until that date passes:\n      ${future.join("\n      ")}`);
  } else ok("No future pubDates");

  report();
}

function report() {
  const pad = "  ";
  for (const r of results) {
    const mark = r.level === "ok" ? "✓" : r.level === "warn" ? "!" : "✗";
    console.log(`${pad}${mark} ${r.m}`);
    if (r.d) console.log(`${pad}    ${String(r.d).replace(/\n/g, "\n" + pad + "    ")}`);
  }
  const fails = results.filter((r) => r.level === "fail").length;
  const warns = results.filter((r) => r.level === "warn").length;
  console.log();
  if (fails) {
    console.log(`  ${fails} failure(s), ${warns} warning(s). Fix the failures, re-run, then submit.\n`);
    process.exit(1);
  }
  console.log(`  Clear${warns ? ` (${warns} warning(s) to read)` : ""}. Submit this URL:\n\n      ${process.argv[2] || "(feedUrl from show.config.json)"}\n`);
}

main().catch((e) => { console.error(e); process.exit(2); });

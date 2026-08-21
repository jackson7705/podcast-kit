#!/usr/bin/env node
/**
 * What is missing, and what to do about it. Run any time.
 *
 *   node setup-check.mjs
 *
 * Checks the machine, the config and the credentials — everything except the live feed,
 * which is preflight.mjs's job. Between them: setup-check before you build, preflight
 * before you submit.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/config.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(HERE, ".env"));

const out = [];
const ok = (m) => out.push(["ok", m, null]);
const warn = (m, fix) => out.push(["warn", m, fix]);
const bad = (m, fix) => out.push(["fail", m, fix]);
const have = (bin) => spawnSync(bin, ["-version"], { encoding: "utf8" }).status === 0;

// ---- machine ---------------------------------------------------------------
const major = Number(process.versions.node.split(".")[0]);
if (major < 18) bad(`Node ${process.versions.node} is too old`, "Needs Node 18 or newer (built-in fetch). https://nodejs.org");
else ok(`Node ${process.versions.node}`);

if (have("ffmpeg") && have("ffprobe")) ok("ffmpeg + ffprobe");
else bad("ffmpeg not found", process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg   (or https://ffmpeg.org/download.html)");

// ---- config ----------------------------------------------------------------
const cfgPath = path.join(HERE, "show.config.json");
if (!fs.existsSync(cfgPath)) {
  bad("No show.config.json", "cp show.config.example.json show.config.json   (or cp demo/show.config.json . to try the demo)");
  report();
}
let cfg;
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
catch (e) { bad(`show.config.json is not valid JSON: ${e.message}`, "A trailing comma is the usual cause."); report(); }
ok("show.config.json parses");

for (const [field, why] of [
  ["title", "the show name listeners see"],
  ["description", "shown in every podcast app"],
  ["author", "rendered by Apple as the publisher"],
  ["email", "Spotify sends the ownership code here"],
  ["link", "the show's hub page; every directory links to it"],
  ["feedUrl", "must equal the URL you submit"],
  ["audioBaseUrl", "where episode audio will live"],
  ["image", "cover art, 1400-3000px square"],
]) {
  const v = cfg[field];
  if (!v) bad(`show.config.json is missing "${field}"`, why);
  else if (String(v).includes("example.com") && field !== "link") warn(`"${field}" still points at example.com`, "Fine for the demo. Real shows need a real URL.");
}
if (!Array.isArray(cfg.categories) || !cfg.categories.length) warn("No categories set", "Apple requires at least one, from its own taxonomy.");

// ---- episodes --------------------------------------------------------------
const eps = fs.existsSync(path.join(HERE, "episodes")) ? fs.readdirSync(path.join(HERE, "episodes")).filter((f) => f.endsWith(".mdx")) : [];
if (!eps.length) warn("No episodes yet", "node ingest.mjs --from <your feed url>, then ask your agent to write them (see AGENTS.md).");
else ok(`${eps.length} episode script(s)`);

// ---- tts -------------------------------------------------------------------
const tp = process.env.TTS_PROVIDER || cfg.tts?.provider || "local";
if (tp === "elevenlabs") {
  if (!process.env.ELEVENLABS_API_KEY) bad("tts.provider is elevenlabs but ELEVENLABS_API_KEY is not set", "Put it in .env, or switch tts.provider to \"local\" to render with no key.");
  else if (!process.env.ELEVENLABS_VOICE_ID) bad("ELEVENLABS_VOICE_ID is not set", "Pick or clone a voice in ElevenLabs and copy its Voice ID.");
  else ok("ElevenLabs key + voice id present");
} else if (tp === "command") {
  if (!cfg.tts?.command) bad('tts.provider is "command" but tts.command is not set', "See the README's TTS section.");
  else {
    const bin = cfg.tts.command.trim().split(/\s+/)[0];
    if (spawnSync("sh", ["-c", `command -v ${bin}`]).status !== 0) bad(`tts.command starts with "${bin}", which is not on PATH`, "Install it, or use an absolute path.");
    else ok(`command TTS: ${bin}`);
  }
} else if (tp === "openai") {
  if (!cfg.tts?.baseUrl) bad('tts.provider is "openai" but tts.baseUrl is not set', "e.g. http://localhost:8880/v1");
  else ok(`openai-compatible TTS at ${cfg.tts.baseUrl}`);
} else {
  if (process.platform === "darwin" || (have("piper") && process.env.PIPER_MODEL)) ok(`local TTS (${process.env.PIPER_MODEL ? "piper" : "macOS say"}) — no key needed`);
  else bad("tts.provider is local but no local engine was found", "Install piper and set PIPER_MODEL, or pick another provider.");
}

// ---- hosting ---------------------------------------------------------------
const hp = cfg.host?.provider || "r2";
const NEED = { r2: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE"],
                bunny: ["BUNNY_STORAGE_ZONE", "BUNNY_ACCESS_KEY", "BUNNY_PUBLIC_BASE"],
                s3: ["S3_BUCKET", "S3_REGION", "S3_PUBLIC_BASE"], local: ["PUBLIC_BASE"] }[hp] || [];
const missing = NEED.filter((k) => !process.env[k]);
if (missing.length) warn(`host.provider is "${hp}" but .env is missing ${missing.join(", ")}`, "Only needed when you publish. Rendering works without it.");
else ok(`host "${hp}" configured`);
if (hp !== "local" && !have("python3")) warn("python3 not found", "publish.py needs it.");
if (hp === "r2" && /r2\.dev/.test(process.env.R2_PUBLIC_BASE || "")) {
  bad("R2_PUBLIC_BASE points at an r2.dev URL",
    "Cloudflare rate-limits r2.dev and marks it non-production. A feed URL is permanent, so use a custom domain before you launch.");
}

report();

function report() {
  console.log();
  for (const [level, m, fix] of out) {
    console.log(`  ${level === "ok" ? "✓" : level === "warn" ? "!" : "✗"} ${m}`);
    if (fix) console.log(`      ${fix}`);
  }
  const f = out.filter((o) => o[0] === "fail").length;
  console.log();
  console.log(f ? `  ${f} thing(s) to fix before this will run.\n` : "  Ready.\n");
  process.exit(f ? 1 : 0);
}

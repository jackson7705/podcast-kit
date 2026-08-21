/** Local TTS. No key, no network, no cost — and it sounds like it.
 *
 *  This exists so you can go clone-to-published-feed without signing up for anything, and
 *  so the demo show renders on a fresh checkout. Swap to a hosted provider when you want
 *  the show to sound like a person.
 *
 *  Providers, in order of preference:
 *    piper   — https://github.com/rhasspy/piper, needs PIPER_MODEL pointing at a .onnx voice
 *    say     — macOS built-in
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ffmpeg, haveBinary } from "../lib/audio.mjs";

export const name = "local";

const piperReady = () => haveBinary("piper") && process.env.PIPER_MODEL;
const sayReady = () => process.platform === "darwin" && spawnSync("which", ["say"]).status === 0;

/** There is no "voice id" here. Piper takes a path to a .onnx model file you downloaded;
 *  `say` takes the name of a voice already installed on the machine. Neither is a secret and
 *  neither is tied to an account. */
export function check() {
  if (piperReady()) {
    if (!fs.existsSync(process.env.PIPER_MODEL)) return `PIPER_MODEL points at a file that does not exist: ${process.env.PIPER_MODEL}`;
    return null;
  }
  if (!sayReady()) return "No local TTS found. Install piper and set PIPER_MODEL, or run on macOS (uses `say`).";
  const want = process.env.SAY_VOICE;
  if (want) {
    const listed = spawnSync("say", ["-v", "?"], { encoding: "utf8" }).stdout || "";
    const names = listed.split("\n").map((l) => l.split(/\s{2,}/)[0].trim()).filter(Boolean);
    if (!names.some((n) => n.toLowerCase() === want.toLowerCase())) {
      return `SAY_VOICE="${want}" is not installed. Available: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ", ..." : ""}\n  (full list: say -v "?"  — more can be added in System Settings > Accessibility > Spoken Content)`;
    }
  }
  return null;
}

export async function speakOne({ text, outPath }) {
  const tmp = outPath.replace(/\.mp3$/, piperReady() ? ".wav" : ".aiff");
  if (piperReady()) {
    const r = spawnSync("piper", ["--model", process.env.PIPER_MODEL, "--output_file", tmp], { input: text, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`piper failed: ${r.stderr}`);
  } else if (sayReady()) {
    const voice = process.env.SAY_VOICE || "Samantha";
    const r = spawnSync("say", ["-v", voice, "-o", tmp, text], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`say failed: ${r.stderr}`);
  } else {
    throw new Error(check());
  }
  ffmpeg(["-i", tmp, "-c:a", "libmp3lame", "-b:a", "128k", outPath]);
  fs.existsSync(tmp) && fs.unlinkSync(tmp);
}

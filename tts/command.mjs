/** Any local TTS that has a CLI. Kokoro, Piper, XTTS, Chatterbox, F5-TTS, StyleTTS2, or
 *  something you wrote this afternoon — none of them need code in this repo.
 *
 *  show.config.json:
 *    "tts": {
 *      "provider": "command",
 *      "command": "kokoro-tts {{text_file}} {{out}} --voice af_heart",
 *      "outputFormat": "wav"
 *    }
 *
 *  Placeholders, substituted per paragraph:
 *    {{text_file}}  path to a temp file holding the text  (preferred — no quoting problems)
 *    {{text}}       the text inline, shell-quoted
 *    {{out}}        where your tool must write audio
 *
 *  Use none of them and the text is piped on stdin instead. Whatever `outputFormat` your
 *  tool writes (wav, aiff, flac, mp3) is converted to mp3 here, so you do not have to care.
 *
 *  The command runs through `sh -c`, so pipes and redirection work. It comes from your own
 *  config file, which is the only reason that is acceptable.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ffmpeg } from "../lib/audio.mjs";

export const name = "command";

export function check(cfg) {
  const c = cfg.tts?.command;
  if (!c) return 'tts.provider is "command" but tts.command is not set in show.config.json';
  const bin = c.trim().split(/\s+/)[0];
  if (spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" }).status !== 0) {
    return `"${bin}" not found on PATH (from tts.command)`;
  }
  return null;
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

export async function speakOne({ text, outPath, cfg }) {
  const fmt = (cfg.tts.outputFormat || "wav").replace(/^\./, "");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-kit-"));
  const textFile = path.join(tmpDir, "chunk.txt");
  const audioFile = path.join(tmpDir, `chunk.${fmt}`);
  fs.writeFileSync(textFile, text);

  let cmd = cfg.tts.command;
  const usesText = /\{\{\s*text(_file)?\s*\}\}/.test(cmd);
  cmd = cmd
    .replace(/\{\{\s*text_file\s*\}\}/g, shellQuote(textFile))
    .replace(/\{\{\s*text\s*\}\}/g, shellQuote(text))
    .replace(/\{\{\s*out\s*\}\}/g, shellQuote(audioFile));

  const r = spawnSync("sh", ["-c", cmd], { encoding: "utf8", input: usesText ? undefined : text });
  const cleanup = () => { for (const f of [textFile, audioFile]) fs.existsSync(f) && fs.unlinkSync(f); fs.rmSync(tmpDir, { recursive: true, force: true }); };

  if (r.status !== 0) { cleanup(); throw new Error(`tts.command failed (exit ${r.status}):\n${r.stderr || r.stdout}`); }
  if (!fs.existsSync(audioFile) || fs.statSync(audioFile).size === 0) {
    cleanup();
    throw new Error(`tts.command exited 0 but wrote nothing to {{out}}.\n  Command: ${cmd}\n  Check that your tool writes to the path it is given, and that outputFormat matches what it produces.`);
  }
  ffmpeg(["-i", audioFile, "-c:a", "libmp3lame", "-b:a", "128k", outPath]);
  cleanup();
}

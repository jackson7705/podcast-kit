/** Provider-agnostic synthesis.
 *
 *  🔴 WHY THIS CHUNKS. A long single generation drifts. One measured body decayed 18 dB from
 *  start to finish (-27.7 dB at 0s to -46.0 dB at 70s), and a hook and body synthesised as two
 *  calls sat 4.4 dB apart. A static gain cannot fix a file that varies internally. So: one call
 *  per PARAGRAPH, each chunk level-matched, then concatenated with a beat between.
 *
 *  Which is also why paragraph breaks in an episode script are pacing, not formatting.
 */
import fs from "node:fs";
import path from "node:path";
import { ffmpeg, meanDb, silence, normalizeTo } from "../lib/audio.mjs";

const PROVIDERS = {
  elevenlabs: () => import("./elevenlabs.mjs"),
  local: () => import("./local.mjs"),
  command: () => import("./command.mjs"),   // any local TTS with a CLI
  openai: () => import("./openai.mjs"),     // any OpenAI-compatible /v1/audio/speech server
};

export async function getProvider(cfg) {
  const key = process.env.TTS_PROVIDER || cfg.tts.provider;
  const load = PROVIDERS[key];
  if (!load) throw new Error(`Unknown tts.provider "${key}". Options: ${Object.keys(PROVIDERS).join(", ")}`);
  return await load();
}

export async function speak({ script, outPath, cfg, pronounce }) {
  const provider = await getProvider(cfg);
  const paras = script.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  const dir = path.dirname(outPath);
  const base = path.basename(outPath, ".mp3");
  const parts = [];

  for (let i = 0; i < paras.length; i++) {
    const f = path.join(dir, `_${base}-${String(i).padStart(2, "0")}.mp3`);
    await provider.speakOne({
      text: pronounce(paras[i]),
      outPath: f,
      prev: paras[i - 1] ? pronounce(paras[i - 1]) : null,
      next: paras[i + 1] ? pronounce(paras[i + 1]) : null,
      cfg,
    });
    normalizeTo(f, cfg.audio.chunkTargetDb);
    parts.push(f);
  }

  if (parts.length === 1) { fs.renameSync(parts[0], outPath); return; }

  const beat = path.join(dir, `_beat-${base}.mp3`);
  silence(beat, cfg.audio.paragraphBeat);
  const seq = [];
  parts.forEach((f, i) => { if (i) seq.push(beat); seq.push(f); });
  const args = [];
  seq.forEach((f) => args.push("-i", f));
  const filt = seq.map((_, i) => `[${i}:a]`).join("") + `concat=n=${seq.length}:v=0:a=1[o]`;
  ffmpeg([...args, "-filter_complex", filt, "-map", "[o]", "-c:a", "libmp3lame", "-b:a", "128k", outPath]);

  for (const f of [...(process.env.KEEP_CHUNKS ? [] : parts), beat]) fs.existsSync(f) && fs.unlinkSync(f);
  console.log(`      ${base}: ${paras.length} chunk(s), level-matched, ${meanDb(outPath)?.toFixed(1)} dB`);
}

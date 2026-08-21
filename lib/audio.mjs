/** ffmpeg/ffprobe helpers. Everything here shells out; there is no audio library. */
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";

export const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
export const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

export function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ["-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed:\n${r.stderr}`);
}

export const duration = (f) =>
  parseFloat(execFileSync(FFPROBE, ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).trim());

/** Mean volume in dB, or null. Used for every level decision in the pipeline. */
export function meanDb(f) {
  const o = spawnSync(FFMPEG, ["-hide_banner", "-i", f, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  const m = /mean_volume: (-?[\d.]+) dB/.exec(o);
  return m ? parseFloat(m[1]) : null;
}

/** Lift/cut a file to a target mean dB in place. Clamped, because a wild correction means
 *  the measurement was wrong, not that the file needs 30 dB of gain. */
export function normalizeTo(file, targetDb, { min = -12, max = 15 } = {}) {
  const db = meanDb(file);
  if (db === null) return 0;
  const gain = Math.max(min, Math.min(max, Math.round((targetDb - db) * 10) / 10));
  if (Math.abs(gain) < 0.3) return 0;
  const tmp = file.replace(/\.mp3$/, "-n.mp3");
  ffmpeg(["-i", file, "-af", `volume=${gain}dB`, "-c:a", "libmp3lame", "-b:a", "128k", tmp]);
  fs.unlinkSync(file); fs.renameSync(tmp, file);
  return gain;
}

export function silence(outPath, seconds) {
  ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(seconds), "-c:a", "libmp3lame", "-b:a", "128k", outPath]);
}

export const haveBinary = (bin) => spawnSync(bin, ["-version"], { encoding: "utf8" }).status === 0;

/** Round FIRST, then split — rounding after the modulo prints "2:60" for 179.6s. */
export const fmtDuration = (s) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };

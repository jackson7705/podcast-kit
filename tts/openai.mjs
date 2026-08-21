/** Any OpenAI-compatible /v1/audio/speech endpoint — which is what most local TTS servers
 *  expose. Kokoro-FastAPI, LocalAI, Speaches and friends all speak it, as does OpenAI itself.
 *
 *  show.config.json:
 *    "tts": {
 *      "provider": "openai",
 *      "baseUrl": "http://localhost:8880/v1",
 *      "model": "kokoro",
 *      "voice": "af_heart"
 *    }
 *
 *  Set TTS_API_KEY in .env if your endpoint wants one. A local server usually does not,
 *  which is the point.
 */
import fs from "node:fs";

export const name = "openai";

export function check(cfg) {
  if (!cfg.tts?.baseUrl) return 'tts.provider is "openai" but tts.baseUrl is not set (e.g. http://localhost:8880/v1)';
  if (!cfg.tts?.voice) return 'tts.provider is "openai" but tts.voice is not set';
  return null;
}

export async function speakOne({ text, outPath, cfg }) {
  const base = cfg.tts.baseUrl.replace(/\/$/, "");
  const headers = { "Content-Type": "application/json" };
  if (process.env.TTS_API_KEY) headers.Authorization = `Bearer ${process.env.TTS_API_KEY}`;

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${base}/audio/speech`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: cfg.tts.model || "tts-1",
          voice: cfg.tts.voice,
          input: text,
          response_format: "mp3",
          ...(cfg.tts.speed ? { speed: cfg.tts.speed } : {}),
        }),
        signal: AbortSignal.timeout(180000),
      });
      if (!res.ok) {
        const body = await res.text();
        // A local server that is simply not running is the common case; say so plainly.
        throw Object.assign(new Error(`${base} returned ${res.status}: ${body.slice(0, 300)}`), { fatal: res.status < 500 && res.status !== 429 });
      }
      fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      if (/ECONNREFUSED|fetch failed/.test(e.message)) {
        throw new Error(`Could not reach ${base}. Is the TTS server running?\n  ${e.message}`);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw lastErr;
}

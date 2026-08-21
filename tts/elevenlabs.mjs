/** ElevenLabs adapter. One paragraph per call. */
import fs from "node:fs";

export const name = "elevenlabs";

export function check(cfg) {
  if (!process.env.ELEVENLABS_API_KEY) return "ELEVENLABS_API_KEY not set (see .env.example)";
  if (!process.env.ELEVENLABS_VOICE_ID) return "ELEVENLABS_VOICE_ID not set — pick or clone a voice in ElevenLabs and copy its Voice ID";
  return null;
}

export async function speakOne({ text, outPath, prev, next, cfg }) {
  const modelId = process.env.ELEVENLABS_MODEL_ID || cfg.tts.modelId;
  const body = {
    text,
    model_id: modelId,
    voice_settings: {
      stability: cfg.tts.stability,
      similarity_boost: cfg.tts.similarity,
      style: 0.0,
      use_speaker_boost: true,
    },
  };
  // previous_text/next_text carry prosody across chunk joins so the seams are inaudible.
  // eleven_v3 rejects them ("not yet supported with the 'eleven_v3' model"), which is the
  // reason the default model is v2: once you are chunking, continuity beats per-chunk polish.
  if (!/^eleven_v3/.test(modelId)) {
    if (prev) body.previous_text = prev;
    if (next) body.next_text = next;
  }
  // A single ETIMEDOUT should not kill a ten-episode batch after ninety successful calls.
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
        method: "POST",
        headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
      if (!res.ok) throw Object.assign(new Error(`ElevenLabs ${res.status}: ${await res.text()}`), { fatal: true });
      fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      if (attempt < 4) {
        const wait = 2000 * attempt;
        console.log(`      retry ${attempt}/3 after ${e.cause?.code || e.name || "error"} (${wait / 1000}s)`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

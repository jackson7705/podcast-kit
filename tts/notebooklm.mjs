/** NotebookLM Audio Overview adapter.
 *
 * Unlike a TTS provider, NotebookLM generates one complete, conversational episode from
 * the source material. It therefore implements renderEpisode() rather than speakOne().
 * The `notebooklm` CLI comes from https://github.com/jackson7705/notebooklm-py.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ffmpeg } from "../lib/audio.mjs";

export const name = "notebooklm";
export const CLIENT_REPO = "https://github.com/jackson7705/notebooklm-py.git";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function commandError(args, result) {
  const detail = String(result.stderr || result.stdout || result.error?.message || "unknown error").trim();
  return new Error(`notebooklm ${args.join(" ")} failed (exit ${result.status ?? "unknown"}):\n${detail}`);
}

export function runCliJson(args, { timeout = 30 * 60 * 1000 } = {}) {
  const result = spawnSync("notebooklm", args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw commandError(args, result);
  const stdout = String(result.stdout || "").trim();
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`notebooklm ${args.join(" ")} did not return JSON.\nOutput: ${stdout.slice(0, 1000) || "(empty)"}`);
  }
}

export function check(cfg) {
  const format = cfg.tts?.format || "deep-dive";
  const length = cfg.tts?.length || "default";
  if (!["deep-dive", "brief", "critique", "debate"].includes(format)) {
    return `Invalid NotebookLM format "${format}". Options: deep-dive, brief, critique, debate`;
  }
  if (!["short", "default", "long"].includes(length)) {
    return `Invalid NotebookLM length "${length}". Options: short, default, long`;
  }
  const result = spawnSync("notebooklm", ["--version"], { encoding: "utf8" });
  if (result.error?.code === "ENOENT") {
    return `notebooklm CLI not found. Install the requested fork:\n  uv tool install "notebooklm-py[browser] @ git+${CLIENT_REPO}"\nThen run: notebooklm login`;
  }
  if (result.error || result.status !== 0) return commandError(["--version"], result).message;
  const auth = spawnSync("notebooklm", ["auth", "check", "--test", "--json"], { encoding: "utf8", timeout: 60000 });
  let status;
  try { status = JSON.parse(auth.stdout || "{}"); } catch { status = null; }
  if (auth.status !== 0 || status?.status !== "ok" || status?.checks?.token_fetch !== true) {
    return "NotebookLM Google session is not authenticated. Run: notebooklm login   then: notebooklm auth check --test";
  }
  return null;
}

export function resolveEpisodeSource(root, episode) {
  const indexPath = path.join(root, "sources", "index.json");
  if (episode.sourceArticle && fs.existsSync(indexPath)) {
    let index;
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    } catch (e) {
      throw new Error(`Could not parse ${indexPath}: ${e.message}`);
    }
    const match = Array.isArray(index) ? index.find((entry) => entry.url === episode.sourceArticle) : null;
    if (match?.file) {
      const file = path.resolve(root, match.file);
      if (!fs.existsSync(file)) throw new Error(`Indexed source for ${episode.slug} is missing: ${file}`);
      return {
        input: file,
        kind: "file",
        label: match.file,
        fingerprint: sha256(fs.readFileSync(file)),
      };
    }
  }

  if (/^https?:\/\//.test(episode.sourceArticle || "")) {
    return {
      input: episode.sourceArticle,
      kind: "url",
      label: episode.sourceArticle,
      fingerprint: sha256(episode.sourceArticle),
    };
  }

  throw new Error(
    `Episode "${episode.slug}" needs sourceArticle in frontmatter, or a matching entry in sources/index.json, for NotebookLM grounding.`,
  );
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch (e) {
    throw new Error(`Could not parse NotebookLM state ${statePath}: ${e.message}`);
  }
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, statePath);
}

function requireField(value, field, command) {
  if (!value) throw new Error(`notebooklm ${command} returned no ${field}. The installed CLI may not match the expected v0.8 JSON contract.`);
  return value;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll the raw generation task ID so temporary artifact-list gaps cannot lose the job. */
export async function waitForArtifact({ run, notebookId, artifactId, timeout, interval }) {
  const deadline = Date.now() + timeout * 1000;
  let consecutiveErrors = 0;
  while (Date.now() < deadline) {
    try {
      const status = await run(["artifact", "poll", artifactId, "-n", notebookId, "--json"], { timeout: 60000 });
      consecutiveErrors = 0;
      if (status?.status === "completed") return status;
      if (["failed", "error", "removed"].includes(status?.status)) {
        throw new Error(`NotebookLM audio generation ${status.status} (task: ${artifactId}): ${status.error || status.error_code || "no details"}`);
      }
    } catch (e) {
      consecutiveErrors++;
      if (consecutiveErrors >= 5) throw e;
      console.log(`      NotebookLM status temporarily unavailable (${consecutiveErrors}/5); polling the same task again`);
    }
    await wait(Math.max(1, interval) * 1000);
  }
  throw new Error(`NotebookLM audio generation timed out after ${timeout}s (task: ${artifactId}). The task may still complete; inspect it with: notebooklm artifact poll ${artifactId} -n ${notebookId} --json`);
}

export function buildInstructions(episode, cfg) {
  const configured = String(cfg.tts?.instructions || "").trim();
  const lines = [
    `Create an engaging, conversational podcast episode titled "${episode.title}".`,
    "Use only the supplied source for substantive claims. Do not read the source or an article script word for word.",
    "Let the hosts explain, react, question each other, and make the central idea easy to follow in audio.",
  ];
  if (configured) lines.push(`Show-level direction: ${configured}`);
  if (episode.audioInstructions) lines.push(`Episode-specific direction: ${episode.audioInstructions}`);
  if (episode.description) lines.push(`Center the conversation on this question or promise: ${episode.description}`);
  if (cfg.episode?.cta) lines.push(`End with this exact closing line: ${cfg.episode.cta}`);
  return lines.join("\n");
}

/** Create/reuse the NotebookLM notebook, generate an overview, and download its raw M4A. */
export async function createNotebookAudio({ episode, root, outDir, rawOutPath, cfg, run = runCliJson }) {
  const source = resolveEpisodeSource(root, episode);
  const statePath = path.join(outDir, "notebooklm.json");
  const previous = readState(statePath);
  let notebookId = previous?.sourceFingerprint === source.fingerprint ? previous.notebookId : null;
  let sourceId = previous?.sourceFingerprint === source.fingerprint ? previous.sourceId : null;

  if (!notebookId) {
    const title = `podcast-kit | ${cfg.title || "Podcast"} | ${episode.episodeNumber}. ${episode.title}`.slice(0, 200);
    const created = await run(["create", title, "--json"]);
    notebookId = requireField(created?.notebook?.id, "notebook.id", "create");

    const addArgs = ["source", "add", source.input, "-n", notebookId, "--json", "--timeout", String(cfg.tts?.sourceTimeout || 300)];
    if (source.kind === "file") addArgs.push("--type", "file", "--title", episode.title);
    const added = await run(addArgs);
    sourceId = requireField(added?.source?.id, "source.id", "source add");
    await run([
      "source", "wait", sourceId, "-n", notebookId,
      "--timeout", String(cfg.tts?.sourceTimeout || 300),
      "--interval", String(cfg.tts?.interval || 2),
      "--json",
    ]);
    writeState(statePath, {
      notebookId,
      sourceId,
      sourceFingerprint: source.fingerprint,
      source: source.label,
      createdAt: new Date().toISOString(),
    });
  }

  const promptPath = path.join(outDir, "_notebooklm-instructions.txt");
  fs.writeFileSync(promptPath, `${buildInstructions(episode, cfg)}\n`);
  let generated;
  try {
    generated = await run([
      "generate", "audio", "-n", notebookId,
      "--prompt-file", promptPath,
      "--format", cfg.tts?.format || "deep-dive",
      "--length", cfg.tts?.length || "default",
      "--language", cfg.tts?.language || "en",
      "--retry", String(cfg.tts?.retry ?? 2),
      "--json",
    ], { timeout: 180000 });
  } finally {
    if (!process.env.KEEP_NOTEBOOKLM_PROMPT && fs.existsSync(promptPath)) fs.unlinkSync(promptPath);
  }

  const artifactId = requireField(generated?.task_id, "task_id", "generate audio");
  if (generated.status !== "completed") await waitForArtifact({
    run,
    notebookId,
    artifactId,
    timeout: cfg.tts?.timeout || 1200,
    interval: cfg.tts?.interval || 2,
  });

  if (fs.existsSync(rawOutPath)) fs.unlinkSync(rawOutPath);
  await run([
    "download", "audio", rawOutPath, "-n", notebookId,
    "-a", artifactId, "--force", "--json",
  ]);
  if (!fs.existsSync(rawOutPath) || fs.statSync(rawOutPath).size === 0) {
    throw new Error(`notebooklm download audio exited successfully but wrote no audio to ${rawOutPath}`);
  }

  writeState(statePath, {
    ...readState(statePath),
    notebookId,
    sourceId,
    sourceFingerprint: source.fingerprint,
    source: source.label,
    artifactId,
    generatedAt: new Date().toISOString(),
  });
  return { notebookId, sourceId, artifactId, source };
}

export async function renderEpisode({ episode, outPath, root, cfg }) {
  const outDir = path.dirname(outPath);
  const rawOutPath = path.join(outDir, "notebooklm.m4a");
  fs.mkdirSync(outDir, { recursive: true });
  const result = await createNotebookAudio({ episode, root, outDir, rawOutPath, cfg });
  ffmpeg(["-i", rawOutPath, "-vn", "-c:a", "libmp3lame", "-b:a", "128k", outPath]);
  if (!process.env.KEEP_NOTEBOOKLM_AUDIO) fs.unlinkSync(rawOutPath);
  console.log(`      NotebookLM artifact ${result.artifactId} (notebook ${result.notebookId})`);
  return outPath;
}

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildInstructions,
  createNotebookAudio,
  resolveEpisodeSource,
  runCliJson,
} from "../tts/notebooklm.mjs";

const episode = {
  episodeNumber: 7,
  slug: "useful-episode",
  title: "A Useful Episode",
  description: "Why does the useful thing work?",
  sourceArticle: "https://example.com/useful",
  audioInstructions: "Spend more time on the practical tradeoff.",
};

const cfg = {
  title: "Test Show",
  episode: { cta: "Visit test.example for the full guide." },
  tts: {
    provider: "notebooklm",
    format: "debate",
    length: "short",
    language: "en",
    timeout: 42,
    sourceTimeout: 20,
    interval: 1,
    retry: 3,
  },
};

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-kit-notebooklm-test-"));
  const sources = path.join(root, "sources");
  const outDir = path.join(root, "output", episode.slug);
  fs.mkdirSync(sources, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(sources, "01.txt"), "SOURCE: https://example.com/useful\n\nGrounded article text.\n");
  fs.writeFileSync(path.join(sources, "index.json"), JSON.stringify([
    { file: "sources/01.txt", url: episode.sourceArticle, title: episode.title, words: 4 },
  ]));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, outDir, rawOutPath: path.join(outDir, "notebooklm.m4a") };
}

function fakeRunner(calls, { notebookId = "nb-123", artifactId = "art-456" } = {}) {
  return async (args) => {
    calls.push(args);
    if (args[0] === "create") return { notebook: { id: notebookId, title: episode.title } };
    if (args[0] === "source" && args[1] === "add") return { source: { id: "src-234" } };
    if (args[0] === "source" && args[1] === "wait") return { status: "ready" };
    if (args[0] === "generate") return { task_id: artifactId, status: "pending" };
    if (args[0] === "artifact" && args[1] === "poll") return { task_id: artifactId, status: "completed", url: "https://example.test/audio" };
    if (args[0] === "download") {
      fs.writeFileSync(args[2], "fake m4a bytes");
      return { downloaded: [args[2]] };
    }
    throw new Error(`Unexpected fake command: ${args.join(" ")}`);
  };
}

test("resolves an indexed local source before the public URL", (t) => {
  const { root } = fixture(t);
  const source = resolveEpisodeSource(root, episode);
  assert.equal(source.kind, "file");
  assert.equal(source.input, path.join(root, "sources", "01.txt"));
  assert.equal(source.label, "sources/01.txt");
  assert.match(source.fingerprint, /^[a-f0-9]{64}$/);
});

test("falls back to sourceArticle when no local source index matches", (t) => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, "sources", "index.json"), "[]");
  const source = resolveEpisodeSource(root, episode);
  assert.equal(source.kind, "url");
  assert.equal(source.input, episode.sourceArticle);
});

test("creates, grounds, generates, and downloads the exact NotebookLM artifact", async (t) => {
  const { root, outDir, rawOutPath } = fixture(t);
  const calls = [];
  const result = await createNotebookAudio({
    episode, root, outDir, rawOutPath, cfg, run: fakeRunner(calls),
  });

  assert.deepEqual(result, {
    notebookId: "nb-123",
    sourceId: "src-234",
    artifactId: "art-456",
    source: resolveEpisodeSource(root, episode),
  });
  assert.equal(calls.length, 6);
  assert.deepEqual(calls[0].slice(0, 2), ["create", "podcast-kit | Test Show | 7. A Useful Episode"]);
  assert.deepEqual(calls[1].slice(0, 3), ["source", "add", path.join(root, "sources", "01.txt")]);
  assert.ok(calls[1].includes("--type"));
  assert.deepEqual(calls[2].slice(0, 3), ["source", "wait", "src-234"]);
  assert.equal(calls[3][calls[3].indexOf("--format") + 1], "debate");
  assert.equal(calls[3][calls[3].indexOf("--length") + 1], "short");
  assert.equal(calls[3].includes("--wait"), false);
  assert.deepEqual(calls[4].slice(0, 3), ["artifact", "poll", "art-456"]);
  assert.equal(calls[5][calls[5].indexOf("-a") + 1], "art-456");
  assert.equal(fs.readFileSync(rawOutPath, "utf8"), "fake m4a bytes");

  const state = JSON.parse(fs.readFileSync(path.join(outDir, "notebooklm.json"), "utf8"));
  assert.equal(state.notebookId, "nb-123");
  assert.equal(state.artifactId, "art-456");
  assert.equal(fs.existsSync(path.join(outDir, "_notebooklm-instructions.txt")), false);
});

test("reuses a notebook for an unchanged source and creates one after the source changes", async (t) => {
  const { root, outDir, rawOutPath } = fixture(t);
  const firstCalls = [];
  await createNotebookAudio({ episode, root, outDir, rawOutPath, cfg, run: fakeRunner(firstCalls) });

  const reuseCalls = [];
  await createNotebookAudio({ episode, root, outDir, rawOutPath, cfg, run: fakeRunner(reuseCalls, { artifactId: "art-789" }) });
  assert.deepEqual(reuseCalls.map((args) => args.slice(0, 2)), [["generate", "audio"], ["artifact", "poll"], ["download", "audio"]]);
  assert.ok(reuseCalls[0].includes("nb-123"));

  fs.appendFileSync(path.join(root, "sources", "01.txt"), "Changed source.\n");
  const changedCalls = [];
  await createNotebookAudio({
    episode, root, outDir, rawOutPath, cfg,
    run: fakeRunner(changedCalls, { notebookId: "nb-new", artifactId: "art-new" }),
  });
  assert.deepEqual(changedCalls[0].slice(0, 1), ["create"]);
  const state = JSON.parse(fs.readFileSync(path.join(outDir, "notebooklm.json"), "utf8"));
  assert.equal(state.notebookId, "nb-new");
});

test("fails closed when a CLI JSON envelope omits required IDs", async (t) => {
  const { root, outDir, rawOutPath } = fixture(t);
  await assert.rejects(
    createNotebookAudio({ episode, root, outDir, rawOutPath, cfg, run: async () => ({}) }),
    /returned no notebook\.id/,
  );
});

test("runCliJson rejects non-JSON stdout", (t) => {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), "podcast-kit-fake-cli-"));
  const cli = path.join(binDir, "notebooklm");
  fs.writeFileSync(cli, "#!/bin/sh\nprintf 'not-json'\n", { mode: 0o755 });
  t.after(() => fs.rmSync(binDir, { recursive: true, force: true }));
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
  try {
    assert.throws(() => runCliJson(["list", "--json"]), /did not return JSON/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("buildInstructions combines show, episode, listener promise, and exact CTA", () => {
  const instructions = buildInstructions(episode, {
    ...cfg,
    tts: { ...cfg.tts, instructions: "Sound curious, specific, and natural." },
  });
  assert.match(instructions, /Sound curious/);
  assert.match(instructions, /practical tradeoff/);
  assert.match(instructions, /Why does the useful thing work/);
  assert.match(instructions, /Visit test\.example/);
});

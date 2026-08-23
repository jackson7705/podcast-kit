import assert from "node:assert/strict";
import test from "node:test";

import { handlePodcastRequest } from "../src/index.js";

function storedObject(body, options = {}) {
  const bytes = new TextEncoder().encode(body);
  return {
    body: new Blob([bytes]).stream(),
    size: options.size ?? bytes.byteLength,
    range: options.range,
    uploaded: options.uploaded ?? new Date("2026-08-22T12:34:56Z"),
    httpEtag: '"test-etag"',
    writeHttpMetadata(headers) {
      headers.set("Content-Type", options.contentType || "application/octet-stream");
    },
  };
}

function environment({ get = null, head = null } = {}) {
  return {
    PODCAST_BUCKET: {
      async get() {
        return get;
      },
      async head() {
        return head;
      },
    },
  };
}

async function originFetch() {
  return new Response("wordpress", { headers: { "X-Origin": "wordpress" } });
}

test("leaves the WordPress podcast landing page at the origin", async () => {
  const response = await handlePodcastRequest(
    new Request("https://example.com/podcast/"),
    environment(),
    originFetch,
  );

  assert.equal(await response.text(), "wordpress");
  assert.equal(response.headers.get("X-Origin"), "wordpress");
});

test("falls through to WordPress when an object is missing", async () => {
  const response = await handlePodcastRequest(
    new Request("https://example.com/podcast/about/"),
    environment(),
    originFetch,
  );

  assert.equal(await response.text(), "wordpress");
});

test("does not recurse through the workers.dev preview hostname", async () => {
  const response = await handlePodcastRequest(
    new Request("https://podcast.example.workers.dev/"),
    environment(),
    originFetch,
  );

  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not Found");
});

test("streams a stored feed with podcast-safe headers", async () => {
  const response = await handlePodcastRequest(
    new Request("https://example.com/podcast/feed.xml"),
    environment({
      get: storedObject("<rss />", {
        contentType: "application/rss+xml",
        range: { offset: 0, length: 7 },
      }),
    }),
    originFetch,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "<rss />");
  assert.equal(response.headers.get("Content-Type"), "application/rss+xml");
  assert.equal(response.headers.get("Content-Length"), "7");
  assert.equal(response.headers.get("ETag"), '"test-etag"');
  assert.equal(response.headers.get("Last-Modified"), "Sat, 22 Aug 2026 12:34:56 GMT");
  assert.equal(response.headers.get("Accept-Ranges"), "bytes");
  assert.equal(response.headers.get("Content-Range"), null);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=300, must-revalidate");
});

test("answers HEAD without reading a body", async () => {
  const object = storedObject("audio", { contentType: "audio/mpeg" });
  delete object.body;
  const response = await handlePodcastRequest(
    new Request("https://example.com/podcast/episode/episode.mp3", { method: "HEAD" }),
    environment({ head: object }),
    originFetch,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
  assert.equal(response.headers.get("Content-Length"), "5");
});

test("returns byte-range metadata for podcast seeking", async () => {
  const response = await handlePodcastRequest(
    new Request("https://example.com/podcast/episode/episode.mp3", {
      headers: { Range: "bytes=2-5" },
    }),
    environment({
      get: storedObject("cdef", { contentType: "audio/mpeg", size: 10, range: { offset: 2, length: 4 } }),
    }),
    originFetch,
  );

  assert.equal(response.status, 206);
  assert.equal(response.headers.get("Content-Range"), "bytes 2-5/10");
  assert.equal(response.headers.get("Content-Length"), "4");
});

test("rejects public writes", async () => {
  const response = await handlePodcastRequest(
    new Request("https://example.com/podcast/feed.xml", { method: "PUT", body: "no" }),
    environment(),
    originFetch,
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET, HEAD");
});

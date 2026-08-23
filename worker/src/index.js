const PODCAST_PREFIX = "/podcast/";

function cachePolicy(key) {
  return key === "feed.xml"
    ? "public, max-age=300, must-revalidate"
    : "public, max-age=86400";
}

function resolvedRange(range, size) {
  if (!range) return null;

  if (typeof range.offset === "number") {
    const length = typeof range.length === "number" ? range.length : size - range.offset;
    return { offset: range.offset, length };
  }

  if (typeof range.suffix === "number") {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }

  if (typeof range.length === "number") {
    return { offset: 0, length: range.length };
  }

  return null;
}

function objectHeaders(object, key, isPartial = false) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", headers.get("Cache-Control") || cachePolicy(key));
  headers.set("ETag", object.httpEtag);
  if (!headers.has("Last-Modified") && object.uploaded instanceof Date) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }
  headers.set("X-Content-Type-Options", "nosniff");

  const range = isPartial ? resolvedRange(object.range, object.size) : null;
  if (range) {
    headers.set("Content-Length", String(range.length));
    headers.set(
      "Content-Range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`,
    );
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return { headers, range };
}

/**
 * Serve podcast objects from R2 and leave the WordPress landing page authoritative.
 * The injected originFetch seam keeps routing behavior deterministic in tests.
 */
export async function handlePodcastRequest(request, env, originFetch = fetch) {
  const url = new URL(request.url);
  const originResponse = () => url.hostname.endsWith(".workers.dev")
    ? new Response("Not Found", { status: 404 })
    : originFetch(request);

  if (!url.pathname.startsWith(PODCAST_PREFIX)) return originResponse();

  const key = url.pathname.slice(PODCAST_PREFIX.length);
  if (!key) return originResponse();

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  }

  try {
    if (request.method === "HEAD") {
      const object = await env.PODCAST_BUCKET.head(key);
      if (object === null) return originResponse();
      const { headers } = objectHeaders(object, key);
      return new Response(null, { status: 200, headers });
    }

    const options = request.headers.has("Range") ? { range: request.headers } : undefined;
    const object = await env.PODCAST_BUCKET.get(key, options);
    if (object === null) return originResponse();

    const requestedRange = request.headers.has("Range");
    const { headers, range } = objectHeaders(object, key, requestedRange);
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch (error) {
    console.error(JSON.stringify({
      message: "podcast object read failed",
      key,
      error: error instanceof Error ? error.message : String(error),
    }));
    return new Response("Podcast media is temporarily unavailable", {
      status: 503,
      headers: { "Retry-After": "60" },
    });
  }
}

export default {
  async fetch(request, env) {
    return handlePodcastRequest(request, env);
  },
};

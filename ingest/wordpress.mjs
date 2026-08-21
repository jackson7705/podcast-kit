/** WordPress REST -> post URLs. Richer than RSS (all posts, not just recent).
 *  `source` is the site root, e.g. https://example.com */
export const name = "wordpress";
export async function discover(source) {
  const base = source.replace(/\/$/, "");
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await fetch(`${base}/wp-json/wp/v2/posts?per_page=100&page=${page}&_fields=link`, { redirect: "follow" });
    if (!r.ok) break;
    const batch = await r.json();
    if (!Array.isArray(batch) || !batch.length) break;
    out.push(...batch.map((p) => p.link));
    if (batch.length < 100) break;
  }
  return out;
}

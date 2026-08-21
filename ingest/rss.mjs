/** RSS or Atom feed -> post URLs. The default adapter, because every CMS emits one. */
export const name = "rss";
export async function discover(source) {
  const xml = await (await fetch(source, { redirect: "follow" })).text();
  const links = [...xml.matchAll(/<link[^>]*>([\s\S]*?)<\/link>/g)].map((m) => m[1].trim())
    .concat([...xml.matchAll(/<link[^>]*href=["']([^"']+)["']/g)].map((m) => m[1]));
  return [...new Set(links.filter((u) => /^https?:\/\//.test(u) && !/\.xml$/.test(u)))];
}

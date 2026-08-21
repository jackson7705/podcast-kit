/** sitemap.xml -> post URLs. Follows one level of sitemap index. */
export const name = "sitemap";
async function urls(u) {
  const xml = await (await fetch(u, { redirect: "follow" })).text();
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map((m) => m[1].trim());
}
export async function discover(source) {
  const top = await urls(source);
  const children = top.filter((u) => /\.xml$/.test(u));
  if (!children.length) return top;
  const out = [];
  for (const c of children.slice(0, 10)) out.push(...(await urls(c)));
  return out.filter((u) => !/\.xml$/.test(u));
}

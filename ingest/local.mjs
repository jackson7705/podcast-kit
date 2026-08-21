/** A local directory of .md/.mdx/.txt files. For static sites, or anything with no
 *  public feed. `source` is the directory path. */
import fs from "node:fs";
import path from "node:path";
export const name = "local";
export async function discover(source) {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  return walk(source).filter((f) => /\.(md|mdx|txt|html?)$/i.test(f));
}

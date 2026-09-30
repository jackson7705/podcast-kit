import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl,
  chooseCandidate,
  descriptionFromArticle,
  isDailyNineCentral,
  notebookEpisodeMdx,
  parseBlogFeed,
  parsePodcastFeed,
  parseWordPressPosts,
  publicationDue,
  slugFromArticle,
  suitability,
  validateDraft,
} from "../weekly.mjs";

test("canonicalUrl removes tracking, fragments, and trailing slashes", () => {
  assert.equal(canonicalUrl("https://example.com/post/?utm_source=x#top"), "https://example.com/post");
});

test("WordPress RSS parsing keeps full source text", () => {
  const words = Array.from({ length: 810 }, (_, i) => `word${i}`).join(" ");
  const xml = `<rss><channel><item>
    <title><![CDATA[How Does This Work?]]></title>
    <link>https://example.com/new-post/</link>
    <guid>post-1</guid><pubDate>Mon, 24 Aug 2026 14:00:00 +0000</pubDate>
    <content:encoded><![CDATA[<p>${words}</p>]]></content:encoded>
  </item></channel></rss>`;
  const [item] = parseBlogFeed(xml);
  assert.equal(item.title, "How Does This Work?");
  assert.equal(item.url, "https://example.com/new-post");
  assert.equal(item.words, 810);
});

test("podcast RSS parsing recovers the published source and audio slug", () => {
  const xml = `<rss><channel><item>
    <title>Existing Episode</title><link>https://example.com/source/</link>
    <pubDate>Sat, 22 Aug 2026 01:00:00 GMT</pubDate>
    <itunes:episode>3</itunes:episode><itunes:summary>Existing description.</itunes:summary>
    <enclosure url="https://example.com/podcast/existing-episode/episode.mp3" />
  </item></channel></rss>`;
  const [item] = parsePodcastFeed(xml);
  assert.equal(item.episodeNumber, 3);
  assert.equal(item.slug, "existing-episode");
  assert.equal(item.url, "https://example.com/source");
});

test("Central-time guard handles daylight saving time", () => {
  assert.equal(isDailyNineCentral(new Date("2026-06-08T14:00:00Z")), true);
  assert.equal(isDailyNineCentral(new Date("2026-12-07T15:00:00Z")), true);
  assert.equal(isDailyNineCentral(new Date("2026-12-07T14:00:00Z")), false);
});

test("daily guard includes weekends and catches up after nine", () => {
  assert.equal(isDailyNineCentral(new Date("2026-09-12T14:00:00Z")), true);
  assert.equal(isDailyNineCentral(new Date("2026-09-13T20:00:00Z")), true);
});

test("selection ignores published URLs, skips thin and pricing posts, and chooses the newest", () => {
  const items = [
    { title: "Published", url: "https://example.com/published", words: 1000, publishedAt: "2026-08-28T00:00:00Z" },
    { title: "Short", url: "https://example.com/short", words: 200, publishedAt: "2026-08-24T00:00:00Z" },
    { title: "Radon Pricing", url: "https://example.com/radon-pricing", words: 1200, publishedAt: "2026-08-25T00:00:00Z" },
    { title: "Older Suitable", url: "https://example.com/first", words: 900, publishedAt: "2026-08-26T00:00:00Z" },
    { title: "Newest Suitable", url: "https://example.com/second", words: 900, publishedAt: "2026-08-27T00:00:00Z" },
  ];
  const result = chooseCandidate(items, ["https://example.com/published/"]);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.candidate.title, "Newest Suitable");
  assert.match(suitability(items[1]), /too short/);
  assert.match(suitability(items[2]), /pricing/);
});

test("WordPress REST posts become articles with full text", () => {
  const [item] = parseWordPressPosts([{
    id: 7, link: "https://example.com/old-post/", date_gmt: "2025-01-04T15:00:00",
    title: { rendered: "Old &amp; Useful" }, content: { rendered: "<p>Radon enters through foundation cracks.</p>" },
  }]);
  assert.equal(item.title, "Old & Useful");
  assert.equal(item.url, "https://example.com/old-post");
  assert.equal(item.publishedAt, "2025-01-04T15:00:00.000Z");
  assert.equal(item.words, 5);
});

test("cadence publishes every other Central calendar day", () => {
  const state = { runs: [{ result: "published", at: "2026-09-22T14:05:00Z" }, { result: "no-new-article", at: "2026-09-23T14:00:00Z" }] };
  assert.equal(publicationDue(state, new Date("2026-09-23T20:00:00Z")), false);
  assert.equal(publicationDue(state, new Date("2026-09-24T14:00:00Z")), true);
  // 11 PM Central on the 22nd is still the 22nd locally.
  assert.equal(publicationDue({ lastPublishedAt: "2026-09-23T04:00:00Z" }, new Date("2026-09-24T14:00:00Z")), true);
  assert.equal(publicationDue({}, new Date()), true);
});

test("draft validation requires exact source evidence", () => {
  const source = "A sealed sump pit can become the suction point for a mitigation system. The fan keeps the soil below the slab under negative pressure. Homeowners can still service the pump through a gasketed access panel.";
  const cfg = { episode: { targetWords: [20, 200], cta: "We are Air Sense Environmental. Visit airsenseenvironmental.com." } };
  const draft = {
    title: "How a Sealed Sump Pit Helps",
    titleEvidence: ["A sealed sump pit can become the suction point"],
    slug: "how-a-sealed-sump-pit-helps",
    description: "A sealed sump pit can serve as a mitigation suction point.",
    descriptionEvidence: ["A sealed sump pit can become the suction point"],
    hook: {
      text: "A sealed sump pit can help control radon. The system uses that opening as its suction point.",
      evidence: ["A sealed sump pit can become the suction point"],
    },
    paragraphs: [{
      text: "The fan keeps the soil below the slab under negative pressure, while a gasketed panel preserves access to the pump.",
      evidence: ["The fan keeps the soil below the slab under negative pressure", "service the pump through a gasketed access panel"],
    }],
  };
  assert.deepEqual(validateDraft(draft, source, cfg), []);
  draft.paragraphs[0].evidence = ["This sentence does not occur anywhere in the article"];
  assert.match(validateDraft(draft, source, cfg).join("\n"), /not an exact source excerpt/);
});

test("NotebookLM automation creates a bodyless manifest grounded in the RSS article", () => {
  const article = {
    title: "Are DIY Radon Test Kits Accurate?",
    url: "https://example.com/are-diy-radon-test-kits-accurate/",
    text: "DIY radon test kits can be accurate when homeowners follow the instructions. Placement and closed-house conditions both affect the result.",
    words: 900,
  };
  assert.equal(slugFromArticle(article), "are-diy-radon-test-kits-accurate");
  assert.equal(descriptionFromArticle(article), article.text);
  const mdx = notebookEpisodeMdx(article, { episode: {} }, 4, slugFromArticle(article));
  assert.match(mdx, /episodeNumber: 4/);
  assert.match(mdx, /sourceArticle: "https:\/\/example\.com\/are-diy-radon-test-kits-accurate\/"/);
  assert.match(mdx, /audioInstructions:/);
  assert.match(mdx, /---\n$/);
  assert.doesNotMatch(mdx, /<!--hook-->/);
});

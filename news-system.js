// news-system.js
import fs from "fs";
import Parser from "rss-parser";
import fetch from "node-fetch";

const parser = new Parser({
  customFields: {
    item: [
      "enclosure",
      ["media:content", "mediaContent"],
      ["content:encoded", "contentEncoded"]
    ]
  }
});

// ── Webhook slots ──────────────────────────────────────────────────────────────
const WEBHOOK_URLS = [
  process.env.WEBHOOK_URL,    // slot 1 (original)
  process.env.WEBHOOK_URL_2,  // slot 2
  process.env.WEBHOOK_URL_3,  // slot 3
  process.env.WEBHOOK_URL_4,  // slot 4
  process.env.WEBHOOK_URL_5,  // slot 5
  process.env.WEBHOOK_URL_6,  // slot 6
].filter(Boolean); // ignore any slots left unset

if (WEBHOOK_URLS.length === 0) {
  console.error("No WEBHOOK_URLs set — define at least WEBHOOK_URL");
  process.exit(1);
}

console.log(`Loaded ${WEBHOOK_URLS.length} webhook slot(s)`);

const IMPORTANT_KEYWORDS = [
  "game pass","release","launch","update",
  "new","announce","announcement","exclusive",
  "dlc","feature"
];

const POSTED_FILE = "postedLinks.json";

// Load stored links
let postedLinks = [];
if (fs.existsSync(POSTED_FILE)) {
  try {
    postedLinks = JSON.parse(fs.readFileSync(POSTED_FILE, "utf-8"));
    // Handle legacy format (plain string array)
    if (typeof postedLinks[0] === "string") {
      postedLinks = postedLinks.map(url => ({ url, timestamp: Date.now() }));
    }
  } catch {
    postedLinks = [];
  }
}

// Cleanup (21 days)
const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
postedLinks = postedLinks.filter(p => p.timestamp >= cutoff);

// Prevent redeploy spam (24h)
const RECENT_WINDOW = 24 * 60 * 60 * 1000;

// Per-webhook rate limiting
const lastPostTime = new Array(WEBHOOK_URLS.length).fill(0);
const GLOBAL_DELAY = 120000;

// Clean description
function cleanDescription(text) {
  if (!text) return "Click to read more.";
  const stripped = text.replace(/<[^>]+>/g, "");
  if (stripped.length <= 300) return stripped;
  return stripped.substring(0, 300).trim() + "...";
}

function isImportant(item) {
  const text = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
  return IMPORTANT_KEYWORDS.some(k => text.includes(k));
}

// Image extraction
function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.mediaContent?.$?.url) return item.mediaContent.$.url;

  const html = item.contentEncoded || item.content || "";
  const match = html.match(/<img[^>]+src="([^">]+)"/);
  if (match) return match[1];

  return null;
}

// Fallback OG image
async function fetchOGImage(url) {
  try {
    const res = await fetch(url, { timeout: 5000 });
    const text = await res.text();
    const match = text.match(/property="og:image"\s*content="([^"]+)"/);
    if (match) return match[1];
  } catch {}
  return null;
}

function saveLinks() {
  fs.writeFileSync(POSTED_FILE, JSON.stringify(postedLinks, null, 2));
}

async function sendToWebhook(item, source, color) {
  if (!item.link) return;

  if (postedLinks.some(p => p.url === item.link)) return;

  const pubTime = new Date(item.pubDate || 0).getTime();
  if (Date.now() - pubTime > RECENT_WINDOW) return;

  if (!isImportant(item)) return;

  // Rate limit check — use the most recent post time across all slots
  const now = Date.now();
  const mostRecent = Math.max(...lastPostTime);
  if (now - mostRecent < GLOBAL_DELAY) {
    setTimeout(() => sendToWebhook(item, source, color), GLOBAL_DELAY);
    return;
  }

  let image = extractImage(item);
  if (!image) image = await fetchOGImage(item.link);

  const embed = {
    title: item.title,
    url: item.link,
    description: cleanDescription(item.contentSnippet),
    color,
    footer: { text: source },
    timestamp: new Date(item.pubDate || Date.now())
  };

  if (image) embed.image = { url: image };

  const payload = JSON.stringify({ username: source, embeds: [embed] });

  // Broadcast to all slots simultaneously
  const results = await Promise.allSettled(
    WEBHOOK_URLS.map((url, i) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      }).then(() => {
        lastPostTime[i] = Date.now();
        console.log(`Posted to slot ${i + 1}: ${item.title}`);
      })
    )
  );

  const anyFailed = results.some(r => r.status === "rejected");
  if (anyFailed) {
    results.forEach((r, i) => {
      if (r.status === "rejected") console.error(`Webhook error slot ${i + 1} (${source}):`, r.reason?.message);
    });
  }

  // Only mark as posted if at least one slot succeeded
  if (results.some(r => r.status === "fulfilled")) {
    postedLinks.push({ url: item.link, timestamp: Date.now() });
    saveLinks();
  }
}

const feeds = [
  { url: "https://news.xbox.com/en-us/feed/", name: "Xbox Wire", color: 0x107C10 },
  { url: "https://blogs.microsoft.com/feed/", name: "Microsoft News", color: 0x00A4EF },
  { url: "https://www.pcgamer.com/rss", name: "PC Gamer", color: 0xE60012 },
  { url: "https://www.techradar.com/rss", name: "TechRadar", color: 0x2E8B57 },
  { url: "https://www.gameinformer.com/rss.xml", name: "Game Informer", color: 0xFF4500 },
  { url: "https://feeds.feedburner.com/psblog", name: "PlayStation Blog", color: 0x003087 },
  { url: "https://feeds.feedburner.com/nvidiablog", name: "NVIDIA News", color: 0x76B900 },
  { url: "https://store.steampowered.com/feeds/news.xml", name: "Steam News", color: 0x1b2838 },

  // ✅ AMD (safe via Google News)
  { url: "https://news.google.com/rss/search?q=AMD+gaming&hl=en-US&gl=US&ceid=US:en", name: "AMD News", color: 0xED1C24 }
];

async function checkFeeds() {
  for (const feed of feeds) {
    try {
      const rss = await parser.parseURL(feed.url);

      const sorted = rss.items.sort((a, b) =>
        new Date(b.pubDate || 0) - new Date(a.pubDate || 0)
      );

      const newItems = sorted.filter(item =>
        item.link &&
        !postedLinks.some(p => p.url === item.link)
      );

      const toPost = newItems.slice(0, 2);

      toPost.forEach((item, i) => {
        setTimeout(() => {
          sendToWebhook(item, feed.name, feed.color);
        }, i * 300000);
      });

    } catch (err) {
      console.error(`Feed error (${feed.name}):`, err.message);
    }
  }
}

setInterval(checkFeeds, 1800000);
checkFeeds();

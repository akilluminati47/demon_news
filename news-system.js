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

const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.error("WEBHOOK_URL not set");
  process.exit(1);
}

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
  } catch {
    postedLinks = [];
  }
}

// Cleanup (21 days)
const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
postedLinks = postedLinks.filter(p => p.timestamp >= cutoff);

// Prevent redeploy spam (24h)
const RECENT_WINDOW = 24 * 60 * 60 * 1000;

// Global rate limit
let lastPostTime = 0;
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

  const now = Date.now();
  if (now - lastPostTime < GLOBAL_DELAY) {
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

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: source,
        embeds: [embed]
      })
    });

    console.log(`Posted: ${item.title}`);
    lastPostTime = Date.now();

    postedLinks.push({
      url: item.link,
      timestamp: Date.now()
    });

    saveLinks();

  } catch (err) {
    console.error(`Webhook error (${source}):`, err.message);
  }
}

// ✅ FEEDS (clean + AMD restored)
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
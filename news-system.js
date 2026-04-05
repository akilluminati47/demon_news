// news-system.js
import fs from "fs";
import fetch from "node-fetch";
import Parser from "rss-parser";

const parser = new Parser({
  customFields: {
    item: ["enclosure", ["media:content", "url"]],
  },
});

// Get the webhook URL from Railway environment variables
const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) throw new Error("WEBHOOK_URL is not set");

// Keywords to filter important news
const IMPORTANT_KEYWORDS = [
  "game pass", "release", "launch", "update",
  "new", "announce", "announcement", "exclusive",
  "dlc", "feature",
];

// File for persistent posted links
const POSTED_FILE = "postedLinks.json";

// Load posted links with timestamps
let postedLinks = {};
if (fs.existsSync(POSTED_FILE)) {
  try {
    postedLinks = JSON.parse(fs.readFileSync(POSTED_FILE, "utf-8"));
  } catch {
    postedLinks = {};
  }
}

// Clean old links (>21 days)
const now = Date.now();
for (const [link, time] of Object.entries(postedLinks)) {
  if (now - time > 21 * 24 * 60 * 60 * 1000) {
    delete postedLinks[link];
  }
}

// RSS feeds
const feeds = [
  { url: "https://news.xbox.com/en-us/feed/", name: "Xbox News", color: 0x107C10 },
  { url: "https://blogs.microsoft.com/feed/", name: "Microsoft News", color: 0x00A4EF },
  { url: "https://www.pcgamer.com/rss", name: "PC Gamer", color: 0xE60012 },
  { url: "https://feeds.feedburner.com/psblog", name: "PlayStation Blog", color: 0x003087 },
  { url: "https://www.nvidia.com/en-us/feed/rss/", name: "NVIDIA News", color: 0x76B900 },
  { url: "https://www.amd.com/en/rss/news", name: "AMD News", color: 0xED1C24 },
];

// Check if an item is important
function isImportant(item) {
  const text = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
  return IMPORTANT_KEYWORDS.some((keyword) => text.includes(keyword));
}

// Send a post to Discord webhook
async function sendToWebhook(item, sourceName, color) {
  if (postedLinks[item.link] || !isImportant(item)) return;

  // Store timestamp
  postedLinks[item.link] = Date.now();
  fs.writeFileSync(POSTED_FILE, JSON.stringify(postedLinks, null, 2));

  // Detect image
  let imageUrl = null;
  if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;
  else if (item["media:content"]) imageUrl = item["media:content"];

  const embed = {
    title: item.title,
    url: item.link,
    description: item.contentSnippet || "Click to read more.",
    color: color,
    footer: { text: sourceName },
    timestamp: new Date(item.pubDate || Date.now()),
  };

  if (imageUrl) embed.image = { url: imageUrl };

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: sourceName, embeds: [embed] }),
    });
    console.log(`Posted: ${item.title}`);
  } catch (err) {
    console.error(`Webhook error for ${sourceName}:`, err.message);
  }
}

// Check all feeds
async function checkFeeds() {
  for (const feed of feeds) {
    try {
      const rss = await parser.parseURL(feed.url);
      const newItems = rss.items
        .filter((item) => !postedLinks[item.link] && isImportant(item));
      const toPost = newItems.slice(0, 2);

      // Stagger posts by 5 minutes
      toPost.forEach((item, index) => {
        setTimeout(() => sendToWebhook(item, feed.name, feed.color), index * 300000);
      });
    } catch (err) {
      console.error(`Feed error (${feed.name}):`, err.message);
    }
  }
}

// Run every 30 minutes
setInterval(checkFeeds, 1800000);
checkFeeds();
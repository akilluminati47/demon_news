import fs from "fs";
import Parser from "rss-parser";
import fetch from "node-fetch";

const parser = new Parser({
  customFields: {
    item: ['enclosure', ['media:content', 'url']]
  }
});

const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.error("Error: WEBHOOK_URL not set in environment variables");
  process.exit(1);
}

const IMPORTANT_KEYWORDS = [
  "game pass", "release", "launch", "update",
  "new", "announce", "announcement", "exclusive",
  "dlc", "feature"
];

const POSTED_FILE = "postedLinks.json";
let postedLinks = [];

if (fs.existsSync(POSTED_FILE)) {
  try {
    postedLinks = JSON.parse(fs.readFileSync(POSTED_FILE, "utf-8"));
  } catch (err) {
    console.error("Error reading postedLinks.json:", err.message);
    postedLinks = [];
  }
}

// Remove links older than 21 days
const TWENTY_ONE_DAYS = 21 * 24 * 60 * 60 * 1000;
postedLinks = postedLinks.filter(item => Date.now() - item.timestamp < TWENTY_ONE_DAYS);

const feeds = [
  { url: "https://news.xbox.com/en-us/feed/", name: "Xbox News", color: 0x107C10 },
  { url: "https://blogs.microsoft.com/feed/", name: "Microsoft News", color: 0x00A4EF },
  { url: "https://www.pcgamer.com/rss", name: "PC Gamer", color: 0xE60012 },
  { url: "https://feeds.feedburner.com/psblog", name: "PlayStation Blog", color: 0x003087 },
  { url: "https://feeds.feedburner.com/nvidiablog", name: "NVIDIA News", color: 0x76B900 },
  { url: "https://community.amd.com/sdtpp67534/rss/board?board.id=gaming-blogs", name: "AMD News", color: 0xED1C24 },
];

function isImportant(item) {
  const text = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
  return IMPORTANT_KEYWORDS.some(keyword => text.includes(keyword));
}

async function savePostedLinks() {
  try {
    fs.writeFileSync(POSTED_FILE, JSON.stringify(postedLinks, null, 2));
  } catch (err) {
    console.error("Error writing postedLinks.json:", err.message);
  }
}

async function sendToWebhook(item, sourceName, color) {
  if (postedLinks.find(link => link.url === item.link) || !isImportant(item)) return;

  // Detect image
  let imageUrl = null;
  if (item.enclosure && item.enclosure.url) imageUrl = item.enclosure.url;
  else if (item['media:content']) imageUrl = item['media:content'];

  // Clean title and snippet for malformed HTML entities
  const title = (item.title || "").replace(/&/g, "&amp;");
  const snippet = (item.contentSnippet || "Click to read more.").replace(/&/g, "&amp;");

  const embed = {
    title,
    url: item.link,
    description: snippet,
    color,
    footer: { text: sourceName },
    timestamp: new Date(item.pubDate || Date.now())
  };

  if (imageUrl) embed.image = { url: imageUrl };

  try {
    await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: sourceName,
        embeds: [embed]
      })
    });
    console.log(`Posted: ${item.title}`);
    postedLinks.push({ url: item.link, timestamp: Date.now() });
    savePostedLinks();
  } catch (err) {
    console.error(`Webhook error for ${sourceName}:`, err.message);
  }
}

async function checkFeeds() {
  for (const feed of feeds) {
    try {
      const rss = await parser.parseURL(feed.url);
      const newItems = rss.items.filter(item => !postedLinks.find(link => link.url === item.link) && isImportant(item));
      const toPost = newItems.slice(0, 2); // max 2 posts per feed at a time

      toPost.forEach((item, index) => {
        setTimeout(() => sendToWebhook(item, feed.name, feed.color), index * 300000); // 5 min stagger
      });
    } catch (err) {
      console.error(`Feed error (${feed.name}):`, err.message);
    }
  }
}

setInterval(checkFeeds, 1800000); // 30 min interval
checkFeeds();
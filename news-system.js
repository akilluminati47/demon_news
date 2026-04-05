// news-system.js
import fs from "fs";
import Parser from "rss-parser";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";

const parser = new Parser({
  customFields: {
    item: [
      "enclosure",
      ["media:content", "mediaUrl"],
      ["content:encoded", "contentEncoded"]
    ]
  }
});

const WEBHOOK_URL = process.env.WEBHOOK_URL;
if (!WEBHOOK_URL) {
  console.error("Error: WEBHOOK_URL not set!");
  process.exit(1);
}

// Keywords to filter important posts
const IMPORTANT_KEYWORDS = [
  "game pass","release","launch","update",
  "new","announce","announcement","exclusive",
  "dlc","feature"
];

const POSTED_FILE = "postedLinks.json";

// Load previously posted links
let postedLinks = [];
if (fs.existsSync(POSTED_FILE)) {
  try {
    postedLinks = JSON.parse(fs.readFileSync(POSTED_FILE, "utf-8"));
  } catch {
    postedLinks = [];
  }
}

// Remove links older than 21 days
const cutoff = Date.now() - 21*24*60*60*1000;
postedLinks = postedLinks.filter(p => p.timestamp >= cutoff);

function isImportant(item) {
  const text = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
  return IMPORTANT_KEYWORDS.some(k => text.includes(k));
}

function extractImage(item) {
  if (item.enclosure?.url) return item.enclosure.url;
  if (item.mediaUrl) return item.mediaUrl;

  const html = item.contentEncoded || "";
  const dom = new JSDOM(html);
  const img = dom.window.document.querySelector("img");
  if (img && img.src) return img.src;

  return null;
}

async function savePostedLinks() {
  fs.writeFileSync(POSTED_FILE, JSON.stringify(postedLinks, null, 2));
}

async function sendToWebhook(item, sourceName, color) {
  if (postedLinks.some(p => p.url === item.link) || !isImportant(item)) return;

  const imageUrl = extractImage(item);

  const embed = {
    title: item.title,
    url: item.link,
    description: item.contentSnippet || "Click to read more.",
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

// RSS feeds: all restored + fixed AMD
const feeds = [
  { url: "https://news.xbox.com/en-us/feed/", name: "Xbox News", color: 0x107C10 },
  { url: "https://blogs.microsoft.com/feed/", name: "Microsoft News", color: 0x00A4EF },
  { url: "https://www.pcgamer.com/rss", name: "PC Gamer", color: 0xE60012 },
  { url: "https://feeds.feedburner.com/psblog", name: "PlayStation Blog", color: 0x003087 },
  { url: "https://feeds.feedburner.com/nvidiablog", name: "NVIDIA News", color: 0x76B900 }, // restored NVIDIA feed
  { url: "https://rss.feedspot.com/amd_rss_feeds/", name: "AMD News", color: 0xED1C24 } // fixed AMD feed
];

async function checkFeeds() {
  for (const feed of feeds) {
    try {
      const rss = await parser.parseURL(feed.url);
      const newItems = rss.items.filter(item => !postedLinks.some(p => p.url === item.link) && isImportant(item));
      const toPost = newItems.slice(0, 2);
      toPost.forEach((item, i) => {
        setTimeout(() => sendToWebhook(item, feed.name, feed.color), i*300000); // stagger posts 5 min
      });
    } catch (err) {
      console.error(`Feed error (${feed.name}):`, err.message);
    }
  }
}

// Run immediately and then every 30 min
setInterval(checkFeeds, 1800000);
checkFeeds();
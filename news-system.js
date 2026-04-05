const fs = require("fs").promises;
const Parser = require("rss-parser");
const fetch = require("node-fetch");

const parser = new Parser({
  customFields: {
    item: ['enclosure', ['media:content', 'url']]
  }
});

const WEBHOOK_URL = process.env.WEBHOOK_URL;

const IMPORTANT_KEYWORDS = [
  "game pass", "release", "launch", "update",
  "new", "announce", "announcement", "exclusive",
  "dlc", "feature"
];

const POSTED_FILE = "postedLinks.json";
let postedLinks = new Set();

async function loadPostedLinks() {
  try {
    const data = await fs.readFile(POSTED_FILE, "utf-8");
    postedLinks = new Set(JSON.parse(data));
  } catch {
    postedLinks = new Set();
  }
}

async function savePostedLinks() {
  await fs.writeFile(POSTED_FILE, JSON.stringify([...postedLinks], null, 2));
}

const feeds = [
  { url: "https://news.xbox.com/en-us/feed/", name: "Xbox News", color: 0x107C10 },
  { url: "https://blogs.microsoft.com/feed/", name: "Microsoft News", color: 0x00A4EF },
  { url: "https://www.pcgamer.com/rss/", name: "PC Gamer", color: 0xE60012 },
  { url: "https://blog.playstation.com/feed/", name: "PlayStation Blog", color: 0x003087 },
  { url: "https://blogs.nvidia.com/feed/", name: "NVIDIA News", color: 0x76B900 },
  { url: "https://community.amd.com/rss.xml", name: "AMD News", color: 0xED1C24 }
  // Removed N4G due to broken XML
];

function isImportant(item) {
  const text = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
  return IMPORTANT_KEYWORDS.some(keyword => text.includes(keyword));
}

async function sendToWebhook(item, sourceName, color) {
  if (postedLinks.has(item.link) || !isImportant(item)) return;

  postedLinks.add(item.link);
  await savePostedLinks();

  let imageUrl = item.enclosure?.url || item['media:content'];

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
      body: JSON.stringify({ username: sourceName, embeds: [embed] })
    });
    console.log(`Posted: ${item.title}`);
  } catch (err) {
    console.error(`Webhook error for ${sourceName}:`, err.message);
  }
}

async function checkFeeds() {
  for (const feed of feeds) {
    try {
      const rss = await parser.parseURL(feed.url);
      const newItems = rss.items.filter(item => !postedLinks.has(item.link) && isImportant(item));
      const toPost = newItems.slice(0, 2);

      toPost.forEach((item, index) => {
        setTimeout(() => sendToWebhook(item, feed.name, feed.color), index * 300000); // 5 min stagger
      });
    } catch (err) {
      console.error(`Feed error (${feed.name}):`, err.message);
    }
  }
}

async function startBot() {
  await loadPostedLinks();
  await checkFeeds();
  setInterval(checkFeeds, 1800000); // every 30 minutes
}

startBot();
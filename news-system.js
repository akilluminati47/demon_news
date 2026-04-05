import Discord from "discord.js";
import Parser from "rss-parser";
import fetch from "node-fetch";
import fs from "fs";

const client = new Discord.Client({ intents: [Discord.GatewayIntentBits.Guilds] });
const parser = new Parser();

// Paths & storage
const STORAGE_FILE = "./postedLinks.json";
let postedLinks = {};
if (fs.existsSync(STORAGE_FILE)) {
  postedLinks = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));
}

// RSS feeds with webhooks
const FEEDS = [
  { name: "Xbox News", url: "https://news.xbox.com/en-us/feed/", webhook: process.env.XBOX_WEBHOOK },
  { name: "Microsoft", url: "https://blogs.microsoft.com/feed/", webhook: process.env.MICROSOFT_WEBHOOK },
  { name: "PC Gamer", url: "https://www.pcgamer.com/rss/", webhook: process.env.PCGAMER_WEBHOOK },
  { name: "PlayStation Blog", url: "https://blog.playstation.com/feed/", webhook: process.env.PLAYSTATION_WEBHOOK },
  { name: "NVIDIA", url: "https://blogs.nvidia.com/feed/", webhook: process.env.NVIDIA_WEBHOOK },
  { name: "AMD", url: "https://community.amd.com/rss.xml", webhook: process.env.AMD_WEBHOOK },
];

// Remove links older than 21 days
function pruneOldLinks() {
  const cutoff = Date.now() - 21 * 24 * 60 * 60 * 1000;
  for (const key in postedLinks) {
    if (postedLinks[key] < cutoff) delete postedLinks[key];
  }
}

// Save storage
function saveLinks() {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(postedLinks, null, 2));
}

async function fetchAndSend(feed) {
  if (!feed.webhook) return;

  try {
    const rss = await parser.parseURL(feed.url);
    if (!rss.items || rss.items.length === 0) return;

    for (const item of rss.items) {
      if (postedLinks[item.link]) continue;

      // Send embed if image exists
      let embedData = { title: item.title, url: item.link };
      if (item.enclosure?.url) embedData.image = { url: item.enclosure.url };
      if (item.contentSnippet) embedData.description = item.contentSnippet;

      const discordWebhook = new Discord.WebhookClient({ url: feed.webhook });
      await discordWebhook.send({ embeds: [embedData] });

      postedLinks[item.link] = Date.now();
    }
  } catch (err) {
    console.error(`Feed error (${feed.name}):`, err.message);
  }
}

async function main() {
  pruneOldLinks();
  for (const feed of FEEDS) await fetchAndSend(feed);
  saveLinks();
}

// Start bot
client.once("ready", () => {
  console.log(`${client.user.tag} is online!`);
  main(); 
  setInterval(main, 15 * 60 * 1000); // every 15 minutes
});

client.login(process.env.DISCORD_TOKEN);
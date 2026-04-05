const fs = require("fs");
const Parser = require("rss-parser");
const parser = new Parser();

const WEBHOOK_URL = "https://discord.com/api/webhooks/1490230920530366574/FoPbpTo_fK0rNMVhdfLKYLUvsiYJ-KtAJ26FHHrX-1hL6yjKqckgAZMtsMgRdYPKVzMJ";

const IMPORTANT_KEYWORDS = [
    "game pass", "release", "launch", "update",
    "new", "announce", "announcement", "exclusive",
    "dlc", "feature"
];

const POSTED_FILE = "postedLinks.json";
let postedLinks = new Set();
if (fs.existsSync(POSTED_FILE)) {
    postedLinks = new Set(JSON.parse(fs.readFileSync(POSTED_FILE, "utf-8")));
}

const feeds = [
    { url: "https://news.xbox.com/en-us/feed/", name: "Xbox News", color: 0x107C10 },
    { url: "https://blogs.microsoft.com/feed/", name: "Microsoft News", color: 0x00A4EF },
    { url: "https://n4g.com/rss/", name: "N4G Gaming News", color: 0xFF4500 },
    { url: "https://www.epicbundle.com/feed/", name: "Epic Bundles", color: 0x313131 },
    { url: "https://www.reddit.com/r/FreeGameFindings/new/.rss", name: "Reddit FreeGameFindings", color: 0xFF4500 },
    { url: "https://epicgames4free.webnode.page/rss/all.xml", name: "Epic All RSS", color: 0x00FFFF }
];

function isImportant(item) {
    const text = (item.title + " " + (item.contentSnippet || "")).toLowerCase();
    return IMPORTANT_KEYWORDS.some(keyword => text.includes(keyword));
}

async function sendToWebhook(item, sourceName, color) {
    if (postedLinks.has(item.link) || !isImportant(item)) return;

    postedLinks.add(item.link);
    fs.writeFileSync(POSTED_FILE, JSON.stringify([...postedLinks], null, 2));

    const embed = {
        title: item.title,
        url: item.link,
        description: item.contentSnippet || "Click to read more.",
        color: color,
        footer: { text: sourceName },
        timestamp: new Date(item.pubDate || Date.now())
    };

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
    } catch (err) {
        console.error(`Webhook error for ${sourceName}:`, err.message);
    }
}

async function checkFeeds() {
    for (const feed of feeds) {
        try {
            const rss = await parser.parseURL(feed.url);
            const newItems = rss.items
                .filter(item => !postedLinks.has(item.link) && isImportant(item));
            const toPost = newItems.slice(0, 2);

            toPost.forEach((item, index) => {
                setTimeout(() => sendToWebhook(item, feed.name, feed.color), index * 300000);
            });
        } catch (err) {
            console.error(`Feed error (${feed.name}):`, err.message);
        }
    }
}

setInterval(checkFeeds, 1800000);
checkFeeds();
import fs from 'fs/promises';
import Parser from 'rss-parser';
import fetch from 'node-fetch';

const parser = new Parser();
const POSTED_FILE = '/data/postedLinks.json';
const MAX_AGE_DAYS = 21;

// Ensure /data folder exists and postedLinks.json exists
async function ensureDataFile() {
    try {
        await fs.mkdir('/data', { recursive: true });
        try {
            await fs.access(POSTED_FILE);
        } catch {
            await fs.writeFile(POSTED_FILE, JSON.stringify([]));
        }
    } catch (err) {
        console.error("Error ensuring data file:", err);
    }
}

// Load posted links and prune old
async function loadPostedLinks() {
    await ensureDataFile();
    const data = await fs.readFile(POSTED_FILE, 'utf8');
    let links = JSON.parse(data);
    const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    links = links.filter(l => l.timestamp >= cutoff);
    return links;
}

// Save posted links
async function savePostedLinks(links) {
    await ensureDataFile();
    await fs.writeFile(POSTED_FILE, JSON.stringify(links, null, 2));
}

// Send message to webhook
async function sendToWebhook(webhookUrl, post) {
    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: post.title })
        });
        if (!res.ok) throw new Error(`Webhook failed: ${res.status}`);
        console.log(`Posted: ${post.title}`);
    } catch (err) {
        console.error(`Webhook error for ${post.source}:`, err.message);
    }
}

// Main function
async function main() {
    const feeds = [
        { url: 'https://www.microsoft.com/en-us/rss', source: 'Microsoft News', webhook: process.env.WEBHOOK_MICROSOFT },
        { url: 'https://www.pcgamer.com/rss/', source: 'PC Gamer', webhook: process.env.WEBHOOK_PCGAMER },
        { url: 'https://blog.playstation.com/feed/', source: 'PlayStation Blog', webhook: process.env.WEBHOOK_PLAYSTATION }
        // Add more RSS feeds here
    ];

    let postedLinks = await loadPostedLinks();

    for (const feedInfo of feeds) {
        try {
            const feed = await parser.parseURL(feedInfo.url);
            for (const item of feed.items) {
                if (postedLinks.some(l => l.link === item.link)) continue;
                await sendToWebhook(feedInfo.webhook, { title: item.title, source: feedInfo.source });
                postedLinks.push({ link: item.link, timestamp: Date.now() });
            }
        } catch (err) {
            console.error(`Feed error (${feedInfo.source}):`, err.message);
        }
    }

    await savePostedLinks(postedLinks);
}

// Run main
main().catch(console.error);
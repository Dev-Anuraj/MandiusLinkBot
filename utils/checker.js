// utils/checker.js

import fetch from 'node-fetch';

export async function checkChatStatus(username) {
  try {
    const res = await fetch(`https://t.me/${username}`);
    if (res.status === 200) {
      const html = await res.text();
      if (html.includes("If you have <strong>Telegram</strong>, you can contact")) {
        return `✅ @${username} is live and public.`;
      } else if (html.includes("this channel can't be displayed")) {
        return `⚠️ @${username} is banned or unavailable.`;
      } else {
        return `ℹ️ @${username} exists but may be private or restricted.`;
      }
    } else if (res.status === 302 || res.status === 404) {
      return `❌ @${username} does not exist.`;
    }
    return `❓ Unknown status for @${username} (HTTP ${res.status})`;
  } catch (err) {
    return `❌ Error checking status: ${err.message}`;
  }
}

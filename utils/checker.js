async function checkChatStatus(username) {
    try {
        const res = await fetch(`https://t.me/${username}`);
        if (res.status === 200) return `✅ @${username} is live.`;
        if (res.status === 404) return `❌ @${username} is banned or removed.`;
        return `ℹ️ Unable to determine status for @${username}`;
    } catch (err) {
        return `⚠️ Error: ${err.message}`;
    }
}

module.exports = { checkChatStatus };
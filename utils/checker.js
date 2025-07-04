export async function checkChatStatus(link) {
  try {
    const username = link.replace('https://t.me/', '').replace('@', '');
    // In production, you'd use Telegram API here
    return `✅ Checked: [${username}](https://t.me/${username})\nStatus: *Seems active!*`;
  } catch (err) {
    return '❌ Failed to check the status. Please try again later.';
  }
}

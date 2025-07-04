// utils/checker.js
import axios from 'axios';

export async function checkChatStatus(link) {
  try {
    // For now, just simulate a response
    if (link.includes('t.me/')) {
      return `✅ The link [${link}] appears to be working.`;
    }
    return `❌ Invalid link format.`;
  } catch (error) {
    return `⚠️ Error checking link: ${error.message}`;
  }
}

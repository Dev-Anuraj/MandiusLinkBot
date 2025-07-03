function generateReport({ link, reason, chatId }) {
    return `📩 Report Sent! Details:
  - Chat ID: ${chatId}
  - Link: ${link}
  - Reason: ${reason}`;
}

module.exports = { generateReport };

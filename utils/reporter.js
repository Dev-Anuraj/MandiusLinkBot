// utils/reporter.js

export function generateReport(session) {
  return `📩 Report Sent! Details:
- Chat ID: ${session.chatId}
- Link: ${session.link}
- Reason: ${session.reason}`;
}

// utils/logger.js

export function logJoinLeave(msg, action) {
  const user = msg.left_chat_member || msg.new_chat_members?.[0];
  if (!user) return;

  const username = user.username
    ? `@${user.username}`
    : `${user.first_name} ${user.last_name || ''}`;
    
  console.log(`ℹ️ User ${username} ${action} the group ${msg.chat.title}`);
}

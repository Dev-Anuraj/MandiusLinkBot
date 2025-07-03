function logJoinLeave(msg, action) {
    const user = msg.left_chat_member || msg.new_chat_members[0];
    console.log(`User ${user.username || user.first_name} ${action} the chat ${msg.chat.title}`);
}

module.exports = { logJoinLeave };
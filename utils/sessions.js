const sessions = {};

function startSession(chatId) {
    sessions[chatId] = { step: 'awaiting_link' };
}

function updateSession(chatId, data) {
    if (!sessions[chatId]) return;
    Object.assign(sessions[chatId], data);
}

function getSession(chatId) {
    return sessions[chatId];
}

function endSession(chatId) {
    delete sessions[chatId];
}

module.exports = { startSession, updateSession, getSession, endSession };
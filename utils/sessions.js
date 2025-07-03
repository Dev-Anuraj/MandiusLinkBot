// utils/sessions.js

const sessions = new Map();

export function startSession(userId) {
  sessions.set(userId, { step: 'awaitingLink' });
}

export function updateSession(userId, data) {
  const session = sessions.get(userId);
  if (session) {
    sessions.set(userId, { ...session, ...data });
  }
}

export function getSession(userId) {
  return sessions.get(userId);
}

export function endSession(userId) {
  sessions.delete(userId);
}

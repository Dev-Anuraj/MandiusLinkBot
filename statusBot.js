import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import { checkChatStatus } from './utils/checker.js';
import { logJoinLeave } from './utils/logger.js';
import { generateReport } from './utils/reporter.js';
import { startSession, updateSession, getSession, endSession } from './utils/sessions.js';
import blacklist from './blacklist.json' assert { type: 'json' };

const app = express();
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;

const bot = new TelegramBot(TOKEN);
bot.setWebHook(`${URL}/bot${TOKEN}`);

app.use(express.json());
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome to Mandius Link Checker Bot!");
});

bot.onText(/\/check (.+)/, async (msg, match) => {
  const username = match[1].trim();
  const chatId = msg.chat.id;
  const status = await checkChatStatus(username);
  bot.sendMessage(chatId, status);
});

bot.onText(/\/report/, (msg) => {
  const chatId = msg.chat.id;
  startSession(chatId);
  bot.sendMessage(chatId, "Session created. Send the message or channel/bot link to report.");
});

bot.onText(/\/reply (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const session = getSession(chatId);
  if (!session) return bot.sendMessage(chatId, "No active report session. Use /report to start one.");

  if (session.step === 'awaiting_link') {
    updateSession(chatId, { step: 'awaiting_reason', link: match[1] });
    return bot.sendMessage(chatId, "Please explain the violation.");
  }

  if (session.step === 'awaiting_reason') {
    const reason = match[1];
    const report = generateReport({ link: session.link, reason, chatId });
    bot.sendMessage(chatId, report);
    endSession(chatId);
  }
});

bot.on("new_chat_members", (msg) => {
  msg.new_chat_members.forEach((member) => {
    bot.sendMessage(
      msg.chat.id,
      `👋 Welcome [${member.first_name}](tg://user?id=${member.id})!`,
      { parse_mode: "Markdown" }
    );
  });
});

bot.on("left_chat_member", (msg) => logJoinLeave(msg, "left"));
bot.on("new_chat_members", (msg) => logJoinLeave(msg, "joined"));

bot.on("message", (msg) => {
  if (!msg.text) return;
  const text = msg.text.toLowerCase();
  if (blacklist.some((word) => text.includes(word))) {
    bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
    bot.sendMessage(msg.chat.id, "Rule violation. Message deleted.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error(`❌ Server error: ${err}`);
  }
});


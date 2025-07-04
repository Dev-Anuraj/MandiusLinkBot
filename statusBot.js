import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { checkChatStatus } from './utils/checker.js';

dotenv.config();

const PORT = process.env.PORT || 10000;
const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL;

const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { webHook: { port: PORT } });
bot.setWebHook(`${URL}/bot${TOKEN}`);

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// /start command
bot.onText(/\/start/, (msg) => {
  const welcome = `👋 Welcome *${msg.from.first_name || 'user'}*! I'm your assistant bot.

Here are my commands:
/start - Show welcome message
/check <link> - Check the status of a Telegram channel or bot

Just type "hi", "hello", or "hey" to greet me! 😄`;

  bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
});

// Greetings
bot.on('message', (msg) => {
  const text = msg.text?.toLowerCase();
  if (!text) return;

  const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hola'];
  if (greetings.includes(text)) {
    bot.sendMessage(msg.chat.id, `👋 Hello *${msg.from.first_name || 'there'}*!`, { parse_mode: 'Markdown' });
  }
});

// /check command
bot.onText(/\/check (.+)/, async (msg, match) => {
  const input = match[1].trim();
  const chatId = msg.chat.id;

  if (!input.startsWith('https://t.me/')) {
    return bot.sendMessage(chatId, 'Please provide a valid Telegram link starting with https://t.me/');
  }

  const result = await checkChatStatus(input);
  bot.sendMessage(chatId, result);
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Express server running on port ${PORT}`);
});

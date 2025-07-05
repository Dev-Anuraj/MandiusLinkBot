import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
// Assuming checker.js exists in the utils folder as shown in the image
import { checkChatStatus } from './utils/checker.js';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
// Render will provide process.env.PORT. Use a different fallback for local development.
const PORT = process.env.PORT || 5000; // Changed fallback port to 5000
const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL; // This should be your Render service's external URL

// Check if essential environment variables are set
if (!TOKEN) {
    console.error('Error: BOT_TOKEN environment variable is not set. Please set it.');
    process.exit(1);
}
if (!URL) {
    console.warn('Warning: RENDER_EXTERNAL_URL environment variable is not set. Webhook might not work correctly.');
    // In a real Render deployment, this should be set automatically.
    // For local testing, you might need a tool like ngrok to expose your local server.
}

// Initialize Express app
const app = express();
app.use(express.json()); // To parse JSON bodies from Telegram updates

// Initialize Telegram Bot
// No polling option here, as it's intended for webhook mode on Render
const bot = new TelegramBot(TOKEN);

// Set the webhook URL with Telegram
const webhookUrl = `${URL}/bot${TOKEN}`;
bot.setWebHook(webhookUrl)
    .then(() => {
        console.log(`Webhook set to: ${webhookUrl}`);
    })
    .catch(err => {
        console.error('Failed to set webhook:', err.message);
        // Important: If webhook fails to set, the bot won't receive messages.
        // Consider exiting the process or logging a critical error.
    });

// Handle incoming Telegram updates via the webhook
app.post(`/bot${TOKEN}`, (req, res) => {
    // Process the incoming update from Telegram
    bot.processUpdate(req.body);
    // IMPORTANT: Respond with 200 OK to Telegram immediately to acknowledge receipt
    res.sendStatus(200);
});

// Simple root route to indicate the server is running
app.get('/', (req, res) => {
    res.send('Telegram Bot Webhook Server is running!');
});

// --- Bot Command Handlers ---

// Listen for the /start command
bot.onText(/\/start/, (msg) => {
    const welcome = `👋 Welcome *${msg.from.first_name || 'user'}*! I'm your assistant bot.

Here are my commands:
/start - Show welcome message
/check <link_or_username> - Check the status of a Telegram channel or bot`; // Updated command description

    bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
});

// Greetings
bot.on('message', (msg) => {
    const text = msg.text?.toLowerCase();
    if (!text) return; // Ignore messages without text

    const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hola'];
    if (greetings.includes(text)) {
        bot.sendMessage(msg.chat.id, `👋 Hello *${msg.from.first_name || 'there'}*!`, { parse_mode: 'Markdown' });
    }
});

// /check command - Now handles links and usernames
bot.onText(/\/check (.+)/, async (msg, match) => {
    const input = match[1].trim(); // The text after /check
    const chatId = msg.chat.id;

    let targetLink;

    // Case 1: Input is already a full Telegram link
    if (input.startsWith('https://t.me/')) {
        targetLink = input;
    }
    // Case 2: Input is a username starting with '@'
    else if (input.startsWith('@')) {
        const username = input.substring(1); // Remove the '@' symbol
        targetLink = `https://t.me/${username}`;
    }
    // Case 3: Input is a plain username (alphanumeric and underscore only)
    // This regex checks for valid Telegram usernames (can contain letters, numbers, and underscores)
    else if (input.match(/^[a-zA-Z0-9_]+$/)) {
        targetLink = `https://t.me/${input}`;
    }
    // Case 4: Invalid input format
    else {
        return bot.sendMessage(
            chatId,
            'Please provide a valid Telegram link (e.g., `https://t.me/channel_name`) or a username (e.g., `@channel_name` or `channel_name`).'
        );
    }

    try {
        // Call the checkChatStatus function with the normalized link
        // IMPORTANT: Ensure your checkChatStatus function can handle both channel and bot links
        const result = await checkChatStatus(targetLink);
        bot.sendMessage(chatId, result);
    } catch (error) {
        console.error(`Error checking chat status for ${targetLink}:`, error.message);
        bot.sendMessage(chatId, `An error occurred while checking the link/username. Please try again later.`);
    }
});

// --- Error Handling for Bot ---
bot.on('polling_error', (error) => {
    // This will only log if polling is accidentally enabled or if there's a misconfiguration
    console.error('Polling error (should not happen in webhook mode):', error.code, error.message);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.code, error.message);
});

// Listen for any unhandled messages (optional, for debugging or default responses)
bot.on('message', (msg) => {
    // If the message is not a command, provide a general response
    if (msg.text && !msg.text.startsWith('/')) {
        // Only respond if it's not a greeting already handled
        const lowerText = msg.text.toLowerCase();
        const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hola'];
        if (!greetings.includes(lowerText)) {
            bot.sendMessage(msg.chat.id, "I received your message! Try using one of my commands like /start or /check.");
        }
    }
});


// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 Express server running on port ${PORT}`);
    console.log('Bot is ready to receive messages.');
});

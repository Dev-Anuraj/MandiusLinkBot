import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Import the enhanced checkChatStatus function
import { checkChatStatus } from './utils/checker.js';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const PORT = process.env.PORT || 5000; // Render will provide process.env.PORT. Fallback for local.
const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL; // Your Render service's external URL

// Check if essential environment variables are set
if (!TOKEN) {
    console.error('Error: BOT_TOKEN environment variable is not set. Please set it.');
    process.exit(1);
}
if (!URL) {
    console.warn('Warning: RENDER_EXTERNAL_URL environment variable is not set. Webhook might not work correctly.');
}

// Initialize Express app
const app = express();
app.use(express.json()); // To parse JSON bodies from Telegram updates

// Initialize Telegram Bot
const bot = new TelegramBot(TOKEN);

// Set the webhook URL with Telegram
const webhookUrl = `${URL}/bot${TOKEN}`;
bot.setWebHook(webhookUrl)
    .then(() => {
        console.log(`Webhook set to: ${webhookUrl}`);
    })
    .catch(err => {
        console.error('Failed to set webhook:', err.message);
    });

// Handle incoming Telegram updates via the webhook
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200); // Respond with 200 OK to Telegram immediately
});

// Simple root route to indicate the server is running
app.get('/', (req, res) => {
    res.send('Telegram Bot Webhook Server is running!');
});

// --- Bot Command Handlers ---

// Listen for the /start command
bot.onText(/\/start/, (msg) => {
    const welcome = `👋 Welcome *${msg.from.first_name || 'user'}*! I'm your Telegram Status Monitor.

My primary function is to provide real-time status checks for Telegram channels, usernames, and bots.

Here are my commands:
• /start - Display this welcome message.
• /check <link_or_username> - Instantly check the status of a Telegram entity.
• /help - Get a detailed list of commands and usage instructions.`;

    bot.sendMessage(msg.chat.id, welcome, { parse_mode: 'Markdown' });
});

// Greetings
bot.on('message', async (msg) => {
    const text = msg.text?.toLowerCase();
    if (!text) return; // Ignore messages without text

    const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hola'];
    if (greetings.includes(text)) {
        const greetingMessage = `👋 Hello *${msg.from.first_name || 'there'}*!

I specialize in providing real-time status updates for Telegram channels, usernames, and bots with actual data.

To get started, you can:
• Use the \`/check <link_or_username>\` command\. For example:
  \`\/check @telegram\`
  \`\/check https:\/\/t\.me\/botfather\`
• Or, for a complete overview of my capabilities, simply type \/help\.

I'm here to assist you with precise and professional status monitoring\.`;

        try {
            await bot.sendMessage(msg.chat.id, greetingMessage, { parse_mode: 'MarkdownV2' }); // Use MarkdownV2 for clickable links
        } catch (error) {
            console.error('Error sending greeting message:', error.message);
        }
    } else if (!text.startsWith('/')) { // Only respond if it's not a command and not a greeting
        bot.sendMessage(msg.chat.id, "I received your message! Please use a command like /check or /help to interact with me.");
    }
});

// /check command - Now handles links and usernames
bot.onText(/\/check (.+)/, async (msg, match) => {
    const input = match[1].trim(); // The text after /check
    const chatId = msg.chat.id;

    let targetIdentifier; // This will be the username or chat ID

    // Case 1: Input is a full Telegram link
    if (input.startsWith('https://t.me/')) {
        targetIdentifier = input.substring(input.lastIndexOf('/') + 1);
        if (targetIdentifier.startsWith('+')) { // Handle invite links with chat ID
            // Telegram bot API getChat requires chat ID to be prefixed with '-' for channels/supergroups
            targetIdentifier = `-${targetIdentifier.substring(1)}`;
        } else if (!targetIdentifier.startsWith('@')) { // Ensure username from link starts with @
            targetIdentifier = `@${targetIdentifier}`;
        }
    }
    // Case 2: Input is a username starting with '@'
    else if (input.startsWith('@')) {
        targetIdentifier = input;
    }
    // Case 3: Input is a plain username (alphanumeric and underscore only)
    else if (input.match(/^[a-zA-Z0-9_]+$/)) {
        targetIdentifier = `@${input}`;
    }
    // Case 4: Invalid input format
    else {
        return bot.sendMessage(
            chatId,
            'Please provide a valid Telegram link (e.g., `https://t.me/channel_name`) or a username (e.g., `@channel_name` or `channel_name`).'
        );
    }

    // Send a "checking..." message
    const processingMessage = await bot.sendMessage(chatId, `🔍 Checking status for \`${input}\`...`);

    try {
        // Pass the bot instance to checkChatStatus
        const result = await checkChatStatus(bot, targetIdentifier);
        // Edit the "checking..." message with the actual result
        await bot.editMessageText(result, {
            chat_id: processingMessage.chat.id,
            message_id: processingMessage.message_id,
            parse_mode: 'MarkdownV2'
        });
    } catch (error) {
        console.error(`Error checking chat status for ${targetIdentifier}:`, error.message);
        const errorMessage = `❌ An error occurred while checking the status for \`${input}\`\. Please ensure the link\/username is correct and try again later\. Error: ${error.message}`;
        // Edit the "checking..." message with the error
        await bot.editMessageText(errorMessage, {
            chat_id: processingMessage.chat.id,
            message_id: processingMessage.message_id,
            parse_mode: 'MarkdownV2'
        });
    }
});

// Listen for the /help command
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `*Telegram Status Monitor - Help*

I am designed to provide real-time status checks for Telegram channels, usernames, and bots.

*Available Commands:*
• \`/start\` - Display the welcome message and a brief overview.
• \`/check <link_or_username>\` - Use this command to get the current status of a Telegram entity.
  * *Examples:*
      * \`\/check @mychannel\`
      * \`\/check mybotusername\`
      * \`\/check https:\/\/t\.me\/anotherchannel\`

I strive to provide accurate and timely information for your monitoring needs\.`;

    try {
        await bot.sendMessage(chatId, helpMessage, { parse_mode: 'MarkdownV2' });
        console.log(`Received /help from ${msg.from.first_name} (${chatId})`);
    } catch (error) {
        console.error('Error sending /help message:', error.message);
    }
});


// --- Error Handling for Bot ---
bot.on('polling_error', (error) => {
    console.error('Polling error (should not happen in webhook mode):', error.code, error.message);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.code, error.message);
});

// --- Main execution flow ---
// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 Express server running on port ${PORT}`);
    console.log('Bot is ready to receive messages.');
});

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Import all utility functions
import { checkChatStatus } from './utils/checker.js';
import { logJoinLeave } from './utils/logger.js';
import { generateReport } from './utils/reporter.js';
import { startSession, updateSession, getSession, endSession } from './utils/sessions.js';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const PORT = process.env.PORT || 5000; // Render will provide process.env.PORT. Fallback for local.
const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL; // Your Render service's external URL
const DEFAULT_CHANNEL_CHAT_ID = process.env.TELEGRAM_CHANNEL_CHAT_ID; // For reporting feature

// Check if essential environment variables are set
if (!TOKEN) {
    console.error('Error: BOT_TOKEN environment variable is not set. Please set it.');
    process.exit(1);
}
if (!URL) {
    console.warn('Warning: RENDER_EXTERNAL_URL environment variable is not set. Webhook might not work correctly.');
}
if (!DEFAULT_CHANNEL_CHAT_ID) {
    console.warn('Warning: TELEGRAM_CHANNEL_CHAT_ID environment variable is not set. Default reports will fail.');
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
        // If webhook fails to set, the bot won't receive messages.
        // Consider exiting the process or logging a critical error.
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
    const welcome = `👋 Welcome *${msg.from.first_name || 'user'}*! I'm your assistant bot.

Here are my commands:
/start - Show welcome message
/check <link_or_username> - Check the status of a Telegram channel or bot
/report - Start a guided process to send a report
/report <channel_username_or_id> <your_message> - Send a quick report
/cancel - Cancel any ongoing operation`; // Updated command description

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
        const result = await checkChatStatus(targetLink);
        bot.sendMessage(chatId, result);
    } catch (error) {
        console.error(`Error checking chat status for ${targetLink}:`, error.message);
        bot.sendMessage(chatId, `An error occurred while checking the link/username. Please try again later.`);
    }
});

// --- Integration of utils/logger.js ---
// Listen for new chat members
bot.on('new_chat_members', (msg) => {
    logJoinLeave(msg, 'joined');
});

// Listen for left chat members
bot.on('left_chat_member', (msg) => {
    logJoinLeave(msg, 'left');
});

// --- Integration of utils/sessions.js and utils/reporter.js for /report command ---

// Listen for /report command (with or without arguments)
bot.onText(/\/report(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const fullText = match[1]?.trim(); // The text after /report, if any

    // If fullText is provided, try to process as a one-liner report
    if (fullText) {
        let targetChat = DEFAULT_CHANNEL_CHAT_ID;
        let reportContent = fullText;

        const parts = fullText.split(' ');
        // Check if the first part looks like a channel username or ID
        if (parts.length > 1 && (parts[0].startsWith('@') || /^-?\d+$/.test(parts[0]))) {
            targetChat = parts[0]; // Use the provided username/ID as target
            reportContent = parts.slice(1).join(' '); // The rest is the message
        } else if (!DEFAULT_CHANNEL_CHAT_ID) {
            // If no target provided and no default channel set
            return bot.sendMessage(chatId, 'Error: No target channel specified and no default channel configured. ' +
                                     'Please use `/report @channel_username Your message` or set `TELEGRAM_CHANNEL_CHAT_ID` environment variable.');
        }

        if (!reportContent.trim()) {
            return bot.sendMessage(chatId, 'Please provide a message to report. Example: `/report @my_channel This is my message.` or `/report This is my message.`');
        }

        const sessionData = {
            chatId: targetChat,
            link: targetChat, // For reporter, we can use targetChat as link
            reason: reportContent,
            reporterName: msg.from.first_name || 'Someone'
        };

        try {
            const finalReport = generateReport(sessionData);
            await bot.sendMessage(targetChat, finalReport, { parse_mode: 'Markdown' });
            bot.sendMessage(chatId, `Report sent to ${targetChat} successfully!`);
            console.log(`Report sent to ${targetChat} by ${sessionData.reporterName}`);
        } catch (error) {
            console.error(`Error sending report to ${targetChat}:`, error.message);
            let errorMessage = `Failed to send report to ${targetChat}. Error: ${error.message}`;
            if (error.response && error.response.body && error.response.body.description) {
                errorMessage += `\nTelegram API Error: ${error.response.body.description}`;
            }
            bot.sendMessage(chatId, errorMessage);
        }
        return; // Exit after processing one-liner report
    }

    // If no fullText, start a guided session for reporting
    startSession(userId);
    bot.sendMessage(chatId, 'Okay, let\'s start a new report. What is the Telegram link (channel or bot) or username you want to report about? (e.g., `https://t.me/mychannel` or `@mybot`)');
    updateSession(userId, { step: 'awaitingReportLink' });
});

// Listen for /cancel command to end any ongoing session
bot.onText(/\/cancel/, (msg) => {
    const userId = msg.from.id;
    if (getSession(userId)) {
        endSession(userId);
        bot.sendMessage(msg.chat.id, 'Report creation cancelled.');
    } else {
        bot.sendMessage(msg.chat.id, 'No active report session to cancel.');
    }
});

// General message handler for session-based interactions
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Ignore commands (they are handled by onText) and messages without text
    if (!text || text.startsWith('/')) {
        return;
    }

    const session = getSession(userId);

    if (session) {
        switch (session.step) {
            case 'awaitingReportLink':
                let targetLink;
                // Normalize input for the link
                if (text.startsWith('https://t.me/')) {
                    targetLink = text;
                } else if (text.startsWith('@')) {
                    const username = text.substring(1);
                    targetLink = `https://t.me/${username}`;
                } else if (text.match(/^[a-zA-Z0-9_]+$/)) {
                    targetLink = `https://t.me/${text}`;
                } else {
                    return bot.sendMessage(
                        chatId,
                        'Invalid link or username format. Please provide a valid Telegram link (e.g., `https://t.me/channel_name`) or a username (e.g., `@channel_name` or `channel_name`).'
                    );
                }

                updateSession(userId, { link: targetLink, step: 'awaitingReportReason' });
                bot.sendMessage(chatId, `Got it. The report will be about: ${targetLink}. Now, please describe the reason for your report.`);
                break;

            case 'awaitingReportReason':
                const reportReason = text.trim();
                if (!reportReason) {
                    return bot.sendMessage(chatId, 'Please provide a reason for the report.');
                }

                updateSession(userId, { reason: reportReason });

                // Finalize and send the report
                const finalSessionData = getSession(userId);
                const reporterName = msg.from.first_name || 'Someone';

                // Determine target chat for the report. Prioritize default if available.
                // For session-based reports, we assume it goes to the DEFAULT_CHANNEL_CHAT_ID
                const reportTargetChat = DEFAULT_CHANNEL_CHAT_ID;

                if (!reportTargetChat) {
                    endSession(userId);
                    return bot.sendMessage(chatId, 'Error: No default channel configured to send the report. Please set `TELEGRAM_CHANNEL_CHAT_ID` environment variable.');
                }

                const reportDetails = {
                    chatId: reportTargetChat, // The target chat for the report
                    link: finalSessionData.link,
                    reason: finalSessionData.reason,
                    reporterName: reporterName // Add reporter name for the generateReport function
                };

                try {
                    const finalReportMessage = generateReport(reportDetails);
                    await bot.sendMessage(reportTargetChat, finalReportMessage, { parse_mode: 'Markdown' });
                    bot.sendMessage(chatId, `Report sent to ${reportTargetChat} successfully!`);
                    console.log(`Report sent to ${reportTargetChat} by ${reporterName}`);
                } catch (error) {
                    console.error(`Error sending report to ${reportTargetChat}:`, error.message);
                    let errorMessage = `Failed to send report to ${reportTargetChat}. Error: ${error.message}`;
                    if (error.response && error.response.body && error.response.body.description) {
                        errorMessage += `\nTelegram API Error: ${error.response.body.description}`;
                    }
                    bot.sendMessage(chatId, errorMessage);
                } finally {
                    endSession(userId); // Always end session after report attempt
                }
                break;

            default:
                // If a session exists but the step is unknown (shouldn't happen with proper flow)
                bot.sendMessage(chatId, "I'm not sure what to do with that. Type /cancel to end the current operation.");
                break;
        }
    } else {
        // If no active session and not a command, provide a general response
        const lowerText = text.toLowerCase();
        const greetings = ['hi', 'hello', 'hey', 'hii', 'helo', 'hola'];
        if (!greetings.includes(lowerText)) { // Avoid double greeting
            bot.sendMessage(chatId, "I received your message! Try using one of my commands like /start or /check.");
        }
    }
});


// --- Error Handling for Bot ---
bot.on('polling_error', (error) => {
    console.error('Polling error (should not happen in webhook mode):', error.code, error.message);
});

bot.on('webhook_error', (error) => {
    console.error('Webhook error:', error.code, error.message);
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 Express server running on port ${PORT}`);
    console.log('Bot is ready to receive messages.');
});

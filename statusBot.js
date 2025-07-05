import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

// Import all utility functions
import { checkChatStatus } from './utils/checker.js';
import { logJoinLeave } from './utils/logger.js';
import { generateReport } from './utils/reporter.js';
import { startSession, updateSession, getSession, endSession } from './utils/sessions.js';

// Import Firestore modules
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, getDoc, query, where, getDocs } from 'firebase/firestore';

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---
const PORT = process.env.PORT || 5000; // Render will provide process.env.PORT. Fallback for local.
const TOKEN = process.env.BOT_TOKEN;
const URL = process.env.RENDER_EXTERNAL_URL; // Your Render service's external URL
const DEFAULT_CHANNEL_CHAT_ID = process.env.TELEGRAM_CHANNEL_CHAT_ID; // For reporting feature

// Global Firebase variables (will be initialized later)
let firebaseApp;
let db;
let auth;
let currentUserId = null; // To store the authenticated user ID
let firebaseAuthReady = false; // New flag to indicate Firebase auth state is known

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
// This needs to be done early so Telegram can reach the bot
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

// --- Firebase Initialization and Authentication ---
async function initializeFirebase() {
    try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

        console.log("Firebase Init: App ID:", appId);
        console.log("Firebase Init: Config provided:", Object.keys(firebaseConfig).length > 0);

        if (Object.keys(firebaseConfig).length === 0) {
            console.error("Firebase config is not available. Firestore operations will not work.");
            firebaseAuthReady = false; // Ensure flag is false if config is missing
            return; // Exit if no config
        }

        firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        auth = getAuth(firebaseApp);

        // Use a promise to wait for the initial auth state to be known
        await new Promise(resolve => {
            const unsubscribe = onAuthStateChanged(auth, async (user) => {
                console.log("Firebase Auth: onAuthStateChanged triggered.");
                if (user) {
                    currentUserId = user.uid;
                    console.log("Firebase Auth: User signed in. UID:", currentUserId);
                } else {
                    // Try to sign in anonymously if no user is found (e.g., first run or token expired)
                    try {
                        console.log("Firebase Auth: No user signed in. Attempting anonymous sign-in...");
                        // Check if __initial_auth_token is defined and use it
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(auth, __initial_auth_token);
                            console.log("Firebase Auth: Signed in with custom token.");
                        } else {
                            await signInAnonymously(auth);
                            console.log("Firebase Auth: Signed in anonymously.");
                        }
                        currentUserId = auth.currentUser?.uid; // Set after sign-in attempt
                        console.log("Firebase Auth: Current User ID after sign-in attempt:", currentUserId);
                    } catch (anonError) {
                        console.error("Firebase Auth: Anonymous/Custom Token sign-in failed:", anonError.message);
                        currentUserId = null;
                    }
                }
                firebaseAuthReady = true; // Set flag once initial state is known
                console.log("Firebase Auth: firebaseAuthReady set to true.");
                unsubscribe(); // Unsubscribe after the first call to prevent multiple resolves
                resolve();
            });
        });

        console.log("Firebase initialized and initial authentication state determined. Final currentUserId:", currentUserId);
    } catch (error) {
        console.error("Firebase Init: Failed to initialize Firebase or authenticate:", error.message);
        firebaseAuthReady = false; // Ensure flag is false if initialization fails
    }
}

// --- Firestore Utility Functions for Monitored Users ---
async function getMonitoredUsersCollectionRef(userId) {
    console.log("Firestore Util: getMonitoredUsersCollectionRef called with userId:", userId);
    if (!db || !userId) {
        console.error("Firestore Util: DB or User ID not available for collection reference. db:", !!db, "userId:", userId);
        return null;
    }
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
    return collection(db, `artifacts/${appId}/users/${userId}/monitoredUsers`);
}

async function addMonitoredUser(userId, usernameToAdd, addedBy) {
    console.log(`Firestore Util: addMonitoredUser called for userId: ${userId}, username: ${usernameToAdd}`);
    if (!db || !userId) {
        console.error("Firestore Util: DB or User ID not available to add user. db:", !!db, "userId:", userId);
        return { success: false, message: "Service not ready." };
    }

    const usersCollectionRef = await getMonitoredUsersCollectionRef(userId);
    if (!usersCollectionRef) {
        console.error("Firestore Util: Could not get collection reference for addMonitoredUser.");
        return { success: false, message: "Could not get collection reference." };
    }

    // Create a document ID from the username for easy lookup and to prevent duplicates
    const userDocRef = doc(usersCollectionRef, usernameToAdd.replace(/[^a-zA-Z0-9_]/g, '')); // Sanitize username for doc ID

    try {
        const docSnap = await getDoc(userDocRef);
        if (docSnap.exists()) {
            console.log(`Firestore Util: User ${usernameToAdd} already exists.`);
            return { success: false, message: `User ${usernameToAdd} is already being monitored.` };
        } else {
            await setDoc(userDocRef, {
                username: normalizedUsername, // Use normalized username for consistency
                addedBy: addedBy,
                addedAt: new Date().toISOString(),
                // You can add more fields here like 'status', 'lastChecked', etc.
            });
            console.log(`Firestore Util: User ${usernameToAdd} added successfully.`);
            return { success: true, message: `User ${usernameToAdd} added to monitoring list.` };
        }
    } catch (error) {
        console.error(`Firestore Util: Error adding user ${usernameToAdd} to Firestore:`, error.message);
        return { success: false, message: `Failed to add ${usernameToAdd}: ${error.message}` };
    }
}

async function isUserMonitored(userId, usernameToCheck) {
    console.log(`Firestore Util: isUserMonitored called for userId: ${userId}, username: ${usernameToCheck}`);
    if (!db || !userId) {
        console.error("Firestore Util: DB or User ID not available to check user. db:", !!db, "userId:", userId);
        return false;
    }
    const usersCollectionRef = await getMonitoredUsersCollectionRef(userId);
    if (!usersCollectionRef) {
        console.error("Firestore Util: Could not get collection reference for isUserMonitored.");
        return false;
    }

    const userDocRef = doc(usersCollectionRef, usernameToCheck.replace(/[^a-zA-Z0-9_]/g, ''));
    try {
        const docSnap = await getDoc(userDocRef);
        return docSnap.exists();
    } catch (error) {
        console.error(`Firestore Util: Error checking if user ${usernameToCheck} is monitored:`, error.message);
        return false;
    }
}


// --- Bot Command Handlers ---

// Listen for the /start command
bot.onText(/\/start/, (msg) => {
    const welcome = `👋 Welcome *${msg.from.first_name || 'user'}*! I'm your assistant bot.

Here are my commands:
/start - Show welcome message
/check <link_or_username> - Check the status of a Telegram channel or bot
/report - Start a guided process to send a report
/report <channel_username_or_id> <your_message> - Send a quick report
/add3 <username1> <username2> ... - Add multiple usernames to the monitoring list
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

// --- New Feature: /add3 command to add multiple usernames to monitoring list ---
bot.onText(/\/add3 (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const addedBy = msg.from.username ? `@${msg.from.username}` : msg.from.first_name || 'Anonymous';

    console.log("Add3 Command: Checking Firebase readiness...");
    console.log("Add3 Command: firebaseAuthReady:", firebaseAuthReady);
    console.log("Add3 Command: currentUserId:", currentUserId);

    // Check if Firebase authentication is ready AND currentUserId is set
    if (!firebaseAuthReady || !currentUserId) {
        return bot.sendMessage(chatId, "The bot is still initializing its database connection. Please try again in a few moments.");
    }
    if (!db) {
        return bot.sendMessage(chatId, "Firestore is not available. Cannot add users.");
    }

    const usernamesInput = match[1].trim();
    // Split by spaces, filter out empty strings, and ensure they start with '@' or are plain usernames
    let usernames = usernamesInput.split(/\s+/).filter(u => u.length > 0);

    if (usernames.length === 0) {
        return bot.sendMessage(chatId, 'Please provide at least one username to add. Example: `/add3 @user1 @user2`');
    }

    // Inform user that processing has started
    await bot.sendMessage(chatId, `Processing ${usernames.length} username(s)...`);

    for (const username of usernames) {
        // Normalize username: ensure it starts with '@'
        const normalizedUsername = username.startsWith('@') ? username : `@${username}`;

        // Basic validation for username format (can be expanded)
        if (!normalizedUsername.match(/^@[a-zA-Z0-9_]+$/)) {
            await bot.sendMessage(chatId, `⚠️ Invalid username format: \`${username}\`. Skipping.`);
            continue;
        }

        const result = await addMonitoredUser(currentUserId, normalizedUsername, addedBy); // Use currentUserId
        if (result.success) {
            await bot.sendMessage(chatId, `✅ Entità \`${normalizedUsername}\` aggiunta alla lista 3.`);
        } else {
            await bot.sendMessage(chatId, `❌ ${result.message}`);
        }
    }
    await bot.sendMessage(chatId, 'Finished processing all usernames.');
});


// General message handler for session-based interactions
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id; // Telegram user ID
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

// --- Main execution flow ---
// Wrap the server start in an async function to await Firebase initialization
(async () => {
    console.log('Main Flow: Starting Firebase initialization...');
    await initializeFirebase();
    console.log('Main Flow: Firebase initialization complete. Starting Express server...');

    // Start Express server ONLY after Firebase is ready
    app.listen(PORT, () => {
        console.log(`🚀 Express server running on port ${PORT}`);
        console.log('Bot is ready to receive messages.');
    });
})();

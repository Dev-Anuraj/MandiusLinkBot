import axios from 'axios'; // Keep axios if you need it for other web checks, but Telegram API is preferred here.

/**
 * Escapes special MarkdownV2 characters in a string.
 * @param {string} text The text to escape.
 * @returns {string} The escaped text.
 */
function escapeMarkdownV2(text) {
    if (!text) return '';
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Checks the status of a Telegram channel, username, or bot using the Telegram Bot API.
 * @param {object} bot The TelegramBot instance.
 * @param {string} identifier The username (e.g., "@channelname") or chat ID (e.g., "-1001234567890").
 * @returns {Promise<string>} A formatted string with the status details.
 */
export async function checkChatStatus(bot, identifier) {
    try {
        let chatInfo;
        let isBot = false;

        // Try to get chat info using getChat
        try {
            chatInfo = await bot.getChat(identifier);
            // Check if it's a bot by looking at the type and specific properties
            if (chatInfo.type === 'private' && chatInfo.username && chatInfo.username.endsWith('bot')) {
                // This is a heuristic, a more robust check involves getMe if you know it's a bot token
                // For a user-provided identifier, getChat is the primary way.
                // We'll try to refine if it's a bot using getMe later if needed.
            }
        } catch (getChatError) {
            // If getChat fails, it might be because it's a bot and getChat doesn't work for bots
            // or the identifier is invalid.
            // Let's try to get info about the bot itself if the identifier looks like a bot username
            if (identifier.endsWith('bot') && identifier.startsWith('@')) {
                try {
                    const botMe = await bot.getMe();
                    if (`@${botMe.username}`.toLowerCase() === identifier.toLowerCase()) {
                        chatInfo = botMe; // It's the bot itself
                        isBot = true;
                    }
                } catch (getMeError) {
                    // Ignore, it's not the bot itself or another error
                }
            }
            if (!chatInfo) { // If still no chatInfo, rethrow the original getChatError
                throw getChatError;
            }
        }

        let statusMessage = `*📊 Telegram Entity Status Report*\n\n`;

        if (isBot) {
            statusMessage += `*Entity Type:* Bot\n`;
            statusMessage += `*Name:* ${escapeMarkdownV2(chatInfo.first_name || 'N/A')}\n`;
            if (chatInfo.last_name) {
                statusMessage += `*Last Name:* ${escapeMarkdownV2(chatInfo.last_name)}\n`;
            }
            statusMessage += `*Username:* \`@${escapeMarkdownV2(chatInfo.username)}\`\n`;
            statusMessage += `*ID:* \`${chatInfo.id}\`\n`;
            statusMessage += `*Can Join Groups:* ${chatInfo.can_join_groups ? '✅ Yes' : '❌ No'}\n`;
            statusMessage += `*Can Read All Group Messages:* ${chatInfo.can_read_all_group_messages ? '✅ Yes' : '❌ No'}\n`;
            statusMessage += `*Supports Inline Queries:* ${chatInfo.supports_inline_queries ? '✅ Yes' : '❌ No'}\n`;
            statusMessage += `*Online Status:* ✅ Online (Bot API response received)\n`;
        } else {
            statusMessage += `*Entity Type:* ${escapeMarkdownV2(chatInfo.type.charAt(0).toUpperCase() + chatInfo.type.slice(1))}\n`;
            statusMessage += `*Title:* ${escapeMarkdownV2(chatInfo.title || chatInfo.first_name || 'N/A')}\n`;
            if (chatInfo.username) {
                statusMessage += `*Username:* \`@${escapeMarkdownV2(chatInfo.username)}\`\n`;
            }
            statusMessage += `*ID:* \`${chatInfo.id}\`\n`;

            if (chatInfo.type === 'channel' || chatInfo.type === 'supergroup') {
                try {
                    const memberCount = await bot.getChatMembersCount(identifier);
                    statusMessage += `*Members:* ${memberCount}\n`;
                } catch (countError) {
                    console.warn(`Could not get member count for ${identifier}:`, countError.message);
                    statusMessage += `*Members:* N/A (Could not retrieve)\n`;
                }
                statusMessage += `*Online Status:* ✅ Online (Chat API response received)\n`;
                statusMessage += `*Description:* ${escapeMarkdownV2(chatInfo.description || 'N/A')}\n`;
                statusMessage += `*Invite Link:* ${chatInfo.invite_link ? `[Click Here](${escapeMarkdownV2(chatInfo.invite_link)})` : 'N/A'}\n`;
            } else if (chatInfo.type === 'private') {
                statusMessage += `*First Name:* ${escapeMarkdownV2(chatInfo.first_name || 'N/A')}\n`;
                if (chatInfo.last_name) {
                    statusMessage += `*Last Name:* ${escapeMarkdownV2(chatInfo.last_name)}\n`;
                }
                statusMessage += `*Online Status:* ✅ Online (User profile accessible)\n`;
            }
        }

        return statusMessage;

    } catch (error) {
        console.error(`Error in checkChatStatus for ${identifier}:`, error.message);
        let errorMessage = `❌ Failed to retrieve status for \`${escapeMarkdownV2(identifier)}\`\.`;

        if (error.response && error.response.body) {
            const apiError = error.response.body;
            errorMessage += `\n*Telegram API Error:* ${escapeMarkdownV2(apiError.description || apiError.error_code || 'Unknown error')}`;
            if (apiError.error_code === 400 && apiError.description.includes('chat not found')) {
                errorMessage += `\n*Reason:* The channel\/bot\/user might be private, non-existent, or you do not have permission to access its information\.`;
            } else if (apiError.error_code === 403) {
                 errorMessage += `\n*Reason:* The bot might be blocked by the user\/channel, or it does not have the necessary permissions\.`;
            }
        } else {
            errorMessage += `\n*Reason:* Network error or invalid identifier\.`;
        }
        return errorMessage;
    }
}

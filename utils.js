// ==========================================
//  TELEGRAM API WRAPPER
// ==========================================

export function apiUrl(token, method, params = {}) {
    const clean = Object.fromEntries(
        Object.entries(params).filter(([_, v]) => v != null)
    );
    const qs = Object.keys(clean).length ? '?' + new URLSearchParams(clean).toString() : '';
    return `https://api.telegram.org/bot${token}/${method}${qs}`;
}

export async function sendMessage(token, chatId, text, options = {}) {
    const params = {
        chat_id: chatId,
        text,
        parse_mode: options.parse_mode || 'HTML',
        disable_web_page_preview: options.disable_web_page_preview ?? true,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendMessage', params));
}

export async function editMessage(token, chatId, msgId, text, options = {}) {
    const params = {
        chat_id: chatId,
        message_id: msgId,
        text,
        parse_mode: options.parse_mode || 'HTML',
        disable_web_page_preview: options.disable_web_page_preview ?? true,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'editMessageText', params));
}

export async function answerCallback(token, callbackId, text = null, alert = false) {
    const params = { callback_query_id: callbackId, show_alert: alert };
    if (text) params.text = text;
    return fetch(apiUrl(token, 'answerCallbackQuery', params));
}

export async function getChatMember(token, chatId, userId) {
    const res = await fetch(apiUrl(token, 'getChatMember', { chat_id: chatId, user_id: userId }));
    const json = await res.json();
    return json.ok ? json.result : null;
}

export async function getChatAdministrators(token, chatId) {
    const res = await fetch(apiUrl(token, 'getChatAdministrators', { chat_id: chatId }));
    const json = await res.json();
    return json.ok ? json.result : null;
}

export async function getMe(token) {
    const res = await fetch(apiUrl(token, 'getMe'));
    const json = await res.json();
    return json.ok ? json.result : null;
}

// Fungsi sementara untuk mendapatkan jumlah anggota (tidak tersedia di API, kembalikan 0)
export async function getChatMemberCount(token, chatId) {
    // Tidak ada endpoint resmi, kembalikan 0 untuk sementara
    return 0;
}

export async function restrictChatMember(token, chatId, userId, permissions, untilDate = null) {
    const params = {
        chat_id: chatId,
        user_id: userId,
        permissions: JSON.stringify(permissions)
    };
    if (untilDate) params.until_date = untilDate;
    return fetch(apiUrl(token, 'restrictChatMember', params));
}

export async function kickChatMember(token, chatId, userId) {
    return fetch(apiUrl(token, 'kickChatMember', { chat_id: chatId, user_id: userId }));
}

export async function unbanChatMember(token, chatId, userId) {
    return fetch(apiUrl(token, 'unbanChatMember', { chat_id: chatId, user_id: userId }));
}

export async function deleteMessage(token, chatId, messageId) {
    return fetch(apiUrl(token, 'deleteMessage', { chat_id: chatId, message_id: messageId }));
}

export async function sendSticker(token, chatId, stickerId, options = {}) {
    const params = {
        chat_id: chatId,
        sticker: stickerId,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendSticker', params));
}

export async function sendPhoto(token, chatId, photoId, options = {}) {
    const params = {
        chat_id: chatId,
        photo: photoId,
        caption: options.caption,
        parse_mode: options.parse_mode,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendPhoto', params));
}

export async function sendDocument(token, chatId, docId, options = {}) {
    const params = {
        chat_id: chatId,
        document: docId,
        caption: options.caption,
        parse_mode: options.parse_mode,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendDocument', params));
}

export async function sendAudio(token, chatId, audioId, options = {}) {
    const params = {
        chat_id: chatId,
        audio: audioId,
        caption: options.caption,
        parse_mode: options.parse_mode,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendAudio', params));
}

export async function sendVoice(token, chatId, voiceId, options = {}) {
    const params = {
        chat_id: chatId,
        voice: voiceId,
        caption: options.caption,
        parse_mode: options.parse_mode,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendVoice', params));
}

export async function sendVideo(token, chatId, videoId, options = {}) {
    const params = {
        chat_id: chatId,
        video: videoId,
        caption: options.caption,
        parse_mode: options.parse_mode,
        reply_to_message_id: options.reply_to_message_id,
        reply_markup: options.reply_markup ? JSON.stringify(options.reply_markup) : undefined
    };
    return fetch(apiUrl(token, 'sendVideo', params));
}

// ==========================================
//  DATABASE (D1) HELPERS
// ==========================================

export async function trackUser(db, user) {
    if (!user) return;
    await db.prepare(
        `INSERT OR REPLACE INTO users (user_id, first_name, last_name, username, language_code, is_bot)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
        user.id,
        user.first_name || '',
        user.last_name || '',
        user.username || '',
        user.language_code || '',
        user.is_bot ? 1 : 0
    ).run();
}

export async function trackChat(db, chat) {
    if (!chat) return;
    await db.prepare(
        `INSERT OR REPLACE INTO chats (chat_id, title, type, username)
         VALUES (?, ?, ?, ?)`
    ).bind(
        chat.id,
        chat.title || '',
        chat.type || '',
        chat.username || ''
    ).run();
}

export async function getUserCount(db) {
    const res = await db.prepare('SELECT COUNT(*) as count FROM users').first();
    return res?.count || 0;
}

export async function getChatCount(db) {
    const res = await db.prepare('SELECT COUNT(*) as count FROM chats').first();
    return res?.count || 0;
}

// ==========================================
//  FORMATTING & UTILITY
// ==========================================

export function getReadableTime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    let result = '';
    if (days > 0) result += `${days}h `;
    if (hours > 0) result += `${hours}j `;
    if (minutes > 0) result += `${minutes}m `;
    if (secs > 0) result += `${secs}d`;
    return result.trim() || '0d';
}

export function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function mentionHtml(userId, name) {
    return `<a href="tg://user?id=${userId}">${escapeHtml(name)}</a>`;
}

export function extractUser(message) {
    if (!message) return null;
    if (message.reply_to_message?.from) {
        return message.reply_to_message.from.id;
    }
    const args = message.text?.split(' ') || [];
    if (args.length > 1) {
        const mention = args[1].match(/^@(\w+)/);
        if (mention) return mention[1];
        const id = parseInt(args[1]);
        if (!isNaN(id)) return id;
    }
    return null;
}

export function extractText(message) {
    if (!message) return '';
    if (message.text) return message.text;
    if (message.caption) return message.caption;
    return '';
}

export function splitQuotes(text) {
    if (!text) return ['', ''];
    text = text.trim();
    if (text.length === 0) return ['', ''];

    const firstChar = text[0];
    if (firstChar === '"' || firstChar === "'") {
        let endQuote = -1;
        for (let i = 1; i < text.length; i++) {
            if (text[i] === firstChar && text[i - 1] !== '\\') {
                endQuote = i;
                break;
            }
        }
        if (endQuote !== -1) {
            const keyword = text.substring(1, endQuote);
            const rest = text.substring(endQuote + 1).trim();
            return [keyword, rest];
        }
    }
    const spaceIndex = text.indexOf(' ');
    if (spaceIndex === -1) return [text, ''];
    return [text.substring(0, spaceIndex), text.substring(spaceIndex + 1).trim()];
}

export function buttonMarkdownParser(text) {
    if (!text) return { text: '', buttons: [] };
    const buttons = [];
    let cleanText = text;

    const regex = /\[([^\]]+)\]\(buttonurl:([^\)]+)\)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const [full, btnText, url] = match;
        buttons.push({ text: btnText, url: url.trim() });
        cleanText = cleanText.replace(full, '');
    }

    const regex2 = /\[([^\]]+)\]\(([^\)]+)\)/g;
    while ((match = regex2.exec(text)) !== null) {
        const [full, btnText, url] = match;
        if (!buttons.some(b => b.text === btnText && b.url === url)) {
            buttons.push({ text: btnText, url: url.trim() });
            cleanText = cleanText.replace(full, '');
        }
    }

    cleanText = cleanText.replace(/\s+/g, ' ').trim();
    return { text: cleanText, buttons };
}

export function buildKeyboard(buttons) {
    if (!buttons || buttons.length === 0) return null;
    const keyboard = [];
    let row = [];
    for (let i = 0; i < buttons.length; i++) {
        row.push({ text: buttons[i].text, url: buttons[i].url });
        if (row.length === 2 || i === buttons.length - 1) {
            keyboard.push([...row]);
            row = [];
        }
    }
    return { inline_keyboard: keyboard };
}

export function markdownToHtml(text) {
    if (!text) return '';
    text = text.replace(/\*([^\*]+)\*/g, '<b>$1</b>');
    text = text.replace(/_([^_]+)_/g, '<i>$1</i>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2">$1</a>');
    return text;
}

export function formatWelcomeText(text, user, chat, count) {
    if (!text) return '';
    const first = user.first_name || '';
    const last = user.last_name || first;
    const fullname = user.last_name ? `${first} ${user.last_name}` : first;
    const username = user.username ? '@' + user.username : mentionHtml(user.id, first);
    const mention = mentionHtml(user.id, first);
    const chatname = chat.title || '';
    const id = user.id;

    let result = text;
    const replacements = {
        '{first}': first,
        '{last}': last,
        '{fullname}': fullname,
        '{username}': username,
        '{mention}': mention,
        '{id}': id,
        '{count}': count,
        '{chatname}': chatname
    };
    for (const [key, value] of Object.entries(replacements)) {
        result = result.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), value);
    }
    return result;
}

// ==========================================
//  PERMISSION CHECKS
// ==========================================

export async function isBotAdmin(token, chatId, botId) {
    const member = await getChatMember(token, chatId, botId);
    return member?.status === 'administrator' || member?.status === 'creator';
}

export async function canPromote(token, chatId, userId) {
    const member = await getChatMember(token, chatId, userId);
    return member?.can_promote_members || member?.status === 'creator';
}

export async function canChangeInfo(token, chatId, userId) {
    const member = await getChatMember(token, chatId, userId);
    return member?.can_change_info || member?.status === 'creator';
}

export async function canPin(token, chatId, userId) {
    const member = await getChatMember(token, chatId, userId);
    return member?.can_pin_messages || member?.status === 'creator';
}

export async function isUserAdmin(token, chatId, userId) {
    const member = await getChatMember(token, chatId, userId);
    return member?.status === 'administrator' || member?.status === 'creator';
}

// ==========================================
//  ALIAS UNTUK formatWelcomeText (digunakan di filters.js)
// ==========================================
export const formatText = formatWelcomeText;

// ==========================================
//  EXPORT SEMUA FUNGSI (sudah diekspor satu per satu di atas,
//  tetapi jika ingin ekspor dalam satu objek, bisa ditambahkan di sini.
//  Sebenarnya semua fungsi sudah diekspor dengan 'export' di depan.
//  Tidak perlu ekspor ulang, tapi jika Anda ingin mengelompokkan,
//  Anda bisa menambahkan baris berikut sebagai dokumentasi.
//  Perhatikan bahwa mengekspor ulang dengan 'export {...}' tidak masalah
//  karena tidak mendefinisikan ulang, hanya merujuk.
// ==========================================
// (Opsional) Jika ingin ekspor dalam satu objek, gunakan:
/*
export {
    apiUrl,
    sendMessage,
    editMessage,
    answerCallback,
    getChatMember,
    getChatAdministrators,
    getMe,
    getChatMemberCount,
    restrictChatMember,
    kickChatMember,
    unbanChatMember,
    deleteMessage,
    sendSticker,
    sendPhoto,
    sendDocument,
    sendAudio,
    sendVoice,
    sendVideo,
    trackUser,
    trackChat,
    getUserCount,
    getChatCount,
    getReadableTime,
    escapeHtml,
    mentionHtml,
    extractUser,
    extractText,
    splitQuotes,
    buttonMarkdownParser,
    buildKeyboard,
    markdownToHtml,
    formatWelcomeText,
    formatText,
    isBotAdmin,
    canPromote,
    canChangeInfo,
    canPin,
    isUserAdmin
};
*/
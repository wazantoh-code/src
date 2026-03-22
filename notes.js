import {
    sendMessage, editMessage, answerCallback, getChatMember, getChatAdministrators, getMe,
    sendSticker, sendPhoto, sendDocument, sendAudio, sendVoice, sendVideo,
    restrictChatMember, kickChatMember, unbanChatMember, deleteMessage,
    escapeHtml, mentionHtml, extractUser, extractText, splitQuotes,
    buttonMarkdownParser, buildKeyboard, markdownToHtml, formatWelcomeText,
    isUserAdmin, getChatMemberCount
} from './utils.js';

// ==========================================
//  TABEL DATABASE YANG DIBUTUHKAN
// ==========================================
/*
CREATE TABLE IF NOT EXISTS notes (
    chat_id INTEGER,
    name TEXT,
    value TEXT,
    msgtype TEXT DEFAULT 'text',
    file_id TEXT,
    buttons TEXT,
    PRIMARY KEY (chat_id, name)
);
*/

// ==========================================
//  DATABASE QUERIES (D1)
// ==========================================

// Mendapatkan semua catatan dalam chat
async function getAllNotes(db, chatId) {
    const res = await db.prepare(
        'SELECT name FROM notes WHERE chat_id = ? ORDER BY name'
    ).bind(chatId).all();
    return res.results || [];
}

// Mendapatkan satu catatan
async function getNote(db, chatId, name) {
    const res = await db.prepare(
        'SELECT value, msgtype, file_id, buttons FROM notes WHERE chat_id = ? AND name = ?'
    ).bind(chatId, name.toLowerCase()).first();
    return res;
}

// Menambahkan atau mengganti catatan
async function addNote(db, chatId, name, value, msgtype = 'text', fileId = null, buttons = null) {
    await db.prepare(
        `INSERT OR REPLACE INTO notes (chat_id, name, value, msgtype, file_id, buttons)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(
        chatId,
        name.toLowerCase(),
        value || null,
        msgtype,
        fileId || null,
        buttons ? JSON.stringify(buttons) : null
    ).run();
}

// Menghapus catatan
async function rmNote(db, chatId, name) {
    await db.prepare(
        'DELETE FROM notes WHERE chat_id = ? AND name = ?'
    ).bind(chatId, name.toLowerCase()).run();
}

// Menghapus semua catatan dalam chat
async function rmAllNotes(db, chatId) {
    await db.prepare(
        'DELETE FROM notes WHERE chat_id = ?'
    ).bind(chatId).run();
}

// ==========================================
//  HELP TEXT
// ==========================================
const NOTES_HELP = `
──「 Catatan 」──

❖ /get <nama>: dapatkan catatan dengan nama ini
❖ #<nama>: sama dengan /get
❖ /notes atau /saved: daftar semua catatan yang disimpan
❖ /number  : ambil catatan berdasarkan nomor dalam daftar

*Hanya Admin:*
❖ /save <nama> <isi>: menyimpan catatan. Jika membalas pesan, gunakan isi dari pesan yang dibalas.
  • Pisahkan balasan berbeda dengan \`%%%\` untuk mendapatkan catatan acak.
    Contoh:
    /save salam
    Halo!
    %%%
    Hai!
    %%%
    Apa kabar?

  • Tombol: \`[Teks](buttonurl:link)\`

❖ /clear <nama>: hapus catatan
❖ /removeallnotes: hapus semua catatan (khusus pemilik grup)
`;

// ==========================================
//  FUNGSI UTAMA MENGAMBIL CATATAN
// ==========================================
async function getNoteAndSend(update, context, name, showNone = true, noFormat = false) {
    const { message, db, token, chat } = context;
    const note = await getNote(db, chat.id, name);
    if (!note) {
        if (showNone) await sendMessage(token, chat.id, '❌ Catatan tidak ditemukan.');
        return;
    }

    const replyId = message.reply_to_message ? message.reply_to_message.message_id : message.message_id;
    let text = note.value || '';
    const msgtype = note.msgtype || 'text';
    const fileId = note.file_id;
    let buttons = [];
    if (note.buttons) {
        try { buttons = JSON.parse(note.buttons); } catch (e) {}
    }

    // Format teks jika ada placeholder
    if (text && !noFormat) {
        // Placeholder: {first}, {last}, {fullname}, {username}, {mention}, {id}, {chatname}
        const user = message.from;
        const first = user.first_name || '';
        const last = user.last_name || first;
        const fullname = user.last_name ? `${first} ${user.last_name}` : first;
        const username = user.username ? '@' + user.username : mentionHtml(user.id, first);
        const mention = mentionHtml(user.id, first);
        const chatname = chat.title || first;
        const id = user.id;

        // Random jika ada %%%
        if (text.includes('%%%')) {
            const parts = text.split('%%%').map(s => s.trim()).filter(s => s);
            if (parts.length > 0) text = parts[Math.floor(Math.random() * parts.length)];
        }

        text = text
            .replace(/{first}/g, first)
            .replace(/{last}/g, last)
            .replace(/{fullname}/g, fullname)
            .replace(/{username}/g, username)
            .replace(/{mention}/g, mention)
            .replace(/{id}/g, id)
            .replace(/{chatname}/g, chatname);
    }

    const keyboard = buttons.length > 0 ? buildKeyboard(buttons) : null;

    try {
        if (msgtype === 'sticker' && fileId) {
            await sendSticker(token, chat.id, fileId, { reply_to_message_id: replyId, reply_markup: keyboard });
        } else if (msgtype === 'photo' && fileId) {
            await sendPhoto(token, chat.id, fileId, {
                caption: text,
                parse_mode: noFormat ? null : 'HTML',
                reply_to_message_id: replyId,
                reply_markup: keyboard
            });
        } else if (msgtype === 'document' && fileId) {
            await sendDocument(token, chat.id, fileId, {
                caption: text,
                parse_mode: noFormat ? null : 'HTML',
                reply_to_message_id: replyId,
                reply_markup: keyboard
            });
        } else if (msgtype === 'audio' && fileId) {
            await sendAudio(token, chat.id, fileId, {
                caption: text,
                parse_mode: noFormat ? null : 'HTML',
                reply_to_message_id: replyId,
                reply_markup: keyboard
            });
        } else if (msgtype === 'voice' && fileId) {
            await sendVoice(token, chat.id, fileId, {
                caption: text,
                parse_mode: noFormat ? null : 'HTML',
                reply_to_message_id: replyId,
                reply_markup: keyboard
            });
        } else if (msgtype === 'video' && fileId) {
            await sendVideo(token, chat.id, fileId, {
                caption: text,
                parse_mode: noFormat ? null : 'HTML',
                reply_to_message_id: replyId,
                reply_markup: keyboard
            });
        } else {
            // Teks atau button_text
            await sendMessage(token, chat.id, text || 'Catatan kosong', {
                parse_mode: noFormat ? null : 'HTML',
                disable_web_page_preview: true,
                reply_to_message_id: replyId,
                reply_markup: keyboard
            });
        }
    } catch (e) {
        console.error('Gagal mengirim catatan:', e);
        await sendMessage(token, chat.id, '❌ Gagal mengirim catatan. Mungkin formatnya salah.');
    }
}

// ==========================================
//  COMMAND HANDLERS
// ==========================================

// /get nama [noformat]
async function getCommand(update, context) {
    const { message, args } = context;
    if (!args || args.length === 0) {
        return sendMessage(context.token, context.chat.id, '❌ Gunakan: /get <nama catatan> [noformat]');
    }
    const name = args[0].toLowerCase();
    const noFormat = args[1]?.toLowerCase() === 'noformat';
    await getNoteAndSend(update, context, name, true, noFormat);
}

// #nama
async function hashGetHandler(update, context) {
    const { message } = context;
    const text = message.text || '';
    const match = text.match(/^#(\S+)/);
    if (!match) return;
    const name = match[1].toLowerCase();
    await getNoteAndSend(update, context, name, false, false);
}

// /number (misal /5)
async function slashGetHandler(update, context) {
    const { message, db, token, chat } = context;
    const text = message.text || '';
    const match = text.match(/^\/(\d+)$/);
    if (!match) return;
    const index = parseInt(match[1]) - 1;
    const notes = await getAllNotes(db, chat.id);
    if (index < 0 || index >= notes.length) {
        return sendMessage(token, chat.id, '❌ Nomor catatan tidak valid.');
    }
    const name = notes[index].name;
    await getNoteAndSend(update, context, name, false, false);
}

// /save nama [isi] (atau reply)
async function saveCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const fullText = message.text || '';
    const args = fullText.split(' ').slice(1).join(' ').trim();

    if (!args && !message.reply_to_message) {
        return sendMessage(token, chat.id, '❌ Gunakan: /save <nama> <isi> (atau balas pesan)');
    }

    let name, value, msgtype = 'text', fileId = null, buttons = [];

    if (message.reply_to_message) {
        const reply = message.reply_to_message;
        // Nama diambil dari argumen pertama, sisanya diabaikan? Di Python, nama dari argumen, isi dari reply.
        // Kita akan ambil nama dari argumen pertama
        const spaceIdx = fullText.indexOf(' ');
        if (spaceIdx === -1) return sendMessage(token, chat.id, '❌ Berikan nama catatan.');
        name = fullText.substring(spaceIdx + 1).trim().toLowerCase();
        if (!name) return sendMessage(token, chat.id, '❌ Nama catatan tidak boleh kosong.');

        // Tentukan tipe dari reply
        if (reply.sticker) { msgtype = 'sticker'; fileId = reply.sticker.file_id; }
        else if (reply.photo) { msgtype = 'photo'; fileId = reply.photo[reply.photo.length-1].file_id; }
        else if (reply.document) { msgtype = 'document'; fileId = reply.document.file_id; }
        else if (reply.audio) { msgtype = 'audio'; fileId = reply.audio.file_id; }
        else if (reply.voice) { msgtype = 'voice'; fileId = reply.voice.file_id; }
        else if (reply.video) { msgtype = 'video'; fileId = reply.video.file_id; }
        else if (reply.text) {
            value = reply.text;
            const parsed = buttonMarkdownParser(value);
            value = parsed.text;
            buttons = parsed.buttons;
        } else if (reply.caption) {
            value = reply.caption;
            const parsed = buttonMarkdownParser(value);
            value = parsed.text;
            buttons = parsed.buttons;
        }
    } else {
        // Tidak reply, parse dengan splitQuotes
        const [rawName, rest] = splitQuotes(args);
        if (!rawName) return sendMessage(token, chat.id, '❌ Nama catatan tidak boleh kosong.');
        name = rawName.toLowerCase();
        if (!rest) return sendMessage(token, chat.id, '❌ Isi catatan tidak boleh kosong.');
        value = rest;
        const parsed = buttonMarkdownParser(value);
        value = parsed.text;
        buttons = parsed.buttons;
    }

    await addNote(db, chat.id, name, value, msgtype, fileId, buttons);
    await sendMessage(token, chat.id, `✅ Catatan *${escapeHtml(name)}* berhasil disimpan.`, { parse_mode: 'Markdown' });
}

// /clear nama
async function clearCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1);
    if (args.length === 0) return sendMessage(token, chat.id, '❌ Berikan nama catatan.');
    const name = args[0].toLowerCase();

    const note = await getNote(db, chat.id, name);
    if (!note) return sendMessage(token, chat.id, '❌ Catatan tidak ditemukan.');

    await rmNote(db, chat.id, name);
    await sendMessage(token, chat.id, `✅ Catatan *${escapeHtml(name)}* dihapus.`, { parse_mode: 'Markdown' });
}

// /notes atau /saved
async function listNotesCommand(update, context) {
    const { message, db, token, chat } = context;
    const notes = await getAllNotes(db, chat.id);
    if (notes.length === 0) {
        return sendMessage(token, chat.id, '📭 Tidak ada catatan dalam grup ini.');
    }

    let text = '📝 *Daftar Catatan:*\n\n*ID*   *Nama*\n';
    for (let i = 0; i < notes.length; i++) {
        const line = `\`${(i+1).toString().padStart(2)}.\`  \`#${notes[i].name}\`\n`;
        if ((text + line).length > 4000) {
            await sendMessage(token, chat.id, text, { parse_mode: 'Markdown' });
            text = line;
        } else {
            text += line;
        }
    }
    await sendMessage(token, chat.id, text, { parse_mode: 'Markdown' });
}

// /removeallnotes
async function removeAllNotesCommand(update, context) {
    const { message, db, token, chat, user } = context;
    const member = await getChatMember(token, chat.id, user.id);
    if (member?.status !== 'creator' && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Hanya pemilik grup yang dapat menghapus semua catatan.');
    }

    const notes = await getAllNotes(db, chat.id);
    if (notes.length === 0) {
        return sendMessage(token, chat.id, 'Tidak ada catatan.');
    }

    const keyboard = {
        inline_keyboard: [
            [
                { text: '✅ Hapus semua catatan', callback_data: 'notes_rmall' },
                { text: '❌ Batal', callback_data: 'notes_cancel' }
            ]
        ]
    };
    await sendMessage(token, chat.id, `⚠️ Anda yakin ingin menghapus SEMUA catatan di *${escapeHtml(chat.title)}*?`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

// ==========================================
//  CALLBACK HANDLER (hapus semua catatan)
// ==========================================
async function clearAllCallback(update, context) {
    const { callback_query, db, token, chat, user } = context;
    const data = callback_query.data;
    const msgId = callback_query.message.message_id;

    const member = await getChatMember(token, chat.id, user.id);
    if (member?.status !== 'creator') {
        await answerCallback(token, callback_query.id, '❌ Hanya pemilik grup yang dapat melakukan ini.', true);
        return;
    }

    if (data === 'notes_rmall') {
        const notes = await getAllNotes(db, chat.id);
        const count = notes.length;
        await rmAllNotes(db, chat.id);
        await editMessage(token, chat.id, msgId, `✅ ${count} catatan telah dihapus dari *${escapeHtml(chat.title)}*.`, { parse_mode: 'Markdown' });
    } else if (data === 'notes_cancel') {
        await editMessage(token, chat.id, msgId, '❌ Penghapusan dibatalkan.', { parse_mode: 'Markdown' });
    }
    await answerCallback(token, callback_query.id);
}

// ==========================================
//  EXPORT MODUL
// ==========================================
export default {
    mod_name: "Notes",
    help: NOTES_HELP,
    commands: [
        { command: 'get', handler: getCommand },
        { command: 'save', handler: saveCommand },
        { command: 'clear', handler: clearCommand },
        { command: 'notes', handler: listNotesCommand },
        { command: 'saved', handler: listNotesCommand },
        { command: 'removeallnotes', handler: removeAllNotesCommand }
    ],
    callbacks: [
        { pattern: /^notes_(rmall|cancel)$/, handler: clearAllCallback }
    ],
    messageHandlers: [
        { handler: hashGetHandler, group: 6 },  // #nama
        { handler: slashGetHandler, group: 6 }  // /number
    ]
};
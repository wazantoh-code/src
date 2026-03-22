import {
    apiUrl, sendMessage, editMessage, answerCallback, sendSticker, sendPhoto, sendDocument,
    sendAudio, sendVoice, sendVideo, getChatMember, getChatAdministrators, getMe,
    escapeHtml, mentionHtml, extractUser, extractText, splitQuotes,
    buttonMarkdownParser, buildKeyboard, markdownToHtml, formatText,
    isUserAdmin
} from './utils.js';

// ==========================================
//  DATABASE QUERIES (D1)
// ==========================================
async function getChatFilters(db, chatId) {
    const res = await db.prepare(
        'SELECT * FROM filters WHERE chat_id = ? ORDER BY keyword'
    ).bind(chatId).all();
    return res.results || [];
}

async function getFilter(db, chatId, keyword) {
    const res = await db.prepare(
        'SELECT * FROM filters WHERE chat_id = ? AND keyword = ?'
    ).bind(chatId, keyword.toLowerCase()).first();
    return res;
}

async function addFilter(db, chatId, keyword, replyText, fileType, fileId, buttons) {
    const count = await db.prepare(
        'SELECT COUNT(*) as count FROM filters WHERE chat_id = ?'
    ).bind(chatId).first();
    if (count?.count >= 150) {
        return { success: false, message: '❌ Grup ini telah mencapai batas maksimum filter (150).' };
    }
    await db.prepare(
        `INSERT OR REPLACE INTO filters (chat_id, keyword, reply_text, file_type, file_id, buttons, has_markdown)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
    ).bind(
        chatId,
        keyword.toLowerCase(),
        replyText || null,
        fileType || null,
        fileId || null,
        buttons && buttons.length ? JSON.stringify(buttons) : null
    ).run();
    return { success: true };
}

async function removeFilter(db, chatId, keyword) {
    await db.prepare(
        'DELETE FROM filters WHERE chat_id = ? AND keyword = ?'
    ).bind(chatId, keyword.toLowerCase()).run();
}

async function removeAllFilters(db, chatId) {
    await db.prepare(
        'DELETE FROM filters WHERE chat_id = ?'
    ).bind(chatId).run();
}

// ==========================================
//  HELP TEXT
// ==========================================
const FILTERS_HELP = `
──「 Filters 」──

❖ /filters: Daftar semua filter aktif dalam obrolan.

*Hanya Admin:*
❖ /filter <kata kunci> <balas pesan>: Tambahkan filter ke obrolan. Bot akan membalas pesan itu setiap kali kata kunci disebut.
  • Jika Anda membalas stiker, bot akan membalas dengan stiker itu.
  • Kata kunci tidak case-sensitive.
  • Untuk kata kunci berupa kalimat, gunakan tanda kutip. Contoh: /filter "halo semua" Halo juga!
  • Pisahkan balasan berbeda dengan \`%%%\` untuk mendapatkan balasan acak.
    Contoh:
    /filter "salam"
    Selamat pagi!
    %%%
    Selamat siang!
    %%%
    Selamat malam!

❖ /stop <kata kunci>: Hentikan filter tersebut.

*Khusus Pemilik Grup:*
❖ /removeallfilters: Hapus semua filter dalam obrolan sekaligus.

*Catatan:* Filter mendukung pemformatan Markdown dan tombol.
  • Tombol: \`[teks tombol](buttonurl:link)\`
  • Placeholder: \`{first}\`, \`{last}\`, \`{fullname}\`, \`{username}\`, \`{mention}\`, \`{chatname}\`, \`{id}\`
`;

// ==========================================
//  COMMAND: /filters (daftar filter)
// ==========================================
async function listFilters(update, context) {
    const { message, db, token, chat } = context;
    const chatId = chat.id;
    const chatTitle = chat.title || 'obrolan ini';

    try {
        const filters = await getChatFilters(db, chatId);
        if (!filters || filters.length === 0) {
            return sendMessage(token, chat.id, `Tidak ada filter yang tersimpan di ${escapeHtml(chatTitle)}.`);
        }

        let text = `*Daftar Filter di ${escapeHtml(chatTitle)}:*\n`;
        for (const f of filters) {
            const line = ` • \`${f.keyword}\`\n`;
            if ((text + line).length > 4000) {
                await sendMessage(token, chat.id, text, { parse_mode: 'Markdown' });
                text = line;
            } else {
                text += line;
            }
        }
        await sendMessage(token, chat.id, text, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('Error in listFilters:', e);
        await sendMessage(token, chat.id, '❌ Gagal mengambil daftar filter.');
    }
}

// ==========================================
//  COMMAND: /filter (tambah filter)
// ==========================================
async function addFilterHandler(update, context) {
    const { message, db, token, chat, user } = context;

    // Periksa admin (kecuali PM)
    if (chat.type !== 'private' && !await isUserAdmin(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const fullText = message.text || '';
    const args = fullText.split(' ').slice(1).join(' ').trim();

    if (!message.reply_to_message && !args) {
        return sendMessage(token, chat.id, '❌ Balas ke pesan atau berikan kata kunci dan isi filter.');
    }

    let keyword, content;
    if (message.reply_to_message) {
        // Mode reply: keyword dari argumen
        if (!args) return sendMessage(token, chat.id, '❌ Berikan kata kunci untuk filter ini.');
        keyword = args.toLowerCase();
        content = message.reply_to_message;
    } else {
        // Mode teks: pisahkan keyword dan konten
        const [rawKeyword, rest] = splitQuotes(args);
        if (!rawKeyword) return sendMessage(token, chat.id, '❌ Kata kunci tidak boleh kosong.');
        keyword = rawKeyword.toLowerCase();
        content = { text: rest || '' };
    }

    let fileType = null, fileId = null, replyText = null, buttons = [];

    if (message.reply_to_message) {
        const reply = message.reply_to_message;
        if (reply.sticker) { fileType = 'sticker'; fileId = reply.sticker.file_id; }
        else if (reply.photo) { fileType = 'photo'; fileId = reply.photo[reply.photo.length-1].file_id; }
        else if (reply.document) { fileType = 'document'; fileId = reply.document.file_id; }
        else if (reply.audio) { fileType = 'audio'; fileId = reply.audio.file_id; }
        else if (reply.voice) { fileType = 'voice'; fileId = reply.voice.file_id; }
        else if (reply.video) { fileType = 'video'; fileId = reply.video.file_id; }
        else if (reply.text) {
            fileType = 'text';
            replyText = reply.text;
            const parsed = buttonMarkdownParser(replyText);
            replyText = parsed.text;
            buttons = parsed.buttons;
        } else if (reply.caption) {
            fileType = 'text';
            replyText = reply.caption;
            const parsed = buttonMarkdownParser(replyText);
            replyText = parsed.text;
            buttons = parsed.buttons;
        }
    } else {
        // Dari teks command
        if (content.text) {
            fileType = 'text';
            replyText = content.text;
            const parsed = buttonMarkdownParser(replyText);
            replyText = parsed.text;
            buttons = parsed.buttons;
        }
    }

    try {
        const addResult = await addFilter(db, chat.id, keyword, replyText, fileType, fileId, buttons);
        if (!addResult.success) {
            return sendMessage(token, chat.id, addResult.message);
        }

        const chatName = chat.title || 'filter lokal';
        await sendMessage(token, chat.id, `✅ Filter *${escapeHtml(keyword)}* tersimpan di *${escapeHtml(chatName)}*!`, {
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('Error in addFilterHandler:', e);
        await sendMessage(token, chat.id, '❌ Gagal menyimpan filter. Silakan coba lagi.');
    }
}

// ==========================================
//  COMMAND: /stop (hapus filter)
// ==========================================
async function stopFilterHandler(update, context) {
    const { message, db, token, chat, user } = context;

    if (chat.type !== 'private' && !await isUserAdmin(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1).join(' ').trim();
    if (!args) return sendMessage(token, chat.id, '❌ Filter mana yang ingin dihentikan?');

    const keyword = args.toLowerCase();
    try {
        const filter = await getFilter(db, chat.id, keyword);
        if (!filter) {
            return sendMessage(token, chat.id, `❌ Filter *${escapeHtml(keyword)}* tidak ditemukan.`, { parse_mode: 'Markdown' });
        }

        await removeFilter(db, chat.id, keyword);
        const chatName = chat.title || 'filter lokal';
        await sendMessage(token, chat.id, `✅ Filter *${escapeHtml(keyword)}* telah dihentikan di *${escapeHtml(chatName)}*.`, {
            parse_mode: 'Markdown'
        });
    } catch (e) {
        console.error('Error in stopFilterHandler:', e);
        await sendMessage(token, chat.id, '❌ Gagal menghapus filter.');
    }
}

// ==========================================
//  COMMAND: /removeallfilters (hapus semua filter)
// ==========================================
async function removeAllFiltersHandler(update, context) {
    const { message, db, token, chat, user } = context;
    const member = await getChatMember(token, chat.id, user.id);
    if (member?.status !== 'creator' && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Hanya pemilik grup yang dapat menghapus semua filter.');
    }

    try {
        const filters = await getChatFilters(db, chat.id);
        if (!filters || filters.length === 0) {
            return sendMessage(token, chat.id, 'Tidak ada filter dalam obrolan ini.');
        }

        const keyboard = {
            inline_keyboard: [
                [
                    { text: '✅ Hapus semua filter', callback_data: 'filters_rmall' },
                    { text: '❌ Batal', callback_data: 'filters_cancel' }
                ]
            ]
        };
        await sendMessage(token, chat.id, `⚠️ Anda yakin ingin menghapus SEMUA filter di *${escapeHtml(chat.title)}*? Tindakan ini tidak dapat dibatalkan.`, {
            parse_mode: 'Markdown',
            reply_markup: keyboard
        });
    } catch (e) {
        console.error('Error in removeAllFiltersHandler:', e);
        await sendMessage(token, chat.id, '❌ Gagal memproses permintaan.');
    }
}

// ==========================================
//  CALLBACK: hapus semua filter
// ==========================================
async function rmallCallback(update, context) {
    const { callback_query, db, token, chat, user } = context;
    const data = callback_query.data;
    const msgId = callback_query.message.message_id;

    const member = await getChatMember(token, chat.id, user.id);
    if (member?.status !== 'creator') {
        await answerCallback(token, callback_query.id, '❌ Hanya pemilik grup yang dapat melakukan ini.', true);
        return;
    }

    try {
        if (data === 'filters_rmall') {
            const filters = await getChatFilters(db, chat.id);
            const count = filters.length;
            await removeAllFilters(db, chat.id);
            await editMessage(token, chat.id, msgId, `✅ ${count} filter telah dihapus dari *${escapeHtml(chat.title)}*.`, { parse_mode: 'Markdown' });
        } else if (data === 'filters_cancel') {
            await editMessage(token, chat.id, msgId, '❌ Penghapusan semua filter dibatalkan.', { parse_mode: 'Markdown' });
        }
    } catch (e) {
        console.error('Error in rmallCallback:', e);
        await editMessage(token, chat.id, msgId, '❌ Terjadi kesalahan.');
    }
    await answerCallback(token, callback_query.id);
}

// ==========================================
//  MESSAGE HANDLER: mendeteksi keyword dan membalas
// ==========================================
async function replyFilter(update, context) {
    const { message, db, token, chat, user } = context;
    if (!user || user.id === 777000) return; // abaikan Telegram

    const text = extractText(message);
    if (!text) return;

    try {
        const filters = await getChatFilters(db, chat.id);
        if (!filters || filters.length === 0) return;

        for (const filt of filters) {
            const keyword = filt.keyword;
            const regex = new RegExp(`(^|\\s|[^\\w])${escapeRegExp(keyword)}($|\\s|[^\\w])`, 'i');
            if (regex.test(text)) {
                // Proses balasan
                let replyText = filt.reply_text;
                const fileType = filt.file_type;
                const fileId = filt.file_id;
                let buttons = [];
                if (filt.buttons) {
                    try { buttons = JSON.parse(filt.buttons); } catch (e) {}
                }
                const keyboard = buttons.length > 0 ? buildKeyboard(buttons) : null;

                // Random reply
                let finalText = replyText;
                if (replyText && replyText.includes('%%%')) {
                    const parts = replyText.split('%%%').map(s => s.trim()).filter(s => s);
                    if (parts.length > 0) {
                        finalText = parts[Math.floor(Math.random() * parts.length)];
                    }
                }

                // Format placeholders
                if (finalText) {
                    finalText = formatText(finalText, user, chat);
                    finalText = markdownToHtml(finalText);
                }

                // Kirim
                if (fileType === 'sticker' && fileId) {
                    await sendSticker(token, chat.id, fileId, { reply_to_message_id: message.message_id, reply_markup: keyboard });
                } else if (fileType === 'photo' && fileId) {
                    await sendPhoto(token, chat.id, fileId, { caption: finalText, parse_mode: 'HTML', reply_to_message_id: message.message_id, reply_markup: keyboard });
                } else if (fileType === 'document' && fileId) {
                    await sendDocument(token, chat.id, fileId, { caption: finalText, parse_mode: 'HTML', reply_to_message_id: message.message_id, reply_markup: keyboard });
                } else if (fileType === 'audio' && fileId) {
                    await sendAudio(token, chat.id, fileId, { caption: finalText, parse_mode: 'HTML', reply_to_message_id: message.message_id, reply_markup: keyboard });
                } else if (fileType === 'voice' && fileId) {
                    await sendVoice(token, chat.id, fileId, { caption: finalText, parse_mode: 'HTML', reply_to_message_id: message.message_id, reply_markup: keyboard });
                } else if (fileType === 'video' && fileId) {
                    await sendVideo(token, chat.id, fileId, { caption: finalText, parse_mode: 'HTML', reply_to_message_id: message.message_id, reply_markup: keyboard });
                } else {
                    await sendMessage(token, chat.id, finalText || 'Filter', {
                        parse_mode: 'HTML',
                        disable_web_page_preview: true,
                        reply_to_message_id: message.message_id,
                        reply_markup: keyboard
                    });
                }
                break; // hanya proses filter pertama
            }
        }
    } catch (e) {
        console.error('Error in replyFilter:', e);
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================
//  EXPORT MODUL FILTERS
// ==========================================
export default {
    mod_name: "Filters",
    help: FILTERS_HELP,
    commands: [
        { command: 'filters', handler: listFilters },
        { command: 'filter', handler: addFilterHandler },
        { command: 'stop', handler: stopFilterHandler },
        { command: 'removeallfilters', handler: removeAllFiltersHandler }
    ],
    callbacks: [
        { pattern: /^filters_(rmall|cancel)$/, handler: rmallCallback }
    ],
    messageHandlers: [
        { handler: replyFilter, group: 10 }
    ]
};
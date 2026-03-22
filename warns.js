import {
    sendMessage, editMessage, answerCallback, getChatMember, getChatAdministrators, getMe,
    restrictChatMember, kickChatMember, unbanChatMember, deleteMessage,
    escapeHtml, mentionHtml, extractUser, extractText, splitQuotes,
    buttonMarkdownParser, buildKeyboard, markdownToHtml, formatWelcomeText,
    isUserAdmin, getChatMemberCount
} from './utils.js';

// ==========================================
//  TABEL DATABASE YANG DIBUTUHKAN
// ==========================================
/*
CREATE TABLE IF NOT EXISTS warn_settings (
    chat_id INTEGER PRIMARY KEY,
    warn_limit INTEGER DEFAULT 3,
    soft_warn INTEGER DEFAULT 1  -- 1 = kick, 0 = ban
);

CREATE TABLE IF NOT EXISTS warns (
    chat_id INTEGER,
    user_id INTEGER,
    reason TEXT,
    warned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    id INTEGER PRIMARY KEY AUTOINCREMENT
);
CREATE INDEX idx_warns_chat_user ON warns(chat_id, user_id);

CREATE TABLE IF NOT EXISTS warn_filters (
    chat_id INTEGER,
    keyword TEXT,
    reply_text TEXT,
    PRIMARY KEY (chat_id, keyword)
);
*/

// ==========================================
//  DATABASE QUERIES (D1)
// ==========================================

// ----- Pengaturan peringatan -----
async function getWarnSetting(db, chatId) {
    const res = await db.prepare(
        'SELECT warn_limit, soft_warn FROM warn_settings WHERE chat_id = ?'
    ).bind(chatId).first();
    if (res) {
        return { limit: res.warn_limit, soft: res.soft_warn === 1 };
    }
    // Default
    return { limit: 3, soft: true };
}

async function setWarnLimit(db, chatId, limit) {
    await db.prepare(
        `INSERT INTO warn_settings (chat_id, warn_limit, soft_warn)
         VALUES (?, ?, COALESCE((SELECT soft_warn FROM warn_settings WHERE chat_id = ?), 1))
         ON CONFLICT(chat_id) DO UPDATE SET warn_limit = excluded.warn_limit`
    ).bind(limit, chatId, chatId).run();
}

async function setWarnStrength(db, chatId, soft) {
    const softValue = soft ? 1 : 0;
    await db.prepare(
        `INSERT INTO warn_settings (chat_id, warn_limit, soft_warn)
         VALUES (?, COALESCE((SELECT warn_limit FROM warn_settings WHERE chat_id = ?), 3), ?)
         ON CONFLICT(chat_id) DO UPDATE SET soft_warn = excluded.soft_warn`
    ).bind(chatId, chatId, softValue).run();
}

// ----- Data peringatan pengguna -----
async function warnUser(db, chatId, userId, reason) {
    // Simpan peringatan
    await db.prepare(
        'INSERT INTO warns (chat_id, user_id, reason) VALUES (?, ?, ?)'
    ).bind(chatId, userId, reason || null).run();

    // Hitung jumlah peringatan
    const countRes = await db.prepare(
        'SELECT COUNT(*) as count FROM warns WHERE chat_id = ? AND user_id = ?'
    ).bind(chatId, userId).first();
    const numWarns = countRes?.count || 0;

    // Ambil semua alasan
    const reasonsRes = await db.prepare(
        'SELECT reason FROM warns WHERE chat_id = ? AND user_id = ? ORDER BY warned_at'
    ).bind(chatId, userId).all();
    const reasons = reasonsRes.results?.map(r => r.reason).filter(r => r) || [];

    return { numWarns, reasons };
}

async function removeWarn(db, chatId, userId) {
    // Hapus satu peringatan terakhir
    const row = await db.prepare(
        'SELECT id FROM warns WHERE chat_id = ? AND user_id = ? ORDER BY warned_at DESC LIMIT 1'
    ).bind(chatId, userId).first();
    if (!row) return false;
    await db.prepare('DELETE FROM warns WHERE id = ?').bind(row.id).run();
    return true;
}

async function resetWarns(db, chatId, userId) {
    await db.prepare(
        'DELETE FROM warns WHERE chat_id = ? AND user_id = ?'
    ).bind(chatId, userId).run();
}

async function getWarns(db, chatId, userId) {
    const countRes = await db.prepare(
        'SELECT COUNT(*) as count FROM warns WHERE chat_id = ? AND user_id = ?'
    ).bind(chatId, userId).first();
    const numWarns = countRes?.count || 0;

    const reasonsRes = await db.prepare(
        'SELECT reason FROM warns WHERE chat_id = ? AND user_id = ? ORDER BY warned_at'
    ).bind(chatId, userId).all();
    const reasons = reasonsRes.results?.map(r => r.reason).filter(r => r) || [];

    return { numWarns, reasons };
}

// ----- Filter peringatan otomatis -----
async function addWarnFilter(db, chatId, keyword, replyText) {
    await db.prepare(
        `INSERT OR REPLACE INTO warn_filters (chat_id, keyword, reply_text)
         VALUES (?, ?, ?)`
    ).bind(chatId, keyword.toLowerCase(), replyText).run();
}

async function removeWarnFilter(db, chatId, keyword) {
    await db.prepare(
        'DELETE FROM warn_filters WHERE chat_id = ? AND keyword = ?'
    ).bind(chatId, keyword.toLowerCase()).run();
}

async function getWarnFilters(db, chatId) {
    const res = await db.prepare(
        'SELECT keyword FROM warn_filters WHERE chat_id = ? ORDER BY keyword'
    ).bind(chatId).all();
    return res.results?.map(r => r.keyword) || [];
}

async function getWarnFilter(db, chatId, keyword) {
    const res = await db.prepare(
        'SELECT reply_text FROM warn_filters WHERE chat_id = ? AND keyword = ?'
    ).bind(chatId, keyword.toLowerCase()).first();
    return res?.reply_text || null;
}

// ==========================================
//  HELP TEXT
// ==========================================
const WARN_HELP = `
──「 Peringatan 」──

*Perintah Pengguna:*
❖ /warns <userhandle>: mendapatkan jumlah peringatan dan alasan pengguna.
❖ /warnlist: daftar semua filter peringatan saat ini.

*Hanya Admin:*
❖ /warn <userhandle> <alasan>: memberi peringatan ke pengguna. Jika membalas pesan, peringatan untuk pengguna yang dibalas. Setelah batas, pengguna akan ditendang/diblokir.
❖ /dwarn <userhandle> <alasan>: sama seperti /warn, tapi pesan yang diperingatkan akan dihapus.
❖ /resetwarn <userhandle>: mereset semua peringatan pengguna.
❖ /addwarn <kata kunci> <pesan balasan>: membuat filter peringatan otomatis. Jika seseorang menggunakan kata kunci, mereka otomatis diperingatkan dengan pesan tersebut.
❖ /nowarn <kata kunci>: menghapus filter peringatan.
❖ /warnlimit <angka>: mengatur batas peringatan (minimal 3).
❖ /strongwarn <on/off>: jika on, melebihi batas akan menyebabkan ban; jika off, hanya kick.
`;

// ==========================================
//  FUNGSI UTAMA PEMBERIAN PERINGATAN
// ==========================================
async function warn(user, chat, reason, message, warner, token, db, context) {
    // Cek admin
    if (await isUserAdmin(token, chat.id, user.id)) {
        await sendMessage(token, chat.id, '❌ Admin tidak bisa diberi peringatan.');
        return null;
    }

    // TODO: Jika ada sistem TIGERS/WOLVES, bisa ditambahkan di sini

    const warnerTag = warner ? mentionHtml(warner.id, warner.first_name) : 'Filter otomatis';
    const setting = await getWarnSetting(db, chat.id);
    const { numWarns, reasons } = await warnUser(db, chat.id, user.id, reason);

    if (numWarns >= setting.limit) {
        // Reset peringatan
        await resetWarns(db, chat.id, user.id);

        let action, reply;
        if (setting.soft) {
            // Kick
            await kickChatMember(token, chat.id, user.id);
            action = 'ditendang';
            reply = `${mentionHtml(user.id, user.first_name)} [<code>${user.id}</code>] Ditendang (batas peringatan).`;
        } else {
            // Ban
            await kickChatMember(token, chat.id, user.id); // kick sama dengan ban di supergroup
            action = 'diblokir';
            reply = `${mentionHtml(user.id, user.first_name)} [<code>${user.id}</code>] Diblokir (batas peringatan).`;
        }

        // Tambahkan alasan ke pesan
        for (const r of reasons) {
            if (r) reply += `\n - ${escapeHtml(r)}`;
        }

        const keyboard = null;
        await sendMessage(token, chat.id, reply, { parse_mode: 'HTML', reply_markup: keyboard });

        const logReason = `<b>${escapeHtml(chat.title)}</b>\n#WARN_${action.toUpperCase()}\n<b>Admin:</b> ${warnerTag}\n<b>User:</b> ${mentionHtml(user.id, user.first_name)}\n<b>Alasan:</b> ${reason || '-'}\n<b>Jumlah:</b> ${numWarns}/${setting.limit}`;
        return logReason;
    } else {
        // Belum mencapai batas
        const keyboard = {
            inline_keyboard: [[
                { text: '❌ Hapus peringatan', callback_data: `rm_warn_${user.id}` }
            ]]
        };
        let reply = `${mentionHtml(user.id, user.first_name)} [<code>${user.id}</code>] Mendapat peringatan (${numWarns} dari ${setting.limit}).`;
        if (reason) reply += `\nAlasan: ${escapeHtml(reason)}`;

        await sendMessage(token, chat.id, reply, { parse_mode: 'HTML', reply_markup: keyboard });

        const logReason = `<b>${escapeHtml(chat.title)}</b>\n#WARN\n<b>Admin:</b> ${warnerTag}\n<b>User:</b> ${mentionHtml(user.id, user.first_name)}\n<b>Alasan:</b> ${reason || '-'}\n<b>Jumlah:</b> ${numWarns}/${setting.limit}`;
        return logReason;
    }
}

// ==========================================
//  COMMAND HANDLERS
// ==========================================

// /warn dan /dwarn
async function warnCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ');
    const isDwarn = message.text.startsWith('/dwarn');
    let targetId, reason;

    if (message.reply_to_message) {
        targetId = message.reply_to_message.from.id;
        reason = args.slice(1).join(' ').trim() || null;
        if (isDwarn) {
            try { await deleteMessage(token, chat.id, message.reply_to_message.message_id); } catch (e) {}
        }
    } else {
        if (args.length < 2) return sendMessage(token, chat.id, '❌ Gunakan: /warn <userid/username> <alasan> (atau balas pesan)');
        const extracted = extractUser(message);
        if (!extracted) return sendMessage(token, chat.id, '❌ Tidak dapat menemukan pengguna.');
        targetId = extracted;
        reason = args.slice(2).join(' ').trim() || null;
    }

    // Dapatkan objek user
    let targetUser;
    try {
        const member = await getChatMember(token, chat.id, targetId);
        if (!member) return sendMessage(token, chat.id, '❌ Pengguna tidak ditemukan di grup ini.');
        targetUser = member.user;
    } catch (e) {
        return sendMessage(token, chat.id, '❌ Gagal mendapatkan informasi pengguna.');
    }

    const log = await warn(targetUser, chat, reason, message, user, token, db, context);
    if (log) {
        // Log ke owner? Nanti bisa ditambahkan
    }
}

// /resetwarn
async function resetWarnCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const targetId = extractUser(message);
    if (!targetId) return sendMessage(token, chat.id, '❌ Tidak dapat menemukan pengguna.');

    await resetWarns(db, chat.id, targetId);
    await sendMessage(token, chat.id, `✅ Peringatan untuk <code>${targetId}</code> telah direset.`, { parse_mode: 'HTML' });
}

// /warns
async function warnsCommand(update, context) {
    const { message, db, token, chat } = context;
    const targetId = extractUser(message) || message.from.id;
    const { numWarns, reasons } = await getWarns(db, chat.id, targetId);
    const setting = await getWarnSetting(db, chat.id);

    if (numWarns === 0) {
        return sendMessage(token, chat.id, '✅ Pengguna ini tidak memiliki peringatan.');
    }

    let text = `👤 <a href="tg://user?id=${targetId}">Pengguna</a> memiliki ${numWarns}/${setting.limit} peringatan.`;
    if (reasons.length > 0) {
        text += '\n\n<b>Alasan:</b>';
        for (const r of reasons) {
            if (r) text += `\n• ${escapeHtml(r)}`;
        }
    }
    await sendMessage(token, chat.id, text, { parse_mode: 'HTML' });
}

// /addwarn
async function addWarnFilterCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const text = message.text || '';
    const args = text.split(' ').slice(1).join(' ').trim();
    if (!args) return sendMessage(token, chat.id, '❌ Gunakan: /addwarn <kata kunci> <pesan balasan> (atau balas pesan)');

    let keyword, replyText;
    if (message.reply_to_message) {
        const extracted = splitQuotes(args);
        if (extracted[0]) {
            keyword = extracted[0].toLowerCase();
            replyText = extracted[1] || message.reply_to_message.text || 'Anda mendapat peringatan otomatis.';
        } else {
            keyword = args.toLowerCase();
            replyText = message.reply_to_message.text || 'Anda mendapat peringatan otomatis.';
        }
    } else {
        const extracted = splitQuotes(args);
        if (!extracted[0]) return sendMessage(token, chat.id, '❌ Kata kunci tidak boleh kosong.');
        keyword = extracted[0].toLowerCase();
        replyText = extracted[1] || 'Anda mendapat peringatan otomatis.';
    }

    await addWarnFilter(db, chat.id, keyword, replyText);
    await sendMessage(token, chat.id, `✅ Filter peringatan untuk <code>${escapeHtml(keyword)}</code> ditambahkan.`, { parse_mode: 'HTML' });
}

// /nowarn
async function removeWarnFilterCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1).join(' ').trim();
    if (!args) return sendMessage(token, chat.id, '❌ Berikan kata kunci filter yang ingin dihapus.');

    const keyword = args.toLowerCase();
    await removeWarnFilter(db, chat.id, keyword);
    await sendMessage(token, chat.id, `✅ Filter peringatan <code>${escapeHtml(keyword)}</code> dihapus.`, { parse_mode: 'HTML' });
}

// /warnlist
async function listWarnFiltersCommand(update, context) {
    const { message, db, token, chat } = context;
    const filters = await getWarnFilters(db, chat.id);
    if (filters.length === 0) {
        return sendMessage(token, chat.id, '📭 Tidak ada filter peringatan di grup ini.');
    }

    let text = '<b>Daftar filter peringatan:</b>\n';
    for (const f of filters) {
        text += `• <code>${escapeHtml(f)}</code>\n`;
    }
    await sendMessage(token, chat.id, text, { parse_mode: 'HTML' });
}

// /warnlimit
async function warnLimitCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1);
    if (args.length === 0) {
        const setting = await getWarnSetting(db, chat.id);
        return sendMessage(token, chat.id, `📊 Batas peringatan saat ini: <b>${setting.limit}</b>`, { parse_mode: 'HTML' });
    }

    const newLimit = parseInt(args[0]);
    if (isNaN(newLimit) || newLimit < 3) {
        return sendMessage(token, chat.id, '❌ Batas minimal adalah 3.');
    }

    await setWarnLimit(db, chat.id, newLimit);
    await sendMessage(token, chat.id, `✅ Batas peringatan diubah menjadi <b>${newLimit}</b>.`, { parse_mode: 'HTML' });
}

// /strongwarn
async function strongWarnCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1);
    if (args.length === 0) {
        const setting = await getWarnSetting(db, chat.id);
        const mode = setting.soft ? 'soft (kick)' : 'strong (ban)';
        return sendMessage(token, chat.id, `⚙️ Mode peringatan saat ini: <b>${mode}</b>`, { parse_mode: 'HTML' });
    }

    const option = args[0].toLowerCase();
    if (option === 'on' || option === 'yes' || option === 'strong') {
        await setWarnStrength(db, chat.id, false); // false = tidak soft = ban
        return sendMessage(token, chat.id, '✅ Mode peringatan diatur ke <b>strong (ban)</b>.', { parse_mode: 'HTML' });
    } else if (option === 'off' || option === 'no' || option === 'soft') {
        await setWarnStrength(db, chat.id, true); // true = soft = kick
        return sendMessage(token, chat.id, '✅ Mode peringatan diatur ke <b>soft (kick)</b>.', { parse_mode: 'HTML' });
    } else {
        return sendMessage(token, chat.id, '❌ Gunakan: on/off atau yes/no');
    }
}

// ==========================================
//  CALLBACK HANDLER (hapus peringatan)
// ==========================================
async function removeWarnCallback(update, context) {
    const { callback_query, db, token, chat, user } = context;
    const data = callback_query.data;
    const match = data.match(/^rm_warn_(\d+)/);
    if (!match) return;

    const targetId = parseInt(match[1]);
    if (user.id !== targetId && !await isUserAdmin(token, chat.id, user.id)) {
        await answerCallback(token, callback_query.id, '❌ Anda tidak berhak menghapus peringatan ini.', true);
        return;
    }

    const removed = await removeWarn(db, chat.id, targetId);
    if (removed) {
        await answerCallback(token, callback_query.id, '✅ Satu peringatan dihapus.');
        // Edit pesan asli untuk mencerminkan perubahan
        try {
            const newText = callback_query.message.text + '\n\n<i>Satu peringatan telah dihapus.</i>';
            await editMessage(token, chat.id, callback_query.message.message_id, newText, { parse_mode: 'HTML' });
        } catch (e) {}
    } else {
        await answerCallback(token, callback_query.id, '❌ Pengguna tidak memiliki peringatan.', true);
    }
}

// ==========================================
//  MESSAGE HANDLER (filter peringatan otomatis)
// ==========================================
async function warnFilterHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!user || user.id === 777000) return; // abaikan service
    if (await isUserAdmin(token, chat.id, user.id)) return; // admin tidak kena filter

    const text = extractText(message);
    if (!text) return;

    const filters = await getWarnFilters(db, chat.id);
    for (const keyword of filters) {
        const regex = new RegExp(`(^|\\s|[^\\w])${escapeRegExp(keyword)}($|\\s|[^\\w])`, 'i');
        if (regex.test(text)) {
            const replyText = await getWarnFilter(db, chat.id, keyword);
            if (replyText) {
                await warn(user, chat, replyText, message, null, token, db, context);
            }
            break; // hanya satu filter per pesan
        }
    }
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==========================================
//  EXPORT MODUL
// ==========================================
export default {
    mod_name: "Warning",
    help: WARN_HELP,
    commands: [
        { command: 'warn', handler: warnCommand },
        { command: 'dwarn', handler: warnCommand },   // sama, dibedakan di dalam handler
        { command: 'resetwarn', handler: resetWarnCommand },
        { command: 'resetwarns', handler: resetWarnCommand },
        { command: 'warns', handler: warnsCommand },
        { command: 'addwarn', handler: addWarnFilterCommand },
        { command: 'nowarn', handler: removeWarnFilterCommand },
        { command: 'stopwarn', handler: removeWarnFilterCommand },
        { command: 'warnlist', handler: listWarnFiltersCommand },
        { command: 'warnfilters', handler: listWarnFiltersCommand },
        { command: 'warnlimit', handler: warnLimitCommand },
        { command: 'strongwarn', handler: strongWarnCommand }
    ],
    callbacks: [
        { pattern: /^rm_warn_/, handler: removeWarnCallback }
    ],
    messageHandlers: [
        { handler: warnFilterHandler, group: 8 } // prioritas sebelum filter biasa
    ]
};
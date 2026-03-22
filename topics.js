import {
    apiUrl, sendMessage, editMessage, answerCallback, getChatMember, getChatAdministrators, getMe,
    restrictChatMember, kickChatMember, unbanChatMember, deleteMessage,
    escapeHtml, mentionHtml, extractUser, extractText, splitQuotes,
    buttonMarkdownParser, buildKeyboard, markdownToHtml, formatWelcomeText,
    isUserAdmin, getChatMemberCount
} from './utils.js';

// ==========================================
//  TABEL DATABASE YANG DIBUTUHKAN
// ==========================================
/*
CREATE TABLE IF NOT EXISTS action_topics (
    chat_id INTEGER PRIMARY KEY,
    topic_id INTEGER,
    topic_name TEXT
);
*/

// ==========================================
//  DATABASE QUERIES (D1)
// ==========================================

// Mendapatkan topik aksi
async function getActionTopic(db, chatId) {
    const res = await db.prepare(
        'SELECT topic_id, topic_name FROM action_topics WHERE chat_id = ?'
    ).bind(chatId).first();
    return res || null;
}

// Menyimpan topik aksi
async function setActionTopic(db, chatId, topicId, topicName) {
    await db.prepare(
        `INSERT INTO action_topics (chat_id, topic_id, topic_name)
         VALUES (?, ?, ?)
         ON CONFLICT(chat_id) DO UPDATE SET topic_id = excluded.topic_id, topic_name = excluded.topic_name`
    ).bind(chatId, topicId, topicName).run();
}

// Menghapus topik aksi
async function clearActionTopic(db, chatId) {
    await db.prepare(
        'DELETE FROM action_topics WHERE chat_id = ?'
    ).bind(chatId).run();
}

// ==========================================
//  HELP TEXT
// ==========================================
const TOPICS_HELP = `
──「 Manajemen Topik (Forum) 」──

Fitur ini memungkinkan Anda mengelola topik dalam grup forum.

*Perintah Admin:*
❖ /setactiontopic – Tetapkan topik saat ini sebagai topik aksi default (digunakan untuk welcome dll.)
❖ /actiontopic – Lihat topik aksi yang sedang aktif
❖ /createtopic <nama> – Buat topik baru
❖ /renametopic <nama> – Ubah nama topik saat ini
❖ /opentopic – Buka kembali topik yang ditutup
❖ /closetopic – Tutup topik saat ini
❖ /deletetopic – Hapus topik saat ini (tidak dapat dibatalkan!)

*Catatan:* Bot harus menjadi admin dengan hak *manage topics*.
`;

// ==========================================
//  CEK APAKAH GRUP ADALAH FORUM
// ==========================================
async function isForum(token, chatId) {
    const res = await fetch(apiUrl(token, 'getChat', { chat_id: chatId }));
    const json = await res.json();
    return json.ok ? json.result.is_forum === true : false;
}

// ==========================================
//  CEK APAKAH USER DAPAT MENGELOLA TOPIK
// ==========================================
async function canManageTopics(token, chatId, userId) {
    const member = await getChatMember(token, chatId, userId);
    return member?.can_manage_topics || member?.status === 'creator';
}

// ==========================================
//  COMMAND HANDLERS
// ==========================================

// /setactiontopic (atau /setdefaulttopic)
async function setActionTopicCommand(update, context) {
    const { message, db, token, chat, user } = context;
    
    // Cek apakah grup adalah forum
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum (topik tidak diaktifkan).');
    }

    // Cek hak admin
    if (!await canManageTopics(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengelola topik.');
    }

    // Cek apakah pesan dikirim dalam topik
    if (!message.message_thread_id) {
        return sendMessage(token, chat.id, '❌ Perintah ini harus digunakan di dalam topik.');
    }

    const topicId = message.message_thread_id;

    // Dapatkan nama topik (perlu mengambil daftar topik)
    const topics = await getForumTopics(token, chat.id);
    const topic = topics.find(t => t.message_thread_id === topicId);
    if (!topic) {
        return sendMessage(token, chat.id, '❌ Tidak dapat menemukan informasi topik.');
    }

    // Simpan ke database
    await setActionTopic(db, chat.id, topicId, topic.name);
    await sendMessage(token, chat.id, `✅ Topik aksi ditetapkan ke: *${escapeMarkdown(topic.name)}*`, { parse_mode: 'Markdown' });
}

// /actiontopic
async function actionTopicCommand(update, context) {
    const { message, db, token, chat } = context;
    
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum.');
    }

    const action = await getActionTopic(db, chat.id);
    if (!action) {
        return sendMessage(token, chat.id, '❌ Belum ada topik aksi yang ditetapkan. Gunakan /setactiontopic.');
    }

    await sendMessage(token, chat.id, 
        `📌 *Topik Aksi Saat Ini:*\nID: \`${action.topic_id}\`\nNama: ${escapeMarkdown(action.topic_name)}`,
        { parse_mode: 'Markdown' }
    );
}

// /createtopic <nama>
async function createTopicCommand(update, context) {
    const { message, db, token, chat, user } = context;
    
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum.');
    }

    if (!await canManageTopics(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengelola topik.');
    }

    const args = message.text.split(' ').slice(1).join(' ').trim();
    if (!args) {
        return sendMessage(token, chat.id, '❌ Gunakan: /createtopic <nama topik>');
    }

    try {
        const res = await fetch(apiUrl(token, 'createForumTopic', {
            chat_id: chat.id,
            name: args
        }));
        const json = await res.json();
        if (json.ok) {
            await sendMessage(token, chat.id, `✅ Topik *${escapeMarkdown(args)}* berhasil dibuat!`);
        } else {
            await sendMessage(token, chat.id, `❌ Gagal membuat topik: ${json.description}`);
        }
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Terjadi kesalahan saat membuat topik.');
    }
}

// /renametopic <nama>
async function renameTopicCommand(update, context) {
    const { message, db, token, chat, user } = context;
    
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum.');
    }

    if (!await canManageTopics(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengelola topik.');
    }

    if (!message.message_thread_id) {
        return sendMessage(token, chat.id, '❌ Perintah ini harus digunakan di dalam topik.');
    }

    const args = message.text.split(' ').slice(1).join(' ').trim();
    if (!args) {
        return sendMessage(token, chat.id, '❌ Gunakan: /renametopic <nama baru>');
    }

    try {
        const res = await fetch(apiUrl(token, 'editForumTopic', {
            chat_id: chat.id,
            message_thread_id: message.message_thread_id,
            name: args
        }));
        const json = await res.json();
        if (json.ok) {
            await sendMessage(token, chat.id, `✅ Nama topik diubah menjadi *${escapeMarkdown(args)}*`);
        } else {
            await sendMessage(token, chat.id, `❌ Gagal mengubah nama: ${json.description}`);
        }
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Terjadi kesalahan.');
    }
}

// /opentopic
async function openTopicCommand(update, context) {
    const { message, db, token, chat, user } = context;
    
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum.');
    }

    if (!await canManageTopics(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengelola topik.');
    }

    if (!message.message_thread_id) {
        return sendMessage(token, chat.id, '❌ Perintah ini harus digunakan di dalam topik.');
    }

    try {
        const res = await fetch(apiUrl(token, 'reopenForumTopic', {
            chat_id: chat.id,
            message_thread_id: message.message_thread_id
        }));
        const json = await res.json();
        if (json.ok) {
            await sendMessage(token, chat.id, '✅ Topik dibuka kembali.');
        } else {
            await sendMessage(token, chat.id, `❌ Gagal membuka topik: ${json.description}`);
        }
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Terjadi kesalahan.');
    }
}

// /closetopic
async function closeTopicCommand(update, context) {
    const { message, db, token, chat, user } = context;
    
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum.');
    }

    if (!await canManageTopics(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengelola topik.');
    }

    if (!message.message_thread_id) {
        return sendMessage(token, chat.id, '❌ Perintah ini harus digunakan di dalam topik.');
    }

    try {
        const res = await fetch(apiUrl(token, 'closeForumTopic', {
            chat_id: chat.id,
            message_thread_id: message.message_thread_id
        }));
        const json = await res.json();
        if (json.ok) {
            await sendMessage(token, chat.id, '✅ Topik ditutup.');
        } else {
            await sendMessage(token, chat.id, `❌ Gagal menutup topik: ${json.description}`);
        }
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Terjadi kesalahan.');
    }
}

// /deletetopic
async function deleteTopicCommand(update, context) {
    const { message, db, token, chat, user } = context;
    
    if (!await isForum(token, chat.id)) {
        return sendMessage(token, chat.id, '❌ Grup ini bukan forum.');
    }

    if (!await canManageTopics(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengelola topik.');
    }

    if (!message.message_thread_id) {
        return sendMessage(token, chat.id, '❌ Perintah ini harus digunakan di dalam topik.');
    }

    // Konfirmasi dengan tombol
    const keyboard = {
        inline_keyboard: [[
            { text: '✅ Ya, hapus', callback_data: `confirm_deletetopic_${message.message_thread_id}` },
            { text: '❌ Batal', callback_data: 'cancel_deletetopic' }
        ]]
    };
    await sendMessage(token, chat.id, 
        '⚠️ Anda yakin ingin menghapus topik ini? Tindakan ini tidak dapat dibatalkan.',
        { reply_markup: keyboard }
    );
}

// Callback untuk konfirmasi hapus topik
async function deleteTopicCallback(update, context) {
    const { callback_query, db, token, chat, user } = context;
    const data = callback_query.data;
    const msgId = callback_query.message.message_id;

    if (!await canManageTopics(token, chat.id, user.id)) {
        await answerCallback(token, callback_query.id, '❌ Anda tidak memiliki hak.', true);
        return;
    }

    if (data.startsWith('confirm_deletetopic_')) {
        const topicId = parseInt(data.split('_')[2]);
        try {
            const res = await fetch(apiUrl(token, 'deleteForumTopic', {
                chat_id: chat.id,
                message_thread_id: topicId
            }));
            const json = await res.json();
            if (json.ok) {
                await editMessage(token, chat.id, msgId, '✅ Topik berhasil dihapus.');
                // Jika topik yang dihapus adalah topik aksi, hapus dari DB
                const action = await getActionTopic(db, chat.id);
                if (action && action.topic_id === topicId) {
                    await clearActionTopic(db, chat.id);
                }
            } else {
                await editMessage(token, chat.id, msgId, `❌ Gagal: ${json.description}`);
            }
        } catch (e) {
            await editMessage(token, chat.id, msgId, '❌ Terjadi kesalahan.');
        }
    } else if (data === 'cancel_deletetopic') {
        await editMessage(token, chat.id, msgId, '❌ Penghapusan dibatalkan.');
    }
    await answerCallback(token, callback_query.id);
}

// Helper untuk mendapatkan daftar topik (digunakan saat set action topic)
async function getForumTopics(token, chatId) {
    const topics = [];
    let offset = 0;
    const limit = 100;
    while (true) {
        const res = await fetch(apiUrl(token, 'getForumTopics', {
            chat_id: chatId,
            offset: offset,
            limit: limit
        }));
        const json = await res.json();
        if (!json.ok) break;
        topics.push(...json.result.topics);
        if (topics.length >= json.result.total_count) break;
        offset += limit;
    }
    return topics;
}

// Helper escape markdown
function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// ==========================================
//  EXPORT MODUL
// ==========================================
export default {
    mod_name: "Topics",
    help: TOPICS_HELP,
    commands: [
        { command: 'setactiontopic', handler: setActionTopicCommand },
        { command: 'setdefaulttopic', handler: setActionTopicCommand }, // alias
        { command: 'actiontopic', handler: actionTopicCommand },
        { command: 'createtopic', handler: createTopicCommand },
        { command: 'renametopic', handler: renameTopicCommand },
        { command: 'opentopic', handler: openTopicCommand },
        { command: 'closetopic', handler: closeTopicCommand },
        { command: 'deletetopic', handler: deleteTopicCommand }
    ],
    callbacks: [
        { pattern: /^confirm_deletetopic_/, handler: deleteTopicCallback },
        { pattern: /^cancel_deletetopic/, handler: deleteTopicCallback }
    ],
    messageHandlers: []
};
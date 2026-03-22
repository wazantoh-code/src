import {
    apiUrl, sendMessage, getChatMember, getChatAdministrators,
    escapeHtml, mentionHtml, extractUser, isBotAdmin, canPromote, canChangeInfo, canPin
} from './utils.js';

// ==========================================
//  HELP TEXT UNTUK MODUL ADMIN
// ==========================================
const ADMIN_HELP = `
──「 Admins 」──

*Perintah Pengguna*:
❖ /admins – daftar admin di chat
❖ /pinned – dapatkan pesan yang disematkan

*Perintah Admin*:
❖ /pin – sematkan pesan (balas pesan)
❖ /unpin – lepas semat (balas pesan)
❖ /invitelink – dapatkan tautan undangan
❖ /promote – promosikan pengguna (balas/username)
❖ /demote – turunkan admin (balas/username)
❖ /title <judul> – set title admin kustom
❖ /setgtitle <judul> – ubah judul grup
❖ /setdesc <deskripsi> – ubah deskripsi grup
❖ /setgpic – (belum tersedia)
❖ /delgpic – (belum tersedia)
❖ /setsticker – (belum tersedia)
`;

// ==========================================
//  PROMOTE
// ==========================================
async function promote(update, context) {
    const { message, token, chat, user } = context;
    const targetId = extractUser(message);
    if (!targetId) return sendMessage(token, chat.id, '❌ Tidak menemukan pengguna. Balas pesan atau berikan username/id.');

    if (!await canPromote(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mempromosikan anggota.');
    }

    const botMe = await (await fetch(apiUrl(token, 'getMe'))).json();
    const botId = botMe.result.id;
    if (!await isBotAdmin(token, chat.id, botId)) {
        return sendMessage(token, chat.id, '❌ Saya bukan admin di grup ini.');
    }

    const botMember = await getChatMember(token, chat.id, botId);
    const perms = {
        can_change_info: botMember.can_change_info,
        can_post_messages: botMember.can_post_messages,
        can_edit_messages: botMember.can_edit_messages,
        can_delete_messages: botMember.can_delete_messages,
        can_invite_users: botMember.can_invite_users,
        can_restrict_members: botMember.can_restrict_members,
        can_pin_messages: botMember.can_pin_messages,
        can_promote_members: false,
        can_manage_voice_chats: botMember.can_manage_voice_chats
    };

    try {
        await fetch(apiUrl(token, 'promoteChatMember', { chat_id: chat.id, user_id: targetId, ...perms }));
        const targetMember = await getChatMember(token, chat.id, targetId);
        const text = `<b>${escapeHtml(chat.title)}</b>\n\n🔹 ADMIN DIPROMOSIKAN\nUser: ${mentionHtml(targetId, targetMember.user.first_name)}\nOleh: ${mentionHtml(user.id, user.first_name)}`;
        await sendMessage(token, chat.id, text);
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal mempromosikan. Pastikan saya memiliki hak admin yang cukup.');
    }
}

// ==========================================
//  DEMOTE
// ==========================================
async function demote(update, context) {
    const { message, token, chat, user } = context;
    const targetId = extractUser(message);
    if (!targetId) return sendMessage(token, chat.id, '❌ Tidak menemukan pengguna.');

    if (!await canPromote(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk menurunkan admin.');
    }

    try {
        await fetch(apiUrl(token, 'promoteChatMember', {
            chat_id: chat.id,
            user_id: targetId,
            can_change_info: false,
            can_post_messages: false,
            can_edit_messages: false,
            can_delete_messages: false,
            can_invite_users: false,
            can_restrict_members: false,
            can_pin_messages: false,
            can_promote_members: false,
            can_manage_voice_chats: false
        }));
        const targetMember = await getChatMember(token, chat.id, targetId);
        const text = `<b>${escapeHtml(chat.title)}</b>\n\n🔻 ADMIN DITURUNKAN\nAdmin: <b>${mentionHtml(targetId, targetMember.user.first_name)}</b>\nOleh: ${mentionHtml(user.id, user.first_name)}`;
        await sendMessage(token, chat.id, text);
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal menurunkan admin. Pastikan mereka dipromosikan oleh saya.');
    }
}

// ==========================================
//  SET TITLE
// ==========================================
async function setTitle(update, context) {
    const { message, token, chat, user } = context;
    const targetId = extractUser(message);
    if (!targetId) return sendMessage(token, chat.id, '❌ Balas ke pengguna atau berikan username/id.');

    const args = message.text.split(' ');
    if (args.length < 2) return sendMessage(token, chat.id, '❌ Gunakan: /title <judul> (balas ke user)');
    const title = args.slice(1).join(' ').substring(0, 16);
    if (!title) return sendMessage(token, chat.id, '❌ Judul tidak boleh kosong.');

    if (!await canPromote(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk mengatur title admin.');
    }

    try {
        await fetch(apiUrl(token, 'setChatAdministratorCustomTitle', {
            chat_id: chat.id,
            user_id: targetId,
            custom_title: title
        }));
        await sendMessage(token, chat.id, `✅ Title untuk <code>${escapeHtml(title)}</code> berhasil diset!`);
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal menyetel title. Pastikan user adalah admin yang dipromosikan bot.');
    }
}

// ==========================================
//  PIN
// ==========================================
async function pin(update, context) {
    const { message, token, chat, user } = context;
    if (!message.reply_to_message) return sendMessage(token, chat.id, '❌ Balas ke pesan yang ingin disematkan.');

    if (!await canPin(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk menyematkan pesan.');
    }

    const isSilent = !(message.text.includes('loud') || message.text.includes('notify'));
    try {
        await fetch(apiUrl(token, 'pinChatMessage', {
            chat_id: chat.id,
            message_id: message.reply_to_message.message_id,
            disable_notification: isSilent
        }));
        let link = '';
        if (chat.username) {
            link = `https://t.me/${chat.username}/${message.reply_to_message.message_id}`;
        } else {
            link = `https://t.me/c/${String(chat.id).replace('-100', '')}/${message.reply_to_message.message_id}`;
        }
        await sendMessage(token, chat.id, '📌 Pesan berhasil disematkan.', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '👉 Lihat Pesan', url: link }
                ]]
            }
        });
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal menyematkan pesan.');
    }
}

// ==========================================
//  UNPIN
// ==========================================
async function unpin(update, context) {
    const { message, token, chat, user } = context;
    if (!await canPin(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak untuk melepas sematan.');
    }

    try {
        if (message.reply_to_message) {
            await fetch(apiUrl(token, 'unpinChatMessage', {
                chat_id: chat.id,
                message_id: message.reply_to_message.message_id
            }));
            await sendMessage(token, chat.id, '✅ Pesan berhasil dilepas sematan.');
        } else {
            await fetch(apiUrl(token, 'unpinChatMessage', { chat_id: chat.id }));
            await sendMessage(token, chat.id, '✅ Sematan terakhir dilepas.');
        }
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal melepas sematan.');
    }
}

// ==========================================
//  ADMIN LIST
// ==========================================
async function adminList(update, context) {
    const { token, chat } = context;
    const admins = await getChatAdministrators(token, chat.id);
    if (!admins) return sendMessage(token, chat.id, '❌ Gagal mengambil daftar admin.');

    let text = `<b>Daftar Admin ${escapeHtml(chat.title)}</b>`;
    const creators = admins.filter(a => a.status === 'creator');
    const administrators = admins.filter(a => a.status === 'administrator');

    for (let admin of creators) {
        text += `\n\n🌏 <b>Pemilik</b>`;
        text += `\n<code> • </code>${mentionHtml(admin.user.id, admin.user.first_name)}`;
        if (admin.custom_title) text += `\n<code> ┗━ ${escapeHtml(admin.custom_title)}</code>`;
    }

    text += `\n\n🌟 <b>Admin</b>`;
    for (let admin of administrators) {
        text += `\n<code> • </code>${mentionHtml(admin.user.id, admin.user.first_name)}`;
        if (admin.custom_title) text += ` | <code>${escapeHtml(admin.custom_title)}</code>`;
    }

    await sendMessage(token, chat.id, text);
}

// ==========================================
//  INVITE LINK
// ==========================================
async function inviteLink(update, context) {
    const { token, chat } = context;
    if (chat.username) {
        return sendMessage(token, chat.id, `🔗 https://t.me/${chat.username}`);
    }
    try {
        const res = await fetch(apiUrl(token, 'exportChatInviteLink', { chat_id: chat.id }));
        const data = await res.json();
        if (data.ok) {
            await sendMessage(token, chat.id, `🔗 ${data.result}`);
        } else {
            await sendMessage(token, chat.id, '❌ Saya tidak memiliki izin untuk membuat tautan undangan.');
        }
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal mendapatkan tautan undangan.');
    }
}

// ==========================================
//  SET CHAT TITLE
// ==========================================
async function setChatTitle(update, context) {
    const { message, token, chat, user } = context;
    if (!await canChangeInfo(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak mengubah info grup.');
    }
    const title = message.text.split(' ').slice(1).join(' ');
    if (!title) return sendMessage(token, chat.id, '❌ Masukkan judul baru.');
    try {
        await fetch(apiUrl(token, 'setChatTitle', { chat_id: chat.id, title }));
        await sendMessage(token, chat.id, `✅ Judul grup diubah menjadi <b>${escapeHtml(title)}</b>!`);
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal mengubah judul.');
    }
}

// ==========================================
//  SET DESCRIPTION
// ==========================================
async function setDesc(update, context) {
    const { message, token, chat, user } = context;
    if (!await canChangeInfo(token, chat.id, user.id)) {
        return sendMessage(token, chat.id, '❌ Anda tidak memiliki hak mengubah deskripsi grup.');
    }
    const desc = message.text.split(' ').slice(1).join(' ').substring(0, 255);
    if (!desc) return sendMessage(token, chat.id, '❌ Deskripsi tidak boleh kosong.');
    try {
        await fetch(apiUrl(token, 'setChatDescription', { chat_id: chat.id, description: desc }));
        await sendMessage(token, chat.id, `✅ Deskripsi grup diperbarui!`);
    } catch (e) {
        await sendMessage(token, chat.id, '❌ Gagal mengubah deskripsi.');
    }
}

// ==========================================
//  NOT IMPLEMENTED (PLACEHOLDER)
// ==========================================
async function notImplemented(update, context) {
    const { token, chat } = context;
    await sendMessage(token, chat.id, '⚠️ Fitur ini belum diimplementasikan di versi Cloudflare Worker.');
}

// ==========================================
//  EXPORT MODUL
// ==========================================
export default {
    mod_name: "Admins",
    help: ADMIN_HELP,
    commands: [
        { command: 'promote', handler: promote },
        { command: 'demote', handler: demote },
        { command: 'title', handler: setTitle },
        { command: 'pin', handler: pin },
        { command: 'unpin', handler: unpin },
        { command: 'admins', handler: adminList },
        { command: 'invitelink', handler: inviteLink },
        { command: 'setgtitle', handler: setChatTitle },
        { command: 'setdesc', handler: setDesc },
        { command: 'setgpic', handler: notImplemented },
        { command: 'delgpic', handler: notImplemented },
        { command: 'setsticker', handler: notImplemented }
    ],
    callbacks: []
};
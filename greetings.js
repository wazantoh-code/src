import {
    sendMessage, editMessage, answerCallback, getChatMember, getChatAdministrators, getMe,
    sendSticker, sendPhoto, sendDocument, sendAudio, sendVoice, sendVideo,
    restrictChatMember, kickChatMember, unbanChatMember, deleteMessage,
    escapeHtml, mentionHtml, extractUser, extractText, splitQuotes,
    buttonMarkdownParser, buildKeyboard, markdownToHtml, formatWelcomeText,
    isUserAdmin, getChatMemberCount
} from './utils.js';

// ==========================================
//  DATABASE QUERIES (D1)
// ==========================================

async function getWelcomeSettings(db, chatId) {
    const res = await db.prepare(
        'SELECT * FROM welcome_settings WHERE chat_id = ?'
    ).bind(chatId).first();
    return res;
}

async function initWelcomeSettings(db, chatId) {
    const exists = await getWelcomeSettings(db, chatId);
    if (!exists) {
        await db.prepare(
            `INSERT INTO welcome_settings (chat_id, should_welcome, should_goodbye, welcome_mutes)
             VALUES (?, 1, 1, 'off')`
        ).bind(chatId).run();
    }
}

async function setWelcomePref(db, chatId, enabled) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        'UPDATE welcome_settings SET should_welcome = ? WHERE chat_id = ?'
    ).bind(enabled ? 1 : 0, chatId).run();
}

async function setGoodbyePref(db, chatId, enabled) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        'UPDATE welcome_settings SET should_goodbye = ? WHERE chat_id = ?'
    ).bind(enabled ? 1 : 0, chatId).run();
}

async function setCustomWelcome(db, chatId, text, type, content, buttons) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        `UPDATE welcome_settings SET welcome_text = ?, welcome_type = ?, welcome_content = ?, welcome_buttons = ?
         WHERE chat_id = ?`
    ).bind(
        text || null,
        type || 'text',
        content || null,
        buttons ? JSON.stringify(buttons) : null,
        chatId
    ).run();
}

async function setCustomGoodbye(db, chatId, text, type, buttons) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        `UPDATE welcome_settings SET goodbye_text = ?, goodbye_type = ?, goodbye_buttons = ?
         WHERE chat_id = ?`
    ).bind(
        text || null,
        type || 'text',
        buttons ? JSON.stringify(buttons) : null,
        chatId
    ).run();
}

async function resetWelcome(db, chatId) {
    await setCustomWelcome(db, chatId, null, 'text', null, null);
}

async function resetGoodbye(db, chatId) {
    await setCustomGoodbye(db, chatId, null, 'text', null);
}

async function setCleanWelcome(db, chatId, enabled) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        'UPDATE welcome_settings SET clean_welcome = ? WHERE chat_id = ?'
    ).bind(enabled ? 1 : 0, chatId).run();
}

async function setWelcomeMutes(db, chatId, mode) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        'UPDATE welcome_settings SET welcome_mutes = ? WHERE chat_id = ?'
    ).bind(mode, chatId).run();
}

async function setCleanService(db, chatId, enabled) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        'UPDATE welcome_settings SET clean_service = ? WHERE chat_id = ?'
    ).bind(enabled ? 1 : 0, chatId).run();
}

async function setLastWelcomeMsg(db, chatId, msgId) {
    await initWelcomeSettings(db, chatId);
    await db.prepare(
        'UPDATE welcome_settings SET last_welcome_msg_id = ? WHERE chat_id = ?'
    ).bind(msgId || null, chatId).run();
}

// ==========================================
//  VERIFICATION DATA (D1)
// ==========================================
async function setVerification(db, chatId, userId, data) {
    await db.prepare(
        `INSERT OR REPLACE INTO verification (chat_id, user_id, data)
         VALUES (?, ?, ?)`
    ).bind(chatId, userId, JSON.stringify(data)).run();
}

async function getVerification(db, chatId, userId) {
    const res = await db.prepare(
        'SELECT data FROM verification WHERE chat_id = ? AND user_id = ?'
    ).bind(chatId, userId).first();
    return res ? JSON.parse(res.data) : null;
}

async function deleteVerification(db, chatId, userId) {
    await db.prepare(
        'DELETE FROM verification WHERE chat_id = ? AND user_id = ?'
    ).bind(chatId, userId).run();
}

// ==========================================
//  HELP TEXT
// ==========================================
const GREETINGS_HELP = `
──「 Salam Pembuka 」──

*Hanya Admin :*
❖ /welcome <on/off> – mengaktifkan/menonaktifkan pesan selamat datang.
❖ /welcome – menunjukkan pengaturan sambutan saat ini.
❖ /welcome noformat – menunjukkan pengaturan selamat datang saat ini tanpa pemformatan.
❖ /goodbye – penggunaan dan argumen yang sama dengan /welcome.
❖ /setwelcome <teks> – mengatur pesan selamat datang khusus. Jika digunakan membalas media, gunakan media itu.
❖ /setgoodbye <teks> – mengatur pesan selamat tinggal khusus.
❖ /resetwelcome – reset ke pesan selamat datang default.
❖ /resetgoodbye – reset ke pesan selamat tinggal default.
❖ /cleanwelcome <on/off> – hapus pesan selamat datang sebelumnya untuk menghindari spam.
❖ /welcomemute <soft/strong/captcha/off> – atur mode mute untuk anggota baru.
❖ /cleanservice <on/off> – hapus pesan layanan (user joined/left).
❖ /welcomehelp – panduan format markdown dan tombol.
❖ /welcomemutehelp – penjelasan tentang welcome mute.

*Contoh markdown:*
• \`{first}\` – nama depan
• \`{last}\` – nama belakang
• \`{fullname}\` – nama lengkap
• \`{username}\` – username
• \`{mention}\` – mention pengguna
• \`{id}\` – ID pengguna
• \`{count}\` – jumlah anggota
• \`{chatname}\` – nama grup

*Tombol:* \`[Teks](buttonurl:link)\`
`;

const WELCOME_MUTE_HELP = `
*Mode Welcome Mute:*
• \`soft\` – batasi pengiriman media selama 24 jam.
• \`strong\` – bisukan hingga pengguna menekan tombol verifikasi.
• \`captcha\` – bisukan hingga pengguna memilih angka yang benar pada captcha.
• \`off\` – nonaktifkan welcome mute.
`;

// ==========================================
//  DEFAULT MESSAGES
// ==========================================
const DEFAULT_WELCOMES = [
    "Halo {first}, selamat datang di {chatname}!",
    "Selamat datang {first}! Senang melihatmu di sini.",
    "Hai {first}, semoga betah ya!",
    "Wih, {first} baru gabung. Ayo kenalan!",
    "Ada anggota baru: {first}. Salam kenal!"
];

const DEFAULT_GOODBYES = [
    "Selamat tinggal {first}, sampai jumpa lagi!",
    "{first} meninggalkan grup. Dadah!",
    "Yah, {first} pergi. Semoga sukses di tempat lain.",
    "Selamat jalan {first}, kami akan merindukanmu."
];

// ==========================================
//  NEW MEMBER HANDLER
// ==========================================
async function newMemberHandler(update, context) {
    const { message, db, token, chat, user } = context;
    const newMembers = message.new_chat_members;
    if (!newMembers || newMembers.length === 0) return;

    await initWelcomeSettings(db, chat.id);
    const settings = await getWelcomeSettings(db, chat.id);
    if (!settings) return;

    const shouldWelcome = settings.should_welcome === 1;
    const welcMutes = settings.welcome_mutes || 'off';
    const cleanService = settings.clean_service === 1;

    if (cleanService) {
        try { await deleteMessage(token, chat.id, message.message_id); } catch (e) {}
    }

    for (const newMem of newMembers) {
        const botMe = await getMe(token);
        if (newMem.id === botMe.id) continue;

        const isAdmin = await isUserAdmin(token, chat.id, newMem.id);
        const isBot = newMem.is_bot;
        const shouldMute = !isAdmin && !isBot && welcMutes !== 'off';

        const memberCount = await getChatMemberCount(token, chat.id); // sementara 0

        let welcomeText = null;
        let welcomeType = 'text';
        let welcomeContent = null;
        let welcomeButtons = [];

        if (shouldWelcome) {
            if (settings.welcome_text) {
                welcomeText = settings.welcome_text;
                welcomeType = settings.welcome_type || 'text';
                welcomeContent = settings.welcome_content;
                if (settings.welcome_buttons) {
                    try { welcomeButtons = JSON.parse(settings.welcome_buttons); } catch (e) {}
                }
            } else {
                welcomeText = DEFAULT_WELCOMES[Math.floor(Math.random() * DEFAULT_WELCOMES.length)];
            }

            const formatted = formatWelcomeText(welcomeText, newMem, chat, memberCount);
            welcomeText = markdownToHtml(formatted);
        }

        // Verifikasi strong / captcha
        if (shouldMute && (welcMutes === 'strong' || welcMutes === 'captcha')) {
            await restrictChatMember(token, chat.id, newMem.id, {
                can_send_messages: false,
                can_send_media_messages: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false,
                can_invite_users: false,
                can_pin_messages: false,
                can_change_info: false,
                can_send_polls: false
            });

            const verifData = {
                should_welcome: shouldWelcome,
                welcome_text: welcomeText,
                welcome_type: welcomeType,
                welcome_content: welcomeContent,
                welcome_buttons: welcomeButtons,
                chat_id: chat.id
            };

            if (welcMutes === 'strong') {
                const keyboard = {
                    inline_keyboard: [[
                        { text: '✅ Saya manusia', callback_data: `verify_strong_${newMem.id}` }
                    ]]
                };
                const sentMsg = await sendMessage(token, chat.id,
                    `Hai [${escapeHtml(newMem.first_name)}](tg://user?id=${newMem.id}), tekan tombol di bawah untuk membuktikan Anda bukan bot.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: keyboard
                    }
                );
                const msgData = await sentMsg.json();
                if (msgData.ok) {
                    verifData.message_id = msgData.result.message_id;
                }
            } else if (welcMutes === 'captcha') {
                const correct = Math.floor(1000 + Math.random() * 9000);
                const nums = [correct];
                while (nums.length < 8) {
                    const r = Math.floor(1000 + Math.random() * 9000);
                    if (!nums.includes(r)) nums.push(r);
                }
                for (let i = nums.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [nums[i], nums[j]] = [nums[j], nums[i]];
                }

                const keyboard = [];
                let row = [];
                for (let i = 0; i < nums.length; i++) {
                    row.push({
                        text: nums[i].toString(),
                        callback_data: `verify_captcha_${newMem.id}_${nums[i]}`
                    });
                    if (row.length === 2 || i === nums.length - 1) {
                        keyboard.push([...row]);
                        row = [];
                    }
                }

                const sentMsg = await sendMessage(token, chat.id,
                    `Hai [${escapeHtml(newMem.first_name)}](tg://user?id=${newMem.id}), pilih angka yang benar untuk membuktikan Anda bukan bot.`,
                    {
                        parse_mode: 'Markdown',
                        reply_markup: { inline_keyboard: keyboard }
                    }
                );
                const msgData = await sentMsg.json();
                if (msgData.ok) {
                    verifData.correct = correct;
                    verifData.message_id = msgData.result.message_id;
                }
            }

            await setVerification(db, chat.id, newMem.id, verifData);
            return; // tunggu verifikasi
        }

        if (shouldWelcome) {
            await sendWelcomeMessage(update, context, db, welcomeText, welcomeType, welcomeContent, welcomeButtons, settings);
        }

        if (shouldMute && welcMutes === 'soft') {
            const until = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
            await restrictChatMember(token, chat.id, newMem.id, {
                can_send_messages: true,
                can_send_media_messages: false,
                can_send_other_messages: false,
                can_add_web_page_previews: false,
                can_invite_users: false,
                can_pin_messages: false,
                can_change_info: false,
                can_send_polls: false
            }, until);
        }
    }
}

async function sendWelcomeMessage(update, context, db, text, type, content, buttons, settings) {
    const { token, chat } = context;
    const keyboard = buttons.length > 0 ? buildKeyboard(buttons) : null;
    let sent;

    try {
        if (type === 'sticker' && content) {
            sent = await sendSticker(token, chat.id, content, { reply_markup: keyboard });
        } else if (type === 'photo' && content) {
            sent = await sendPhoto(token, chat.id, content, { caption: text, parse_mode: 'HTML', reply_markup: keyboard });
        } else if (type === 'document' && content) {
            sent = await sendDocument(token, chat.id, content, { caption: text, parse_mode: 'HTML', reply_markup: keyboard });
        } else if (type === 'audio' && content) {
            sent = await sendAudio(token, chat.id, content, { caption: text, parse_mode: 'HTML', reply_markup: keyboard });
        } else if (type === 'voice' && content) {
            sent = await sendVoice(token, chat.id, content, { caption: text, parse_mode: 'HTML', reply_markup: keyboard });
        } else if (type === 'video' && content) {
            sent = await sendVideo(token, chat.id, content, { caption: text, parse_mode: 'HTML', reply_markup: keyboard });
        } else {
            sent = await sendMessage(token, chat.id, text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard });
        }
    } catch (e) {
        console.error('Gagal mengirim welcome:', e);
        sent = await sendMessage(token, chat.id, DEFAULT_WELCOMES[0], { parse_mode: 'HTML' });
    }

    if (sent && settings.clean_welcome === 1 && settings.last_welcome_msg_id) {
        try { await deleteMessage(token, chat.id, settings.last_welcome_msg_id); } catch (e) {}
    }

    if (sent) {
        const msgData = await sent.json();
        if (msgData.ok) {
            await setLastWelcomeMsg(db, chat.id, msgData.result.message_id);
        }
    }
}

// ==========================================
//  LEFT MEMBER HANDLER
// ==========================================
async function leftMemberHandler(update, context) {
    const { message, db, token, chat } = context;
    const leftMem = message.left_chat_member;
    if (!leftMem) return;

    await initWelcomeSettings(db, chat.id);
    const settings = await getWelcomeSettings(db, chat.id);
    if (!settings || settings.should_goodbye !== 1) return;

    const cleanService = settings.clean_service === 1;
    if (cleanService) {
        try { await deleteMessage(token, chat.id, message.message_id); } catch (e) {}
    }

    let goodbyeText = settings.goodbye_text;
    let goodbyeType = settings.goodbye_type || 'text';
    let goodbyeButtons = [];
    if (settings.goodbye_buttons) {
        try { goodbyeButtons = JSON.parse(settings.goodbye_buttons); } catch (e) {}
    }

    if (!goodbyeText) {
        goodbyeText = DEFAULT_GOODBYES[Math.floor(Math.random() * DEFAULT_GOODBYES.length)];
    }

    const count = 0;
    const formatted = formatWelcomeText(goodbyeText, leftMem, chat, count);
    const text = markdownToHtml(formatted);
    const keyboard = goodbyeButtons.length > 0 ? buildKeyboard(goodbyeButtons) : null;

    if (goodbyeType !== 'text' && settings.goodbye_content) {
        if (goodbyeType === 'sticker') {
            await sendSticker(token, chat.id, settings.goodbye_content, { reply_markup: keyboard });
        } else if (goodbyeType === 'photo') {
            await sendPhoto(token, chat.id, settings.goodbye_content, { caption: text, parse_mode: 'HTML', reply_markup: keyboard });
        } // tambahkan tipe lain jika perlu
    } else {
        await sendMessage(token, chat.id, text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard });
    }
}

// ==========================================
//  COMMAND HANDLERS
// ==========================================

async function welcomeCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1);
    await initWelcomeSettings(db, chat.id);
    const settings = await getWelcomeSettings(db, chat.id);

    if (args.length === 0) {
        const status = settings.should_welcome === 1 ? 'on' : 'off';
        let reply = `Pengaturan welcome: *${status}*\n\n`;
        if (settings.welcome_text) {
            reply += `*Pesan:*\n${settings.welcome_text}`;
        } else {
            reply += 'Pesan default digunakan.';
        }
        return sendMessage(token, chat.id, reply, { parse_mode: 'Markdown' });
    }

    if (args[0].toLowerCase() === 'on') {
        await setWelcomePref(db, chat.id, true);
        return sendMessage(token, chat.id, '✅ Welcome diaktifkan.');
    } else if (args[0].toLowerCase() === 'off') {
        await setWelcomePref(db, chat.id, false);
        return sendMessage(token, chat.id, '✅ Welcome dimatikan.');
    } else if (args[0].toLowerCase() === 'noformat') {
        let text = settings.welcome_text || 'Tidak ada pesan kustom.';
        return sendMessage(token, chat.id, text, { parse_mode: '' });
    } else {
        return sendMessage(token, chat.id, '❌ Gunakan: /welcome on/off/noformat');
    }
}

async function goodbyeCommand(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const args = message.text.split(' ').slice(1);
    await initWelcomeSettings(db, chat.id);
    const settings = await getWelcomeSettings(db, chat.id);

    if (args.length === 0) {
        const status = settings.should_goodbye === 1 ? 'on' : 'off';
        let reply = `Pengaturan goodbye: *${status}*\n\n`;
        if (settings.goodbye_text) {
            reply += `*Pesan:*\n${settings.goodbye_text}`;
        } else {
            reply += 'Pesan default digunakan.';
        }
        return sendMessage(token, chat.id, reply, { parse_mode: 'Markdown' });
    }

    if (args[0].toLowerCase() === 'on') {
        await setGoodbyePref(db, chat.id, true);
        return sendMessage(token, chat.id, '✅ Goodbye diaktifkan.');
    } else if (args[0].toLowerCase() === 'off') {
        await setGoodbyePref(db, chat.id, false);
        return sendMessage(token, chat.id, '✅ Goodbye dimatikan.');
    } else if (args[0].toLowerCase() === 'noformat') {
        let text = settings.goodbye_text || 'Tidak ada pesan kustom.';
        return sendMessage(token, chat.id, text, { parse_mode: '' });
    } else {
        return sendMessage(token, chat.id, '❌ Gunakan: /goodbye on/off/noformat');
    }
}

async function setWelcomeHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const msg = message;
    const text = msg.text || '';
    const args = text.split(' ').slice(1).join(' ').trim();

    let welcomeText = null;
    let welcomeType = 'text';
    let welcomeContent = null;
    let buttons = [];

    if (msg.reply_to_message) {
        const reply = msg.reply_to_message;
        if (reply.sticker) { welcomeType = 'sticker'; welcomeContent = reply.sticker.file_id; }
        else if (reply.photo) { welcomeType = 'photo'; welcomeContent = reply.photo[reply.photo.length-1].file_id; }
        else if (reply.document) { welcomeType = 'document'; welcomeContent = reply.document.file_id; }
        else if (reply.audio) { welcomeType = 'audio'; welcomeContent = reply.audio.file_id; }
        else if (reply.voice) { welcomeType = 'voice'; welcomeContent = reply.voice.file_id; }
        else if (reply.video) { welcomeType = 'video'; welcomeContent = reply.video.file_id; }
        else if (reply.text) {
            welcomeText = reply.text;
            const parsed = buttonMarkdownParser(welcomeText);
            welcomeText = parsed.text;
            buttons = parsed.buttons;
        } else if (reply.caption) {
            welcomeText = reply.caption;
            const parsed = buttonMarkdownParser(welcomeText);
            welcomeText = parsed.text;
            buttons = parsed.buttons;
        }
    } else {
        if (!args) return sendMessage(token, chat.id, '❌ Berikan teks untuk welcome.');
        welcomeText = args;
        const parsed = buttonMarkdownParser(welcomeText);
        welcomeText = parsed.text;
        buttons = parsed.buttons;
    }

    await setCustomWelcome(db, chat.id, welcomeText, welcomeType, welcomeContent, buttons);
    await sendMessage(token, chat.id, '✅ Pesan welcome berhasil disimpan.');
}

async function setGoodbyeHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }

    const msg = message;
    const args = msg.text.split(' ').slice(1).join(' ').trim();

    if (!args && !msg.reply_to_message) {
        return sendMessage(token, chat.id, '❌ Berikan teks untuk goodbye.');
    }

    let goodbyeText, buttons = [];
    if (msg.reply_to_message && msg.reply_to_message.text) {
        goodbyeText = msg.reply_to_message.text;
    } else {
        goodbyeText = args;
    }
    const parsed = buttonMarkdownParser(goodbyeText);
    goodbyeText = parsed.text;
    buttons = parsed.buttons;

    await setCustomGoodbye(db, chat.id, goodbyeText, 'text', buttons);
    await sendMessage(token, chat.id, '✅ Pesan goodbye berhasil disimpan.');
}

async function resetWelcomeHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }
    await resetWelcome(db, chat.id);
    await sendMessage(token, chat.id, '✅ Welcome direset ke default.');
}

async function resetGoodbyeHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }
    await resetGoodbye(db, chat.id);
    await sendMessage(token, chat.id, '✅ Goodbye direset ke default.');
}

async function cleanWelcomeHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }
    const args = message.text.split(' ').slice(1);
    if (args.length === 0) {
        const settings = await getWelcomeSettings(db, chat.id);
        const status = settings?.clean_welcome === 1 ? 'on' : 'off';
        return sendMessage(token, chat.id, `Clean welcome saat ini: *${status}*`, { parse_mode: 'Markdown' });
    }
    if (args[0].toLowerCase() === 'on') {
        await setCleanWelcome(db, chat.id, true);
        return sendMessage(token, chat.id, '✅ Clean welcome diaktifkan.');
    } else if (args[0].toLowerCase() === 'off') {
        await setCleanWelcome(db, chat.id, false);
        return sendMessage(token, chat.id, '✅ Clean welcome dimatikan.');
    } else {
        return sendMessage(token, chat.id, '❌ Gunakan: /cleanwelcome on/off');
    }
}

async function welcomeMuteHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }
    const args = message.text.split(' ').slice(1);
    if (args.length === 0) {
        const settings = await getWelcomeSettings(db, chat.id);
        const mode = settings?.welcome_mutes || 'off';
        return sendMessage(token, chat.id, `Welcome mute saat ini: *${mode}*`, { parse_mode: 'Markdown' });
    }
    const mode = args[0].toLowerCase();
    if (['off', 'soft', 'strong', 'captcha'].includes(mode)) {
        await setWelcomeMutes(db, chat.id, mode);
        return sendMessage(token, chat.id, `✅ Welcome mute diatur ke *${mode}*.`, { parse_mode: 'Markdown' });
    } else {
        return sendMessage(token, chat.id, '❌ Pilihan: off, soft, strong, captcha');
    }
}

async function cleanServiceHandler(update, context) {
    const { message, db, token, chat, user } = context;
    if (!await isUserAdmin(token, chat.id, user.id) && chat.type !== 'private') {
        return sendMessage(token, chat.id, '❌ Perintah ini hanya untuk admin.');
    }
    const args = message.text.split(' ').slice(1);
    if (args.length === 0) {
        const settings = await getWelcomeSettings(db, chat.id);
        const status = settings?.clean_service === 1 ? 'on' : 'off';
        return sendMessage(token, chat.id, `Clean service saat ini: *${status}*`, { parse_mode: 'Markdown' });
    }
    if (args[0].toLowerCase() === 'on') {
        await setCleanService(db, chat.id, true);
        return sendMessage(token, chat.id, '✅ Clean service diaktifkan.');
    } else if (args[0].toLowerCase() === 'off') {
        await setCleanService(db, chat.id, false);
        return sendMessage(token, chat.id, '✅ Clean service dimatikan.');
    } else {
        return sendMessage(token, chat.id, '❌ Gunakan: /cleanservice on/off');
    }
}

async function welcomeHelpHandler(update, context) {
    const { token, chat } = context;
    await sendMessage(token, chat.id, GREETINGS_HELP, { parse_mode: 'Markdown' });
}

async function welcomeMuteHelpHandler(update, context) {
    const { token, chat } = context;
    await sendMessage(token, chat.id, WELCOME_MUTE_HELP, { parse_mode: 'Markdown' });
}

// ==========================================
//  CALLBACK HANDLERS (verifikasi)
// ==========================================
async function verifyStrongCallback(update, context) {
    const { callback_query, db, token, chat, user } = context;
    const data = callback_query.data;
    const match = data.match(/verify_strong_(\d+)/);
    if (!match) return;
    const targetId = parseInt(match[1]);
    if (user.id !== targetId) {
        await answerCallback(token, callback_query.id, '❌ Bukan untukmu.', true);
        return;
    }

    const verif = await getVerification(db, chat.id, user.id);
    if (!verif) {
        await answerCallback(token, callback_query.id, '❌ Data verifikasi tidak ditemukan.', true);
        return;
    }

    await restrictChatMember(token, chat.id, user.id, {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
        can_invite_users: true,
        can_pin_messages: true,
        can_change_info: true,
        can_send_polls: true
    });

    if (verif.message_id) {
        try { await deleteMessage(token, chat.id, verif.message_id); } catch (e) {}
    }

    if (verif.should_welcome) {
        const settings = await getWelcomeSettings(db, chat.id);
        await sendWelcomeMessage(update, context, db, verif.welcome_text, verif.welcome_type, verif.welcome_content, verif.welcome_buttons, settings);
    }

    await deleteVerification(db, chat.id, user.id);
    await answerCallback(token, callback_query.id, '✅ Verifikasi berhasil! Selamat datang.');
}

async function verifyCaptchaCallback(update, context) {
    const { callback_query, db, token, chat, user } = context;
    const data = callback_query.data;
    const match = data.match(/verify_captcha_(\d+)_(\d+)/);
    if (!match) return;
    const targetId = parseInt(match[1]);
    const answer = parseInt(match[2]);
    if (user.id !== targetId) {
        await answerCallback(token, callback_query.id, '❌ Bukan untukmu.', true);
        return;
    }

    const verif = await getVerification(db, chat.id, user.id);
    if (!verif) {
        await answerCallback(token, callback_query.id, '❌ Data verifikasi tidak ditemukan.', true);
        return;
    }

    if (answer === verif.correct) {
        await restrictChatMember(token, chat.id, user.id, {
            can_send_messages: true,
            can_send_media_messages: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_invite_users: true,
            can_pin_messages: true,
            can_change_info: true,
            can_send_polls: true
        });
        if (verif.message_id) {
            try { await deleteMessage(token, chat.id, verif.message_id); } catch (e) {}
        }
        if (verif.should_welcome) {
            const settings = await getWelcomeSettings(db, chat.id);
            await sendWelcomeMessage(update, context, db, verif.welcome_text, verif.welcome_type, verif.welcome_content, verif.welcome_buttons, settings);
        }
        await deleteVerification(db, chat.id, user.id);
        await answerCallback(token, callback_query.id, '✅ Captcha benar! Selamat datang.');
    } else {
        await kickChatMember(token, chat.id, user.id);
        if (verif.message_id) {
            try { await deleteMessage(token, chat.id, verif.message_id); } catch (e) {}
        }
        await deleteVerification(db, chat.id, user.id);
        await answerCallback(token, callback_query.id, '❌ Captcha salah. Anda dikeluarkan.');
    }
}

// ==========================================
//  EXPORT MODUL
// ==========================================
export default {
    mod_name: "Greetings",
    help: GREETINGS_HELP,
    commands: [
        { command: 'welcome', handler: welcomeCommand },
        { command: 'goodbye', handler: goodbyeCommand },
        { command: 'setwelcome', handler: setWelcomeHandler },
        { command: 'setgoodbye', handler: setGoodbyeHandler },
        { command: 'resetwelcome', handler: resetWelcomeHandler },
        { command: 'resetgoodbye', handler: resetGoodbyeHandler },
        { command: 'cleanwelcome', handler: cleanWelcomeHandler },
        { command: 'welcomemute', handler: welcomeMuteHandler },
        { command: 'cleanservice', handler: cleanServiceHandler },
        { command: 'welcomehelp', handler: welcomeHelpHandler },
        { command: 'welcomemutehelp', handler: welcomeMuteHelpHandler }
    ],
    callbacks: [
        { pattern: /^verify_strong_/, handler: verifyStrongCallback },
        { pattern: /^verify_captcha_/, handler: verifyCaptchaCallback }
    ],
    messageHandlers: [
        { handler: newMemberHandler, group: 5 },
        { handler: leftMemberHandler, group: 5 }
    ]
};
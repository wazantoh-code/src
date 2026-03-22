import adminModule from './admin.js';
import filtersModule from './filters.js';
import greetingsModule from './greetings.js';
import warnsModule from './warns.js';
import notesModule from './notes.js';
import rulesModule from './rules.js';
import topicsModule from './topics.js';


import {
    sendMessage, editMessage, answerCallback, getChatMember, getChatAdministrators, getMe,
    trackUser, trackChat, getUserCount, getChatCount,
    getReadableTime, escapeHtml, mentionHtml, extractUser, extractText,
    isBotAdmin, canPromote, canChangeInfo, canPin, isUserAdmin
} from './utils.js';

// ==========================================
//  KONFIGURASI HARDCODED
// ==========================================
const BOT_TOKEN = '5593144463:AAFsIwRgGoGXEBQC-kZibnMoMV5BkRwjqIA';
const BOT_USERNAME = 'xrynze4bot';
const OWNER_ID = 5166575484;
const SUPPORT_CHAT = 'DutabotSupport';
const START_TIME = Date.now();

// ==========================================
//  MODULE REGISTRY
// ==========================================
const COMMANDS = new Map();
const CALLBACK_HANDLERS = [];
const MESSAGE_HANDLERS = [];
const HELPABLE = {};

function registerModule(module) {
    module.commands?.forEach(cmd => COMMANDS.set(cmd.command, cmd.handler));
    module.callbacks?.forEach(cb => CALLBACK_HANDLERS.push(cb));
    module.messageHandlers?.forEach(mh => MESSAGE_HANDLERS.push(mh));
    if (module.mod_name && module.help) {
        const key = module.mod_name.toLowerCase();
        HELPABLE[key] = {
            name: module.mod_name,
            help: module.help
        };
    }
}

registerModule(adminModule);
registerModule(filtersModule);
registerModule(greetingsModule);
registerModule(warnsModule);
registerModule(notesModule); 
registerModule(rulesModule);  
registerModule(topicsModule); 


// ==========================================
//  HELPER PAGINATION (untuk /help)
// ==========================================
function paginateModules(page, modules, callbackPrefix) {
    const moduleList = Object.keys(modules).sort();
    const perPage = 4;
    const totalPages = Math.ceil(moduleList.length / perPage);
    const start = page * perPage;
    const end = start + perPage;
    const currentModules = moduleList.slice(start, end);

    const keyboard = [];
    const row = [];

    for (let i = 0; i < currentModules.length; i++) {
        const modName = modules[currentModules[i]].name;
        row.push({
            text: modName,
            callback_data: `${callbackPrefix}_module(${currentModules[i]})`
        });
        if (row.length === 2 || i === currentModules.length - 1) {
            keyboard.push([...row]);
            row.length = 0;
        }
    }

    const navRow = [];
    if (page > 0) {
        navRow.push({ text: '◀ Sebelumnya', callback_data: `${callbackPrefix}_prev(${page})` });
    }
    if (page < totalPages - 1) {
        navRow.push({ text: 'Selanjutnya ▶', callback_data: `${callbackPrefix}_next(${page})` });
    }
    if (navRow.length > 0) keyboard.push(navRow);
    keyboard.push([{ text: '🔙 Kembali', callback_data: 'mz_back' }]);

    return { inline_keyboard: keyboard };
}

// ==========================================
//  FUNGSI KIRIM PESAN ERROR KE OWNER
// ==========================================
async function sendErrorToOwner(error, update) {
    if (!OWNER_ID) return;
    try {
        const errorText = `🚨 *Error pada bot* 🚨\n\n${escapeHtml(error.toString())}\n\n\`\`\`${escapeHtml(error.stack || '')}\`\`\`\n\nUpdate: ${JSON.stringify(update, null, 2)}`;
        const trimmed = errorText.length > 4000 ? errorText.substring(0, 4000) + '...' : errorText;
        await sendMessage(BOT_TOKEN, OWNER_ID, trimmed, { parse_mode: 'Markdown' });
    } catch (e) {
        console.error('Gagal mengirim error ke owner:', e);
    }
}

// ==========================================
//  CORE HANDLERS (start, help, about)
// ==========================================
const BUTTONS_MAIN = {
    inline_keyboard: [
        [{ text: '❖ TAMBAHKAN KE GRUP ❖', url: `https://t.me/${BOT_USERNAME}?startgroup=new` }],
        [
            { text: '🆘 Bantuan', callback_data: 'help_back' },
            { text: '📞 Support', url: `https://t.me/${SUPPORT_CHAT}` }
        ],
        [{ text: `ℹ️ Tentang ${BOT_USERNAME}`, callback_data: 'mz_' }]
    ]
};

const HELP_STRINGS = `❖ *Klik tombol di bawah untuk deskripsi perintah spesifik.* ❖

❖ /start : Mulai aku!! ✨
❖ /help : Bantuan perintah`;


async function startHandler(update, context) {
    const { message, db, token, env } = context;
    const chat = message.chat;
    const user = message.from;
    const args = message.text.split(' ').slice(1);

    await trackUser(db, user);
    await trackChat(db, chat);

    // Handle deep link untuk rules
    if (args.length > 0 && args[0].startsWith('rules_')) {
        // Import fungsi sendRules dari rules module
        const { sendRules } = await import('./rules.js');
        const chatId = parseInt(args[0].replace('rules_', ''));
        await sendRules(update, context, chatId, true);
        return;
    }

    // Sisa kode startHandler seperti biasa...
    if (chat.type === 'private') {
        if (args[0]?.toLowerCase() === 'help') {
            return sendHelp(chat.id, context);
        }
        
        const uptime = getReadableTime((Date.now() - START_TIME) / 1000);
        const userCount = await getUserCount(db);
        const chatCount = await getChatCount(db);
        const text = `*Halo ${escapeHtml(user.first_name)} !*
Saya adalah ${BOT_USERNAME} – Bot Manajemen Telegram [❖]
────────────────────────
× *Uptime:* \`${uptime}\`
× \`${userCount}\` *pengguna, di* \`${chatCount}\` *grup.*
────────────────────────
✪ Tekan /help untuk bantuan..`;
        await sendMessage(BOT_TOKEN, chat.id, text, {
            parse_mode: 'Markdown',
            reply_markup: BUTTONS_MAIN
        });
    } else {
        await sendMessage(BOT_TOKEN, chat.id, `👋 Halo, saya *${BOT_USERNAME}*. Senang bertemu denganmu!`, { parse_mode: 'Markdown' });
    }
}

async function helpHandler(update, context) {
    const { message, chat } = context;
    if (chat.type !== 'private') {
        return sendMessage(BOT_TOKEN, chat.id, 'Hubungi saya di PM untuk mendapatkan daftar perintah.', {
            reply_markup: {
                inline_keyboard: [[
                    { text: '🆘 Bantuan', url: `https://t.me/${BOT_USERNAME}?start=help` }
                ]]
            }
        });
    }
    await sendHelp(chat.id, context);
}

async function sendHelp(chatId, context) {
    const keyboard = paginateModules(0, HELPABLE, 'help');
    await sendMessage(BOT_TOKEN, chatId, HELP_STRINGS, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
    });
}

async function helpButtonCallback(update, context) {
    const { callback_query } = context;
    const data = callback_query.data;
    const chatId = callback_query.message.chat.id;
    const msgId = callback_query.message.message_id;

    const modMatch = data.match(/help_module\((.+?)\)/);
    const prevMatch = data.match(/help_prev\((\d+)\)/);
    const nextMatch = data.match(/help_next\((\d+)\)/);
    const backMatch = data.match(/help_back/);

    try {
        if (modMatch) {
            const modKey = modMatch[1];
            const mod = HELPABLE[modKey];
            if (!mod) return;
            const text = `*Berikut adalah bantuan untuk modul ${mod.name}:*\n\n${mod.help}`;
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'help_back' }
                    ]]
                }
            });
        } else if (prevMatch) {
            const page = parseInt(prevMatch[1]) - 1;
            const keyboard = paginateModules(page, HELPABLE, 'help');
            await editMessage(BOT_TOKEN, chatId, msgId, HELP_STRINGS, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else if (nextMatch) {
            const page = parseInt(nextMatch[1]) + 1;
            const keyboard = paginateModules(page, HELPABLE, 'help');
            await editMessage(BOT_TOKEN, chatId, msgId, HELP_STRINGS, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } else if (backMatch) {
            const keyboard = paginateModules(0, HELPABLE, 'help');
            await editMessage(BOT_TOKEN, chatId, msgId, HELP_STRINGS, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        }
    } catch (e) {
        console.error('Help callback error:', e);
        await sendErrorToOwner(e, update);
    }
    await answerCallback(BOT_TOKEN, callback_query.id);
}

// ==========================================
//  CALLBACK HANDLER ABOUT (sudah lengkap, potong karena panjang)
// ==========================================
async function aboutCallback(update, context) {
    const { callback_query, db } = context;
    const data = callback_query.data;
    const chatId = callback_query.message.chat.id;
    const msgId = callback_query.message.message_id;

    try {
        if (data === 'mz_') {
            const text = `๏ Saya *${BOT_USERNAME}*, bot manajemen grup yang powerful untuk membantu Anda mengelola grup dengan mudah.
• Saya bisa membatasi pengguna.
• Saya bisa menyapa pengguna baru dengan pesan selamat datang kustom, dan bahkan mengatur aturan grup.
• Saya punya sistem anti-flood canggih.
• Saya bisa memperingatkan pengguna hingga batas maksimum, dengan tindakan seperti ban, mute, kick, dll.
• Saya punya sistem catatan, daftar hitam, dan balasan otomatis pada kata kunci tertentu.
• Saya memeriksa izin admin sebelum menjalankan perintah apa pun.

_${BOT_USERNAME} dilisensikan di bawah GNU General Public License v3.0_

Klik tombol di bawah untuk bantuan dasar ${BOT_USERNAME}.`;
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '👮 Admin', callback_data: 'mz_admin' },
                            { text: '📝 Catatan', callback_data: 'mz_notes' }
                        ],
                        [
                            { text: '📞 Support', callback_data: 'mz_support' },
                            { text: '🌟 Kredit', callback_data: 'mz_credit' }
                        ],
                        [
                            { text: '📦 Kode Sumber', url: 'https://github.com' }
                        ],
                        [
                            { text: '🔙 Kembali', callback_data: 'mz_back' }
                        ]
                    ]
                }
            });
        } else if (data === 'mz_back') {
            const uptime = getReadableTime((Date.now() - START_TIME) / 1000);
            const userCount = await getUserCount(db);
            const chatCount = await getChatCount(db);
            const text = `*Halo ${escapeHtml(callback_query.from.first_name)} !*
Saya adalah ${BOT_USERNAME} – Bot Manajemen Telegram [❖]
────────────────────────
× *Uptime:* \`${uptime}\`
× \`${userCount}\` *pengguna, di* \`${chatCount}\` *grup.*
────────────────────────
✪ Tekan /help untuk bantuan..`;
            const BUTTONS_MAIN = {
                inline_keyboard: [
                    [{ text: '❖ TAMBAHKAN KE GRUP ❖', url: `https://t.me/${BOT_USERNAME}?startgroup=new` }],
                    [
                        { text: '🆘 Bantuan', callback_data: 'help_back' },
                        { text: '📞 Support', url: `https://t.me/${SUPPORT_CHAT}` }
                    ],
                    [{ text: `ℹ️ Tentang ${BOT_USERNAME}`, callback_data: 'mz_' }]
                ]
            };
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'Markdown',
                reply_markup: BUTTONS_MAIN
            });
        } else if (data === 'mz_admin') {
            const text = `*๏ Mari buat grup Anda lebih efektif sekarang*
Selamat, ${BOT_USERNAME} siap mengelola grup Anda.

*🛠 Peralatan Admin*
Bantuan admin dasar untuk melindungi dan memperkuat grup.
• Ban, kick, promote anggota.
• Pesan selamat datang kustom.
• Atur aturan grup.

*👋 Salam*
Setel pesan selamat datang:
\`/setwelcome [pesan]\`

*📌 Pin & Semat*
• /pin – sematkan pesan
• /unpin – lepas semat`;
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'mz_' }
                    ]]
                }
            });
        } else if (data === 'mz_notes') {
            const text = `<b>๏ Mengatur Catatan</b>
Anda dapat menyimpan pesan/media/audio sebagai catatan.
Gunakan tanda # di awal kata untuk mengambil catatan.

Contoh: Kirim <code>#info</code> untuk mendapatkan catatan yang tersimpan.

Anda juga bisa menambahkan tombol (inline button) pada catatan.`;
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Kembali', callback_data: 'mz_' }
                    ]]
                }
            });
        } else if (data === 'mz_support') {
            const text = `*๏ Grup Support ${BOT_USERNAME}*
Gabung ke grup/channel support untuk melaporkan masalah atau sekedar ngobrol.`;
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '📞 Support', url: 'https://t.me/Mazekubot' },
                            { text: '📢 Updates', url: 'https://t.me/Dutabotid' }
                        ],
                        [
                            { text: '🔙 Kembali', callback_data: 'mz_' }
                        ]
                    ]
                }
            });
        } else if (data === 'mz_credit') {
            const text = `๏ *Kredit untuk ${BOT_USERNAME}*

Berikut adalah para pengembang dan inspirator yang telah membantu menciptakan bot ini.`;
            await editMessage(BOT_TOKEN, chatId, msgId, text, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: 'sena-ex', url: 'https://github.com/kennedy-ex' },
                            { text: 'TheHamkerCat', url: 'https://github.com/TheHamkerCat' }
                        ],
                        [
                            { text: 'Feri', url: 'https://github.com/FeriEXP' },
                            { text: 'riz-ex', url: 'https://github.com/riz-ex' }
                        ],
                        [
                            { text: 'Anime Kaizoku', url: 'https://github.com/animekaizoku' },
                            { text: 'TheGhost Hunter', url: 'https://github.com/HuntingBots' }
                        ],
                        [
                            { text: '🔙 Kembali', callback_data: 'mz_' }
                        ]
                    ]
                }
            });
        }
    } catch (e) {
        console.error('About callback error:', e);
        await sendErrorToOwner(e, update);
    }
    await answerCallback(BOT_TOKEN, callback_query.id);
}

// ==========================================
//  MAIN REQUEST HANDLER
// ==========================================
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (request.method !== 'POST' || url.pathname !== '/webhook') {
            return new Response('OK');
        }

        const update = await request.json();
        const db = env.DB;

        const context = {
            update,
            token: BOT_TOKEN,
            db,
            env,
            bot: { username: BOT_USERNAME }
        };

        try {
            if (update.message) {
                const msg = update.message;
                context.message = msg;
                context.chat = msg.chat;
                context.user = msg.from;

                await trackUser(db, msg.from);
                await trackChat(db, msg.chat);

                if (msg.text?.startsWith('/')) {
                    const fullCmd = msg.text.split(' ')[0];
                    const command = fullCmd.split('@')[0].substring(1).toLowerCase();
                    const handler = COMMANDS.get(command);
                    if (handler) await handler(update, context);
                }

                for (const mh of MESSAGE_HANDLERS) {
                    await mh.handler(update, context);
                }
            }

            if (update.callback_query) {
                const cb = update.callback_query;
                context.callback_query = cb;
                context.message = cb.message;
                context.chat = cb.message.chat;
                context.user = cb.from;

                let handled = false;

                for (const { pattern, handler } of CALLBACK_HANDLERS) {
                    if (pattern.test(cb.data)) {
                        await handler(update, context);
                        handled = true;
                        break;
                    }
                }
                if (!handled && cb.data.startsWith('help_')) {
                    await helpButtonCallback(update, context);
                    handled = true;
                }
                if (!handled && cb.data.startsWith('mz_')) {
                    await aboutCallback(update, context);
                    handled = true;
                }
            }
        } catch (e) {
            console.error('FATAL ERROR:', e);
            await sendErrorToOwner(e, update);
        }
        return new Response('OK');
    }
};

COMMANDS.set('start', startHandler);
COMMANDS.set('help', helpHandler);
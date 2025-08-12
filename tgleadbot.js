require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

// ======== ENV / CONFIG ========
const BOT_TOKEN = process.env.BOT_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN not set'); process.exit(1); }
if (!SHEET_ID)  { console.error('❌ SHEET_ID not set');  process.exit(1); }

const MY_ID = 1296951270; // для сервисных уведомлений/file_id

// ======== BOT INIT ========
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ======== STEPS / LOCAL PROGRESS (как было) ========
const steps = JSON.parse(fs.readFileSync('./steps.json', 'utf8'));
const userDataPath = path.join(__dirname, 'userData.json');
let userData = fs.existsSync(userDataPath)
  ? JSON.parse(fs.readFileSync(userDataPath, 'utf8'))
  : {};
function saveUserData() {
  fs.writeFileSync(userDataPath, JSON.stringify(userData, null, 2));
}

// ======== GOOGLE SHEETS ========
let sheetsApi;

async function initSheets() {
  const scopes = ['https://www.googleapis.com/auth/spreadsheets'];

  let authClient;

  // 1) Если есть приватный ключ в переменной — используем его
  if (SERVICE_EMAIL && PRIVATE_KEY) {
    const auth = new google.auth.JWT(SERVICE_EMAIL, null, PRIVATE_KEY, scopes);
    await auth.authorize();
    authClient = auth;
  }
  // 2) Иначе, если передан путь к json-файлу — используем его
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes
    });
    authClient = await auth.getClient();
  }
  else {
    throw new Error('Нет ни GOOGLE_PRIVATE_KEY, ни GOOGLE_APPLICATION_CREDENTIALS');
  }

  sheetsApi = google.sheets({ version: 'v4', auth: authClient });

  await ensureSheetWithHeader('Users',  ['ts','user_id','username','first_name','last_name','ref']);
  await ensureSheetWithHeader('Steps',  ['ts','user_id','step_index','step_type']);
  await ensureSheetWithHeader('Events', ['ts','user_id','type','data']);

  console.log('✅ Google Sheets готова');

async function ensureSheetWithHeader(title, header) {
  // Проверяем есть ли шапка; если листа нет — попробуем добавить.
  const headerRead = await sheetsApi.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${title}!A1:Z1`
  }).catch(() => null);

  const hasHeader = headerRead && headerRead.data && headerRead.data.values && headerRead.data.values.length > 0;
  if (!hasHeader) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] }
    }).catch(() => {}); // если уже есть — ок
    await sheetsApi.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${title}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [header] }
    });
  }
}

async function appendRow(title, values) {
  await sheetsApi.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${title}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] }
  });
}

// ======== ANALYTICS HELPERS ========
const nowISO = () => new Date().toISOString();

async function logStart(msg, ref) {
  const u = msg.from || {};
  const ts = nowISO();
  await appendRow('Users',  [ts, u.id || '', u.username || '', u.first_name || '', u.last_name || '', ref || 'no_ref']);
  await appendRow('Events', [ts, u.id || '', 'start', JSON.stringify({ ref: ref || 'no_ref' })]);
}

async function logStepView(userId, stepIndex, stepType) {
  await appendRow('Steps', [nowISO(), userId || '', stepIndex, stepType || '']);
}

async function logClick(userId, data) {
  await appendRow('Events', [nowISO(), userId || '', 'click', JSON.stringify({ data })]);
}

async function logFinish(userId) {
  await appendRow('Events', [nowISO(), userId || '', 'finish', '{}']);
}

// ======== UI: INLINE KEYBOARD (твоя логика) ========
function buildInlineKeyboard(step) {
  const rows = step.buttons || [];
  const inline_keyboard = rows.map((row, rIdx) =>
    row.map((btn, cIdx) => {
      const text = btn.text ?? '';
      const cb = btn.callback_data ?? btn.data; // совместимость
      const url = btn.url;

      if (!text || (cb == null && !url)) {
        console.warn('⚠️ Bad button in step:', { stepType: step.type, rIdx, cIdx, btn });
        return { text: '…', callback_data: 'noop' };
      }
      return url ? { text, url } : { text, callback_data: cb };
    })
  );
  if (!inline_keyboard.length) {
    return [[{ text: step.button || 'Дальше', callback_data: 'next' }]];
  }
  return inline_keyboard;
}

// ======== CORE: SEND STEP (с логированием) ========
async function sendStep(chatId, stepIndex) {
  const step = steps[stepIndex];
  if (!step) {
    await bot.sendMessage(chatId, '🎉 Ты прошёл все шаги! Спасибо, что был с нами.');
    try { await logFinish(chatId); } catch (e) { console.error('logFinish:', e.message); }
    return;
  }

  userData[chatId] = stepIndex;
  saveUserData();

  try { await logStepView(chatId, stepIndex, step.type); } catch (e) { console.error('logStepView:', e.message); }

  const inline_keyboard = buildInlineKeyboard(step);
  const options = { reply_markup: { inline_keyboard } };

  try {
    switch (step.type) {
      case 'text':
        await bot.sendMessage(chatId, step.content, options);
        break;
      case 'document':
        await bot.sendDocument(chatId, step.file, { caption: step.caption, ...options });
        break;
      case 'video':
        await bot.sendVideo(chatId, step.file, { caption: step.caption, ...options });
        break;
      case 'audio':
        await bot.sendAudio(chatId, step.file, { caption: step.caption, ...options });
        break;
      default:
        await bot.sendMessage(chatId, '⚠️ Неизвестный тип шага.');
    }
  } catch (err) {
    console.error('❌ Failed to send step', { stepIndex, err: err?.message });
    await bot.sendMessage(chatId, '⚠️ Ошибка отправки шага. Попробуй ещё раз /start');
  }
}

// ======== /start (ловим источник) ========
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  let ref = (match && match[1]) ? match[1].trim() : 'no_ref'; // vk / ig / site / tg / vk_adset1_creative2 и т.п.
  if (!ref) ref = 'no_ref';

  try { await logStart(msg, ref); } catch (e) { console.error('logStart:', e.message); }

  await sendStep(chatId, 0);
});

// ======== CALLBACKS (логируем клики) ========
bot.on('callback_query', async (query) => {
  const chatId = query.message?.chat?.id;
  const data = (query.data || '').trim();
  const current = userData[chatId] ?? 0;

  try { await logClick(chatId, data); } catch (e) { console.error('logClick:', e.message); }

  try {
    if (data === 'next') {
      await sendStep(chatId, current + 1);
    } else if (data === 'noop') {
      await bot.answerCallbackQuery(query.id, { text: 'Скоро будет доступно', show_alert: false });
    } else if (data.startsWith('goto:')) {
      const index = parseInt(data.split(':')[1], 10);
      if (!isNaN(index)) await sendStep(chatId, index);
      else await bot.sendMessage(chatId, `⏳ Некорректный goto: ${data}`);
    } else if (/^step(\d+)$/i.test(data)) {
      const stepNum = parseInt(data.replace(/^step/i, ''), 10);
      if (!isNaN(stepNum) && steps[stepNum]) {
        await sendStep(chatId, stepNum);
      } else {
        await bot.sendMessage(chatId, `⏳ Нет шага с индексом ${stepNum}`);
      }
    } else {
      await bot.sendMessage(chatId, `⏳ Эта кнопка пока не реализована: ${data}`);
    }
  } catch (err) {
    console.error('❌ callback_query handler error:', err?.message);
  } finally {
    try { await bot.answerCallbackQuery(query.id); } catch {}
  }
});

// ======== FILE_ID catcher (как было) ========
bot.on('channel_post', async (msg) => {
  const chatId = MY_ID;
  try {
    if (msg.video)         await bot.sendMessage(chatId, `🎥 Видео file_id:\n${msg.video.file_id}`);
    else if (msg.document) await bot.sendMessage(chatId, `📄 Документ file_id:\n${msg.document.file_id}`);
    else if (msg.audio)    await bot.sendMessage(chatId, `🎵 Аудио file_id:\n${msg.audio.file_id}`);
    else if (msg.voice)    await bot.sendMessage(chatId, `🎙 Голосовое сообщение file_id:\n${msg.voice.file_id}`);
    else if (msg.photo) {
      const largest = msg.photo[msg.photo.length - 1];
      await bot.sendMessage(chatId, `🖼 Фото file_id:\n${largest.file_id}`);
    } else {
      await bot.sendMessage(chatId, '🤷 Канал получил что-то, что бот не обрабатывает.');
    }
  } catch (e) {
    console.error('❌ channel_post forward error:', e?.message);
  }
});

// ======== INIT ========
(async () => {
  try {
    await initSheets();
  } catch (e) {
    console.error('❌ Sheets init error:', e.message);
  }
})();

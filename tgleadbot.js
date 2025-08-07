require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const steps = JSON.parse(fs.readFileSync('./steps.json', 'utf8'));
let userData = fs.existsSync('./userData.json') ? JSON.parse(fs.readFileSync('./userData.json', 'utf8')) : {};

function saveUserData() {
  fs.writeFileSync('./userData.json', JSON.stringify(userData, null, 2));
}

// === ⬇️ Основная логика показа шагов ===
function sendStep(chatId, stepIndex) {
  const step = steps[stepIndex];
  if (!step) {
    bot.sendMessage(chatId, "🎉 Ты прошёл все шаги! Спасибо, что был с нами.");
    return;
  }

  userData[chatId] = stepIndex;
  saveUserData();

  // Поддержка нескольких кнопок (одна или много строк)
  const inline_keyboard = (step.buttons || []).map(row =>
    row.map(btn => ({ text: btn.text, callback_data: btn.data }))
  );

  const options = {
    reply_markup: {
      inline_keyboard: inline_keyboard.length ? inline_keyboard : [[{ text: step.button || "Дальше", callback_data: "next" }]]
    }
  };

  switch (step.type) {
    case 'text':
      bot.sendMessage(chatId, step.content, options);
      break;
    case 'document':
      bot.sendDocument(chatId, step.file, {
        caption: step.caption,
        ...options
      });
      break;
    case 'video':
      bot.sendVideo(chatId, step.file, {
        caption: step.caption,
        ...options
      });
      break;
    case 'audio':
      bot.sendAudio(chatId, step.file, {
        caption: step.caption,
        ...options
      });
      break;
    default:
      bot.sendMessage(chatId, "⚠️ Неизвестный тип шага.");
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sendStep(chatId, 0);
});

// === ⬇️ Переход по кнопкам ===
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  const current = userData[chatId] || 0;

  if (data === 'next') {
    sendStep(chatId, current + 1);
  } else if (data.startsWith('goto:')) {
    const index = parseInt(data.split(':')[1], 10);
    if (!isNaN(index)) sendStep(chatId, index);
  } else {
    bot.sendMessage(chatId, `⏳ Эта кнопка пока не реализована: ${data}`);
  }

  bot.answerCallbackQuery(query.id).catch(() => {});
});

// Функция экранирования спецсимволов для MarkdownV2
const MY_ID = 1296951270;

bot.on('channel_post', (msg) => {
  console.log('📡 Получен пост из канала:', msg);

  const chatId = MY_ID;

  if (msg.video) {
    bot.sendMessage(chatId, `🎥 Видео file_id:\n${msg.video.file_id}`);
  } else if (msg.document) {
    bot.sendMessage(chatId, `📄 Документ file_id:\n${msg.document.file_id}`);
  } else if (msg.audio) {
    bot.sendMessage(chatId, `🎵 Аудио file_id:\n${msg.audio.file_id}`);
  } else if (msg.voice) {
    bot.sendMessage(chatId, `🎙 Голосовое сообщение file_id:\n${msg.voice.file_id}`);
  } else if (msg.photo) {
    const largestPhoto = msg.photo[msg.photo.length - 1]; // берём самое большое
    bot.sendMessage(chatId, `🖼 Фото file_id:\n${largestPhoto.file_id}`);
  } else {
    bot.sendMessage(chatId, '🤷 Канал получил что-то, что бот не обрабатывает (например, текст или unsupported формат).');
  }
});

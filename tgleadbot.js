require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const steps = JSON.parse(fs.readFileSync('./steps.json', 'utf8'));
let userData = fs.existsSync('./userData.json') ? JSON.parse(fs.readFileSync('./userData.json', 'utf8')) : {};

function saveUserData() {
  fs.writeFileSync('./userData.json', JSON.stringify(userData, null, 2));
}

function sendStep(chatId, stepIndex) {
  const step = steps[stepIndex];
  if (!step) {
    bot.sendMessage(chatId, "🎉 Ты прошёл все шаги! Спасибо, что был с нами.");
    return;
  }

  userData[chatId] = stepIndex;
  saveUserData();

  const options = {
    reply_markup: {
      inline_keyboard: [[{ text: step.button || "Дальше", callback_data: "next" }]]
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
    default:
      bot.sendMessage(chatId, "⚠️ Неизвестный тип шага.");
  }
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sendStep(chatId, 0);
});

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const current = userData[chatId] || 0;
  const next = current + 1;
  sendStep(chatId, next);
});
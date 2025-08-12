require('dotenv').config();
console.log('BOT_TOKEN exists:', Boolean(process.env.BOT_TOKEN));
console.log('SHEET_ID:', process.env.SHEET_ID);
console.log('GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS);
console.log('GOOGLE_SERVICE_ACCOUNT_EMAIL:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL);
console.log('Has GOOGLE_PRIVATE_KEY:', Boolean(process.env.GOOGLE_PRIVATE_KEY));

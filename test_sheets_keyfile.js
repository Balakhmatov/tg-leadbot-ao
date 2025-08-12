require('dotenv').config();
const { google } = require('googleapis');

(async () => {
  try {
    const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (!keyFile) throw new Error('GOOGLE_APPLICATION_CREDENTIALS is empty');
    const auth = new google.auth.GoogleAuth({
      keyFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const client = await auth.getClient();
    const sheets = google.sheets({ version: 'v4', auth: client });
    await sheets.spreadsheets.get({ spreadsheetId: process.env.SHEET_ID });
    console.log('OK: keyFile auth works');
  } catch (e) {
    console.error('ERR:', e.message);
  }
})();

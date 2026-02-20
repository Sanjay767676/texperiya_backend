const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { env } = require('./env');

let auth;

// Support two modes:
// 1. GOOGLE_SERVICE_ACCOUNT_JSON env var (for Render/cloud) — full JSON string
// 2. GOOGLE_SERVICE_ACCOUNT_KEY env var (for local) — path to JSON file
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    console.log('[Google Sheets] Auth via GOOGLE_SERVICE_ACCOUNT_JSON env var');
} else {
    const keyFilePath = path.join(__dirname, '../../', env.serviceAccountKey);
    auth = new google.auth.GoogleAuth({
        keyFile: keyFilePath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    console.log('[Google Sheets] Auth via key file:', env.serviceAccountKey);
}

const sheets = google.sheets({ version: 'v4', auth });

module.exports = sheets;

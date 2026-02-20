const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env
dotenv.config({ path: path.join(__dirname, '../../.env') });

const required = [
    'CS_SHEET_ID',
    'NCS_SHEET_ID',
    'BASE_URL',
    'CS_EMAIL_USER',
    'CS_EMAIL_PASS',
    'NCS_EMAIL_USER',
    'NCS_EMAIL_PASS',
];

const validateEnv = () => {
    const missing = required.filter((key) => !process.env[key] || String(process.env[key]).trim() === '');
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON || String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).trim() === '') {
        missing.push('GOOGLE_SERVICE_ACCOUNT_JSON');
    }
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
};

const env = {
    port: process.env.PORT || '3000',
    baseUrl: String(process.env.BASE_URL || '').trim().replace(/\/$/, ''),
    csSheetId: String(process.env.CS_SHEET_ID || '').trim(),
    ncsSheetId: String(process.env.NCS_SHEET_ID || '').trim(),
    csEmailUser: String(process.env.CS_EMAIL_USER || '').trim(),
    csEmailPass: String(process.env.CS_EMAIL_PASS || '').trim(),
    ncsEmailUser: String(process.env.NCS_EMAIL_USER || '').trim(),
    ncsEmailPass: String(process.env.NCS_EMAIL_PASS || '').trim(),
};

module.exports = {
    env,
    validateEnv,
};

const express = require('express');
const { getSheetRows } = require('../services/sheetsService');
const { env } = require('../config/env');
const router = express.Router();

router.get('/test-connection', async (req, res) => {
    try {
        // Read first 5 rows (e.g., A1:Z5)
        // Assuming data starts from row 1. You might want to adjust the range.
        const csRows = await getSheetRows(env.csSheetId, 'A1:E5');
        const ncsRows = await getSheetRows(env.ncsSheetId, 'A1:E5');

        res.json({
            csRows,
            ncsRows,
        });
    } catch (error) {
        res.status(500).json({
            error: 'Failed to connect to Google Sheets',
            details: error.message,
        });
    }
});

router.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

module.exports = router;

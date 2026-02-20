const express = require('express');
const router = express.Router();

// Payment processing is now fully automatic via polling in server.js
// The /check-payments endpoint has been disabled for automatic operation

// Uncomment below if you need manual trigger for testing/debugging:
/*
const { processPayments } = require('../services/paymentProcessor');

router.get('/check-payments', async (req, res) => {
    try {
        const result = await processPayments();
        res.json(result);
    } catch (error) {
        console.error('Error in check-payments endpoint:', error.message);
        res.status(500).json({
            error: 'Failed to check payments',
            details: error.message,
        });
    }
});
*/

module.exports = router;

const { env } = require('../config/env');
const { getPendingPayments, processPaymentTokens } = require('./sheetsService');

/**
 * Automatically process pending payments for both CS and NCS sheets
 * @returns {Promise<Object>} Summary of processed payments
 */
const processPayments = async () => {
    const startTime = Date.now();
    console.log('[Payment Processor] Starting automatic payment check...');

    try {
        // Get pending payments from both sheets
        const [csResult, ncsResult] = await Promise.all([
            getPendingPayments(env.csSheetId),
            getPendingPayments(env.ncsSheetId),
        ]);

        console.log(`[Payment Processor] Found ${csResult.pending.length} pending CS payments`);
        console.log(`[Payment Processor] Found ${ncsResult.pending.length} pending NCS payments`);

        // Process tokens for both sheets
        const [processedCS, processedNCS] = await Promise.all([
            processPaymentTokens(env.csSheetId, csResult.pending, csResult.headers, 'CS'),
            processPaymentTokens(env.ncsSheetId, ncsResult.pending, ncsResult.headers, 'NCS'),
        ]);

        const totalProcessed = processedCS.length + processedNCS.length;
        const duration = Date.now() - startTime;

        console.log(`[Payment Processor] Completed: ${totalProcessed} payments processed in ${duration}ms`);
        console.log(`[Payment Processor] CS: ${processedCS.length}, NCS: ${processedNCS.length}`);

        return {
            processedCS: {
                count: processedCS.length,
                rows: processedCS.map((item) => ({
                    rowIndex: item.rowIndex,
                    senderType: item.senderType,
                    emailSent: item.emailSent,
                })),
            },
            processedNCS: {
                count: processedNCS.length,
                rows: processedNCS.map((item) => ({
                    rowIndex: item.rowIndex,
                    senderType: item.senderType,
                    emailSent: item.emailSent,
                })),
            },
            duration,
        };
    } catch (error) {
        console.error('[Payment Processor] Error:', error.message);
        throw error;
    }
};

module.exports = {
    processPayments,
};

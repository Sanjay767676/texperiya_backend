const sheets = require('../config/googleSheets');
const { randomUUID } = require('crypto');
const QRCode = require('qrcode');
const { env } = require('../config/env');
const { sendConfirmationEmail, sendAttendanceEmail } = require('./emailService');
const {
    normalizeValue,
    getColumnByAlias,
    indexToColumn,
    buildHeaderMap,
    validateRequiredColumns,
    getColumnLetterByAlias,
    getDayType,
} = require('../utils/columnResolver');

const SHEET_NAME = 'Form Responses 1';
const HEADER_CACHE_TTL_MS = 5 * 60 * 1000;
const TOKEN_REGEX = /^(CS|NCS)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const headerCache = new Map();

const getHeaderInfo = async (spreadsheetId) => {
    const cached = headerCache.get(spreadsheetId);
    if (cached && Date.now() - cached.timestamp < HEADER_CACHE_TTL_MS) {
        return cached.data;
    }

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${SHEET_NAME}!1:1`,
    });

    const headers = response.data.values ? response.data.values[0] : [];
    console.log(`[Sheets Service] Detected headers: ${headers.join(', ')}`);
    
    const headerMap = buildHeaderMap(headers);
    const data = { headers, headerMap };
    headerCache.set(spreadsheetId, { data, timestamp: Date.now() });
    return data;
};

const getSheetRows = async (spreadsheetId, range) => {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });
        return response.data.values || [];
    } catch (error) {
        console.error(`[Sheets Service] Error reading sheet ${spreadsheetId}:`, error.message);
        throw error;
    }
};

const getPendingPayments = async (spreadsheetId) => {
    try {
        const rows = await getSheetRows(spreadsheetId, SHEET_NAME);
        if (rows.length === 0) return { headers: [], pending: [] };

        const headers = rows[0];
        const headerMap = buildHeaderMap(headers);

        // Validate required columns using aliases
        validateRequiredColumns(headers, headerMap, ['paymentStatus', 'token', 'timestamp']);

        const paymentStatusIdx = getColumnByAlias(headerMap, 'paymentStatus');
        const tokenIdx = getColumnByAlias(headerMap, 'token');
        const timestampIdx = getColumnByAlias(headerMap, 'timestamp');
        const mailSentIdx = getColumnByAlias(headerMap, 'mailSent');

        const pending = rows.slice(1).map((row, index) => {
            const status = normalizeValue(row[paymentStatusIdx]).toUpperCase();
            const token = normalizeValue(row[tokenIdx]);
            const timestamp = normalizeValue(row[timestampIdx]);
            const mailSent = mailSentIdx === -1 ? '' : normalizeValue(row[mailSentIdx]).toUpperCase();

            return {
                rowIndex: index + 2,
                row,
                status,
                token,
                timestamp,
                mailSent,
            };
        }).filter(item => item.status === 'APPROVED' && item.token === '' && item.timestamp !== '');

        return { headers, pending };
    } catch (error) {
        console.error('[Sheets Service] Error getting pending payments:', error.message);
        return { headers: [], pending: [] };
    }
};

const extractEvents = (row, headers) => {
    const day1Events = [];
    const day2Events = [];

    headers.forEach((header, index) => {
        if (index >= row.length) return;
        
        const cellValue = normalizeValue(row[index]);
        if (!cellValue) return;

        const dayType = getDayType(header);
        if (dayType === 'day1') {
            day1Events.push(cellValue);
        } else if (dayType === 'day2') {
            day2Events.push(cellValue);
        }
    });

    return { day1Events, day2Events };
};

const generateQRCode = async (token) => {
    const scanUrl = `${process.env.BASE_URL}/scan?token=${token}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl);
    return { qrBase64: qrDataUrl, scanUrl };
};

const updateRowColumns = async (spreadsheetId, rowIndex, updates, headers, headerMap) => {
    const data = [];

    Object.entries(updates).forEach(([aliasKey, value]) => {
        const colLetter = getColumnLetterByAlias(headers, headerMap, aliasKey);
        if (colLetter) {
            data.push({
                range: `${SHEET_NAME}!${colLetter}${rowIndex}`,
                values: [[value]],
            });
        } else {
            console.warn(`[Sheets Service] Column "${aliasKey}" not found, skipping update`);
        }
    });

    if (data.length === 0) return null;

    const response = await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
            valueInputOption: 'USER_ENTERED',
            data,
        },
    });

    console.log(`[Sheets Service] Updated ${data.length} columns in row ${rowIndex}`);

    return response.data;
};

const buildToken = (prefix) => `${prefix}-${randomUUID()}`;

const isValidToken = (token) => TOKEN_REGEX.test(normalizeValue(token));

const getRowByIndex = async (spreadsheetId, rowIndex, headers) => {
    const lastColumn = indexToColumn(Math.max(headers.length - 1, 0));
    const range = `${SHEET_NAME}!A${rowIndex}:${lastColumn}${rowIndex}`;
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });
    return response.data.values ? response.data.values[0] : [];
};

const processPaymentTokens = async (spreadsheetId, pendingPayments, headers, senderType) => {
    const processed = [];
    const { headerMap } = await getHeaderInfo(spreadsheetId);

    // Validate required columns using aliases
    validateRequiredColumns(headers, headerMap, ['paymentStatus', 'token', 'timestamp', 'tokenGeneratedTime', 'qrLink']);

    for (const payment of pendingPayments) {
        try {
            console.log(`\n[Payment Processing] Processing row ${payment.rowIndex}...`);
            
            const latestRow = await getRowByIndex(spreadsheetId, payment.rowIndex, headers);
            
            // Get column indices using aliases
            const paymentStatusIdx = getColumnByAlias(headerMap, 'paymentStatus');
            const tokenIdx = getColumnByAlias(headerMap, 'token');
            const timestampIdx = getColumnByAlias(headerMap, 'timestamp');
            const mailSentIdx = getColumnByAlias(headerMap, 'mailSent');

            const status = normalizeValue(latestRow[paymentStatusIdx]).toUpperCase();
            const existingToken = normalizeValue(latestRow[tokenIdx]);
            const timestamp = normalizeValue(latestRow[timestampIdx]);
            const mailSent = mailSentIdx === -1 ? '' : normalizeValue(latestRow[mailSentIdx]).toUpperCase();

            // Double-check eligibility
            if (status !== 'APPROVED' || existingToken !== '' || timestamp === '') {
                console.log(`[Payment Processing] ⏭️ Row ${payment.rowIndex} no longer eligible - skipping`);
                continue;
            }

            // Generate token and QR
            const token = buildToken(senderType);
            const { qrBase64, scanUrl } = await generateQRCode(token);
            const { day1Events, day2Events } = extractEvents(latestRow, headers);

            console.log(`[Payment Processing] ✅ Token generated: ${token}`);
            console.log(`[Payment Processing] 📊 Events - Day1: ${day1Events.length}, Day2: ${day2Events.length}`);

            // Get student information using aliases
            const nameIdx = getColumnByAlias(headerMap, 'name');
            const emailIdx = getColumnByAlias(headerMap, 'email');
            
            const studentName = nameIdx !== -1 ? normalizeValue(latestRow[nameIdx]) || 'Student' : 'Student';
            const studentEmail = emailIdx !== -1 ? normalizeValue(latestRow[emailIdx]) : '';

            // PHASE 3+4: Update sheet FIRST (token, QR, timestamp) before sending email
            const updates = {
                token: token,
                qrLink: scanUrl,
                tokenGeneratedTime: new Date().toISOString(),
                mailSent: 'PENDING',
            };

            await updateRowColumns(spreadsheetId, payment.rowIndex, updates, headers, headerMap);
            console.log(`[Payment Processing] ✅ Sheet updated for row ${payment.rowIndex}`);

            // PHASE 3: Send email NON-BLOCKING — do not await
            if (studentEmail && (mailSent === '' || mailSent === 'NO')) {
                console.log(`[Payment Processing] 📤 Queueing email to ${studentEmail} (non-blocking)...`);
                sendConfirmationEmail({
                    senderType,
                    to: studentEmail,
                    name: studentName,
                    day1Events,
                    day2Events,
                    scanUrl,
                }).then(async (emailResult) => {
                    const mailStatus = emailResult ? 'YES' : 'NO';
                    console.log(`[Payment Processing] ${emailResult ? '✅' : '❌'} Email ${mailStatus} for row ${payment.rowIndex}`);
                    try {
                        await updateRowColumns(spreadsheetId, payment.rowIndex, { mailSent: mailStatus }, headers, headerMap);
                    } catch (updateErr) {
                        console.error(`[Payment Processing] Failed to update Mail_Sent for row ${payment.rowIndex}:`, updateErr.message);
                    }
                }).catch((err) => {
                    console.error(`[Payment Processing] ❌ Email error for row ${payment.rowIndex}:`, err.message);
                    updateRowColumns(spreadsheetId, payment.rowIndex, { mailSent: 'NO' }, headers, headerMap).catch(() => {});
                });
            } else {
                if (!studentEmail) {
                    console.warn(`[Payment Processing] ⚠️ No email for row ${payment.rowIndex}`);
                    await updateRowColumns(spreadsheetId, payment.rowIndex, { mailSent: 'NO_EMAIL' }, headers, headerMap);
                }
                if (mailSent === 'YES') {
                    console.log(`[Payment Processing] ⏭️ Email already sent for row ${payment.rowIndex}`);
                }
            }

            processed.push({
                rowIndex: payment.rowIndex,
                senderType,
                emailSent: 'QUEUED',
            });

            console.log(`[Payment Processing] ✅ Row ${payment.rowIndex} done (email queued)`);
        } catch (error) {
            console.error(`[Payment Processing] ❌ Failed to process payment at row ${payment.rowIndex}:`, error.message);
        }
    }

    return processed;
};

const findRowByToken = async (spreadsheetId, token) => {
    const { headers, headerMap } = await getHeaderInfo(spreadsheetId);
    
    // Validate required columns using aliases
    validateRequiredColumns(headers, headerMap, ['token']);

    const tokenCol = getColumnLetterByAlias(headers, headerMap, 'token');
    const range = `${SHEET_NAME}!${tokenCol}2:${tokenCol}`;

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
    });

    const values = response.data.values || [];
    const normalizedToken = normalizeValue(token);

    for (let i = 0; i < values.length; i += 1) {
        const cellValue = normalizeValue(values[i][0]);
        if (cellValue && cellValue === normalizedToken) {
            return { rowIndex: i + 2, headers, headerMap };
        }
    }

    return null;
};

const markAttendancePresent = async (spreadsheetId, rowIndex, headers, headerMap) => {
    // Validate required columns using aliases
    validateRequiredColumns(headers, headerMap, ['attendance']);
    const updates = { attendance: 'PRESENT' };
    await updateRowColumns(spreadsheetId, rowIndex, updates, headers, headerMap);
};

const handleScan = async (token) => {
    const normalizedToken = normalizeValue(token);

    if (!isValidToken(normalizedToken)) {
        const error = new Error('Invalid token format');
        error.statusCode = 400;
        throw error;
    }

    const senderType = normalizedToken.toUpperCase().startsWith('NCS-') ? 'NCS' : 'CS';
    const spreadsheetId = senderType === 'NCS' ? env.ncsSheetId : env.csSheetId;

    const rowInfo = await findRowByToken(spreadsheetId, normalizedToken);
    if (!rowInfo) {
        const error = new Error('Token not found');
        error.statusCode = 400;
        throw error;
    }

    const { rowIndex, headers, headerMap } = rowInfo;

    // Get the full row for this entry
    const row = await getRowByIndex(spreadsheetId, rowIndex, headers);

    // Get column indices using aliases
    const attendanceIdx = getColumnByAlias(headerMap, 'attendance');
    const nameIdx = getColumnByAlias(headerMap, 'name');
    const emailIdx = getColumnByAlias(headerMap, 'email');

    const attendanceValue = attendanceIdx === -1 ? '' : normalizeValue(row[attendanceIdx]).toUpperCase();
    if (attendanceValue === 'PRESENT') {
        const error = new Error('Attendance already marked');
        error.statusCode = 409;
        throw error;
    }

    await markAttendancePresent(spreadsheetId, rowIndex, headers, headerMap);

    const studentEmail = emailIdx === -1 ? '' : normalizeValue(row[emailIdx]);
    const studentName = nameIdx === -1 ? 'Student' : normalizeValue(row[nameIdx]) || 'Student';
    
    if (studentEmail) {
        // Non-blocking: fire and forget attendance email
        const { day1Events, day2Events } = extractEvents(row, headers);
        generateQRCode(normalizedToken).then(({ scanUrl }) => {
            return sendAttendanceEmail({
                senderType,
                to: studentEmail,
                name: studentName,
                day1Events,
                day2Events,
                scanUrl,
            });
        }).then(() => {
            console.log(`[Scan Handler] ✅ Attendance email sent to ${studentEmail}`);
        }).catch((error) => {
            console.error(`[Scan Handler] ❌ Attendance email failed for ${studentEmail}:`, error.message);
        });
    }

    return { rowIndex, senderType };
};

module.exports = {
    getSheetRows,
    getPendingPayments,
    processPaymentTokens,
    extractEvents,
    generateQRCode,
    updateRowColumns,
    buildToken,
    isValidToken,
    handleScan,
};

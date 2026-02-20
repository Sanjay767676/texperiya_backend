const nodemailer = require('nodemailer');
const dns = require('dns');

// Force IPv4 globally — Render free tier has no IPv6 support
dns.setDefaultResultOrder('ipv4first');

const smtpConfig = {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
        rejectUnauthorized: false,
    },
};

const csTransporter = nodemailer.createTransport({
    ...smtpConfig,
    auth: {
        user: process.env.CS_EMAIL_USER,
        pass: process.env.CS_EMAIL_PASS,
    },
});

const ncsTransporter = nodemailer.createTransport({
    ...smtpConfig,
    auth: {
        user: process.env.NCS_EMAIL_USER,
        pass: process.env.NCS_EMAIL_PASS,
    },
});

csTransporter.verify()
    .then(() => console.log('CS SMTP Ready (port 587)'))
    .catch((err) => console.error('CS SMTP verify failed:', err.message));

ncsTransporter.verify()
    .then(() => console.log('NCS SMTP Ready (port 587)'))
    .catch((err) => console.error('NCS SMTP verify failed:', err.message));

const getTransporter = (senderType) => {
    const type = String(senderType || '').toUpperCase();
    if (type === 'NCS') {
        return ncsTransporter;
    }
    if (type === 'CS') {
        return csTransporter;
    }
    throw new Error(`Unknown sender type: ${senderType}`);
};

const renderEventList = (events) => {
    if (!events || events.length === 0) {
        return '<p><em>No events selected</em></p>';
    }
    return `<ul>${events.map((event) => `<li>${event}</li>`).join('')}</ul>`;
};

const renderEmailTemplate = ({
    title,
    greeting,
    message,
    day1Events,
    day2Events,
        scanUrl,
}) => {
    const day1Html = renderEventList(day1Events);
    const day2Html = renderEventList(day2Events);

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    background-color: #f4f4f4;
                    margin: 0;
                    padding: 0;
                }
                .container {
                    max-width: 600px;
                    margin: 20px auto;
                    background-color: #ffffff;
                    padding: 30px;
                    border-radius: 8px;
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }
                .header {
                    text-align: center;
                    border-bottom: 3px solid #4CAF50;
                    padding-bottom: 20px;
                    margin-bottom: 20px;
                }
                .header h1 {
                    color: #4CAF50;
                    margin: 0;
                    font-size: 28px;
                }
                .greeting {
                    font-size: 16px;
                    margin: 20px 0;
                    color: #333;
                }
                .section {
                    margin-bottom: 25px;
                }
                .section h3 {
                    color: #4CAF50;
                    border-left: 4px solid #4CAF50;
                    padding-left: 10px;
                    margin-top: 0;
                }
                .section ul {
                    list-style-type: none;
                    padding-left: 0;
                    margin: 10px 0;
                }
                .section li {
                    padding: 8px 0;
                    padding-left: 20px;
                    position: relative;
                    color: #555;
                }
                .section li:before {
                    content: "✓";
                    position: absolute;
                    left: 0;
                    color: #4CAF50;
                    font-weight: bold;
                }
                .qr-section {
                    text-align: center;
                    background-color: #f9f9f9;
                    padding: 20px;
                    border-radius: 6px;
                    margin: 20px 0;
                }
                .qr-section p {
                    color: #666;
                    margin: 10px 0;
                    font-size: 14px;
                }
                .qr-section img {
                    border: 2px solid #4CAF50;
                    border-radius: 4px;
                    margin: 10px 0;
                }
                .footer {
                    text-align: center;
                    padding-top: 20px;
                    border-top: 1px solid #eee;
                    color: #999;
                    font-size: 12px;
                    margin-top: 30px;
                }
                .footer p {
                    margin: 5px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Texperia 2026</h1>
                    <p>${title}</p>
                </div>

                <div class="greeting">
                    <p>${greeting}</p>
                    <p>${message}</p>
                </div>

                <div class="qr-section">
                    <p><strong>Your Entry QR Code</strong></p>
                        <img src="${scanUrl}" width="200" alt="QR Code" />
                    <p>Show this QR code during event entry</p>
                </div>

                <div class="section">
                    <h3>Day 1 Events</h3>
                    ${day1Html}
                </div>

                <div class="section">
                    <h3>Day 2 Events</h3>
                    ${day2Html}
                </div>

                <div class="footer">
                    <p>© 2026 Texperia. All rights reserved.</p>
                    <p>If you have any questions, please contact us at support@texperia.com</p>
                </div>
            </div>
        </body>
        </html>
    `;
};

const sendConfirmationEmail = async ({
    senderType,
    to,
    name,
    day1Events,
    day2Events,
    scanUrl,
}) => {
    const transporter = getTransporter(senderType);
    const htmlBody = renderEmailTemplate({
        title: 'Registration Confirmed',
        greeting: `Hello <strong>${name}</strong>,`,
        message: 'Thank you for registering for Texperia 2026! Your registration is confirmed. Below is your QR code for entry and your selected events.',
        day1Events,
        day2Events,
        scanUrl,
    });

    const mailOptions = {
        from: senderType === 'NCS' ? process.env.NCS_EMAIL_USER : process.env.CS_EMAIL_USER,
        to,
        subject: 'Texperia 2026 Registration Confirmed',
        html: htmlBody,
    };

    try {
        console.log('Preparing to send email to:', to);
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.response);
        return true;
    } catch (error) {
        console.error('EMAIL ERROR FULL OBJECT:', error);
        if (error.response) {
            console.error('SMTP RESPONSE:', error.response);
        }
        return false;
    }
};

const sendAttendanceEmail = async ({
    senderType,
    to,
    name,
    day1Events,
    day2Events,
    scanUrl,
}) => {
    const transporter = getTransporter(senderType);
    const htmlBody = renderEmailTemplate({
        title: 'Attendance Confirmed',
        greeting: `Hello <strong>${name}</strong>,`,
        message: 'Your attendance has been recorded successfully. Please keep your QR code for reference.',
        day1Events,
        day2Events,
        scanUrl,
    });

    const mailOptions = {
        from: senderType === 'NCS' ? process.env.NCS_EMAIL_USER : process.env.CS_EMAIL_USER,
        to,
        subject: 'Texperia 2026 Attendance Confirmed',
        html: htmlBody,
    };

    try {
        console.log('Preparing to send email to:', to);
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', info.response);
        return true;
    } catch (error) {
        console.error('EMAIL ERROR FULL OBJECT:', error);
        if (error.response) {
            console.error('SMTP RESPONSE:', error.response);
        }
        return false;
    }
};

module.exports = {
    sendConfirmationEmail,
    sendAttendanceEmail,
};

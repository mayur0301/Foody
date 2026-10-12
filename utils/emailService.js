const nodemailer = require('nodemailer');
const path = require('path');

// Define transporter - User can update credentials in .env
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const logoUrl = `${process.env.APP_URL}/image.png`;

// Branded Footer (using direct public URL)
const footer = `
  <hr style="border: 0; border-top: 1px solid #ddd; margin: 30px 0 10px 0;" />
  <div style="text-align: center; color: #777; font-size: 12px;">
    <p>Developed by <strong>TechSurya IT Solutions</strong></p>
    <img src="${logoUrl}" alt="TechSurya IT Solutions" style="height: 70px; margin-top: 10px;" />
  </div>
`;

/**
 * Send Subscription Expiry Warning
 */
exports.sendExpiryWarningEmail = async (to, hotelName, expiryDate) => {
  try {
    const info = await transporter.sendMail({
      from: `"Hotel Management" <${process.env.EMAIL_USER}>`,
      to,
      subject: `Action Required: Your plan for ${hotelName} expires soon!`,
      html: `
        <h2>Subscription Expiring Soon</h2>
        <p>Dear Admin,</p>
        <p>This is a reminder that your subscription for <strong>${hotelName}</strong> will expire on <strong>${expiryDate.toDateString()}</strong>.</p>
        <p>Please renew your plan to avoid any interruption in service.</p>
        ${footer}
      `,
    });
    console.log(`[EMAIL] Warning sent to ${to}: ${info.messageId}`);
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send warning to ${to}:`, err);
  }
};

/**
 * Send Subscription Expired Notification
 */
exports.sendExpiredNotificationEmail = async (to, hotelName) => {
  try {
    const info = await transporter.sendMail({
      from: `"Hotel Management" <${process.env.EMAIL_USER}>`,
      to,
      subject: `Subscription Expired: ${hotelName}`,
      html: `
        <h2>Plan Expired</h2>
        <p>Dear Admin,</p>
        <p>Your subscription for <strong>${hotelName}</strong> has expired. Your access to premium features has been restricted.</p>
        <p>Please subscribe to a new plan to restore full access.</p>
        ${footer}
      `,
    });
    console.log(`[EMAIL] Expiry notice sent to ${to}: ${info.messageId}`);
  } catch (err) {
    console.error(`[EMAIL ERROR] Failed to send expiry notice to ${to}:`, err);
  }
};




import { Resend } from 'resend';
import { env } from '../config/env.js';

const resend = new Resend(env.resendApiKey);

async function send({ to, subject, html }) {
  try {
    await resend.emails.send({ from: env.resendFromEmail, to, subject, html });
  } catch (err) {
    // Do not crash the request flow if email fails — log and let the caller decide.
    console.error('[mailer] Failed to send email:', err.message);
  }
}

export async function sendOnboardingInvite({ to, firstName, invitationLink }) {
  await send({
    to,
    subject: 'Welcome to ESTRADA International — Complete Your Onboarding',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: auto;">
        <h2 style="color:#1B2A4A;">Welcome to ESTRADA International, ${firstName}!</h2>
        <p>Your employee account has been created on ESTRADA HRIS. Click below to set your password and begin onboarding.</p>
        <p style="margin: 24px 0;">
          <a href="${invitationLink}" style="background: linear-gradient(90deg,#F7941D,#EE3124); color:#fff; padding:12px 24px; border-radius:8px; text-decoration:none;">Start Onboarding</a>
        </p>
        <p>This link expires in 72 hours.</p>
      </div>
    `,
  });
}

export async function sendDocumentExpiryReminder({ to, firstName, documentName, expiryDate }) {
  await send({
    to,
    subject: `Reminder: ${documentName} is expiring soon`,
    html: `<p>Hi ${firstName}, your document "${documentName}" expires on ${new Date(expiryDate).toDateString()}. Please upload a renewed copy on ESTRADA HRIS.</p>`,
  });
}

export async function sendLeaveStatusEmail({ to, firstName, status, leaveType }) {
  await send({
    to,
    subject: `Leave request ${status.toLowerCase()}`,
    html: `<p>Hi ${firstName}, your ${leaveType} leave request status is now: <strong>${status}</strong>.</p>`,
  });
}

export async function sendPayslipReadyEmail({ to, firstName, month, year }) {
  await send({
    to,
    subject: `Your payslip for ${month}/${year} is ready`,
    html: `<p>Hi ${firstName}, your payslip for ${month}/${year} has been generated and is available on ESTRADA HRIS.</p>`,
  });
}

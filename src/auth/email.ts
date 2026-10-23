import { createTransport, type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

let transporter: Transporter | undefined;

function assertEmailDeliveryConfigured(): void {
  if (!env.SMTP_HOST || !env.SMTP_PORT || !env.SMTP_USER || !env.SMTP_PASSWORD || !env.SMTP_FROM) {
    throw Object.assign(new Error('Email delivery is not configured'), { statusCode: 503 });
  }
}

function getTransporter(): Transporter {
  assertEmailDeliveryConfigured();
  transporter ??= createTransport({
    host: env.SMTP_HOST!,
    port: env.SMTP_PORT!,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASSWORD! },
  });
  return transporter;
}

export async function sendAuthTokenEmail(
  recipient: string,
  purpose: 'email_verification' | 'password_reset',
  token: string,
): Promise<void> {
  const subject = purpose === 'email_verification' ? 'Verify your Flava email' : 'Reset your Flava password';
  const action = purpose === 'email_verification' ? 'verify your email address' : 'reset your password';
  await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to: recipient,
    subject,
    text: `Use this one-time token to ${action}: ${token}\n\nThis token expires in ${env.AUTH_EMAIL_TOKEN_TTL_MINUTES} minutes. If you did not request this, you can ignore this email.`,
  });
}

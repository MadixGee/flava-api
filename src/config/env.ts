import 'dotenv/config';
import { z } from 'zod';

const optionalSmtpString = z.preprocess((value) => value === '' ? undefined : value, z.string().optional());
const optionalSmtpPort = z.preprocess(
  (value) => value === '' ? undefined : value,
  z.coerce.number().int().min(1).max(65535).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().default('http://localhost:8081'),
  AUTH_JWT_SECRET: z.string().min(32),
  AUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  AUTH_REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  AUTH_EMAIL_TOKEN_TTL_MINUTES: z.coerce.number().int().min(10).max(120).default(60),
  SMTP_HOST: optionalSmtpString,
  SMTP_PORT: optionalSmtpPort,
  SMTP_USER: optionalSmtpString,
  SMTP_PASSWORD: optionalSmtpString,
  SMTP_FROM: z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional()),
});

const parsed = envSchema.superRefine((values, context) => {
  const smtpFields = [values.SMTP_HOST, values.SMTP_PORT, values.SMTP_USER, values.SMTP_PASSWORD, values.SMTP_FROM];
  const configuredSmtpFields = smtpFields.filter((value) => value !== undefined).length;
  if (configuredSmtpFields !== 0 && configuredSmtpFields !== smtpFields.length) {
    context.addIssue({
      code: 'custom',
      message: 'SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD and SMTP_FROM must be configured together',
    });
  }
  if (values.NODE_ENV === 'production' && configuredSmtpFields !== smtpFields.length) {
    context.addIssue({
      code: 'custom',
      message: 'SMTP settings are required in production',
    });
  }
}).safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;

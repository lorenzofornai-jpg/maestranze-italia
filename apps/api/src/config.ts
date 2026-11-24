import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATA_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "DATA_ENCRYPTION_KEY deve essere di 32 byte in base64"),
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("Maestranze Italia <concierge@maestranze.it>"),
  SMS_PROVIDER: z.enum(["console", "memory"]).default("console"),
  MEDIA_DIR: z.string().default("./uploads"),
  PUSH_PROVIDER: z.enum(["console", "memory", "expo"]).default("console"),
});

export type Config = z.infer<typeof envSchema> & {
  /** Tempi e soglie della sicurezza, in un unico punto. */
  security: typeof security;
};

export const security = {
  activationTtlMs: 24 * 60 * 60 * 1000,
  passwordResetTtlMs: 30 * 60 * 1000,
  challengeTtlMs: 5 * 60 * 1000,
  otpTtlMs: 5 * 60 * 1000,
  otpResendGapMs: 30 * 1000,
  otpMaxSends: 3,
  challengeMaxAttempts: 5,
  passwordMaxFailures: 5,
  lockoutMs: 15 * 60 * 1000,
  /** Inattività massima, come nell'home banking. */
  sessionIdleMs: 15 * 60 * 1000,
  sessionAbsoluteMs: 8 * 60 * 60 * 1000,
  pairingTtlMs: 5 * 60 * 1000,
  deviceNonceTtlMs: 60 * 1000,
  deviceClockSkewMs: 60 * 1000,
  /** Per associare l'app da una sessione mobile serve un accesso recente. */
  freshAuthMs: 10 * 60 * 1000,
} as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return { ...envSchema.parse(env), security };
}

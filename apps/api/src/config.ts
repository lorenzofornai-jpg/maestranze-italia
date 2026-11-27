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
  SMS_PROVIDER: z.enum(["console", "memory", "twilio"]).default("console"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  /** Numero mittente in formato E.164, oppure il Messaging Service (mittente alfanumerico). */
  TWILIO_FROM: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  /** Facoltativo: token di accesso Expo se la «push security» è attiva sul progetto. */
  EXPO_ACCESS_TOKEN: z.string().optional(),
  /** Ricerca in linguaggio naturale con l'LLM: auto = attiva se c'è ANTHROPIC_API_KEY. */
  AI_SEARCH: z.enum(["auto", "on", "off"]).default("auto"),
  /** Traduzione automatica dell'Atelier con l'LLM: auto = attiva se c'è ANTHROPIC_API_KEY. */
  AI_TRANSLATION: z.enum(["auto", "on", "off"]).default("auto"),
  MEDIA_DIR: z.string().default("./uploads"),
  /** Videochiamate: server STUN pubblico per la connessione diretta; TURN facoltativo per le reti più chiuse. */
  STUN_URLS: z.string().default("stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"),
  TURN_URLS: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
  PUSH_PROVIDER: z.enum(["console", "memory", "expo"]).default("console"),
});

const checkedEnv = envSchema.superRefine((env, ctx) => {
  if (env.SMS_PROVIDER === "twilio" && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !(env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID))) {
    ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "Twilio richiede TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_FROM o TWILIO_MESSAGING_SERVICE_SID" });
  }
  // In produzione i codici di accesso non devono mai finire nei log.
  if (env.NODE_ENV === "production" && env.SMS_PROVIDER !== "twilio") {
    ctx.addIssue({ code: "custom", path: ["SMS_PROVIDER"], message: "In produzione serve un fornitore SMS reale" });
  }
  if (env.NODE_ENV === "production" && env.PUSH_PROVIDER !== "expo") {
    ctx.addIssue({ code: "custom", path: ["PUSH_PROVIDER"], message: "In produzione le notifiche push passano da Expo" });
  }
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
  return { ...checkedEnv.parse(env), security };
}

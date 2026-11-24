import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import {
  deviceMessages,
  loginSchema,
  otpSchema,
  pairingUri,
  passwordSchema,
  registrationSchema,
  type LoginChallengeResponse,
  type MfaMethod,
  type PendingApproval,
  type SessionUser,
} from "@maestranze/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import {
  accounts,
  auditEvents,
  authChallenges,
  deviceNonces,
  devicePairings,
  devices,
  emailTokens,
  mfaFactors,
  sessions,
  type Account,
  type AuthChallenge,
} from "../db/schema";
import {
  burnPasswordCheck,
  decrypt,
  encrypt,
  generateTotpSecret,
  hashPassword,
  isValidPublicKey,
  randomOtp,
  randomToken,
  safeEqual,
  sha256,
  totpUri,
  verifyDeviceSignature,
  verifyPassword,
  verifyTotp,
} from "../lib/crypto";
import { ApiError, Errors } from "../lib/errors";
import { renderEmail, texts, type Notifier } from "../lib/notifications";

export type Channel = "WEB" | "MOBILE";

export interface RequestContext {
  ip?: string;
  userAgent?: string;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
  user: SessionUser;
}

export interface AuthDeps {
  db: Db;
  config: Config;
  notifier: Notifier;
  now?: () => Date;
}

/** Converte gli errori di zod in { campo: chiave_di_traduzione }. */
function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw Errors.validation(fields);
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)} ••• ••• ${phone.slice(-4)}`;
}

export class AuthService {
  private db: Db;
  private config: Config;
  private notifier: Notifier;
  private now: () => Date;

  constructor(deps: AuthDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.notifier = deps.notifier;
    this.now = deps.now ?? (() => new Date());
  }

  private get sec() {
    return this.config.security;
  }

  private after(ms: number) {
    return new Date(this.now().getTime() + ms);
  }

  private async audit(accountId: string | null, type: string, ctx: RequestContext = {}, meta?: Record<string, unknown>) {
    await this.db.insert(auditEvents).values({ accountId, type, ip: ctx.ip, userAgent: ctx.userAgent, meta });
  }

  // =============================================================================================
  // Registrazione e attivazione via email
  // =============================================================================================

  async register(input: unknown, ctx: RequestContext = {}): Promise<void> {
    const data = parseOrThrow(registrationSchema, input);
    const existing = await this.db.query.accounts.findFirst({ where: eq(accounts.email, data.email) });

    if (existing) {
      // Stessa risposta di una registrazione nuova: non si rivela se l'email è già presente.
      const t = texts(existing.locale);
      const url = `${this.config.WEB_ORIGIN}/${existing.locale}/accedi`;
      await this.notifier.email({
        to: existing.email,
        subject: t.existsSubject,
        ...renderEmail({ locale: existing.locale, title: t.existsSubject, body: t.existsBody, cta: { label: t.existsCta, url } }),
      });
      await this.audit(existing.id, "register.duplicate", ctx);
      return;
    }

    const [account] = await this.db
      .insert(accounts)
      .values({
        role: data.role,
        subjectType: data.subjectType,
        email: data.email,
        passwordHash: await hashPassword(data.password),
        phone: data.phone,
        firstName: data.firstName,
        lastName: data.lastName,
        companyName: data.subjectType === "COMPANY" ? data.companyName : null,
        vatNumber: data.subjectType === "COMPANY" ? data.vatNumber : null,
        fiscalCode: data.subjectType === "PERSON" ? data.fiscalCode : null,
        sector: data.sector,
        province: data.province,
        city: data.city,
        locale: data.locale,
        consents: { ...data.consents, at: this.now().toISOString() },
      })
      .onConflictDoNothing({ target: accounts.email })
      .returning();
    if (!account) return; // registrazione concorrente con la stessa email

    await this.audit(account.id, "register", ctx, { role: account.role, subjectType: account.subjectType });
    await this.sendActivationEmail(account);
  }

  private async sendActivationEmail(account: Account) {
    const token = randomToken();
    await this.db.insert(emailTokens).values({
      accountId: account.id,
      purpose: "ACTIVATION",
      tokenHash: sha256(token),
      expiresAt: this.after(this.sec.activationTtlMs),
    });
    const t = texts(account.locale);
    const url = `${this.config.WEB_ORIGIN}/${account.locale}/attiva?token=${token}`;
    await this.notifier.email({
      to: account.email,
      subject: t.activationSubject,
      actionUrl: url,
      ...renderEmail({ locale: account.locale, title: t.activationTitle, body: t.activationBody, cta: { label: t.activationCta, url } }),
    });
  }

  async resendActivation(email: unknown): Promise<void> {
    const parsed = z.string().trim().toLowerCase().email().safeParse(email);
    if (!parsed.success) return;
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.email, parsed.data) });
    if (account?.status === "PENDING_EMAIL") await this.sendActivationEmail(account);
  }

  private async consumeEmailToken(token: unknown, purpose: "ACTIVATION" | "PASSWORD_RESET") {
    if (typeof token !== "string" || token.length < 20 || token.length > 100) throw Errors.invalidToken();
    const [row] = await this.db
      .update(emailTokens)
      .set({ usedAt: this.now() })
      .where(
        and(
          eq(emailTokens.tokenHash, sha256(token)),
          eq(emailTokens.purpose, purpose),
          isNull(emailTokens.usedAt),
          gt(emailTokens.expiresAt, this.now()),
        ),
      )
      .returning();
    if (!row) throw Errors.invalidToken();
    return row;
  }

  /** Clic sul link dell'email: l'indirizzo è confermato, ora serve la doppia autenticazione. */
  async activate(token: unknown, ctx: RequestContext = {}): Promise<{ status: Account["status"] }> {
    const row = await this.consumeEmailToken(token, "ACTIVATION");
    const [account] = await this.db
      .update(accounts)
      .set({ emailVerifiedAt: this.now(), status: "PENDING_MFA", updatedAt: this.now() })
      .where(and(eq(accounts.id, row.accountId), eq(accounts.status, "PENDING_EMAIL")))
      .returning();
    await this.audit(row.accountId, "email.verified", ctx);
    return { status: account?.status ?? "PENDING_MFA" };
  }

  // =============================================================================================
  // Accesso: password, poi secondo fattore
  // =============================================================================================

  private async activeFactors(accountId: string): Promise<MfaMethod[]> {
    const rows = await this.db
      .select({ method: mfaFactors.method, revokedAt: devices.revokedAt })
      .from(mfaFactors)
      .leftJoin(devices, eq(mfaFactors.deviceId, devices.id))
      .where(and(eq(mfaFactors.accountId, accountId), sql`${mfaFactors.confirmedAt} is not null`));
    const methods = new Set<MfaMethod>();
    for (const r of rows) if (!(r.method === "MOBILE_APP" && r.revokedAt)) methods.add(r.method);
    return (["MOBILE_APP", "TOTP", "SMS"] as const).filter((m) => methods.has(m));
  }

  async login(input: unknown, channel: Channel, ctx: RequestContext = {}): Promise<LoginChallengeResponse> {
    const { email, password } = parseOrThrow(loginSchema, input);
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.email, email) });

    if (!account) {
      await burnPasswordCheck(password);
      throw Errors.invalidCredentials();
    }

    const ok = await verifyPassword(account.passwordHash, password);
    const now = this.now();

    if (account.lockedUntil && account.lockedUntil > now) {
      if (ok) throw Errors.accountLocked(account.lockedUntil);
      throw Errors.invalidCredentials();
    }

    if (!ok) {
      const failures = account.failedLoginCount + 1;
      const lock = failures >= this.sec.passwordMaxFailures;
      await this.db
        .update(accounts)
        .set({ failedLoginCount: lock ? 0 : failures, lockedUntil: lock ? this.after(this.sec.lockoutMs) : account.lockedUntil })
        .where(eq(accounts.id, account.id));
      await this.audit(account.id, lock ? "login.locked" : "login.password_failed", ctx);
      throw Errors.invalidCredentials();
    }

    if (account.failedLoginCount > 0) {
      await this.db.update(accounts).set({ failedLoginCount: 0 }).where(eq(accounts.id, account.id));
    }
    if (account.status === "PENDING_EMAIL") throw Errors.emailNotVerified();
    if (account.status === "SUSPENDED" || account.status === "LOCKED") throw Errors.accountSuspended();

    const enrollment = account.status === "PENDING_MFA";
    const methods: MfaMethod[] = enrollment ? ["SMS"] : await this.activeFactors(account.id);
    if (methods.length === 0) methods.push("SMS");

    const loginToken = randomToken();
    const expiresAt = this.after(this.sec.challengeTtlMs);
    await this.db.insert(authChallenges).values({
      accountId: account.id,
      tokenHash: sha256(loginToken),
      channel,
      enrollment,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      expiresAt,
    });
    await this.audit(account.id, "login.password_ok", ctx, { channel });

    return {
      status: enrollment ? "MFA_ENROLLMENT_REQUIRED" : "MFA_REQUIRED",
      loginToken,
      methods,
      maskedPhone: maskPhone(account.phone),
      expiresAt: expiresAt.toISOString(),
    };
  }

  private async loadChallenge(loginToken: unknown): Promise<{ challenge: AuthChallenge; account: Account }> {
    if (typeof loginToken !== "string" || loginToken.length > 100) throw Errors.challengeExpired();
    const challenge = await this.db.query.authChallenges.findFirst({ where: eq(authChallenges.tokenHash, sha256(loginToken)) });
    if (
      !challenge ||
      challenge.stage !== "PASSWORD_OK" ||
      challenge.expiresAt <= this.now() ||
      challenge.failedAttempts >= this.sec.challengeMaxAttempts
    ) {
      throw Errors.challengeExpired();
    }
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.id, challenge.accountId) });
    if (!account || account.status === "SUSPENDED" || account.status === "LOCKED") throw Errors.challengeExpired();
    return { challenge, account };
  }

  /** Invia (o reinvia) il codice OTP via SMS al cellulare dell'account. */
  async sendSmsOtp(loginToken: unknown): Promise<{ maskedPhone: string; expiresAt: string }> {
    const { challenge, account } = await this.loadChallenge(loginToken);
    const methods = challenge.enrollment ? ["SMS"] : await this.activeFactors(account.id);
    if (!methods.includes("SMS")) throw Errors.methodNotAvailable();

    const now = this.now();
    if (challenge.otpLastSentAt) {
      const wait = challenge.otpLastSentAt.getTime() + this.sec.otpResendGapMs - now.getTime();
      if (wait > 0) throw Errors.otpRateLimited(Math.ceil(wait / 1000));
    }
    if (challenge.otpSentCount >= this.sec.otpMaxSends) throw Errors.otpRateLimited(0);

    const code = randomOtp();
    const otpExpiresAt = this.after(this.sec.otpTtlMs);
    // Il codice è legato alla transazione: l'hash include l'id della sfida.
    await this.db
      .update(authChallenges)
      .set({
        otpHash: sha256(`${challenge.id}:${code}`),
        otpExpiresAt,
        otpSentCount: challenge.otpSentCount + 1,
        otpLastSentAt: now,
      })
      .where(eq(authChallenges.id, challenge.id));

    const t = texts(account.locale);
    await this.notifier.sms({ to: account.phone, text: challenge.enrollment ? t.smsEnroll(code) : t.smsOtp(code), code });
    return { maskedPhone: maskPhone(account.phone), expiresAt: otpExpiresAt.toISOString() };
  }

  private async failAttempt(challenge: AuthChallenge): Promise<never> {
    const attempts = challenge.failedAttempts + 1;
    await this.db
      .update(authChallenges)
      .set({ failedAttempts: attempts, stage: attempts >= this.sec.challengeMaxAttempts ? "DENIED" : "PASSWORD_OK" })
      .where(eq(authChallenges.id, challenge.id));
    await this.audit(challenge.accountId, "login.mfa_failed", {}, { attempts });
    throw Errors.invalidCode(Math.max(0, this.sec.challengeMaxAttempts - attempts));
  }

  /** Verifica il codice SMS o TOTP e, se corretto, apre la sessione. */
  async verifyMfa(
    input: { loginToken?: unknown; method?: unknown; code?: unknown },
    ctx: RequestContext = {},
  ): Promise<IssuedSession> {
    const { challenge, account } = await this.loadChallenge(input.loginToken);
    const method = z.enum(["SMS", "TOTP"]).safeParse(input.method);
    if (!method.success) throw Errors.methodNotAvailable();
    const code = otpSchema.safeParse(input.code);
    if (!code.success) return this.failAttempt(challenge);

    const methods = challenge.enrollment ? ["SMS"] : await this.activeFactors(account.id);
    if (!methods.includes(method.data)) throw Errors.methodNotAvailable();

    if (method.data === "SMS") {
      const valid =
        challenge.otpHash &&
        challenge.otpExpiresAt &&
        challenge.otpExpiresAt > this.now() &&
        safeEqual(challenge.otpHash, sha256(`${challenge.id}:${code.data}`));
      if (!valid) return this.failAttempt(challenge);
    } else {
      const factor = await this.db.query.mfaFactors.findFirst({
        where: and(eq(mfaFactors.accountId, account.id), eq(mfaFactors.method, "TOTP"), sql`${mfaFactors.confirmedAt} is not null`),
      });
      if (!factor?.totpSecretEnc) throw Errors.methodNotAvailable();
      const step = verifyTotp(decrypt(factor.totpSecretEnc, this.config.DATA_ENCRYPTION_KEY), code.data, this.now().getTime(), factor.totpLastStep);
      if (step === null) return this.failAttempt(challenge);
      await this.db.update(mfaFactors).set({ totpLastStep: step, lastUsedAt: this.now() }).where(eq(mfaFactors.id, factor.id));
    }

    // Consuma la sfida in modo atomico: un codice vale una volta sola.
    const [done] = await this.db
      .update(authChallenges)
      .set({ stage: "COMPLETED", completedAt: this.now() })
      .where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.stage, "PASSWORD_OK")))
      .returning();
    if (!done) throw Errors.challengeExpired();

    let current = account;
    if (challenge.enrollment) {
      // Primo accesso: il codice SMS conferma il cellulare, che diventa il primo fattore.
      await this.db.insert(mfaFactors).values({ accountId: account.id, method: "SMS", confirmedAt: this.now() });
      const [updated] = await this.db
        .update(accounts)
        .set({ status: "ACTIVE", phoneVerifiedAt: this.now(), updatedAt: this.now() })
        .where(eq(accounts.id, account.id))
        .returning();
      current = updated!;
      await this.audit(account.id, "mfa.sms_enrolled", ctx);
    } else if (method.data === "SMS") {
      await this.db
        .update(mfaFactors)
        .set({ lastUsedAt: this.now() })
        .where(and(eq(mfaFactors.accountId, account.id), eq(mfaFactors.method, "SMS")));
    }

    await this.audit(account.id, "login.success", ctx, { method: method.data, channel: challenge.channel });
    return this.issueSession(current, challenge.channel, method.data, null, ctx);
  }

  // --- Approvazione dall'app (notifica push) ---------------------------------------------------

  async startPush(loginToken: unknown): Promise<{ status: "PENDING"; devices: number }> {
    const { challenge, account } = await this.loadChallenge(loginToken);
    if (challenge.enrollment) throw Errors.methodNotAvailable();
    const active = await this.db.query.devices.findMany({ where: and(eq(devices.accountId, account.id), isNull(devices.revokedAt)) });
    if (active.length === 0) throw Errors.methodNotAvailable();

    await this.db
      .update(authChallenges)
      .set({ pushStatus: "PENDING", pushNonce: randomToken(16) })
      .where(eq(authChallenges.id, challenge.id));

    const t = texts(account.locale);
    for (const d of active) {
      if (d.pushToken) {
        await this.notifier.push({ to: d.pushToken, title: t.pushTitle, body: t.pushBody, data: { type: "APPROVAL", challengeId: challenge.id } });
      }
    }
    return { status: "PENDING", devices: active.length };
  }

  /** Il browser chiede l'esito: se l'app ha approvato, la sessione web si apre qui. */
  async pollPush(
    loginToken: unknown,
    ctx: RequestContext = {},
  ): Promise<{ status: "PENDING" | "DENIED" | "EXPIRED" } | { status: "APPROVED"; session: IssuedSession }> {
    if (typeof loginToken !== "string") return { status: "EXPIRED" };
    const challenge = await this.db.query.authChallenges.findFirst({ where: eq(authChallenges.tokenHash, sha256(loginToken)) });
    if (!challenge || challenge.expiresAt <= this.now() || challenge.stage === "COMPLETED") return { status: "EXPIRED" };
    if (challenge.pushStatus === "DENIED" || challenge.stage === "DENIED") return { status: "DENIED" };
    if (challenge.pushStatus !== "APPROVED") return { status: "PENDING" };

    const [done] = await this.db
      .update(authChallenges)
      .set({ stage: "COMPLETED", completedAt: this.now() })
      .where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.stage, "PASSWORD_OK")))
      .returning();
    if (!done) return { status: "EXPIRED" };
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.id, challenge.accountId) });
    if (!account) return { status: "EXPIRED" };
    await this.audit(account.id, "login.success", ctx, { method: "MOBILE_APP", channel: challenge.channel });
    return { status: "APPROVED", session: await this.issueSession(account, challenge.channel, "MOBILE_APP", challenge.pushDeviceId, ctx) };
  }

  private async loadDevice(deviceId: unknown) {
    if (typeof deviceId !== "string" || !/^[0-9a-f-]{36}$/i.test(deviceId)) throw Errors.invalidSignature();
    const device = await this.db.query.devices.findFirst({ where: eq(devices.id, deviceId) });
    if (!device) throw Errors.invalidSignature();
    if (device.revokedAt) throw Errors.deviceRevoked();
    return device;
  }

  /** L'app elenca le richieste da approvare, firmando con la propria chiave. */
  async pendingApprovals(input: { deviceId?: unknown; timestamp?: unknown; signature?: unknown }): Promise<PendingApproval[]> {
    const device = await this.loadDevice(input.deviceId);
    const ts = Number(input.timestamp);
    if (!Number.isFinite(ts) || Math.abs(ts - this.now().getTime()) > this.sec.deviceClockSkewMs) throw Errors.invalidSignature();
    if (!verifyDeviceSignature(device.publicKey, deviceMessages.pending(device.id, ts), String(input.signature ?? ""))) {
      throw Errors.invalidSignature();
    }
    await this.db.update(devices).set({ lastSeenAt: this.now() }).where(eq(devices.id, device.id));
    return this.approvalsFor(device.accountId);
  }

  /** Richieste in attesa per l'app già sbloccata (sessione mobile aperta con la chiave del dispositivo). */
  async approvalsForSession(session: { accountId: string; channel: Channel; deviceId: string | null }): Promise<PendingApproval[]> {
    if (session.channel !== "MOBILE" || !session.deviceId) throw Errors.forbidden();
    return this.approvalsFor(session.accountId);
  }

  private async approvalsFor(accountId: string): Promise<PendingApproval[]> {
    const rows = await this.db.query.authChallenges.findMany({
      where: and(
        eq(authChallenges.accountId, accountId),
        eq(authChallenges.pushStatus, "PENDING"),
        eq(authChallenges.stage, "PASSWORD_OK"),
        gt(authChallenges.expiresAt, this.now()),
      ),
      orderBy: desc(authChallenges.createdAt),
    });
    return rows.map((c) => ({
      id: c.id,
      nonce: c.pushNonce!,
      purpose: c.purpose as PendingApproval["purpose"],
      channel: c.channel,
      ip: c.ip,
      userAgent: c.userAgent,
      details: c.details ?? null,
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
    }));
  }

  /** L'utente approva o rifiuta dall'app, dopo lo sblocco con biometria o PIN. */
  async respondApproval(input: { deviceId?: unknown; challengeId?: unknown; decision?: unknown; signature?: unknown }, ctx: RequestContext = {}) {
    const device = await this.loadDevice(input.deviceId);
    const decision = z.enum(["APPROVE", "DENY"]).safeParse(input.decision);
    if (!decision.success || typeof input.challengeId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.challengeId)) {
      throw Errors.notFound();
    }
    const challenge = await this.db.query.authChallenges.findFirst({
      where: and(eq(authChallenges.id, input.challengeId), eq(authChallenges.accountId, device.accountId)),
    });
    if (!challenge || challenge.pushStatus !== "PENDING" || challenge.stage !== "PASSWORD_OK" || challenge.expiresAt <= this.now()) {
      throw Errors.challengeExpired();
    }
    const message = deviceMessages.respond(challenge.id, challenge.pushNonce!, decision.data);
    if (!verifyDeviceSignature(device.publicKey, message, String(input.signature ?? ""))) throw Errors.invalidSignature();

    const approved = decision.data === "APPROVE";
    const [updated] = await this.db
      .update(authChallenges)
      .set({ pushStatus: approved ? "APPROVED" : "DENIED", pushDeviceId: device.id, pushNonce: null })
      .where(and(eq(authChallenges.id, challenge.id), eq(authChallenges.pushStatus, "PENDING")))
      .returning();
    if (!updated) throw Errors.challengeExpired();
    await this.audit(device.accountId, approved ? "push.approved" : "push.denied", ctx, { deviceId: device.id, challengeId: challenge.id });
    return { status: updated.pushStatus };
  }

  // --- Accesso diretto dall'app -----------------------------------------------------------------

  async deviceNonce(deviceId: unknown): Promise<{ nonce: string; expiresAt: string }> {
    const device = await this.loadDevice(deviceId);
    const nonce = randomToken(24);
    const expiresAt = this.after(this.sec.deviceNonceTtlMs);
    await this.db.insert(deviceNonces).values({ nonce, deviceId: device.id, expiresAt });
    return { nonce, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Accesso dall'app: possesso (chiave privata nel telefono) + inerenza o conoscenza
   * (la chiave si sblocca solo con biometria o PIN del dispositivo). È autenticazione forte senza OTP.
   */
  async deviceLogin(input: { deviceId?: unknown; nonce?: unknown; signature?: unknown }, ctx: RequestContext = {}): Promise<IssuedSession> {
    const device = await this.loadDevice(input.deviceId);
    if (typeof input.nonce !== "string") throw Errors.invalidSignature();
    const [nonce] = await this.db
      .update(deviceNonces)
      .set({ usedAt: this.now() })
      .where(
        and(
          eq(deviceNonces.nonce, input.nonce),
          eq(deviceNonces.deviceId, device.id),
          isNull(deviceNonces.usedAt),
          gt(deviceNonces.expiresAt, this.now()),
        ),
      )
      .returning();
    if (!nonce) throw Errors.invalidSignature();
    if (!verifyDeviceSignature(device.publicKey, deviceMessages.login(device.id, nonce.nonce), String(input.signature ?? ""))) {
      await this.audit(device.accountId, "device.login_bad_signature", ctx, { deviceId: device.id });
      throw Errors.invalidSignature();
    }
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.id, device.accountId) });
    if (!account || account.status !== "ACTIVE") throw Errors.accountSuspended();
    await this.db.update(devices).set({ lastSeenAt: this.now() }).where(eq(devices.id, device.id));
    await this.audit(account.id, "login.success", ctx, { method: "MOBILE_APP", channel: "MOBILE", deviceId: device.id });
    return this.issueSession(account, "MOBILE", "MOBILE_APP", device.id, ctx);
  }

  // =============================================================================================
  // Sessioni
  // =============================================================================================

  async toSessionUser(account: Account): Promise<SessionUser> {
    return {
      id: account.id,
      email: account.email,
      role: account.role,
      subjectType: account.subjectType,
      displayName: account.companyName ?? `${account.firstName} ${account.lastName}`,
      status: account.status,
      locale: account.locale === "en" ? "en" : "it",
      mfaMethods: await this.activeFactors(account.id),
    };
  }

  private async issueSession(
    account: Account,
    channel: Channel,
    mfaMethod: MfaMethod,
    deviceId: string | null,
    ctx: RequestContext,
  ): Promise<IssuedSession> {
    const token = randomToken();
    const expiresAt = this.after(this.sec.sessionAbsoluteMs);
    await this.db.insert(sessions).values({
      accountId: account.id,
      tokenHash: sha256(token),
      channel,
      mfaMethod,
      deviceId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      expiresAt,
    });
    return { token, expiresAt, user: await this.toSessionUser(account) };
  }

  /** Valida un token di sessione e ne rinnova il timer di inattività. */
  async authenticate(token: string | undefined) {
    if (!token || token.length > 100) return null;
    const session = await this.db.query.sessions.findFirst({ where: eq(sessions.tokenHash, sha256(token)) });
    const now = this.now();
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      now.getTime() - session.lastSeenAt.getTime() > this.sec.sessionIdleMs
    ) {
      return null;
    }
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.id, session.accountId) });
    if (!account || account.status !== "ACTIVE") return null;
    if (session.deviceId) {
      const device = await this.db.query.devices.findFirst({ where: eq(devices.id, session.deviceId) });
      if (!device || device.revokedAt) return null;
    }
    await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
    return { session, account };
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.db.update(sessions).set({ revokedAt: this.now() }).where(eq(sessions.tokenHash, sha256(token)));
  }

  // =============================================================================================
  // Gestione dei fattori (richiede una sessione attiva)
  // =============================================================================================

  /** Avvia l'associazione di un'app di autenticazione (Google Authenticator & co.). */
  async totpSetup(account: Account) {
    const secret = generateTotpSecret();
    await this.db
      .delete(mfaFactors)
      .where(and(eq(mfaFactors.accountId, account.id), eq(mfaFactors.method, "TOTP"), isNull(mfaFactors.confirmedAt)));
    await this.db.insert(mfaFactors).values({
      accountId: account.id,
      method: "TOTP",
      totpSecretEnc: encrypt(secret, this.config.DATA_ENCRYPTION_KEY),
    });
    const uri = totpUri(secret, account.email);
    return { secret, uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, color: { dark: "#1c1a17", light: "#fbf8f2" } }) };
  }

  async totpConfirm(account: Account, code: unknown, ctx: RequestContext = {}) {
    const pending = await this.db.query.mfaFactors.findFirst({
      where: and(eq(mfaFactors.accountId, account.id), eq(mfaFactors.method, "TOTP"), isNull(mfaFactors.confirmedAt)),
      orderBy: desc(mfaFactors.createdAt),
    });
    if (!pending?.totpSecretEnc) throw Errors.methodNotAvailable();
    const parsed = otpSchema.safeParse(code);
    const step = parsed.success
      ? verifyTotp(decrypt(pending.totpSecretEnc, this.config.DATA_ENCRYPTION_KEY), parsed.data, this.now().getTime())
      : null;
    if (step === null) throw Errors.invalidCode(this.sec.challengeMaxAttempts);
    // Un solo TOTP attivo per account: quello nuovo sostituisce il precedente.
    await this.db
      .delete(mfaFactors)
      .where(and(eq(mfaFactors.accountId, account.id), eq(mfaFactors.method, "TOTP"), sql`${mfaFactors.confirmedAt} is not null`));
    await this.db.update(mfaFactors).set({ confirmedAt: this.now(), totpLastStep: step }).where(eq(mfaFactors.id, pending.id));
    await this.audit(account.id, "mfa.totp_enrolled", ctx);
    return { methods: await this.activeFactors(account.id) };
  }

  /** QR code da inquadrare con l'app per associarla al profilo. */
  async createPairing(account: Account) {
    const code = randomToken(18);
    const expiresAt = this.after(this.sec.pairingTtlMs);
    await this.db.insert(devicePairings).values({ accountId: account.id, codeHash: sha256(code), expiresAt });
    const uri = pairingUri(code);
    return {
      code,
      uri,
      expiresAt: expiresAt.toISOString(),
      qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 320, color: { dark: "#1c1a17", light: "#fbf8f2" } }),
    };
  }

  /**
   * Registra la chiave pubblica dell'app. Autorizzazione: o il codice del QR code mostrato sul sito,
   * o una sessione mobile aperta da poco con password + SMS (primo accesso direttamente dall'app).
   */
  async enrollDevice(
    input: { pairingCode?: unknown; publicKey?: unknown; signature?: unknown; name?: unknown; platform?: unknown; pushToken?: unknown },
    auth: { session?: { accountId: string; channel: Channel; createdAt: Date } },
    ctx: RequestContext = {},
  ) {
    const body = z
      .object({
        publicKey: z.string().refine(isValidPublicKey),
        signature: z.string().max(200),
        name: z.string().trim().min(1).max(80),
        platform: z.enum(["ios", "android"]),
        pushToken: z.string().max(300).optional(),
      })
      .safeParse(input);
    if (!body.success) throw Errors.validation({ _: "device.invalid" });

    let accountId: string;
    let authorization: string;
    if (typeof input.pairingCode === "string") {
      authorization = input.pairingCode;
      const [pairing] = await this.db
        .update(devicePairings)
        .set({ usedAt: this.now() })
        .where(and(eq(devicePairings.codeHash, sha256(input.pairingCode)), isNull(devicePairings.usedAt), gt(devicePairings.expiresAt, this.now())))
        .returning();
      if (!pairing) throw Errors.invalidToken();
      accountId = pairing.accountId;
    } else if (auth.session && auth.session.channel === "MOBILE") {
      if (this.now().getTime() - auth.session.createdAt.getTime() > this.sec.freshAuthMs) throw Errors.reauthRequired();
      accountId = auth.session.accountId;
      authorization = "session";
    } else {
      throw Errors.unauthenticated();
    }

    // Prova di possesso: la nuova chiave firma la propria richiesta di associazione.
    if (!verifyDeviceSignature(body.data.publicKey, deviceMessages.enroll(authorization, body.data.publicKey), body.data.signature)) {
      throw Errors.invalidSignature();
    }

    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.id, accountId) });
    if (!account || account.status !== "ACTIVE") throw Errors.accountSuspended();

    const [device] = await this.db
      .insert(devices)
      .values({
        accountId,
        name: body.data.name,
        platform: body.data.platform,
        publicKey: body.data.publicKey,
        pushToken: body.data.pushToken,
        lastSeenAt: this.now(),
      })
      .returning();
    await this.db.insert(mfaFactors).values({ accountId, method: "MOBILE_APP", deviceId: device!.id, confirmedAt: this.now() });
    await this.audit(accountId, "device.enrolled", ctx, { deviceId: device!.id, name: device!.name });

    const t = texts(account.locale);
    await this.notifier.email({
      to: account.email,
      subject: t.newDeviceSubject,
      ...renderEmail({ locale: account.locale, title: t.newDeviceSubject, body: t.newDeviceBody(device!.name) }),
    });
    return { deviceId: device!.id, user: await this.toSessionUser(account) };
  }

  async listDevices(account: Account) {
    const rows = await this.db.query.devices.findMany({
      where: and(eq(devices.accountId, account.id), isNull(devices.revokedAt)),
      orderBy: desc(devices.createdAt),
    });
    return rows.map((d) => ({ id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt }));
  }

  async revokeDevice(account: Account, deviceId: string, ctx: RequestContext = {}) {
    const [d] = await this.db
      .update(devices)
      .set({ revokedAt: this.now(), pushToken: null })
      .where(and(eq(devices.id, deviceId), eq(devices.accountId, account.id), isNull(devices.revokedAt)))
      .returning();
    if (!d) throw Errors.notFound();
    await this.db.update(sessions).set({ revokedAt: this.now() }).where(eq(sessions.deviceId, d.id));
    await this.audit(account.id, "device.revoked", ctx, { deviceId });
  }

  // =============================================================================================
  // Recupero password
  // =============================================================================================

  async forgotPassword(email: unknown) {
    const parsed = z.string().trim().toLowerCase().email().safeParse(email);
    if (!parsed.success) return;
    const account = await this.db.query.accounts.findFirst({ where: eq(accounts.email, parsed.data) });
    if (!account || account.status === "SUSPENDED") return;
    const token = randomToken();
    await this.db.insert(emailTokens).values({
      accountId: account.id,
      purpose: "PASSWORD_RESET",
      tokenHash: sha256(token),
      expiresAt: this.after(this.sec.passwordResetTtlMs),
    });
    const t = texts(account.locale);
    const url = `${this.config.WEB_ORIGIN}/${account.locale}/nuova-password?token=${token}`;
    await this.notifier.email({
      to: account.email,
      subject: t.resetSubject,
      actionUrl: url,
      ...renderEmail({ locale: account.locale, title: t.resetSubject, body: t.resetBody, cta: { label: t.resetCta, url } }),
    });
  }

  /** Nuova password: tutte le sessioni aperte vengono chiuse. Il prossimo accesso chiede comunque il secondo fattore. */
  async resetPassword(input: { token?: unknown; password?: unknown }, ctx: RequestContext = {}) {
    const password = passwordSchema.safeParse(input.password);
    if (!password.success) throw Errors.validation({ password: password.error.issues[0]!.message });
    const row = await this.consumeEmailToken(input.token, "PASSWORD_RESET");
    await this.db
      .update(accounts)
      .set({ passwordHash: await hashPassword(password.data), failedLoginCount: 0, lockedUntil: null, updatedAt: this.now() })
      .where(eq(accounts.id, row.accountId));
    await this.db.update(sessions).set({ revokedAt: this.now() }).where(and(eq(sessions.accountId, row.accountId), isNull(sessions.revokedAt)));
    await this.audit(row.accountId, "password.reset", ctx);
  }
}

export { ApiError };

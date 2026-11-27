import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { resolve } from "node:path";
import { CatalogService } from "./catalog/service";
import { AtelierService } from "./atelier/service";
import { DiskMediaStore, MAX_IMAGE_BYTES, PrivateFiles, type MediaStore } from "./lib/media";
import { LlmTranslator, NoTranslator, type Translator } from "./lib/translate";
import { CallService } from "./atelier/calls";
import { atelierRoutes, callRoutes } from "./routes/atelier";
import { catalogRoutes } from "./routes/catalog";
import { orderRoutes } from "./routes/orders";
import { SandboxPaymentProvider, type PaymentProvider } from "./orders/payments";
import { OrderService } from "./orders/service";
import { LlmInterpreter, RulesInterpreter, type Interpreter } from "./search/interpret";
import { SearchService } from "./search/service";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { AuthService, type Channel, type IssuedSession, type RequestContext } from "./auth/service";
import type { Config } from "./config";
import type { Db } from "./db/client";
import type { Account } from "./db/schema";
import { ApiError, Errors } from "./lib/errors";
import type { Notifier } from "./lib/notifications";

export const SESSION_COOKIE = "mi_session";

declare module "fastify" {
  interface FastifyInstance {
    orders: OrderService;
    atelier: AtelierService;
  }
  interface FastifyRequest {
    auth?: { account: Account; session: { id: string; accountId: string; channel: Channel; createdAt: Date; deviceId: string | null } };
  }
}

export async function buildApp(opts: {
  db: Db;
  config: Config;
  notifier: Notifier;
  now?: () => Date;
  logger?: boolean;
  media?: MediaStore;
  interpreter?: Interpreter;
  payments?: PaymentProvider;
  translator?: Translator;
}) {
  const { config } = opts;
  const app = Fastify({ logger: opts.logger ?? process.env.DEBUG_API === "1", trustProxy: true, bodyLimit: 64 * 1024 });
  const auth = new AuthService(opts);
  const prod = config.NODE_ENV === "production";

  await app.register(helmet);
  await app.register(cors, { origin: [config.WEB_ORIGIN], credentials: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });
  const mediaDir = resolve(config.MEDIA_DIR);
  await app.register(fastifyStatic, { root: mediaDir, prefix: "/media/", decorateReply: false, index: false, maxAge: "30d", immutable: true });
  const media = opts.media ?? new DiskMediaStore(mediaDir);
  const search = new SearchService(opts.db);
  const catalog = new CatalogService(opts.db, config, opts.notifier, opts.now, (id) => search.reindex(id));
  const useLlm = config.AI_SEARCH === "on" || (config.AI_SEARCH === "auto" && !!process.env.ANTHROPIC_API_KEY);
  const interpreter = opts.interpreter ?? (useLlm ? new LlmInterpreter((m) => app.log.warn(m)) : new RulesInterpreter());
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === "test" ? 10_000 : 120,
    timeWindow: "1 minute",
  });

  // Limiti più stretti sulle rotte esposte a tentativi ripetuti.
  const strict = { config: { rateLimit: { max: config.NODE_ENV === "test" ? 10_000 : 10, timeWindow: "1 minute" } } };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.status(err.status).send({ error: { code: err.code, fields: err.fields, ...err.extra } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: { code: "RATE_LIMITED" } });
    if (status && status < 500) return reply.status(status).send({ error: { code: "BAD_REQUEST" } });
    app.log.error(err);
    return reply.status(500).send({ error: { code: "INTERNAL_ERROR" } });
  });

  const ctx = (req: FastifyRequest): RequestContext => ({ ip: req.ip, userAgent: req.headers["user-agent"]?.slice(0, 300) });
  const channelOf = (req: FastifyRequest): Channel => (req.headers["x-client"] === "mobile" ? "MOBILE" : "WEB");
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

  /**
   * Protezione CSRF per il web: le richieste che modificano dati devono arrivare dal sito stesso.
   * Valgono l'indirizzo configurato (WEB_ORIGIN) e l'host su cui il browser vede il sito, come lo
   * riportano i proxy (Next, inoltro porte di Codespaces): una pagina di un altro dominio non passa.
   */
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim().toLowerCase();
  const codespace = process.env.CODESPACE_NAME
    ? new RegExp(`^https://${process.env.CODESPACE_NAME}-\\d+\\.${(process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev").replace(/\./g, "\\.")}$`)
    : null;
  app.addHook("onRequest", async (req) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    if (!origin || origin === config.WEB_ORIGIN || codespace?.test(origin)) return;
    let host: string;
    try {
      host = new URL(origin).host.toLowerCase();
    } catch {
      throw Errors.forbidden();
    }
    const seen = [first(req.headers["x-forwarded-host"]), first(req.headers.host)];
    if (seen.includes(host)) return;
    req.log.warn({ origin, expected: config.WEB_ORIGIN, forwardedHost: seen[0], host: seen[1] }, "richiesta rifiutata: origine diversa dal sito");
    throw Errors.forbidden();
  });

  const tokenOf = (req: FastifyRequest) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) return header.slice(7);
    return req.cookies[SESSION_COOKIE];
  };

  /** Consegna la sessione: cookie httpOnly per il web, token per l'app. */
  const deliver = (reply: FastifyReply, channel: Channel, s: IssuedSession) => {
    if (channel === "WEB") {
      reply.setCookie(SESSION_COOKIE, s.token, {
        httpOnly: true,
        secure: prod,
        sameSite: "strict",
        path: "/",
        expires: s.expiresAt,
      });
      return { user: s.user };
    }
    return { user: s.user, sessionToken: s.token, expiresAt: s.expiresAt.toISOString() };
  };

  const requireSession = async (req: FastifyRequest) => {
    const result = await auth.authenticate(tokenOf(req));
    if (!result) throw Errors.unauthenticated();
    req.auth = result;
  };

  /** Sulle pagine pubbliche la sessione è facoltativa: serve solo a mostrare i prezzi riservati. */
  const optionalSession = async (req: FastifyRequest) => {
    const result = await auth.authenticate(tokenOf(req));
    if (result) req.auth = result;
  };

  app.get("/health", async () => ({ ok: true }));
  catalogRoutes(app, catalog, media, { requireSession, optionalSession });
  const orderService = new OrderService(opts.db, config, opts.notifier, auth, opts.payments ?? new SandboxPaymentProvider(), opts.now);
  orderRoutes(app, orderService, { requireSession, ctx, channelOf, strict });
  app.decorate("orders", orderService);

  // L'Atelier: commissioni su misura con conversazione tradotta
  const useTranslation = config.AI_TRANSLATION === "on" || (config.AI_TRANSLATION === "auto" && !!process.env.ANTHROPIC_API_KEY);
  const translator = opts.translator ?? (useTranslation ? new LlmTranslator((m) => app.log.warn(m)) : new NoTranslator());
  const atelier = new AtelierService(opts.db, config, opts.notifier, orderService, translator, new PrivateFiles(`${mediaDir}-private`), opts.now);
  atelierRoutes(app, atelier, { requireSession, ctx, channelOf, strict });
  app.decorate("atelier", atelier);
  callRoutes(app, new CallService(opts.db, config, atelier, translator, opts.now), { requireSession });

  // --- Esplorazione e ricerca -------------------------------------------------------------------
  app.get("/v1/maisons", async (req) => search.search(req.query));
  app.get("/v1/territories", async () => ({ territories: await search.territories() }));
  app.post("/v1/search/interpret", strict, async (req) => {
    const q = (req.body as { query?: unknown } | undefined)?.query;
    if (typeof q !== "string" || q.trim().length < 2) throw Errors.validation({ query: "search.query_required" });
    return interpreter.interpret(q.trim().slice(0, 500));
  });

  // --- Registrazione e attivazione --------------------------------------------------------------
  app.post("/v1/auth/register", strict, async (req, reply) => {
    await auth.register(req.body, ctx(req));
    return reply.status(202).send({ ok: true });
  });
  app.post("/v1/auth/activate", strict, async (req) => auth.activate(body(req).token, ctx(req)));
  app.post("/v1/auth/activation/resend", strict, async (req, reply) => {
    await auth.resendActivation(body(req).email);
    return reply.status(202).send({ ok: true });
  });

  // --- Accesso ----------------------------------------------------------------------------------
  app.post("/v1/auth/login", strict, async (req) => auth.login(req.body, channelOf(req), ctx(req)));
  app.post("/v1/auth/mfa/sms", strict, async (req) => auth.sendSmsOtp(body(req).loginToken));
  app.post("/v1/auth/mfa/verify", strict, async (req, reply) => {
    const s = await auth.verifyMfa(body(req), ctx(req));
    return deliver(reply, channelOf(req), s);
  });
  app.post("/v1/auth/mfa/push", strict, async (req) => auth.startPush(body(req).loginToken));
  app.post("/v1/auth/mfa/push/poll", async (req, reply) => {
    const r = await auth.pollPush(body(req).loginToken, ctx(req));
    if (r.status !== "APPROVED") return r;
    return { status: "APPROVED", ...deliver(reply, channelOf(req), r.session) };
  });
  app.post("/v1/auth/logout", async (req, reply) => {
    await auth.logout(tokenOf(req));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });
  app.post("/v1/auth/password/forgot", strict, async (req, reply) => {
    await auth.forgotPassword(body(req).email);
    return reply.status(202).send({ ok: true });
  });
  app.post("/v1/auth/password/reset", strict, async (req) => {
    await auth.resetPassword(body(req), ctx(req));
    return { ok: true };
  });

  // --- App mobile: dispositivo come chiave ------------------------------------------------------
  app.post("/v1/device/enroll", strict, async (req) => {
    const s = await auth.authenticate(tokenOf(req));
    return auth.enrollDevice(body(req), { session: s?.session }, ctx(req));
  });
  app.post("/v1/device/nonce", strict, async (req) => auth.deviceNonce(body(req).deviceId));
  app.post("/v1/device/login", strict, async (req, reply) => {
    const s = await auth.deviceLogin(body(req), ctx(req));
    return deliver(reply, "MOBILE", s);
  });
  app.post("/v1/device/approvals", async (req) => ({ approvals: await auth.pendingApprovals(body(req)) }));
  app.post("/v1/device/approvals/respond", strict, async (req) => auth.respondApproval(body(req), ctx(req)));

  // --- Area personale ---------------------------------------------------------------------------
  app.get("/v1/me", { preHandler: requireSession }, async (req) => ({ user: await auth.toSessionUser(req.auth!.account) }));
  app.post("/v1/me/mfa/totp/setup", { preHandler: requireSession }, async (req) => auth.totpSetup(req.auth!.account));
  app.post("/v1/me/mfa/totp/confirm", { preHandler: requireSession }, async (req) =>
    auth.totpConfirm(req.auth!.account, body(req).code, ctx(req)),
  );
  app.post("/v1/me/devices/pairing", { preHandler: requireSession }, async (req) => auth.createPairing(req.auth!.account));
  app.get("/v1/me/approvals", { preHandler: requireSession }, async (req) => ({
    approvals: await auth.approvalsForSession(req.auth!.session),
  }));
  app.get("/v1/me/devices", { preHandler: requireSession }, async (req) => ({ devices: await auth.listDevices(req.auth!.account) }));
  app.delete<{ Params: { id: string } }>("/v1/me/devices/:id", { preHandler: requireSession }, async (req) => {
    await auth.revokeDevice(req.auth!.account, req.params.id, ctx(req));
    return { ok: true };
  });

  return app;
}

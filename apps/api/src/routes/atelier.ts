import type { FastifyInstance, FastifyRequest } from "fastify";
import type { CallService } from "../atelier/calls";
import type { AtelierService } from "../atelier/service";
import type { Channel, RequestContext } from "../auth/service";
import { Errors } from "../lib/errors";

export function atelierRoutes(
  app: FastifyInstance,
  atelier: AtelierService,
  deps: {
    requireSession: (req: FastifyRequest) => Promise<void>;
    ctx: (req: FastifyRequest) => RequestContext;
    channelOf: (req: FastifyRequest) => Channel;
    strict: object;
  },
) {
  const me = { preHandler: deps.requireSession };
  const strictMe = { ...deps.strict, preHandler: deps.requireSession };
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const acct = (req: FastifyRequest) => req.auth!.account;
  type P = { Params: { id: string } };
  const uuid = (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
    return id;
  };

  app.get("/v1/commissions", me, async (req) => atelier.list(acct(req)));
  app.post("/v1/commissions", strictMe, async (req) => atelier.request(acct(req), req.body));
  app.get<P>("/v1/commissions/:id", me, async (req) => atelier.view(acct(req), uuid(req.params.id)));

  // Conversazione
  app.post<P>("/v1/commissions/:id/messages", me, async (req) => atelier.message(acct(req), uuid(req.params.id), req.body));
  app.post<P>("/v1/commissions/:id/images", me, async (req) => {
    const file = await req.file();
    if (!file) throw Errors.validation({ file: "image.required" });
    return atelier.image(acct(req), uuid(req.params.id), await file.toBuffer());
  });
  app.get<{ Params: { id: string; key: string } }>("/v1/commissions/:id/files/:key", me, async (req, reply) => {
    const f = await atelier.file(acct(req), uuid(req.params.id), req.params.key);
    return reply.header("cache-control", "private, max-age=3600").type(f.type).send(f.data);
  });

  // Proposta e accordo
  app.post<P>("/v1/commissions/:id/proposals", me, async (req) => atelier.propose(acct(req), uuid(req.params.id), req.body));
  app.post<P>("/v1/commissions/:id/decline", me, async (req) => atelier.decline(acct(req), uuid(req.params.id), body(req).note));
  app.post<P>("/v1/commissions/:id/request-changes", me, async (req) => atelier.requestChanges(acct(req), uuid(req.params.id), body(req).note));
  app.post<P>("/v1/commissions/:id/accept", strictMe, async (req) =>
    atelier.acceptProposal(acct(req), uuid(req.params.id), body(req), deps.channelOf(req), deps.ctx(req)),
  );
  app.post<P>("/v1/commissions/:id/pay-deposit", strictMe, async (req) => atelier.payDeposit(acct(req), uuid(req.params.id), deps.channelOf(req), deps.ctx(req)));
  app.post<P>("/v1/commissions/:id/withdraw", me, async (req) => atelier.withdraw(acct(req), uuid(req.params.id)));

  // Lavorazione, saldo, consegna
  app.post<P>("/v1/commissions/:id/start-work", me, async (req) => atelier.startWork(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/commissions/:id/fittings", me, async (req) => atelier.logFitting(acct(req), uuid(req.params.id), body(req).note));
  app.post<P>("/v1/commissions/:id/request-balance", me, async (req) => atelier.requestBalance(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/commissions/:id/pay-balance", strictMe, async (req) => atelier.payBalance(acct(req), uuid(req.params.id), deps.channelOf(req), deps.ctx(req)));
  app.post<P>("/v1/commissions/:id/ship", me, async (req) => atelier.ship(acct(req), uuid(req.params.id), body(req)));
  app.post<P>("/v1/commissions/:id/confirm-delivery", me, async (req) => atelier.confirmDelivery(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/commissions/:id/dispute", me, async (req) => atelier.dispute(acct(req), uuid(req.params.id), body(req).note));
}

/** Videochiamate e appuntamenti dell'Atelier. */
export function callRoutes(
  app: FastifyInstance,
  calls: CallService,
  deps: { requireSession: (req: FastifyRequest) => Promise<void> },
) {
  const me = { preHandler: deps.requireSession };
  // Durante la chiamata il browser interroga spesso il portale: limite dedicato, più largo.
  const live = { preHandler: deps.requireSession, config: { rateLimit: { max: 600, timeWindow: "1 minute" } } };
  const acct = (req: FastifyRequest) => req.auth!.account;
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;
  const uuid = (id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw Errors.notFound();
    return id;
  };
  type P = { Params: { id: string } };

  app.get<P>("/v1/commissions/:id/calls/current", live, async (req) => calls.current(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/commissions/:id/calls", me, async (req) => calls.start(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/calls/:id/answer", me, async (req) => calls.answer(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/calls/:id/decline", me, async (req) => calls.decline(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/calls/:id/end", live, async (req) => calls.end(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/calls/:id/signals", live, async (req) => calls.signal(acct(req), uuid(req.params.id), req.body));
  app.get<P & { Querystring: { after?: string } }>("/v1/calls/:id/signals", live, async (req) =>
    calls.signals(acct(req), uuid(req.params.id), Math.max(0, Number(req.query.after) || 0)),
  );
  app.post<P>("/v1/calls/:id/captions", live, async (req) => calls.caption(acct(req), uuid(req.params.id), body(req).text, body(req).spokenLanguage));

  app.post<P>("/v1/commissions/:id/appointments", me, async (req) => calls.propose(acct(req), uuid(req.params.id), req.body));
  app.post<P>("/v1/appointments/:id/respond", me, async (req) => calls.respond(acct(req), uuid(req.params.id), body(req)));
}

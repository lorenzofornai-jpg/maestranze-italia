import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Channel, RequestContext } from "../auth/service";
import { Errors } from "../lib/errors";
import type { OrderService } from "../orders/service";

export function orderRoutes(
  app: FastifyInstance,
  orders: OrderService,
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

  app.get("/v1/orders", me, async (req) => orders.list(acct(req)));
  app.post("/v1/orders/quote", me, async (req) => {
    const { priced } = await orders.quote(acct(req), req.body);
    return priced;
  });
  app.post("/v1/orders", strictMe, async (req) => orders.create(acct(req), req.body, deps.channelOf(req), deps.ctx(req)));
  app.get<P>("/v1/orders/:id", me, async (req) => orders.view(acct(req), uuid(req.params.id)));

  // Autorizzazione del pagamento (stessa doppia autenticazione dell'accesso, legata all'importo)
  app.post<P>("/v1/orders/:id/authorize", strictMe, async (req) => orders.reauthorize(acct(req), uuid(req.params.id), deps.channelOf(req), deps.ctx(req)));
  app.post<P>("/v1/orders/:id/authorize/sms", strictMe, async (req) => orders.sendSms(acct(req), uuid(req.params.id), body(req).authToken));
  app.post<P>("/v1/orders/:id/authorize/verify", strictMe, async (req) => orders.verify(acct(req), uuid(req.params.id), body(req), deps.ctx(req)));
  app.post<P>("/v1/orders/:id/authorize/push", strictMe, async (req) => orders.startPush(acct(req), uuid(req.params.id), body(req).authToken));
  app.post<P>("/v1/orders/:id/authorize/poll", me, async (req) => orders.pollPush(acct(req), uuid(req.params.id), body(req).authToken));

  // Ciclo di vita
  app.post<P>("/v1/orders/:id/cancel", me, async (req) => orders.cancel(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/orders/:id/accept", me, async (req) => orders.accept(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/orders/:id/decline", me, async (req) => orders.decline(acct(req), uuid(req.params.id), body(req).note));
  app.post<P>("/v1/orders/:id/ship", me, async (req) => orders.ship(acct(req), uuid(req.params.id), body(req)));
  app.post<P>("/v1/orders/:id/confirm-delivery", me, async (req) => orders.confirmDelivery(acct(req), uuid(req.params.id)));
  app.post<P>("/v1/orders/:id/dispute", me, async (req) => orders.dispute(acct(req), uuid(req.params.id), body(req).note));
  app.post<P>("/v1/orders/:id/resolve", me, async (req) => orders.resolve(acct(req), uuid(req.params.id), body(req)));
}

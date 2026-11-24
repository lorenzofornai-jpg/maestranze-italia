import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MaisonStatus } from "@maestranze/shared";
import type { CatalogService } from "../catalog/service";
import { Errors } from "../lib/errors";
import { storeImage, type MediaStore } from "../lib/media";

export interface RouteDeps {
  requireSession: (req: FastifyRequest) => Promise<void>;
  optionalSession: (req: FastifyRequest) => Promise<void>;
}

export function catalogRoutes(app: FastifyInstance, catalog: CatalogService, media: MediaStore, deps: RouteDeps) {
  const me = { preHandler: deps.requireSession };
  const admin = {
    preHandler: async (req: FastifyRequest) => {
      await deps.requireSession(req);
      if (!req.auth!.account.isAdmin) throw Errors.forbidden();
    },
  };
  const body = (req: FastifyRequest) => (req.body ?? {}) as Record<string, unknown>;

  /** Legge il file del modulo multipart e lo salva dopo aver verificato che sia davvero un'immagine. */
  const upload = async (req: FastifyRequest) => {
    const file = await req.file();
    if (!file) throw Errors.validation({ file: "image.required" });
    return storeImage(media, await file.toBuffer());
  };

  // --- La mia Maison (offerta) ---------------------------------------------------------------
  app.get("/v1/me/maison", me, async (req) => catalog.myMaison(req.auth!.account));
  app.put("/v1/me/maison", me, async (req) => catalog.saveMaison(req.auth!.account, req.body));
  app.post("/v1/me/maison/cover", me, async (req) => catalog.setCover(req.auth!.account, await upload(req)));
  app.post("/v1/me/maison/submit", me, async (req) => catalog.submit(req.auth!.account));
  app.post("/v1/me/products", me, async (req) => catalog.saveProduct(req.auth!.account, req.body));
  app.put<{ Params: { id: string } }>("/v1/me/products/:id", me, async (req) => catalog.saveProduct(req.auth!.account, req.body, req.params.id));
  app.delete<{ Params: { id: string } }>("/v1/me/products/:id", me, async (req) => {
    await catalog.deleteProduct(req.auth!.account, req.params.id);
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>("/v1/me/products/:id/image", me, async (req) =>
    catalog.setProductImage(req.auth!.account, req.params.id, await upload(req)),
  );

  // --- Selezione (staff) -------------------------------------------------------------------
  app.get<{ Querystring: { status?: MaisonStatus } }>("/v1/admin/maisons", admin, async (req) => ({
    maisons: await catalog.reviewQueue(req.query.status ?? "SUBMITTED"),
  }));
  app.post<{ Params: { id: string } }>("/v1/admin/maisons/:id/decision", admin, async (req) =>
    catalog.decide(req.auth!.account, req.params.id, body(req)),
  );

  // --- Pubblico ------------------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>("/v1/maisons/:slug", { preHandler: deps.optionalSession }, async (req) =>
    catalog.publicMaison(req.params.slug, req.auth?.account),
  );
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "../src/app";
import { activeAccount, MAISON, makeAdmin, multipartBody, PRODUCT, setupApp, TINY_PNG, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await setupApp();
});
afterEach(async () => {
  await t.close();
});

const as = (cookie: string) => ({ cookies: { [SESSION_COOKIE]: cookie } });

async function maker() {
  return activeAccount(t, { role: "MAKER", sector: "TAILORING", companyName: "Sartoria Partenopea S.r.l." });
}

async function approvedMaison() {
  const m = await maker();
  await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
  const { id } = (await t.app.inject({ method: "POST", url: "/v1/me/products", payload: PRODUCT, ...as(m.cookie) })).json();
  const up = multipartBody(TINY_PNG);
  await t.app.inject({ method: "POST", url: "/v1/me/maison/cover", payload: up.payload, headers: up.headers, ...as(m.cookie) });
  await t.app.inject({ method: "POST", url: "/v1/me/maison/submit", payload: {}, ...as(m.cookie) });
  const admin = await activeAccount(t);
  await makeAdmin(t, admin.payload.email);
  const queue = (await t.app.inject({ method: "GET", url: "/v1/admin/maisons", ...as(admin.cookie) })).json().maisons;
  await t.app.inject({ method: "POST", url: `/v1/admin/maisons/${queue[0].id}/decision`, payload: { decision: "APPROVE", commissionBps: 1200 }, ...as(admin.cookie) });
  return { m, admin, productId: id as string, maisonId: queue[0].id as string };
}

describe("la Maison", () => {
  it("solo un account di offerta può creare una Maison", async () => {
    const buyer = await activeAccount(t);
    const r = await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(buyer.cookie) });
    expect(r.statusCode).toBe(403);
  });

  it("crea il profilo con slug, regione e testi bilingui", async () => {
    const m = await maker();
    const r = await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
    expect(r.statusCode).toBe(200);
    expect(r.json().maison).toMatchObject({ slug: "sartoria-partenopea", region: "Campania", status: "DRAFT", commissionBps: 1000 });
  });

  it("valida il racconto e la provincia", async () => {
    const m = await maker();
    const r = await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: { ...MAISON, story: { it: "Breve" }, province: "XX" }, ...as(m.cookie) });
    expect(r.json().error.fields).toMatchObject({ "story.it": "text.too_short", province: "province.invalid" });
  });

  it("la candidatura richiede copertina e almeno un prodotto", async () => {
    const m = await maker();
    await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
    const r = await t.app.inject({ method: "POST", url: "/v1/me/maison/submit", payload: {}, ...as(m.cookie) });
    expect(r.json().error.fields).toEqual({ products: "maison.needs_product", coverImage: "maison.needs_cover" });
  });

  it("rifiuta file che non sono immagini, anche se dichiarati come tali", async () => {
    const m = await maker();
    await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
    const fake = multipartBody(Buffer.from("<script>alert(1)</script>"), "x.png", "image/png");
    const r = await t.app.inject({ method: "POST", url: "/v1/me/maison/cover", payload: fake.payload, headers: fake.headers, ...as(m.cookie) });
    expect(r.json().error.code).toBe("IMAGE_TYPE_NOT_ALLOWED");
  });

  it("il prezzo riservato non può superare quello al pubblico", async () => {
    const m = await maker();
    await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
    const r = await t.app.inject({ method: "POST", url: "/v1/me/products", payload: { ...PRODUCT, b2bPriceCents: 300000 }, ...as(m.cookie) });
    expect(r.json().error.fields.b2bPriceCents).toBe("price.b2b_higher");
  });
});

describe("selezione e pagina pubblica", () => {
  it("non è visibile al pubblico prima dell'approvazione", async () => {
    const m = await maker();
    await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
    expect((await t.app.inject({ method: "GET", url: "/v1/maisons/sartoria-partenopea" })).statusCode).toBe(404);
  });

  it("solo lo staff vede la coda di selezione", async () => {
    const m = await maker();
    expect((await t.app.inject({ method: "GET", url: "/v1/admin/maisons", ...as(m.cookie) })).statusCode).toBe(403);
  });

  it("approvazione: la Maison diventa pubblica e il titolare riceve l'email", async () => {
    const { m } = await approvedMaison();
    expect(t.notifier.lastEmailTo(m.payload.email)?.subject).toBe("La tua Maison è stata selezionata");
    const pub = await t.app.inject({ method: "GET", url: "/v1/maisons/sartoria-partenopea" });
    expect(pub.statusCode).toBe(200);
    expect(pub.json()).toMatchObject({ name: "Sartoria Partenopea", region: "Campania", coverImage: expect.stringMatching(/^\/media\/.+\.png$/) });
    expect(pub.json().products[0]).toMatchObject({ priceCents: 280000, b2bPriceCents: null, available: true });
    const media = await t.app.inject({ method: "GET", url: pub.json().coverImage });
    expect(media.statusCode).toBe(200);
  });

  it("il prezzo riservato si vede solo da clienti professionali", async () => {
    await approvedMaison();
    const company = await activeAccount(t);
    const priv = await activeAccount(t, { subjectType: "PERSON", fiscalCode: "RSSMRA85T10A562S", sector: "PRIVATE" });
    const asCompany = (await t.app.inject({ method: "GET", url: "/v1/maisons/sartoria-partenopea", ...as(company.cookie) })).json();
    const asPrivate = (await t.app.inject({ method: "GET", url: "/v1/maisons/sartoria-partenopea", ...as(priv.cookie) })).json();
    expect(asCompany.products[0].b2bPriceCents).toBe(210000);
    expect(asPrivate.products[0].b2bPriceCents).toBeNull();
  });

  it("il rifiuto richiede una motivazione e consente una nuova candidatura", async () => {
    const m = await maker();
    await t.app.inject({ method: "PUT", url: "/v1/me/maison", payload: MAISON, ...as(m.cookie) });
    await t.app.inject({ method: "POST", url: "/v1/me/products", payload: PRODUCT, ...as(m.cookie) });
    const up = multipartBody(TINY_PNG);
    await t.app.inject({ method: "POST", url: "/v1/me/maison/cover", payload: up.payload, headers: up.headers, ...as(m.cookie) });
    await t.app.inject({ method: "POST", url: "/v1/me/maison/submit", payload: {}, ...as(m.cookie) });
    const admin = await activeAccount(t);
    await makeAdmin(t, admin.payload.email);
    const [q] = (await t.app.inject({ method: "GET", url: "/v1/admin/maisons", ...as(admin.cookie) })).json().maisons;
    const noNote = await t.app.inject({ method: "POST", url: `/v1/admin/maisons/${q.id}/decision`, payload: { decision: "REJECT" }, ...as(admin.cookie) });
    expect(noNote.json().error.fields.note).toBe("review.note_required");
    await t.app.inject({ method: "POST", url: `/v1/admin/maisons/${q.id}/decision`, payload: { decision: "REJECT", note: "Servono fotografie della bottega." }, ...as(admin.cookie) });
    const mine = (await t.app.inject({ method: "GET", url: "/v1/me/maison", ...as(m.cookie) })).json();
    expect(mine.maison).toMatchObject({ status: "REJECTED", reviewNote: "Servono fotografie della bottega." });
    expect((await t.app.inject({ method: "POST", url: "/v1/me/maison/submit", payload: {}, ...as(m.cookie) })).json().status).toBe("SUBMITTED");
  });
});

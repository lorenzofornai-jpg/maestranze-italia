import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectContacts } from "@maestranze/shared";
import { SESSION_COOKIE } from "../src/app";
import { activeAccount, approveMaison, multipartBody, TINY_PNG, type TestApp, setupApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await setupApp();
});
afterEach(async () => {
  await t.close();
});

const as = (c: string) => ({ cookies: { [SESSION_COOKIE]: c } });
const HOUR = 60 * 60 * 1000;

const BRIEF = {
  garment: "SUIT_2",
  occasion: "WEDDING",
  fabric: "WOOL",
  colour: "Blu notte",
  description: "Abito per il mio matrimonio a giugno, linea morbida con spalla napoletana e rever a lancia.",
  budget: "3000_6000",
  neededBy: "2027-05-15",
  country: "US",
};
const NY = { name: "John Smith", street: "350 Fifth Avenue", zip: "10118", city: "New York", province: "NY", country: "US", phone: "+1 212 555 0100" };

async function setup() {
  const s = await approveMaison(t);
  await t.pool.query("update maisons set accepts_commissions = true where id = $1", [s.maisonId]);
  const buyer = await activeAccount(t, { subjectType: "PERSON", fiscalCode: "RSSMRA85T10A562S", sector: "PRIVATE", locale: "en" });
  return { ...s, buyer };
}

async function request(buyerCookie: string, maisonId: string, extra: Record<string, unknown> = {}) {
  return t.app.inject({ method: "POST", url: "/v1/commissions", payload: { maisonId, language: "en", brief: BRIEF, ...extra }, ...as(buyerCookie) });
}

const post = (cookie: string, url: string, payload: Record<string, unknown> = {}) => t.app.inject({ method: "POST", url, payload, ...as(cookie) });
const view = async (cookie: string, id: string) => (await t.app.inject({ method: "GET", url: `/v1/commissions/${id}`, ...as(cookie) })).json();

/** Autorizza con l'SMS una tappa di pagamento (acconto o saldo). */
async function authorize(cookie: string, payment: { order: { id: string }; authorization: { authToken: string } }) {
  const { id } = payment.order;
  const { authToken } = payment.authorization;
  await post(cookie, `/v1/orders/${id}/authorize/sms`, { authToken });
  const code = t.notifier.smss.at(-1)!.code;
  return post(cookie, `/v1/orders/${id}/authorize/verify`, { authToken, method: "SMS", code });
}

describe("contatti fuori dal portale", () => {
  it("riconosce email, telefoni, IBAN, link e app di messaggi; ignora date e misure", () => {
    expect(detectContacts("scrivimi a mario.rossi@gmail.com")).toEqual(["email"]);
    expect(detectContacts("chiamami al 333 123 4567")).toEqual(["phone"]);
    expect(detectContacts("IBAN IT60 X054 2811 1010 0000 0123 456")).toContain("iban");
    expect(detectContacts("ci sentiamo su WhatsApp")).toEqual(["app"]);
    expect(detectContacts("guarda www.sartoria-esempio.it")).toEqual(["link"]);
    expect(detectContacts("consegna il 12/03/2027, torace 102 vita 88, budget 3.500 euro")).toEqual([]);
  });
});

describe("l'Atelier", () => {
  it("dalla richiesta al saldo: traduzione, 96 ore, proposta, acconto, lavorazione, spedizione", async () => {
    const s = await setup();

    // Brief con misure: serve il consenso esplicito
    const noConsent = await request(s.buyer.cookie, s.maisonId, { measurements: { chestCm: 102 } });
    expect(noConsent.json().error.fields.measurementsConsent).toBe("measure.consent_required");

    // Recapiti nel brief: avviso gentile, poi invio confermato
    const withPhone = await request(s.buyer.cookie, s.maisonId, { brief: { ...BRIEF, description: `${BRIEF.description} Call me on +1 212 555 0100.` } });
    expect(withPhone.statusCode).toBe(409);
    expect(withPhone.json().error).toMatchObject({ code: "CONTACT_WARNING", kinds: ["phone"] });

    const created = await request(s.buyer.cookie, s.maisonId, { measurements: { chestCm: 102, waistCm: 88, fit: "REGULAR" }, measurementsConsent: true });
    expect(created.statusCode).toBe(200);
    const { id } = created.json();
    expect(t.notifier.lastEmailTo(s.maker.payload.email)!.subject).toMatch(/richiesta su misura/);

    // La Maison legge il brief in italiano (tradotto), con le misure
    let m = await view(s.maker.cookie, id);
    expect(m).toMatchObject({ phase: "REQUESTED", viewer: "MAKER", viewerLanguage: "it", languages: { buyer: "en", maker: "it" } });
    expect(m.brief.descriptionShown).toBe(`[it] ${BRIEF.description}`);
    expect(m.measurements).toMatchObject({ chestCm: 102 });
    expect(new Date(m.respondBy).getTime() - new Date(m.createdAt).getTime()).toBe(96 * HOUR);
    expect(m.actions).toEqual(expect.arrayContaining(["MESSAGE", "PROPOSE", "DECLINE"]));

    // Risposta del maestro: ferma l'orologio e arriva tradotta al cliente
    await post(s.maker.cookie, `/v1/commissions/${id}/messages`, { text: "Buongiorno, con piacere. Quando possiamo fare una videochiamata?" });
    const b = await view(s.buyer.cookie, id);
    expect(b.phase).toBe("IN_DIALOGUE");
    expect(b.firstResponseAt).not.toBeNull();
    const reply = b.messages.find((x: { kind: string; author: string }) => x.kind === "TEXT" && x.author === "MAKER");
    expect(reply).toMatchObject({ text: "[en] Buongiorno, con piacere. Quando possiamo fare una videochiamata?", translated: true, original: "Buongiorno, con piacere. Quando possiamo fare una videochiamata?" });

    // Foto privata: visibile ai due partecipanti, a nessun altro
    const up = multipartBody(TINY_PNG);
    const withImage = (await t.app.inject({ method: "POST", url: `/v1/commissions/${id}/images`, payload: up.payload, headers: up.headers, ...as(s.buyer.cookie) })).json();
    const image = withImage.messages.at(-1).image as string;
    expect((await t.app.inject({ method: "GET", url: image, ...as(s.maker.cookie) })).headers["content-type"]).toBe("image/png");
    const stranger = await activeAccount(t);
    expect((await t.app.inject({ method: "GET", url: image, ...as(stranger.cookie) })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "GET", url: `/v1/commissions/${id}`, ...as(stranger.cookie) })).statusCode).toBe(404);

    // Proposta, richiesta di modifiche, nuova proposta
    const p1 = await post(s.maker.cookie, `/v1/commissions/${id}/proposals`, { description: "Abito due pezzi in lana Super 130, due prove, spalla napoletana.", priceCents: 400_000, depositPct: 50, leadTimeWeeks: 10, fittings: 2 });
    expect(p1.json().phase).toBe("PROPOSED");
    expect((await post(s.buyer.cookie, `/v1/commissions/${id}/request-changes`, { note: "Could we do it in 8 weeks?" })).json().phase).toBe("IN_DIALOGUE");
    await post(s.maker.cookie, `/v1/commissions/${id}/proposals`, { description: "Abito due pezzi in lana Super 130, due prove ravvicinate, consegna in otto settimane.", priceCents: 420_000, depositPct: 40, leadTimeWeeks: 8, fittings: 2 });
    const proposed = await view(s.buyer.cookie, id);
    expect(proposed.proposals.map((p: { status: string }) => p.status)).toEqual(["CHANGES_REQUESTED", "SENT"]);
    expect(proposed.proposals[1]).toMatchObject({ priceCents: 420_000, depositCents: 168_000, balanceCents: 252_000 });
    expect(proposed.actions).toEqual(expect.arrayContaining(["ACCEPT_PROPOSAL", "REQUEST_CHANGES", "WITHDRAW"]));

    // Accettazione con indirizzo all'estero e autorizzazione forte dell'acconto
    const bad = await post(s.buyer.cookie, `/v1/commissions/${id}/accept`, { address: { ...NY, phone: "212 555" } });
    expect(bad.json().error.fields["phone"]).toBe("phone.international");
    const accepted = (await post(s.buyer.cookie, `/v1/commissions/${id}/accept`, { address: NY })).json();
    expect(accepted.order.totalCents).toBe(168_000);
    expect((await view(s.buyer.cookie, id)).phase).toBe("DEPOSIT_DUE");
    expect((await authorize(s.buyer.cookie, accepted)).json().status).toBe("PAID");
    m = await view(s.maker.cookie, id);
    expect(m.phase).toBe("DEPOSIT_PAID");
    expect(m.actions).toContain("START_WORK");
    expect(m.messages.some((x: { event: string }) => x.event === "DEPOSIT_PAID")).toBe(true);

    // Le tappe non si muovono dalle pagine degli ordini dal catalogo
    expect((await post(s.maker.cookie, `/v1/orders/${accepted.order.id}/accept`)).statusCode).toBe(409);
    expect((await t.app.inject({ method: "GET", url: "/v1/orders", ...as(s.buyer.cookie) })).json().orders).toHaveLength(0);

    // Inizio lavorazione: acconto accreditato alla Maison, il cliente non può più ritirarsi
    await post(s.maker.cookie, `/v1/commissions/${id}/start-work`);
    expect(t.payments.calls.filter((c) => c.op === "payout").map((c) => c.amountCents)).toEqual([168_000 - 16_800]);
    expect((await post(s.buyer.cookie, `/v1/commissions/${id}/withdraw`)).statusCode).toBe(409);
    await post(s.maker.cookie, `/v1/commissions/${id}/fittings`, { note: "Prima prova in videochiamata il 3 marzo" });

    // Saldo, spedizione, consegna
    await post(s.maker.cookie, `/v1/commissions/${id}/request-balance`);
    const balance = (await post(s.buyer.cookie, `/v1/commissions/${id}/pay-balance`)).json();
    expect(balance.order.totalCents).toBe(252_000);
    await authorize(s.buyer.cookie, balance);
    expect((await view(s.maker.cookie, id)).phase).toBe("BALANCE_PAID");
    const shipped = (await post(s.maker.cookie, `/v1/commissions/${id}/ship`, { carrier: "DHL Express", trackingCode: "JD0146000000" })).json();
    expect(shipped.phase).toBe("SHIPPED");
    expect(shipped.balance.autoReleaseAt).not.toBeNull();
    const done = (await post(s.buyer.cookie, `/v1/commissions/${id}/confirm-delivery`)).json();
    expect(done.phase).toBe("COMPLETED");
    expect(t.payments.calls.filter((c) => c.op === "payout").map((c) => c.amountCents)).toEqual([151_200, 252_000 - 25_200]);

    // Elenco con fase e messaggi non letti
    const list = (await t.app.inject({ method: "GET", url: "/v1/commissions", ...as(s.maker.cookie) })).json();
    expect(list.commissions[0]).toMatchObject({ id, phase: "COMPLETED", garment: "SUIT_2", answered: true });
  });

  it("senza risposta entro 96 ore la richiesta si chiude e si avvisano entrambi", async () => {
    const s = await setup();
    const { id } = (await request(s.buyer.cookie, s.maisonId)).json();
    t.clock.offsetMs = 95 * HOUR;
    expect(await t.app.atelier.expireOverdue()).toBe(0);
    t.clock.offsetMs = 97 * HOUR;
    expect(await t.app.atelier.expireOverdue()).toBe(1);
    // Le sessioni di prova sono scadute nel frattempo: si controlla direttamente lo stato.
    expect((await t.pool.query("select status from commissions where id = $1", [id])).rows[0].status).toBe("EXPIRED");
    expect(t.notifier.lastEmailTo(s.buyer.payload.email)!.subject).toMatch(/closed/);
    expect(t.notifier.lastEmailTo(s.maker.payload.email)!.subject).toMatch(/scaduta/);
    t.clock.offsetMs = 0;
    const maker = await t.app.inject({ method: "POST", url: `/v1/commissions/${id}/messages`, payload: { text: "Mi scusi il ritardo" }, ...as(s.maker.cookie) });
    expect(maker.statusCode).toBe(409);
  });

  it("ritiro prima della lavorazione: l'acconto torna per intero", async () => {
    const s = await setup();
    const { id } = (await request(s.buyer.cookie, s.maisonId)).json();
    await post(s.maker.cookie, `/v1/commissions/${id}/proposals`, { description: "Giacca monopetto in cashmere, una prova in imbastitura.", priceCents: 250_000, depositPct: 30, leadTimeWeeks: 6, fittings: 1 });
    const accepted = (await post(s.buyer.cookie, `/v1/commissions/${id}/accept`, { address: NY })).json();
    await authorize(s.buyer.cookie, accepted);
    const w = (await post(s.buyer.cookie, `/v1/commissions/${id}/withdraw`)).json();
    expect(w.phase).toBe("WITHDRAWN");
    expect(t.payments.calls.filter((c) => c.op === "refund").map((c) => c.amountCents)).toEqual([75_000]);
    expect((await post(s.maker.cookie, `/v1/commissions/${id}/start-work`)).statusCode).toBe(409);
  });

  it("solo le Maison di sartoria che lo accettano, solo i clienti", async () => {
    const s = await setup();
    await t.pool.query("update maisons set accepts_commissions = false where id = $1", [s.maisonId]);
    expect((await request(s.buyer.cookie, s.maisonId)).statusCode).toBe(404);
    await t.pool.query("update maisons set accepts_commissions = true where id = $1", [s.maisonId]);
    expect((await request(s.maker.cookie, s.maisonId)).json().error.code).toBe("COMMISSION_BUYERS_ONLY");
    const pub = (await t.app.inject({ method: "GET", url: `/v1/maisons/${(await t.pool.query("select slug from maisons where id = $1", [s.maisonId])).rows[0].slug}` })).json();
    expect(pub.acceptsCommissions).toBe(true);
  });
});

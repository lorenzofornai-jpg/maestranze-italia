import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deviceMessages } from "@maestranze/shared";
import { SESSION_COOKIE } from "../src/app";
import { activeAccount, approveMaison, makeAdmin, pairPhone, setupApp, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await setupApp();
});
afterEach(async () => {
  await t.close();
});

const as = (c: string) => ({ cookies: { [SESSION_COOKIE]: c } });
const ADDRESS = { name: "Trattoria del Borgo", street: "Via dei Neri 12", zip: "50122", city: "Firenze", province: "FI", phone: "3331234567" };

/** Maison con due prodotti: una giacca su commissione (22%) e un formaggio a magazzino (4%). */
async function shop(min?: number) {
  const m = await approveMaison(t, { name: "Bottega Prova", b2bMinOrderCents: min ?? null });
  await t.pool.query("update products set vat_rate_bps = 2200 where id = $1", [m.productId]);
  const cheese = await t.app.inject({
    method: "POST",
    url: "/v1/me/products",
    payload: {
      name: { it: "Pecorino stagionato" },
      description: { it: "Pecorino di latte crudo stagionato dodici mesi in grotta." },
      priceCents: 2080, // IVA inclusa
      b2bPriceCents: 1500, // netto
      unit: "KG",
      stock: 10,
      vatRateBps: 400,
    },
    ...as(m.maker.cookie),
  });
  return { ...m, cheeseId: cheese.json().id as string };
}

async function placeOrder(buyerCookie: string, maisonId: string, items: { productId: string; qty: number }[]) {
  return t.app.inject({ method: "POST", url: "/v1/orders", payload: { maisonId, items, shippingAddress: ADDRESS }, ...as(buyerCookie) });
}

/** Crea l'ordine e lo autorizza con il codice SMS: restituisce l'ordine pagato. */
async function paidOrder(buyer: { cookie: string; payload: { phone: string } }, maisonId: string, items: { productId: string; qty: number }[]) {
  const created = (await placeOrder(buyer.cookie, maisonId, items)).json();
  const { id } = created.order;
  const { authToken } = created.authorization;
  await t.app.inject({ method: "POST", url: `/v1/orders/${id}/authorize/sms`, payload: { authToken }, ...as(buyer.cookie) });
  const code = t.notifier.smss.at(-1)!.code;
  const paid = await t.app.inject({ method: "POST", url: `/v1/orders/${id}/authorize/verify`, payload: { authToken, method: "SMS", code }, ...as(buyer.cookie) });
  return paid.json();
}

describe("prezzi e preventivo", () => {
  it("privato: listino IVA inclusa, IVA scorporata per aliquota", async () => {
    const s = await shop();
    const priv = await activeAccount(t, { subjectType: "PERSON", fiscalCode: "RSSMRA85T10A562S", sector: "PRIVATE" });
    const q = (await t.app.inject({ method: "POST", url: "/v1/orders/quote", payload: { maisonId: s.maisonId, items: [{ productId: s.cheeseId, qty: 2 }], shippingAddress: ADDRESS }, ...as(priv.cookie) })).json();
    expect(q).toMatchObject({ professional: false, totalCents: 4160, subtotalCents: 4000, vatCents: 160, commissionCents: 416, payoutCents: 3744 });
  });

  it("professionale: prezzo riservato netto + IVA, ordine minimo della Maison", async () => {
    const s = await shop(10_000);
    const pro = await activeAccount(t);
    const below = await t.app.inject({ method: "POST", url: "/v1/orders/quote", payload: { maisonId: s.maisonId, items: [{ productId: s.cheeseId, qty: 2 }], shippingAddress: ADDRESS }, ...as(pro.cookie) });
    expect(below.json().error).toMatchObject({ code: "ORDER_BELOW_MINIMUM", minimumCents: 10_000 });
    const q = (await t.app.inject({ method: "POST", url: "/v1/orders/quote", payload: { maisonId: s.maisonId, items: [{ productId: s.cheeseId, qty: 8 }], shippingAddress: ADDRESS }, ...as(pro.cookie) })).json();
    expect(q).toMatchObject({ professional: true, subtotalCents: 12_000, vatCents: 480, totalCents: 12_480 });
  });

  it("controlla disponibilità, minimi, indirizzo e chi può ordinare", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const r = await placeOrder(buyer.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 11 }]);
    expect(r.json().error.fields["items.0"]).toBe("order.out_of_stock");
    const bad = await t.app.inject({ method: "POST", url: "/v1/orders", payload: { maisonId: s.maisonId, items: [{ productId: s.cheeseId, qty: 1 }], shippingAddress: { ...ADDRESS, zip: "123" } }, ...as(buyer.cookie) });
    expect(bad.json().error.fields["shippingAddress.zip"]).toBe("address.zip");
    const maker = await placeOrder(s.maker.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 1 }]);
    expect(maker.json().error.code).toBe("ORDER_BUYERS_ONLY");
  });
});

describe("autorizzazione del pagamento (SCA)", () => {
  it("SMS con importo e beneficiario; dopo la conferma i fondi sono in custodia", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const created = (await placeOrder(buyer.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 4 }])).json();
    expect(created.order).toMatchObject({ status: "AWAITING_AUTHORIZATION", totalCents: 6240, actions: ["AUTHORIZE", "CANCEL"] });
    expect(created.order.commissionCents).toBeUndefined(); // il cliente non vede la commissione
    expect(created.authorization.methods).toEqual(["SMS"]);

    await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/sms`, payload: { authToken: created.authorization.authToken }, ...as(buyer.cookie) });
    expect(t.notifier.smss.at(-1)!.text).toMatch(/62,40\s€ a Bottega Prova/);

    const paid = await t.app.inject({
      method: "POST",
      url: `/v1/orders/${created.order.id}/authorize/verify`,
      payload: { authToken: created.authorization.authToken, method: "SMS", code: t.notifier.smss.at(-1)!.code },
      ...as(buyer.cookie),
    });
    expect(paid.json()).toMatchObject({ status: "PAID", actions: ["CANCEL"] });
    expect(t.payments.calls).toEqual([{ op: "charge", amountCents: 6240, ref: expect.any(String) }]);
    const stock = await t.pool.query("select stock from products where id = $1", [s.cheeseId]);
    expect(stock.rows[0].stock).toBe(6);
    expect(t.notifier.lastEmailTo(s.maker.payload.email)?.subject).toMatch(/^Nuovo ordine MI-/);
  });

  it("una sfida di pagamento non apre sessioni e una di accesso non autorizza pagamenti", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const created = (await placeOrder(buyer.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 1 }])).json();
    const { authToken } = created.authorization;
    await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/sms`, payload: { authToken }, ...as(buyer.cookie) });
    const code = t.notifier.smss.at(-1)!.code;
    const asLogin = await t.app.inject({ method: "POST", url: "/v1/auth/mfa/verify", payload: { loginToken: authToken, method: "SMS", code } });
    expect(asLogin.json().error.code).toBe("CHALLENGE_EXPIRED");

    const { loginToken } = (await t.app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: buyer.payload.email, password: buyer.payload.password } })).json();
    await t.app.inject({ method: "POST", url: "/v1/auth/mfa/sms", payload: { loginToken } });
    const loginCode = t.notifier.smss.at(-1)!.code;
    const asPayment = await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/verify`, payload: { authToken: loginToken, method: "SMS", code: loginCode }, ...as(buyer.cookie) });
    expect(asPayment.json().error.code).toBe("CHALLENGE_EXPIRED");
  });

  it("un altro cliente non vede né autorizza l'ordine", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const other = await activeAccount(t);
    const created = (await placeOrder(buyer.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 1 }])).json();
    expect((await t.app.inject({ method: "GET", url: `/v1/orders/${created.order.id}`, ...as(other.cookie) })).statusCode).toBe(404);
    const r = await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/sms`, payload: { authToken: created.authorization.authToken }, ...as(other.cookie) });
    expect(r.statusCode).toBe(404);
  });

  it("approvazione dall'app: la richiesta mostra importo e beneficiario", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const phone = await pairPhone(t, buyer.cookie);
    const created = (await placeOrder(buyer.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 1 }])).json();
    const { authToken } = created.authorization;
    expect(created.authorization.methods).toEqual(["MOBILE_APP", "SMS"]);
    await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/push`, payload: { authToken }, ...as(buyer.cookie) });
    expect(t.notifier.pushes.at(-1)).toMatchObject({ title: "Autorizza il pagamento", body: expect.stringMatching(/15,60\s€ a Bottega Prova/) });

    const ts = Date.now();
    const [a] = (await t.app.inject({ method: "POST", url: "/v1/device/approvals", payload: { deviceId: phone.deviceId, timestamp: ts, signature: phone.sign(deviceMessages.pending(phone.deviceId, ts)) } })).json().approvals;
    expect(a).toMatchObject({ purpose: "TRANSACTION", details: { amountCents: 1560, payee: "Bottega Prova", orderNumber: created.order.number } });
    await t.app.inject({ method: "POST", url: "/v1/device/approvals/respond", payload: { deviceId: phone.deviceId, challengeId: a.id, decision: "APPROVE", signature: phone.sign(deviceMessages.respond(a.id, a.nonce, "APPROVE")) } });
    const done = await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/poll`, payload: { authToken }, ...as(buyer.cookie) });
    expect(done.json()).toMatchObject({ status: "APPROVED", order: { status: "PAID" } });
  });

  it("pagamento rifiutato dalla banca: l'ordine resta da autorizzare e la merce torna disponibile", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    t.payments.failNextCharge = true;
    const created = (await placeOrder(buyer.cookie, s.maisonId, [{ productId: s.cheeseId, qty: 3 }])).json();
    await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/sms`, payload: { authToken: created.authorization.authToken }, ...as(buyer.cookie) });
    const r = await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize/verify`, payload: { authToken: created.authorization.authToken, method: "SMS", code: t.notifier.smss.at(-1)!.code }, ...as(buyer.cookie) });
    expect(r.json().error.code).toBe("PAYMENT_FAILED");
    expect((await t.pool.query("select stock from products where id = $1", [s.cheeseId])).rows[0].stock).toBe(10);
    const again = await t.app.inject({ method: "POST", url: `/v1/orders/${created.order.id}/authorize`, payload: {}, ...as(buyer.cookie) });
    expect(again.json().authToken).toBeTruthy();
  });
});

describe("custodia, consegna e accredito", () => {
  it("accettazione, spedizione, conferma: accredito al netto della commissione", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const order = await paidOrder(buyer, s.maisonId, [{ productId: s.cheeseId, qty: 5 }]);
    const makerView = (await t.app.inject({ method: "GET", url: `/v1/orders/${order.id}`, ...as(s.maker.cookie) })).json();
        // Cliente professionale: 5 × 15,00 € netti + IVA 4% = 78,00 €; commissione 10%.
    expect(makerView).toMatchObject({ actions: ["ACCEPT", "DECLINE"], totalCents: 7800, commissionCents: 780, payoutCents: 7020 });

    await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/accept`, payload: {}, ...as(s.maker.cookie) });
    const noTracking = await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/ship`, payload: { carrier: "BRT" }, ...as(s.maker.cookie) });
    expect(noTracking.json().error.fields.trackingCode).toBe("shipping.tracking_required");
    const shipped = (await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/ship`, payload: { carrier: "BRT", trackingCode: "BRT123456789" }, ...as(s.maker.cookie) })).json();
    expect(shipped.status).toBe("SHIPPED");
    expect(t.notifier.lastEmailTo(buyer.payload.email)?.subject).toMatch(/spedito/);

    const done = (await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/confirm-delivery`, payload: {}, ...as(buyer.cookie) })).json();
    expect(done.status).toBe("COMPLETED");
    expect(t.payments.calls.map((c) => [c.op, c.amountCents])).toEqual([["charge", 7800], ["payout", 7020]]);
    const ledger = await t.pool.query("select kind, amount_cents from ledger_entries where order_id = $1 order by kind", [order.id]);
    expect(ledger.rows).toEqual([
      { kind: "CHARGE", amount_cents: 7800 },
      { kind: "COMMISSION", amount_cents: 780 },
      { kind: "PAYOUT", amount_cents: 7020 },
    ]);
    expect(done.events.map((e: { status: string }) => e.status)).toEqual(["AWAITING_AUTHORIZATION", "PAID", "ACCEPTED", "SHIPPED", "DELIVERED", "COMPLETED"]);
  });

  it("la Maison rifiuta: rimborso integrale e merce di nuovo disponibile", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const order = await paidOrder(buyer, s.maisonId, [{ productId: s.cheeseId, qty: 4 }]);
    const r = (await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/decline`, payload: { note: "Forme non ancora pronte" }, ...as(s.maker.cookie) })).json();
    expect(r.status).toBe("CANCELLED");
    expect(t.payments.calls.at(-1)).toMatchObject({ op: "refund", amountCents: order.totalCents });
    expect((await t.pool.query("select stock from products where id = $1", [s.cheeseId])).rows[0].stock).toBe(10);
  });

  it("il cliente annulla prima che la Maison accetti", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const order = await paidOrder(buyer, s.maisonId, [{ productId: s.cheeseId, qty: 1 }]);
    expect((await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/cancel`, payload: {}, ...as(buyer.cookie) })).json().status).toBe("CANCELLED");
    await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/accept`, payload: {}, ...as(s.maker.cookie) });
    expect((await t.app.inject({ method: "GET", url: `/v1/orders/${order.id}`, ...as(s.maker.cookie) })).json().status).toBe("CANCELLED");
  });

  it("senza segnalazioni, i fondi si rilasciano da soli dopo 14 giorni dalla spedizione", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const order = await paidOrder(buyer, s.maisonId, [{ productId: s.cheeseId, qty: 1 }]);
    await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/accept`, payload: {}, ...as(s.maker.cookie) });
    await t.app.inject({ method: "POST", url: `/v1/orders/${order.id}/ship`, payload: { carrier: "Poste", trackingCode: "PT0001" }, ...as(s.maker.cookie) });
    expect(await t.app.orders.autoRelease()).toBe(0);
    t.clock.offsetMs = 15 * 24 * 60 * 60 * 1000;
    expect(await t.app.orders.autoRelease()).toBe(1);
    t.clock.offsetMs = 0;
    expect((await t.app.inject({ method: "GET", url: `/v1/orders/${order.id}`, ...as(buyer.cookie) })).json().status).toBe("COMPLETED");
  });

  it("controversia: lo staff rimborsa o rilascia", async () => {
    const s = await shop();
    const buyer = await activeAccount(t);
    const staff = await activeAccount(t);
    await makeAdmin(t, staff.payload.email);

    const a = await paidOrder(buyer, s.maisonId, [{ productId: s.cheeseId, qty: 1 }]);
    await t.app.inject({ method: "POST", url: `/v1/orders/${a.id}/accept`, payload: {}, ...as(s.maker.cookie) });
    const short = await t.app.inject({ method: "POST", url: `/v1/orders/${a.id}/dispute`, payload: { note: "rotto" }, ...as(buyer.cookie) });
    expect(short.json().error.fields.note).toBe("dispute.note_required");
    await t.app.inject({ method: "POST", url: `/v1/orders/${a.id}/dispute`, payload: { note: "Forma arrivata ammuffita e senza crosta." }, ...as(buyer.cookie) });
    expect((await t.app.inject({ method: "GET", url: "/v1/orders", ...as(staff.cookie) })).json().disputes).toHaveLength(1);
    expect((await t.app.inject({ method: "POST", url: `/v1/orders/${a.id}/resolve`, payload: { decision: "REFUND" }, ...as(buyer.cookie) })).statusCode).toBe(403);
    const refunded = (await t.app.inject({ method: "POST", url: `/v1/orders/${a.id}/resolve`, payload: { decision: "REFUND", note: "Foto ricevute" }, ...as(staff.cookie) })).json();
    expect(refunded.status).toBe("REFUNDED");

    const b = await paidOrder(buyer, s.maisonId, [{ productId: s.cheeseId, qty: 1 }]);
    await t.app.inject({ method: "POST", url: `/v1/orders/${b.id}/accept`, payload: {}, ...as(s.maker.cookie) });
    await t.app.inject({ method: "POST", url: `/v1/orders/${b.id}/dispute`, payload: { note: "Non ancora arrivato dopo tre settimane." }, ...as(buyer.cookie) });
    const released = (await t.app.inject({ method: "POST", url: `/v1/orders/${b.id}/resolve`, payload: { decision: "RELEASE" }, ...as(staff.cookie) })).json();
    expect(released.status).toBe("COMPLETED");
  });
});

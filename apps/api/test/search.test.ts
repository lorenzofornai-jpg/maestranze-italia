import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { interpretWithRules } from "../src/search/interpret";
import { approveMaison, setupApp, type TestApp } from "./helpers";

let t: TestApp;
beforeEach(async () => {
  t = await setupApp();
});
afterEach(async () => {
  await t.close();
});

const get = async (url: string) => (await t.app.inject({ method: "GET", url })).json();

describe("interpretazione delle richieste (regole)", () => {
  it("riconosce disciplina, zona storica e parole chiave", () => {
    const r = interpretWithRules("Cerco un caseificio in Irpinia per 40 kg al mese di fiordilatte per il mio ristorante");
    expect(r.filters).toMatchObject({ discipline: "FOOD", province: "AV", region: "Campania" });
    expect(r.filters.q).toContain("fiordilatte");
    expect(r.filters.q).not.toMatch(/\d|ristorant/);
    expect(r.professional).toBe(true);
  });

  it("riconosce province e regioni, senza accenti", () => {
    expect(interpretWithRules("grappa dal Friuli-Venezia Giulia").filters).toMatchObject({ discipline: "BEVERAGE", region: "Friuli-Venezia Giulia" });
    expect(interpretWithRules("giacca su misura a Napoli").filters).toMatchObject({ discipline: "TAILORING", province: "NA" });
    expect(interpretWithRules("ceramiche dell'Umbria per hotel").professional).toBe(true);
  });
});

describe("esplorazione", () => {
  it("trova le Maison per testo, territorio e disciplina, con faccette", async () => {
    await approveMaison(t, { name: "Sartoria Partenopea", province: "NA", city: "Napoli", discipline: "TAILORING" });
    await approveMaison(t, {
      name: "Caseificio del Laceno",
      province: "AV",
      city: "Bagnoli Irpino",
      discipline: "FOOD",
      tagline: { it: "Caciocavallo e fiordilatte di montagna" },
      story: { it: "Latte crudo di vacche podoliche lavorato ogni mattina e stagionato in grotte di tufo, come si faceva sessant'anni fa sull'altopiano." },
    });

    const all = await get("/v1/maisons");
    expect(all.total).toBe(2);
    expect(all.facets.regions).toEqual([{ region: "Campania", count: 2 }]);

    const cheese = await get("/v1/maisons?q=fiordilatte");
    expect(cheese.results.map((m: { name: string }) => m.name)).toEqual(["Caseificio del Laceno"]);
    // Frase lunga: nessuna Maison ha tutte le parole, si allarga ad almeno una.
    const wide = await get("/v1/maisons?q=caseificio%20mozzarella%20burrata");
    expect(wide).toMatchObject({ relaxed: true, total: 1 });
    // Plurali e forme che lo stemmer non unifica: «caseifici» trova «caseificio».
    expect((await get("/v1/maisons?q=caseifici")).total).toBe(1);
    // Inglese e accenti
    expect((await get("/v1/maisons?q=Napoli")).total).toBe(1);
    expect((await get("/v1/maisons?province=AV")).total).toBe(1);
    expect((await get("/v1/maisons?discipline=TAILORING&region=Campania")).results[0].productCount).toBe(1);
    // Filtri non validi ignorati, non errori
    expect((await get("/v1/maisons?province=ZZ&discipline=NOPE")).total).toBe(2);

    const tree = (await get("/v1/territories")).territories;
    expect(tree).toEqual([
      {
        region: "Campania",
        count: 2,
        provinces: [
          { code: "AV", name: "Avellino", count: 1, cities: [{ city: "Bagnoli Irpino", count: 1 }] },
          { code: "NA", name: "Napoli", count: 1, cities: [{ city: "Napoli", count: 1 }] },
        ],
      },
    ]);
  });

  it("le Maison non selezionate non compaiono", async () => {
    expect((await get("/v1/maisons")).total).toBe(0);
  });

  it("l'interpretazione risponde con filtri e spiegazione", async () => {
    const r = await t.app.inject({ method: "POST", url: "/v1/search/interpret", payload: { query: "vino rosso dalla Toscana" } });
    expect(r.json()).toMatchObject({ source: "rules", filters: { discipline: "BEVERAGE", region: "Toscana" } });
    expect((await t.app.inject({ method: "POST", url: "/v1/search/interpret", payload: { query: "" } })).statusCode).toBe(400);
  });
});

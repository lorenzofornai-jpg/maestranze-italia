import { afterEach, describe, expect, it } from "vitest";
import type { ConciergeModel } from "../src/concierge/service";
import { SESSION_COOKIE } from "../src/app";
import { activeAccount, approveMaison, setupApp, type TestApp } from "./helpers";

let t: TestApp;
afterEach(async () => {
  await t?.close();
});

type Block = { type: string; [k: string]: unknown };

/** Modello finto: risponde con un copione di turni e registra ciò che riceve. */
function scripted(turns: { text?: string; tools?: { name: string; input: unknown }[] }[]) {
  const seen: unknown[][] = [];
  const systems: string[] = [];
  let i = 0;
  const model: ConciergeModel = {
    enabled: true,
    async turn(input, onText) {
      seen.push(JSON.parse(JSON.stringify(input.messages)));
      systems.push(input.system);
      const step = turns[i++] ?? { text: "…" };
      const content: Block[] = [{ type: "thinking", thinking: "", signature: `sig-${i}` }];
      if (step.text) {
        for (const w of step.text.split(" ")) onText(w + " ");
        content.push({ type: "text", text: step.text });
      }
      for (const [k, tool] of (step.tools ?? []).entries()) content.push({ type: "tool_use", id: `tu_${i}_${k}`, name: tool.name, input: tool.input });
      return { content, stop_reason: step.tools?.length ? "tool_use" : "end_turn" };
    },
  };
  return { model, seen, systems };
}

const lines = (body: string) => body.trim().split("\n").map((l) => JSON.parse(l));

describe("il Concierge", () => {
  it("cerca, legge la Maison, prepara il brief; storia e bozze restano sul server", async () => {
    const { model, seen } = scripted([
      { text: "Sono il Concierge di Maestranze, un assistente automatico. Vediamo le sartorie.", tools: [{ name: "search_maisons", input: { keywords: "giacca", discipline: "TAILORING" } }] },
      { tools: [{ name: "maison_details", input: { slug: "sartoria-partenopea" } }] },
      { tools: [{ name: "draft_bespoke_brief", input: { slug: "sartoria-partenopea", garment: "SUIT_2", occasion: "WEDDING", description: "Un abito per le mie nozze a giugno.", country: "us" } }] },
      { text: "Ho preparato la bozza: la rilegga e la invii quando desidera." },
    ]);
    t = await setupApp({ concierge: model });
    const m = await approveMaison(t);
    await t.pool.query("update maisons set accepts_commissions = true where id = $1", [m.maisonId]);

    expect((await t.app.inject({ method: "GET", url: "/v1/concierge/status" })).json()).toEqual({ enabled: true });
    const res = await t.app.inject({ method: "POST", url: "/v1/concierge", payload: { text: "Cerco un abito per il mio matrimonio", locale: "it" } });
    expect(res.headers["content-type"]).toMatch(/ndjson/);
    const events = lines(res.body);
    const sessionId = events[0].sessionId as string;
    expect(events[0].type).toBe("session");
    expect(events.filter((e) => e.type === "text").map((e) => e.delta).join("")).toContain("assistente automatico");
    const items = events.filter((e) => e.type === "item").map((e) => e.item);
    expect(items[0]).toMatchObject({ kind: "maisons", maisons: [{ slug: "sartoria-partenopea", acceptsCommissions: true }] });
    expect(items[1]).toMatchObject({ kind: "draft", draft: { maison: { slug: "sartoria-partenopea" }, brief: { garment: "SUIT_2", country: "US" } } });
    expect(events.at(-1)).toEqual({ type: "done" });

    // Il modello riceve i blocchi del turno precedente invariati (pensiero compreso) e i risultati degli strumenti
    const second = seen[1] as { role: string; content: Block[] | string }[];
    expect((second[1]!.content as Block[])[0]).toMatchObject({ type: "thinking", signature: "sig-1" });
    const result = JSON.parse(((second[2]!.content as Block[])[0] as unknown as { content: string }).content);
    expect(result.maisons[0]).toMatchObject({ slug: "sartoria-partenopea", acceptsCommissions: true });
    const details = JSON.parse((((seen[2] as { content: Block[] }[])[4]!.content)[0] as unknown as { content: string }).content);
    expect(details.products.length).toBeGreaterThan(0);

    // La pagina ritrova la conversazione; la bozza si apre dalla richiesta su misura
    const saved = (await t.app.inject({ method: "GET", url: `/v1/concierge/sessions/${sessionId}` })).json();
    expect(saved.items.map((x: { kind: string }) => x.kind)).toEqual(["guest", "concierge", "maisons", "draft", "concierge"]);
    const draftId = items[1].draft.id;
    expect((await t.app.inject({ method: "GET", url: `/v1/concierge/sessions/${sessionId}/drafts/${draftId}` })).json().brief.description).toBe("Un abito per le mie nozze a giugno.");

    // Seconda battuta nella stessa conversazione: la storia continua
    await t.app.inject({ method: "POST", url: "/v1/concierge", payload: { text: "Grazie", sessionId } });
    expect((seen.at(-1) as unknown[]).length).toBe(9); // 8 della prima battuta + la nuova domanda
  });

  it("il Concierge sa se l'ospite ha fatto l'accesso, e chi è", async () => {
    const { model, systems } = scripted([{ text: "Buonasera." }, { text: "Bentornata." }]);
    t = await setupApp({ concierge: model });
    const res = await t.app.inject({ method: "POST", url: "/v1/concierge", payload: { text: "Buonasera" } });
    expect(systems[0]).toMatch(/not signed in/);
    const a = await activeAccount(t, { subjectType: "PERSON", fiscalCode: "RSSMRA85T10A562S", sector: "PRIVATE" });
    // Accedendo, la conversazione cominciata da ospite continua e passa al profilo
    const sessionId = lines(res.body)[0].sessionId;
    await t.app.inject({ method: "POST", url: "/v1/concierge", payload: { text: "Eccomi", sessionId }, cookies: { [SESSION_COOKIE]: a.cookie } });
    expect(systems[1]).toMatch(/signed in as a private client; first name Giulia/);
    expect((await t.app.inject({ method: "GET", url: `/v1/concierge/sessions/${sessionId}` })).statusCode).toBe(404);
  });

  it("una conversazione legata a un profilo non si apre da altri", async () => {
    const { model } = scripted([{ text: "Buonasera." }]);
    t = await setupApp({ concierge: model });
    const a = await activeAccount(t);
    const res = await t.app.inject({ method: "POST", url: "/v1/concierge", payload: { text: "Buonasera" }, cookies: { [SESSION_COOKIE]: a.cookie } });
    const sessionId = lines(res.body)[0].sessionId;
    expect((await t.app.inject({ method: "GET", url: `/v1/concierge/sessions/${sessionId}`, cookies: { [SESSION_COOKIE]: a.cookie } })).statusCode).toBe(200);
    expect((await t.app.inject({ method: "GET", url: `/v1/concierge/sessions/${sessionId}` })).statusCode).toBe(404);
  });

  it("senza chiave LLM il Concierge risponde che non è disponibile", async () => {
    t = await setupApp();
    expect((await t.app.inject({ method: "GET", url: "/v1/concierge/status" })).json()).toEqual({ enabled: false });
    const r = await t.app.inject({ method: "POST", url: "/v1/concierge", payload: { text: "Buonasera" } });
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe("CONCIERGE_UNAVAILABLE");
  });
});

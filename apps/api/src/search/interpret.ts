import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  DISCIPLINES,
  PROVINCE_CODES,
  REGIONS,
  normalizeText,
  regionOf,
  searchFiltersSchema,
  type Discipline,
  type Interpretation,
} from "@maestranze/shared";

/**
 * Interpreta una richiesta in linguaggio naturale («cerco un caseificio in Irpinia per 40 kg al mese
 * di fiordilatte») e la trasforma in filtri di esplorazione.
 *
 * Due strategie: le regole (sempre disponibili, nessun costo) e l'LLM (se configurato), che capisce
 * meglio sinonimi, zone storiche e richieste articolate. Se l'LLM non risponde si torna alle regole.
 */
export interface Interpreter {
  interpret(query: string): Promise<Interpretation>;
}

// --- Regole -----------------------------------------------------------------------------------

const DISCIPLINE_WORDS: Record<Discipline, string[]> = {
  FOOD: ["formagg", "caseific", "mozzarell", "fiordilatte", "ricott", "pecorin", "salum", "prosciut", "olio", "frantoi", "pasta", "pastific", "pane", "forno", "miele", "tartuf", "aceto", "conserv", "cioccolat", "dolc", "cheese", "oil", "ham", "honey", "truffle", "bakery"],
  BEVERAGE: ["vin", "cantin", "brunell", "barol", "prosecc", "spumant", "grapp", "distiller", "liquor", "amaro", "birr", "caff", "wine", "winery", "spirit", "beer", "coffee"],
  TAILORING: ["sartori", "sarto", "giacc", "abit", "camici", "cravatt", "tessut", "lana", "seta", "lino", "divis", "lanifici", "tailor", "suit", "jacket", "shirt", "fabric", "wool", "silk", "uniform"],
  SPORT: ["sport", "sci", "bici", "bicicl", "vela", "golf", "equitazion", "sell", "cuoio", "zain", "montagn", "ski", "bike", "sailing", "saddle", "leather"],
  CRAFTS: ["ceramic", "maiolic", "vetro", "murano", "legno", "intagli", "ferro battut", "marmo", "orafo", "gioiell", "argent", "mobil", "tappet", "ceramics", "glass", "wood", "marble", "jewel", "furniture"],
};

/** Zone storiche e gastronomiche che non coincidono con una provincia. */
const AREAS: Record<string, string> = {
  irpinia: "AV",
  sannio: "BN",
  cilento: "SA",
  "costiera amalfitana": "SA",
  langhe: "CN",
  roero: "CN",
  monferrato: "AT",
  franciacorta: "BS",
  valtellina: "SO",
  brianza: "MB",
  chianti: "SI",
  maremma: "GR",
  "val d'orcia": "SI",
  montalcino: "SI",
  salento: "LE",
  murgia: "BA",
  "valle d'itria": "BR",
  carnia: "UD",
  collio: "GO",
  "val di non": "TN",
  "alto adige": "BZ",
  "sudtirol": "BZ",
  ciociaria: "FR",
  tuscia: "VT",
  "riviera ligure": "GE",
  barbagia: "NU",
  gallura: "SS",
  etna: "CT",
  "val di noto": "SR",
  biellese: "BI",
};

const PROFESSIONAL = /\b(ristorant|hotel|albergh|trattori|osteri|bar\b|forniture|fornitura|al mese|settiman|ingrosso|horeca|chef|catering|azienda|aziendal|restaurant|supply|wholesale|monthly|weekly)/;

const STOPWORDS = new Set(
  "ristorante ristoranti hotel albergo alberghi trattoria osteria catering azienda aziende fornitura forniture fornitore fornitori ingrosso chef cucina restaurant restaurants supply supplier wholesale company cerco cerchiamo vorrei voglio serve servono per il lo la i gli le un uno una di da in con su tra fra del della dei delle degli al alla ai alle dal dalla nel nella e o che a mio mia miei nostro nostra kg chili litri pezzi mese settimana anno circa almeno qualche buon buona ottimo ottima produttore produttori artigiano artigiani italia italiano italiana i'm looking for we need need want a an the of from in with to for my our per month week kg about some good producer producers maker makers italy italian".split(
    " ",
  ),
);

export function interpretWithRules(query: string): Interpretation {
  const text = normalizeText(query);
  let discipline: Discipline | undefined;
  for (const d of DISCIPLINES) {
    if (DISCIPLINE_WORDS[d].some((w) => new RegExp(`\\b${w}`).test(text))) {
      discipline = d;
      break;
    }
  }

  let province: string | undefined;
  let region: string | undefined;
  const consumed: string[] = [];
  // Prima le zone storiche, poi le regioni (così «Friuli-Venezia Giulia» non diventa la provincia di Venezia),
  // infine le province nel testo che resta.
  for (const [area, code] of Object.entries(AREAS)) {
    if (text.includes(area)) {
      province = code;
      consumed.push(area);
      break;
    }
  }
  let scan = text;
  if (!province) {
    const hit = Object.keys(REGIONS)
      .sort((a, b) => b.length - a.length)
      .find((r) => text.includes(normalizeText(r)));
    if (hit) {
      region = hit;
      consumed.push(normalizeText(hit));
      scan = text.replace(normalizeText(hit), " ");
    }
  }
  if (!province) {
    for (const list of Object.values(REGIONS)) {
      const hit = list.find(([, name]) => new RegExp(`\\b${normalizeText(name)}\\b`).test(scan));
      if (hit) {
        province = hit[0];
        consumed.push(normalizeText(hit[1]));
        break;
      }
    }
  }

  let rest = text;
  for (const c of consumed) rest = rest.replace(c, " ");
  const keywords = rest
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

  const filters = searchFiltersSchema.parse({
    q: keywords.slice(0, 6).join(" ") || undefined,
    discipline,
    province,
    region: province ? regionOf(province) : region,
  });
  const LABEL: Record<Discipline, [string, string]> = {
    FOOD: ["gastronomia", "food"],
    BEVERAGE: ["vini e distillati", "wine and spirits"],
    TAILORING: ["sartoria", "tailoring"],
    SPORT: ["sport", "sport"],
    CRAFTS: ["artigianato", "crafts"],
  };
  const where = filters.province
    ? Object.values(REGIONS).flat().find(([c]) => c === filters.province)?.[1]
    : filters.region;
  const d = filters.discipline ? LABEL[filters.discipline] : undefined;
  return {
    filters,
    professional: PROFESSIONAL.test(text),
    explanation: {
      it: [d && d[0], where && (filters.province ? `provincia di ${where}` : where), filters.q && `«${filters.q}»`]
        .filter(Boolean)
        .join(", "),
      en: [d && d[1], where && (filters.province ? `province of ${where}` : where), filters.q && `“${filters.q}”`].filter(Boolean).join(", "),
    },
    source: "rules",
  };
}

// --- LLM ----------------------------------------------------------------------------------------

const LlmOutput = z.object({
  discipline: z.enum(DISCIPLINES).nullable(),
  region: z.string().nullable(),
  province: z.string().nullable(),
  city: z.string().nullable(),
  keywords: z.array(z.string()),
  professional: z.boolean(),
  explanation_it: z.string(),
  explanation_en: z.string(),
});

const SYSTEM = `You turn a buyer's request on an Italian craftsmanship marketplace into search filters.
The marketplace lists "Maisons" (producers) in five disciplines: FOOD (cheese, cured meats, oil, pasta, bread, honey, truffles…), BEVERAGE (wine, spirits, grappa, beer, coffee), TAILORING (bespoke clothing, fabrics, wool, silk, uniforms), SPORT (skis, bicycles, sailing, saddlery, leather sports goods), CRAFTS (ceramics, glass, wood, marble, jewellery, furniture).

Rules:
- discipline: the single best discipline, or null if unclear.
- province: the two-letter Italian province code (e.g. AV, SI, NA) when the request names a province, a town or a historic area (Irpinia → AV, Langhe → CN, Chianti → SI, Salento → LE, Franciacorta → BS). Otherwise null.
- region: the Italian region name exactly as in this list when only a region is named, else null: ${Object.keys(REGIONS).join(", ")}.
- city: the town only if explicitly named.
- keywords: up to five product words that would appear in a producer's description, in Italian, singular (e.g. "fiordilatte", "caciocavallo", "brunello"). No quantities, no places, no generic words.
- professional: true if the buyer is a business (restaurant, hotel, company) or speaks of recurring supply.
- explanation_it / explanation_en: one short sentence each, addressed to the buyer, saying what you will look for. No marketing tone.`;

export class LlmInterpreter implements Interpreter {
  private client = new Anthropic();
  constructor(private log: (msg: string) => void = () => {}) {}

  async interpret(query: string): Promise<Interpretation> {
    try {
      const response = await this.client.beta.messages.parse({
        model: "claude-opus-5-5",
        max_tokens: 2048,
        // Compito breve e ad alta frequenza: basta uno sforzo basso, a vantaggio della latenza.
        output_config: { effort: "low", format: zodOutputFormat(LlmOutput) },
        // Se il modello declina la richiesta, l'API la ripete sul modello di riserva.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM,
        messages: [{ role: "user", content: query.slice(0, 500) }],
      });
      const out = response.stop_reason === "refusal" ? null : response.parsed_output;
      if (!out) return interpretWithRules(query);

      const province = out.province && PROVINCE_CODES.includes(out.province.toUpperCase()) ? out.province.toUpperCase() : undefined;
      const filters = searchFiltersSchema.parse({
        q: out.keywords.join(" ") || undefined,
        discipline: out.discipline ?? undefined,
        province,
        region: province ? regionOf(province) : (out.region ?? undefined),
        city: out.city ?? undefined,
      });
      return {
        filters,
        professional: out.professional,
        explanation: { it: out.explanation_it, en: out.explanation_en },
        source: "llm",
      };
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) this.log("[search] LLM: limite di richieste, uso le regole");
      else if (err instanceof Anthropic.APIError) this.log(`[search] LLM: errore ${err.status}, uso le regole`);
      else this.log(`[search] LLM non disponibile: ${(err as Error).message}`);
      return interpretWithRules(query);
    }
  }
}

export class RulesInterpreter implements Interpreter {
  async interpret(query: string) {
    return interpretWithRules(query);
  }
}

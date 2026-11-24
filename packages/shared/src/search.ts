import { z } from "zod";
import { CERTIFICATIONS, DISCIPLINES, type PublicMaison } from "./catalog";
import { PROVINCE_CODES, REGIONS } from "./territory";

/** Filtri dell'esplorazione: arrivano dall'URL, dai menu o dall'interpretazione di una frase. */
export const searchFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  discipline: z.enum(DISCIPLINES).optional().catch(undefined),
  region: z
    .string()
    .refine((v) => v in REGIONS)
    .optional()
    .catch(undefined),
  province: z
    .string()
    .toUpperCase()
    .refine((v) => PROVINCE_CODES.includes(v))
    .optional()
    .catch(undefined),
  city: z.string().trim().max(120).optional().catch(undefined),
  cert: z.enum(CERTIFICATIONS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
});
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export interface SearchResult {
  results: (PublicMaison & { productCount: number })[];
  total: number;
  page: number;
  pageSize: number;
  /** true se nessuna Maison conteneva tutte le parole e si mostrano quelle che ne contengono alcune. */
  relaxed?: boolean;
  facets: {
    regions: { region: string; count: number }[];
    disciplines: { discipline: string; count: number }[];
  };
}

export interface Territory {
  region: string;
  count: number;
  provinces: { code: string; name: string; count: number; cities: { city: string; count: number }[] }[];
}

/** Come l'LLM (o le regole) hanno letto la richiesta, da mostrare all'utente. */
export interface Interpretation {
  filters: SearchFilters;
  professional: boolean;
  explanation: { it: string; en: string };
  source: "llm" | "rules";
}

/** Toglie accenti e maiuscole: la ricerca non dipende da «città» o «citta». */
export const normalizeText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

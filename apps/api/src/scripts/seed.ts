/**
 * Dati dimostrativi: uno staff, una cliente professionale e otto Maison selezionate in regioni diverse.
 * Password di tutti gli account: Maestranze!2026 — il secondo fattore è l'SMS (codice nel log dell'API).
 *   pnpm --filter @maestranze/api db:seed
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { regionOf, slugify, type I18nText } from "@maestranze/shared";
import { loadConfig } from "../config";
import { createDb } from "../db/client";
import { accounts, maisons, mfaFactors, products } from "../db/schema";
import { hashPassword } from "../lib/crypto";
import { DiskMediaStore, storeImage } from "../lib/media";
import { SearchService } from "../search/service";

type Kind = "food" | "beverage" | "tailoring" | "sport" | "crafts";
interface SeedProduct {
  name: I18nText;
  description: I18nText;
  price: number;
  b2b?: number;
  unit?: "PIECE" | "KG" | "BOTTLE" | "CASE" | "METRE" | "SET";
  minQty?: number;
  madeToOrder?: boolean;
  stock?: number;
}
interface SeedMaison {
  name: string;
  kind: Kind;
  vat: string;
  province: string;
  city: string;
  founded: number;
  tagline: I18nText;
  story: I18nText;
  craft?: I18nText;
  certifications: string[];
  minOrder?: number;
  leadTime?: number;
  products: SeedProduct[];
}

const MAISONS: SeedMaison[] = [
  {
    name: "Caseificio Irpino",
    kind: "food",
    vat: "01234567897",
    province: "AV",
    city: "Bagnoli Irpino",
    founded: 1962,
    tagline: { it: "Latte di montagna, caglio naturale, pazienza", en: "Mountain milk, natural rennet, patience" },
    story: {
      it: "Sull'altopiano del Laceno tre famiglie di allevatori conferiscono ogni mattina il latte delle loro vacche podoliche. Lo lavoriamo a crudo, con caglio di capretto, e lo lasciamo stagionare nelle grotte di tufo come si faceva sessant'anni fa.\n\nIl nostro caciocavallo impiccato riposa almeno novanta giorni: è il tempo che serve perché la pasta diventi compatta e profumata di fieno.",
      en: "On the Laceno plateau three farming families bring us the milk of their Podolica cows every morning. We work it raw, with kid rennet, and age it in tuff caves as we did sixty years ago.",
    },
    craft: { it: "Filatura a mano in acqua a 85 gradi, legatura con rafia, stagionatura in grotta.", en: "Hand-stretched in water at 85 degrees, tied with raffia, cave-aged." },
    certifications: ["SLOW_FOOD", "MADE_IN_ITALY_100"],
    minOrder: 30000,
    leadTime: 4,
    products: [
      { name: { it: "Caciocavallo podolico 90 giorni", en: "Podolica caciocavallo, 90 days" }, description: { it: "Pasta filata da latte crudo di vacca podolica, stagionato in grotta. Forma da circa 1,5 kg.", en: "Raw Podolica cow's milk stretched-curd cheese, cave-aged. About 1.5 kg." }, price: 4200, b2b: 3200, unit: "KG", minQty: 1 },
      { name: { it: "Ricotta di pecora fresca", en: "Fresh sheep's ricotta" }, description: { it: "Dal siero del pecorino, in fuscella di giunco. Consegna entro 48 ore dalla produzione.", en: "From pecorino whey, in a rush basket. Delivered within 48 hours." }, price: 1400, b2b: 1000, unit: "KG", minQty: 2 },
      { name: { it: "Pecorino di Carmasciano", en: "Carmasciano pecorino" }, description: { it: "Latte di pecore che pascolano vicino alle mofete: sentori minerali unici, stagionatura 8 mesi.", en: "Milk from ewes grazing near the volcanic springs: unique mineral notes, aged 8 months." }, price: 3800, b2b: 2900, unit: "KG", stock: 40 },
    ],
  },
  {
    name: "Podere Crete Bianche",
    kind: "beverage",
    vat: "02345678906",
    province: "SI",
    city: "Montalcino",
    founded: 1924,
    tagline: { it: "Sangiovese dalle argille di Montalcino", en: "Sangiovese from the clays of Montalcino" },
    story: {
      it: "Sei ettari esposti a sud-ovest, a quattrocento metri di quota, su galestro e argille bianche. Vendemmiamo a mano in cassette da quindici chili e affiniamo in botti grandi di rovere di Slavonia, senza fretta.\n\nOgni annata è diversa e la rispettiamo: in cantina interveniamo il meno possibile.",
      en: "Six hectares facing south-west, at four hundred metres, on galestro and white clays. We harvest by hand and age in large Slavonian oak casks, without haste.",
    },
    craft: { it: "Fermentazioni spontanee in tini di cemento, affinamento di quattro anni in botte grande.", en: "Spontaneous fermentation in concrete vats, four years in large casks." },
    certifications: ["DOCG", "BIO"],
    minOrder: 60000,
    leadTime: 7,
    products: [
      { name: { it: "Brunello di Montalcino 2020", en: "Brunello di Montalcino 2020" }, description: { it: "Ciliegia, viola, sottobosco. Tannino fitto e lunghissimo. Da bere ora o fra vent'anni.", en: "Cherry, violet, undergrowth. Dense, endless tannin. Drink now or in twenty years." }, price: 6800, b2b: 4900, unit: "BOTTLE", minQty: 1, stock: 600 },
      { name: { it: "Rosso di Montalcino 2023", en: "Rosso di Montalcino 2023" }, description: { it: "Il Sangiovese giovane delle vigne più alte: fresco, sapido, perfetto per la carta dei vini al calice.", en: "Young Sangiovese from the highest vineyards: fresh and savoury, ideal by the glass." }, price: 2400, b2b: 1650, unit: "BOTTLE", stock: 1200 },
      { name: { it: "Cassa verticale Brunello 2016–2019", en: "Brunello vertical case 2016–2019" }, description: { it: "Quattro annate in cassa di legno, per la cantina di un ristorante o un regalo importante.", en: "Four vintages in a wooden case, for a restaurant cellar or a significant gift." }, price: 32000, b2b: 25000, unit: "CASE", stock: 24 },
    ],
  },
  {
    name: "Sartoria Partenopea",
    kind: "tailoring",
    vat: "03456789015",
    province: "NA",
    city: "Napoli",
    founded: 1948,
    tagline: { it: "Giacche cucite a mano dal 1948", en: "Hand-sewn jackets since 1948" },
    story: {
      it: "Tre generazioni di sarti nel cuore di Chiaia. Ogni giacca richiede quaranta ore di lavoro e oltre cinquemila punti a mano: la spalla a camicia, il taschino a barchetta, l'asola lavorata col filo di seta.\n\nPer ristoranti e alberghi realizziamo divise su misura che durano dieci stagioni.",
      en: "Three generations of tailors in the heart of Chiaia. Every jacket takes forty hours and over five thousand hand stitches. For restaurants and hotels we make bespoke uniforms that last ten seasons.",
    },
    certifications: ["BOTTEGA_STORICA", "ARTIGIANATO_ARTISTICO"],
    minOrder: 150000,
    leadTime: 45,
    products: [
      { name: { it: "Giacca in lino blu notte", en: "Midnight blue linen jacket" }, description: { it: "Lino irlandese, spalla a camicia, tre bottoni stirati a due. Su misura, due prove.", en: "Irish linen, shirt shoulder, three-roll-two. Bespoke, two fittings." }, price: 280000, b2b: 210000, madeToOrder: true },
      { name: { it: "Divisa di sala, completo", en: "Dining-room uniform, full set" }, description: { it: "Giacca e pantalone in fresco di lana, ricamo del logo a mano. Minimo sei pezzi.", en: "Jacket and trousers in tropical wool, hand-embroidered logo. Minimum six sets." }, price: 98000, b2b: 72000, unit: "SET", minQty: 6, madeToOrder: true },
      { name: { it: "Cravatta sette pieghe", en: "Seven-fold tie" }, description: { it: "Seta di Como, interamente piegata a mano, senza fodera.", en: "Como silk, entirely hand-folded, unlined." }, price: 19000, b2b: 14000, stock: 30 },
    ],
  },
  {
    name: "Selleria Cortinese",
    kind: "sport",
    vat: "04567890124",
    province: "BL",
    city: "Cortina d'Ampezzo",
    founded: 1971,
    tagline: { it: "Cuoio e frassino per la montagna", en: "Leather and ash wood for the mountains" },
    story: {
      it: "Nella bottega sotto le Tofane cuciamo a mano zaini, borracce e cinghie per sci d'epoca, e restauriamo sci in frassino per i rifugi e gli alberghi della valle.\n\nUsiamo cuoio conciato al vegetale in Toscana e filo cerato: oggetti che invecchiano bene.",
      en: "In our workshop beneath the Tofane we hand-stitch backpacks and straps for vintage skis, and restore ash-wood skis for the valley's huts and hotels.",
    },
    certifications: ["MADE_IN_ITALY_100"],
    leadTime: 20,
    products: [
      { name: { it: "Zaino da rifugio in cuoio", en: "Leather mountain-hut backpack" }, description: { it: "Cuoio vegetale da 3 mm, fibbie in ottone, cuciture a sella. 22 litri.", en: "3 mm vegetable-tanned leather, brass buckles, saddle-stitched. 22 litres." }, price: 64000, b2b: 49000, stock: 12 },
      { name: { it: "Coppia di sci in frassino restaurati", en: "Restored ash-wood skis, pair" }, description: { it: "Sci degli anni Cinquanta restaurati per l'arredo di hotel e chalet. Ogni coppia è unica.", en: "1950s skis restored for hotel and chalet interiors. Each pair is unique." }, price: 89000, madeToOrder: true },
    ],
  },
  {
    name: "Antica Fornace Derutese",
    kind: "crafts",
    vat: "05678901233",
    province: "PG",
    city: "Deruta",
    founded: 1890,
    tagline: { it: "Maiolica dipinta a mano da quattro generazioni", en: "Hand-painted majolica for four generations" },
    story: {
      it: "La nostra fornace è attiva dall'Ottocento. Torniamo l'argilla del Tevere, la cuociamo due volte e la dipingiamo a mano con i motivi rinascimentali di Deruta: il raffaellesco, il girali, il petal back.\n\nPer la ristorazione realizziamo servizi da tavola personalizzati, resistenti all'uso quotidiano.",
      en: "Our kiln has been active since the nineteenth century. We throw Tiber clay, fire it twice and hand-paint Deruta's Renaissance patterns. For restaurants we create custom tableware for daily use.",
    },
    certifications: ["BOTTEGA_STORICA", "ARTIGIANATO_ARTISTICO"],
    minOrder: 80000,
    leadTime: 60,
    products: [
      { name: { it: "Servizio da tavola Raffaellesco, 12 coperti", en: "Raffaellesco dinner service, 12 settings" }, description: { it: "Piatti piani, fondi e da dessert dipinti a mano. Personalizzabile con lo stemma del ristorante.", en: "Dinner, soup and dessert plates, hand-painted. Can carry the restaurant's crest." }, price: 186000, b2b: 138000, unit: "SET", madeToOrder: true },
      { name: { it: "Brocca da vino in maiolica", en: "Majolica wine jug" }, description: { it: "Un litro, smalto stannifero, decoro a girali blu e ocra.", en: "One litre, tin glaze, blue and ochre scroll decoration." }, price: 12000, b2b: 8500, stock: 40 },
    ],
  },
  {
    name: "Frantoio Murgia Antica",
    kind: "food",
    vat: "06789012342",
    province: "BA",
    city: "Andria",
    founded: 1898,
    tagline: { it: "Coratina franta entro sei ore dalla raccolta", en: "Coratina pressed within six hours of harvest" },
    story: {
      it: "Ulivi secolari sulla Murgia, raccolta precoce a ottobre, frangitura a freddo entro sei ore. Ne nasce un olio verde, amaro e piccante, ricchissimo di polifenoli.\n\nLo conserviamo sotto azoto e lo imbottigliamo su ordinazione.",
      en: "Centuries-old olive trees on the Murgia, early harvest in October, cold-pressed within six hours. A green, bitter, peppery oil, rich in polyphenols.",
    },
    certifications: ["DOP", "BIO"],
    minOrder: 20000,
    leadTime: 5,
    products: [
      { name: { it: "Olio extravergine Coratina, 0,5 l", en: "Coratina extra virgin olive oil, 0.5 l" }, description: { it: "Raccolta precoce, monocultivar. Carciofo, mandorla verde, pepe nero.", en: "Early harvest, single variety. Artichoke, green almond, black pepper." }, price: 2200, b2b: 1500, unit: "BOTTLE", stock: 800 },
      { name: { it: "Latta da 5 litri per la cucina", en: "5-litre kitchen tin" }, description: { it: "Lo stesso olio, nel formato per le cucine professionali.", en: "The same oil, in the format for professional kitchens." }, price: 9500, b2b: 7200, unit: "PIECE", stock: 200 },
    ],
  },
  {
    name: "Distilleria Val di Torre",
    kind: "beverage",
    vat: "07890123451",
    province: "UD",
    city: "Percoto",
    founded: 1897,
    tagline: { it: "Grappa di monovitigno in alambicco discontinuo", en: "Single-varietal grappa from batch stills" },
    story: {
      it: "Distilliamo vinacce fresche di Picolit, Fragolino e Ribolla Gialla in alambicchi di rame a vapore, a ciclo discontinuo, come facevano i nostri bisnonni friulani.\n\nOgni lotto è numerato a mano.",
      en: "We distil fresh pomace of Picolit, Fragolino and Ribolla Gialla in copper steam batch stills, as our Friulian great-grandparents did. Every batch is hand-numbered.",
    },
    certifications: ["MADE_IN_ITALY_100"],
    minOrder: 40000,
    leadTime: 6,
    products: [
      { name: { it: "Grappa di Picolit", en: "Picolit grappa" }, description: { it: "Miele d'acacia, albicocca, fiori bianchi. Bottiglia soffiata a mano da 50 cl.", en: "Acacia honey, apricot, white flowers. 50 cl hand-blown bottle." }, price: 7800, b2b: 5600, unit: "BOTTLE", stock: 150 },
      { name: { it: "Riserva 18 mesi in barrique", en: "18-month barrique reserve" }, description: { it: "Ribolla Gialla affinata in rovere francese. Vaniglia, frutta secca, tabacco dolce.", en: "Ribolla Gialla aged in French oak. Vanilla, dried fruit, sweet tobacco." }, price: 5400, b2b: 3900, unit: "BOTTLE", stock: 300 },
    ],
  },
  {
    name: "Lanificio Valle del Cervo",
    kind: "tailoring",
    vat: "08901234560",
    province: "BI",
    city: "Valle Mosso",
    founded: 1835,
    tagline: { it: "Tessuti di lana merino, dal filo alla pezza", en: "Merino wool fabrics, from yarn to bolt" },
    story: {
      it: "Nella valle del Cervo l'acqua dolcissima delle Alpi lava la lana come in nessun altro luogo. Pettiniamo, filiamo e tessiamo merino superfine su telai a navetta, per sartorie di tutto il mondo.\n\nVendiamo a metro anche alle piccole sartorie e agli interior designer.",
      en: "In the Cervo valley the soft Alpine water washes wool like nowhere else. We comb, spin and weave superfine merino on shuttle looms for tailors worldwide.",
    },
    certifications: ["MADE_IN_ITALY_100", "BOTTEGA_STORICA"],
    minOrder: 50000,
    leadTime: 10,
    products: [
      { name: { it: "Fresco di lana Super 130's, grigio fumo", en: "Super 130's tropical wool, smoke grey" }, description: { it: "230 g/m, armatura tela, ideale per abiti estivi e divise di sala.", en: "230 g/m, plain weave, ideal for summer suits and dining-room uniforms." }, price: 9800, b2b: 6900, unit: "METRE", minQty: 3, stock: 900 },
      { name: { it: "Flanella cardata, blu Biella", en: "Carded flannel, Biella blue" }, description: { it: "320 g/m, mano morbidissima, finissaggio al vapore.", en: "320 g/m, very soft hand, steam-finished." }, price: 11500, b2b: 8200, unit: "METRE", minQty: 3, stock: 400 },
    ],
  },
];

const PASSWORD = "Maestranze!2026";

async function main() {
  const config = loadConfig();
  const { db, pool } = createDb(config.DATABASE_URL);
  const store = new DiskMediaStore(resolve(config.MEDIA_DIR));
  const images = fileURLToPath(new URL("../../seed/images/", import.meta.url));
  const img = async (name: string) => storeImage(store, await readFile(images + name));
  const passwordHash = await hashPassword(PASSWORD);
  const consents = { terms: true, privacy: true, marketing: false, at: new Date().toISOString() };

  const ensureAccount = async (values: typeof accounts.$inferInsert) => {
    const existing = await db.query.accounts.findFirst({ where: eq(accounts.email, values.email) });
    if (existing) return existing;
    const [row] = await db.insert(accounts).values(values).returning();
    await db.insert(mfaFactors).values({ accountId: row!.id, method: "SMS", confirmedAt: new Date() });
    return row!;
  };
  const base = { passwordHash, status: "ACTIVE" as const, emailVerifiedAt: new Date(), phoneVerifiedAt: new Date(), consents, locale: "it" };

  await ensureAccount({ ...base, email: "staff@maestranze.it", role: "BUYER", subjectType: "COMPANY", firstName: "Elena", lastName: "Conti", companyName: "Maestranze Italia S.r.l.", vatNumber: "12345678903", phone: "+393330000001", sector: "OTHER", province: "MI", city: "Milano", isAdmin: true });
  await ensureAccount({ ...base, email: "chef@osteria.it", role: "BUYER", subjectType: "COMPANY", firstName: "Marco", lastName: "Galli", companyName: "Osteria del Ponte S.r.l.", vatNumber: "98765432109".replace(/.$/, "8"), phone: "+393330000002", sector: "RESTAURANT", province: "MI", city: "Milano" });

  for (const [i, m] of MAISONS.entries()) {
    const email = `${slugify(m.name).split("-")[0]}${i}@maison.maestranze.it`;
    const account = await ensureAccount({ ...base, email, role: "MAKER", subjectType: "COMPANY", firstName: "Titolare", lastName: m.name.split(" ").at(-1)!, companyName: m.name, vatNumber: m.vat, phone: `+3933300001${String(i).padStart(2, "0")}`, sector: m.kind.toUpperCase(), province: m.province, city: m.city });
    if (await db.query.maisons.findFirst({ where: eq(maisons.accountId, account.id) })) continue;
    const [maison] = await db
      .insert(maisons)
      .values({
        accountId: account.id,
        slug: slugify(m.name),
        name: m.name,
        discipline: m.kind.toUpperCase() as "FOOD",
        tagline: m.tagline,
        story: m.story,
        craft: m.craft ?? null,
        foundedYear: m.founded,
        province: m.province,
        region: regionOf(m.province)!,
        city: m.city,
        certifications: m.certifications,
        b2bMinOrderCents: m.minOrder ?? null,
        leadTimeDays: m.leadTime ?? null,
        coverImage: await img(`${m.kind}-cover-${(i % 2) + 1}.jpg`),
        status: "APPROVED",
        submittedAt: new Date(),
        approvedAt: new Date(),
      })
      .returning();
    for (const [j, p] of m.products.entries()) {
      await db.insert(products).values({
        maisonId: maison!.id,
        slug: slugify(p.name.it),
        name: p.name,
        description: p.description,
        priceCents: p.price,
        b2bPriceCents: p.b2b ?? null,
        unit: p.unit ?? "PIECE",
        minQty: p.minQty ?? 1,
        stock: p.madeToOrder ? null : (p.stock ?? null),
        madeToOrder: p.madeToOrder ?? false,
        image: await img(`${m.kind}-product-${(j % 3) + 1}.jpg`),
        position: j,
      });
    }
    console.log(`Maison: ${m.name} (${email})`);
  }
  await new SearchService(db).reindexAll();
  console.log(`\nAccount dimostrativi — password ${PASSWORD}\n  staff@maestranze.it (staff)\n  chef@osteria.it (ristorante)`);
  await pool.end();
}

await main();

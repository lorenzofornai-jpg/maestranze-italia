/** Nomina staff del portale un account esistente: pnpm --filter @maestranze/api admin:grant email@dominio.it */
import { eq } from "drizzle-orm";
import { createDb } from "../db/client";
import { accounts } from "../db/schema";

const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error("Indica l'email dell'account.");
const { db, pool } = createDb(process.env.DATABASE_URL!);
const [row] = await db.update(accounts).set({ isAdmin: true }).where(eq(accounts.email, email)).returning();
console.log(row ? `${email} è ora staff del portale.` : `Nessun account con email ${email}.`);
await pool.end();

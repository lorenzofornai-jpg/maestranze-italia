import { and, asc, desc, eq, gt, inArray } from "drizzle-orm";
import {
  CALL_IDLE_SECONDS,
  CALL_RING_SECONDS,
  appointmentSchema,
  callSignalSchema,
  type CallSession,
  type CallStatus,
  type CallView,
} from "@maestranze/shared";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { callSignals, commissionAppointments, commissionCalls, type Account, type CommissionCall } from "../db/schema";
import { ApiError, Errors } from "../lib/errors";
import type { Translator } from "../lib/translate";
import { parseOrThrow } from "../lib/validation";
import type { AtelierService } from "./service";

type Party = "BUYER" | "MAKER";

const T = {
  it: {
    proposed: (n: string) => `Videochiamata proposta · ${n}`,
    proposedBody: (who: string) => `${who} propone una videochiamata. Data e ora sono nell'Atelier, nel tuo fuso orario: puoi accettarla o proporne un'altra.`,
    accepted: (n: string) => `Videochiamata confermata · ${n}`,
    acceptedBody: (who: string) => `${who} ha confermato l'appuntamento. Al momento giusto apri l'Atelier e avvia la videochiamata: i sottotitoli sono tradotti in diretta.`,
  },
  en: {
    proposed: (n: string) => `Video call proposed · ${n}`,
    proposedBody: (who: string) => `${who} proposes a video call. Date and time are in the Atelier, in your time zone: you can accept or suggest another.`,
    accepted: (n: string) => `Video call confirmed · ${n}`,
    acceptedBody: (who: string) => `${who} has confirmed the appointment. At the time, open the Atelier and start the video call: subtitles are translated live.`,
  },
};
const tx = (l: string) => (l === "en" ? T.en : T.it);

const validTimeZone = (tz: string | undefined) => {
  if (!tz) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
};

/**
 * Videochiamate tra cliente e Maison: il portale fa da centralino (squillo, risposta, scambio dei
 * segnali WebRTC), l'audio e il video passano direttamente tra i due browser. Nessuna registrazione.
 * I sottotitoli: ciascun browser trascrive chi parla, il portale traduce nella lingua dell'altro.
 */
export class CallService {
  /** Ultime battute di ogni chiamata, per tradurre i sottotitoli con il contesto (solo in memoria). */
  private transcripts = new Map<string, { speaker: string; text: string; at: number }[]>();

  constructor(
    private db: Db,
    private config: Config,
    private atelier: AtelierService,
    private translator: Translator,
    private now: () => Date = () => new Date(),
  ) {}

  iceServers(): CallSession["iceServers"] {
    const servers: CallSession["iceServers"] = [{ urls: this.config.STUN_URLS.split(",").map((u) => u.trim()).filter(Boolean) }];
    if (this.config.TURN_URLS) {
      servers.push({ urls: this.config.TURN_URLS.split(",").map((u) => u.trim()), username: this.config.TURN_USERNAME, credential: this.config.TURN_CREDENTIAL });
    }
    return servers;
  }

  private stateError(): never {
    throw new ApiError(409, "CALL_INVALID_STATE");
  }

  /** Chiude le chiamate scadute: squillo senza risposta, o nessun segno di vita da entrambi. */
  private async settle(call: CommissionCall): Promise<CommissionCall> {
    const now = this.now().getTime();
    let to: CallStatus | null = null;
    if (call.status === "RINGING" && now - call.createdAt.getTime() > CALL_RING_SECONDS * 1000) to = "MISSED";
    if (call.status === "ACTIVE") {
      const seen = Math.max(call.buyerSeenAt?.getTime() ?? 0, call.makerSeenAt?.getTime() ?? 0, call.answeredAt?.getTime() ?? 0);
      if (now - seen > CALL_IDLE_SECONDS * 1000) to = "ENDED";
    }
    if (!to) return call;
    return (await this.finish(call, to)) ?? call;
  }

  private async finish(call: CommissionCall, to: CallStatus) {
    const [row] = await this.db
      .update(commissionCalls)
      .set({ status: to, endedAt: this.now() })
      .where(and(eq(commissionCalls.id, call.id), inArray(commissionCalls.status, ["RINGING", "ACTIVE"])))
      .returning();
    if (!row) return null;
    this.transcripts.delete(row.id);
    if (to === "MISSED" || to === "DECLINED") await this.atelier.event(row.commissionId, "CALL_MISSED");
    else if (row.answeredAt) {
      const minutes = Math.max(1, Math.round((this.now().getTime() - row.answeredAt.getTime()) / 60_000));
      await this.atelier.event(row.commissionId, "CALL_ENDED", { minutes });
    } else await this.atelier.event(row.commissionId, "CALL_MISSED");
    return row;
  }

  private async view(call: CommissionCall, party: Party, account: Account, commissionId: string): Promise<CallView> {
    const { c, maison, buyer, maker } = await this.atelier.load(account, commissionId);
    const other = party === "BUYER" ? maison.name : (buyer.companyName ?? `${buyer.firstName} ${buyer.lastName}`);
    return {
      id: call.id,
      commissionId: call.commissionId,
      status: call.status as CallStatus,
      startedBy: call.startedBy as Party,
      mine: call.startedBy === party,
      otherName: other,
      myLanguage: this.atelier.langOf(party, c, maker),
      otherLanguage: this.atelier.langOf(party === "BUYER" ? "MAKER" : "BUYER", c, maker),
      createdAt: call.createdAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
    };
  }

  /** Chiamata in corso o che squilla per questa commissione (lo squillo viene letto dalla pagina). */
  async current(account: Account, commissionId: string): Promise<{ call: CallView | null; iceServers: CallSession["iceServers"] }> {
    const { party } = await this.atelier.load(account, commissionId);
    const open = await this.db.query.commissionCalls.findFirst({
      where: and(eq(commissionCalls.commissionId, commissionId), inArray(commissionCalls.status, ["RINGING", "ACTIVE"])),
      orderBy: desc(commissionCalls.createdAt),
    });
    if (!open) return { call: null, iceServers: this.iceServers() };
    const settled = await this.settle(open);
    if (settled.status !== "RINGING" && settled.status !== "ACTIVE") return { call: null, iceServers: this.iceServers() };
    return { call: await this.view(settled, party, account, commissionId), iceServers: this.iceServers() };
  }

  async start(account: Account, commissionId: string): Promise<CallSession> {
    const { c, party } = await this.atelier.load(account, commissionId);
    this.atelier.writable(c);
    const existing = await this.current(account, commissionId);
    if (existing.call) {
      // Si chiama a vicenda nello stesso momento: si entra nella chiamata che già squilla.
      if (existing.call.status === "RINGING" && !existing.call.mine) return this.answer(account, existing.call.id);
      return existing as CallSession;
    }
    const now = this.now();
    const [call] = await this.db
      .insert(commissionCalls)
      .values({ commissionId, startedBy: party, createdAt: now, ...(party === "BUYER" ? { buyerSeenAt: now } : { makerSeenAt: now }) })
      .returning();
    return { call: await this.view(call!, party, account, commissionId), iceServers: this.iceServers() };
  }

  private async own(account: Account, callId: string) {
    const call = await this.db.query.commissionCalls.findFirst({ where: eq(commissionCalls.id, callId) });
    if (!call) throw Errors.notFound();
    const { party } = await this.atelier.load(account, call.commissionId);
    return { call: await this.settle(call), party };
  }

  async answer(account: Account, callId: string): Promise<CallSession> {
    const { call, party } = await this.own(account, callId);
    if (call.startedBy === party) this.stateError();
    const now = this.now();
    const [row] = await this.db
      .update(commissionCalls)
      .set({ status: "ACTIVE", answeredAt: now, ...(party === "BUYER" ? { buyerSeenAt: now } : { makerSeenAt: now }) })
      .where(and(eq(commissionCalls.id, call.id), eq(commissionCalls.status, "RINGING")))
      .returning();
    if (!row) this.stateError();
    return { call: await this.view(row, party, account, call.commissionId), iceServers: this.iceServers() };
  }

  async decline(account: Account, callId: string) {
    const { call, party } = await this.own(account, callId);
    if (call.status !== "RINGING" || call.startedBy === party) this.stateError();
    await this.finish(call, "DECLINED");
    return { ok: true };
  }

  async end(account: Account, callId: string) {
    const { call } = await this.own(account, callId);
    if (call.status === "RINGING" || call.status === "ACTIVE") await this.finish(call, call.status === "RINGING" ? "MISSED" : "ENDED");
    return { ok: true };
  }

  async signal(account: Account, callId: string, input: unknown) {
    const { call, party } = await this.own(account, callId);
    if (call.status !== "RINGING" && call.status !== "ACTIVE") this.stateError();
    const data = parseOrThrow(callSignalSchema, input);
    if (JSON.stringify(data.payload).length > 20_000) throw Errors.validation({ payload: "signal.too_large" });
    await this.db.insert(callSignals).values({ callId, sender: party, kind: data.kind, payload: data.payload });
    return { ok: true };
  }

  /** Segnali dell'altra parte dopo `after`, con lo stato della chiamata; vale anche come segno di vita. */
  async signals(account: Account, callId: string, after: number) {
    const { call, party } = await this.own(account, callId);
    if (call.status === "ACTIVE" || call.status === "RINGING") {
      await this.db
        .update(commissionCalls)
        .set(party === "BUYER" ? { buyerSeenAt: this.now() } : { makerSeenAt: this.now() })
        .where(eq(commissionCalls.id, callId));
    }
    const rows = await this.db.query.callSignals.findMany({
      where: and(eq(callSignals.callId, callId), gt(callSignals.id, after)),
      orderBy: asc(callSignals.id),
    });
    return {
      status: call.status as CallStatus,
      signals: rows.filter((r) => r.sender !== party).map((r) => ({ id: r.id, kind: r.kind, payload: r.payload })),
      last: rows.at(-1)?.id ?? after,
    };
  }

  /** Sottotitolo: traduce nella lingua dell'altra parte ciò che chi parla ha appena detto. */
  async caption(account: Account, callId: string, text: unknown) {
    const { call, party } = await this.own(account, callId);
    if (call.status !== "ACTIVE") this.stateError();
    const line = typeof text === "string" ? text.trim().slice(0, 500) : "";
    if (!line) throw Errors.validation({ text: "caption.empty" });
    const { c, maison, maker } = await this.atelier.load(account, call.commissionId);
    const from = this.atelier.langOf(party, c, maker);
    const to = this.atelier.langOf(party === "BUYER" ? "MAKER" : "BUYER", c, maker);
    // Le battute restano in memoria solo durante la chiamata, come contesto: non si salvano.
    const now = this.now().getTime();
    const lines = (this.transcripts.get(callId) ?? []).filter((l) => now - l.at < 5 * 60_000).slice(-6);
    const speaker = party === "BUYER" ? "Client" : "Artisan";
    this.transcripts.set(callId, [...lines, { speaker, text: line, at: now }]);
    if (this.transcripts.size > 500) this.transcripts.delete(this.transcripts.keys().next().value!);
    if (from === to) return { text: line, translation: line, language: to };
    const translation = this.translator.enabled
      ? await this.translator.translate(line, to, { discipline: maison.discipline, mode: "caption", from, previous: lines.map(({ speaker, text }) => ({ speaker, text })) })
      : null;
    return { text: line, translation, language: to };
  }

  // --- Appuntamenti -------------------------------------------------------------------------------

  async propose(account: Account, commissionId: string, input: unknown) {
    const { c, party, buyer, maker, maison } = await this.atelier.load(account, commissionId);
    this.atelier.writable(c);
    const data = parseOrThrow(appointmentSchema, input);
    const startsAt = new Date(data.startsAt);
    const now = this.now().getTime();
    if (startsAt.getTime() < now + 10 * 60_000 || startsAt.getTime() > now + 90 * 24 * 3600_000) throw Errors.validation({ startsAt: "appointment.window" });
    const tz = validTimeZone(data.timeZone);
    // Una nuova proposta sostituisce quelle ancora in attesa.
    await this.db
      .update(commissionAppointments)
      .set({ status: "CANCELLED" })
      .where(and(eq(commissionAppointments.commissionId, commissionId), eq(commissionAppointments.status, "PROPOSED")));
    await this.db.insert(commissionAppointments).values({
      commissionId,
      proposedBy: party,
      startsAt,
      durationMin: data.durationMin,
      ...(party === "BUYER" ? { buyerTimeZone: tz } : { makerTimeZone: tz }),
    });
    await this.atelier.event(commissionId, "APPOINTMENT_PROPOSED", { startsAt: startsAt.toISOString(), minutes: data.durationMin });
    const to = party === "BUYER" ? maker : buyer;
    const who = party === "BUYER" ? (buyer.companyName ?? `${buyer.firstName} ${buyer.lastName}`) : maison.name;
    await this.atelier.mail(to, c, tx(to.locale).proposed(c.number), tx(to.locale).proposedBody(who));
    return this.atelier.view(account, commissionId);
  }

  async respond(account: Account, appointmentId: string, input: { accept?: unknown; timeZone?: unknown }) {
    const a = await this.db.query.commissionAppointments.findFirst({ where: eq(commissionAppointments.id, appointmentId) });
    if (!a) throw Errors.notFound();
    const { c, party, buyer, maker, maison } = await this.atelier.load(account, a.commissionId);
    if (a.proposedBy === party || a.status !== "PROPOSED") throw new ApiError(409, "APPOINTMENT_INVALID_STATE");
    const accept = input.accept === true;
    const tz = validTimeZone(typeof input.timeZone === "string" ? input.timeZone : undefined);
    await this.db
      .update(commissionAppointments)
      .set({ status: accept ? "ACCEPTED" : "DECLINED", ...(party === "BUYER" ? { buyerTimeZone: tz } : { makerTimeZone: tz }) })
      .where(eq(commissionAppointments.id, a.id));
    await this.atelier.event(a.commissionId, accept ? "APPOINTMENT_ACCEPTED" : "APPOINTMENT_DECLINED", { startsAt: a.startsAt.toISOString() });
    if (accept) {
      const to = party === "BUYER" ? maker : buyer;
      const who = party === "BUYER" ? (buyer.companyName ?? `${buyer.firstName} ${buyer.lastName}`) : maison.name;
      await this.atelier.mail(to, c, tx(to.locale).accepted(c.number), tx(to.locale).acceptedBody(who));
    }
    return this.atelier.view(account, a.commissionId);
  }
}

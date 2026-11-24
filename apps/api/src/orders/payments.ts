import { randomToken } from "../lib/crypto";

/**
 * Fornitore di pagamento per un marketplace con fondi in custodia ("separate charges and transfers"):
 * il portale incassa dal cliente, trattiene i fondi finché l'ordine non è consegnato, poi trasferisce
 * alla Maison l'importo al netto della commissione, oppure rimborsa il cliente.
 *
 * Implementazioni:
 * - SandboxPaymentProvider: simula l'incasso e i trasferimenti, per sviluppo, test e demo.
 * - Stripe Connect (da collegare): charge = PaymentIntent sul conto del portale con `transfer_group`
 *   = numero d'ordine e raccolta della carta via Stripe Elements; payout = Transfer verso l'account
 *   Connect della Maison; refund = Refund del PaymentIntent. Ogni Maison completa l'onboarding KYC su
 *   Stripe (account Express) e il suo `acct_…` si salva sulla Maison. Adyen for Platforms segue lo stesso schema.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Incassa e tiene in custodia. */
  charge(input: { orderNumber: string; amountCents: number; customerRef: string }): Promise<{ ref: string }>;
  /** Trasferisce alla Maison la sua parte (totale meno commissione). */
  payout(input: { orderNumber: string; chargeRef: string; amountCents: number; maisonRef: string }): Promise<{ ref: string }>;
  /** Restituisce al cliente tutto o parte dell'incasso. */
  refund(input: { orderNumber: string; chargeRef: string; amountCents: number }): Promise<{ ref: string }>;
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = "sandbox";
  /** Movimenti simulati, ispezionabili nei test. */
  readonly calls: { op: "charge" | "payout" | "refund"; amountCents: number; ref: string }[] = [];
  /** Per i test: se impostato, il prossimo incasso viene rifiutato. */
  failNextCharge = false;

  async charge(input: { amountCents: number }) {
    if (this.failNextCharge) {
      this.failNextCharge = false;
      throw new Error("card_declined");
    }
    const ref = `sbx_ch_${randomToken(10)}`;
    this.calls.push({ op: "charge", amountCents: input.amountCents, ref });
    return { ref };
  }
  async payout(input: { amountCents: number }) {
    const ref = `sbx_tr_${randomToken(10)}`;
    this.calls.push({ op: "payout", amountCents: input.amountCents, ref });
    return { ref };
  }
  async refund(input: { amountCents: number }) {
    const ref = `sbx_re_${randomToken(10)}`;
    this.calls.push({ op: "refund", amountCents: input.amountCents, ref });
    return { ref };
  }
}

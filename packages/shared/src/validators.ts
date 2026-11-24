/**
 * Validatori dei dati anagrafici italiani.
 */

/** Partita IVA: 11 cifre con cifra di controllo (algoritmo di Luhn modificato). */
export function isValidPartitaIva(value: string): boolean {
  const v = value.replace(/\s/g, "");
  if (!/^\d{11}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let d = Number(v[i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10 === Number(v[10]);
}

const CF_ODD: Record<string, number> = {
  "0": 1, "1": 0, "2": 5, "3": 7, "4": 9, "5": 13, "6": 15, "7": 17, "8": 19, "9": 21,
  A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18,
  N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};

/** Codice fiscale delle persone fisiche (16 caratteri, con carattere di controllo; ammette l'omocodia). */
export function isValidCodiceFiscale(value: string): boolean {
  const v = value.toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v)) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const c = v[i]!;
    if (i % 2 === 0) {
      sum += CF_ODD[c]!;
    } else {
      sum += /\d/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
    }
  }
  return String.fromCharCode(65 + (sum % 26)) === v[15];
}

/** Cellulare in formato internazionale E.164 (es. +393331234567). */
export function normalizePhone(value: string): string {
  let v = value.replace(/[\s\-().]/g, "");
  if (v.startsWith("00")) v = "+" + v.slice(2);
  if (/^3\d{8,9}$/.test(v)) v = "+39" + v;
  return v;
}

export function isValidMobilePhone(value: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(value));
}

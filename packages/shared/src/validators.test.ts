import { describe, expect, it } from "vitest";
import { isValidCodiceFiscale, isValidPartitaIva, normalizePhone, registrationSchema } from "./index";

describe("validatori italiani", () => {
  it("partita IVA", () => {
    expect(isValidPartitaIva("12345678903")).toBe(true);
    expect(isValidPartitaIva("12345678901")).toBe(false);
    expect(isValidPartitaIva("1234567890")).toBe(false);
  });

  it("codice fiscale", () => {
    expect(isValidCodiceFiscale("RSSMRA85T10A562S")).toBe(true);
    expect(isValidCodiceFiscale("rssmra85t10a562s")).toBe(true);
    expect(isValidCodiceFiscale("RSSMRA85T10A562X")).toBe(false);
  });

  it("cellulare", () => {
    expect(normalizePhone("333 123 4567")).toBe("+393331234567");
    expect(normalizePhone("0039 333 1234567")).toBe("+393331234567");
  });

  it("schema di registrazione", () => {
    const r = registrationSchema.safeParse({
      role: "MAKER",
      subjectType: "COMPANY",
      companyName: "Caseificio Irpino",
      vatNumber: "IT12345678903",
      firstName: "Marco",
      lastName: "Esposito",
      email: " Marco@Caseificio.IT ",
      password: "Fiordilatte!2026",
      phone: "3331234567",
      sector: "FOOD",
      province: "av",
      city: "Avellino",
      consents: { terms: true, privacy: true },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe("marco@caseificio.it");
      expect(r.data.subjectType === "COMPANY" && r.data.vatNumber).toBe("12345678903");
    }
  });
});

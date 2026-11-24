import type { z } from "zod";
import { Errors } from "./errors";

/** Converte gli errori di zod in { campo: chiave_di_traduzione }. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw Errors.validation(fields);
}

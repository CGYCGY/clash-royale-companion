import type { Context } from "hono";
import type { z } from "zod";
import { AppError } from "../errors";

function toAppError(error: z.ZodError): AppError {
  const issues = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
  const summary = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ");
  return new AppError("validation_error", summary || "Invalid request", 400, { issues });
}

export function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw toAppError(result.error);
  return result.data;
}

/** Parses the JSON body with `schema`; throws AppError("validation_error") on bad JSON or schema failure. */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError("bad_request", "Request body must be valid JSON");
  }
  return parseWith(schema, body);
}

/** Parses a urlencoded/multipart form. Repeated keys become arrays. */
export async function parseForm<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  const body = await c.req.parseBody({ all: true });
  return parseWith(schema, body);
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  return parseWith(schema, c.req.query());
}

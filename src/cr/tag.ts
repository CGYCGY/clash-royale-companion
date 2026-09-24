import { AppError } from "../errors";

const TAG_RE = /^#[0289PYLQGRJCUV]{3,14}$/;

/**
 * Canonical form: uppercase with a leading `#`. Accepts input with or without `#` (so URL path
 * params work directly) and maps the letter O to zero, a common typo since tags never contain O.
 * Throws AppError("invalid_tag") on anything else.
 */
export function normalizeTag(input: string): string {
  const cleaned = input.trim().toUpperCase().replace(/^#+/, "").replace(/O/g, "0");
  const tag = `#${cleaned}`;
  if (!TAG_RE.test(tag)) {
    throw new AppError(
      "invalid_tag",
      `Invalid player tag "${input}". Tags use only 0289PYLQGRJCUV.`,
      400,
    );
  }
  return tag;
}

export function isValidTag(input: string): boolean {
  try {
    normalizeTag(input);
    return true;
  } catch {
    return false;
  }
}

/** Tag without `#`, for use in our own URLs like /players/9QJUGC2R. */
export const tagSlug = (tag: string): string => tag.replace(/^#/, "");

/** `#` must be sent as %23 or the API treats the rest of the path as a fragment. */
export const encodeTag = (tag: string): string => encodeURIComponent(tag);

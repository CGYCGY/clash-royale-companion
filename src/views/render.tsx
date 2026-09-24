import type { Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "../types";
import { Layout, type NavKey } from "./Layout";

/** Renders `content` inside Layout with the current user and flash pulled from the context. */
export function renderPage(
  c: Context<AppEnv>,
  opts: { title: string; active?: NavKey; status?: ContentfulStatusCode },
  content: Child,
) {
  return c.html(
    <Layout title={opts.title} user={c.var.user ?? null} flash={c.var.flash ?? null} active={opts.active}>
      {content}
    </Layout>,
    opts.status ?? 200,
  );
}

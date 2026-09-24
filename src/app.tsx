import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { authenticate, isApiRequest } from "./auth/middleware";
import { AppError, errorBody } from "./errors";
import { csrfProtection } from "./http/csrf";
import { flashMiddleware } from "./http/flash";
import { registerRoutes } from "./routes";
import type { AppEnv } from "./types";
import { renderPage } from "./views/render";

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Before auth so asset requests don't hit the database.
  app.use(
    "/static/*",
    serveStatic({ root: "./public", rewriteRequestPath: (p) => p.replace(/^\/static/, "") }),
  );
  app.use(csrfProtection);
  app.use(authenticate);
  app.use(flashMiddleware);

  registerRoutes(app);

  app.notFound((c) => {
    if (isApiRequest(c)) return c.json(errorBody("not_found", `No route for ${c.req.method} ${c.req.path}`), 404);
    return renderPage(
      c,
      { title: "Not found", status: 404 },
      <div class="card">
        <h1>Not found</h1>
        <p class="muted">That page doesn't exist.</p>
        <a class="btn btn-secondary" href="/">
          Back to dashboard
        </a>
      </div>,
    );
  });

  app.onError((err, c) => {
    let status: ContentfulStatusCode = 500;
    let code = "internal_error";
    let message = "Something went wrong";
    let details: Record<string, unknown> | undefined;
    if (err instanceof AppError) {
      status = err.status;
      code = err.code;
      message = err.message;
      details = err.details;
    } else if (err instanceof HTTPException) {
      status = err.status as ContentfulStatusCode;
      code = status === 403 ? "forbidden" : status === 401 ? "unauthorized" : "bad_request";
      message = err.message || (status === 403 ? "Forbidden" : "Request failed");
    } else {
      console.error(`[error] ${c.req.method} ${c.req.path}:`, err);
    }
    if (isApiRequest(c)) return c.json(errorBody(code, message, details), status);
    return renderPage(
      c,
      { title: "Error", status },
      <div class="card">
        <h1>{status >= 500 ? "Something went wrong" : "Request failed"}</h1>
        <p>{message}</p>
        <a class="btn btn-secondary" href="/">
          Back to dashboard
        </a>
      </div>,
    );
  });

  return app;
}

import { Hono } from "hono";
import { z } from "zod";
import { registerWithInvite } from "../../auth/register";
import { endSession, startSession } from "../../auth/sessions";
import { verifyCredentials } from "../../auth/users";
import { setFlash } from "../../http/flash";
import { parseForm } from "../../http/validate";
import type { AppEnv } from "../../types";
import { PasswordChecklist, PasswordInput, PasswordMatch } from "../../views/password";
import { renderPage } from "../../views/render";
import { formError, formErrors, safeNext, text } from "./shared";

function ErrorBox({ messages = [] }: { messages?: string[] }) {
  if (!messages.length) return null;
  return (
    <div class="flash flash-error" role="alert">
      {messages.length === 1 ? (
        messages[0]
      ) : (
        <ul class="error-list">
          {messages.map((m) => (
            <li>{m}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoginForm({ username = "", next = "/", error }: { username?: string; next?: string; error?: string }) {
  return (
    <div class="card form-narrow auth-card">
      <h1>Log in</h1>
      <ErrorBox messages={error ? [error] : []} />
      <form method="post" action="/login">
        <input type="hidden" name="next" value={next} />
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" value={username} autocomplete="username" required autofocus />
        </div>
        <div class="field">
          <label for="password">Password</label>
          <PasswordInput id="password" name="password" autocomplete="current-password" />
        </div>
        <div class="field">
          <button type="submit">Log in</button>
        </div>
      </form>
      <p class="muted">
        Have an invite code? <a href="/register">Create an account</a>
      </p>
    </div>
  );
}

function RegisterForm({ username = "", invite = "", errors }: { username?: string; invite?: string; errors?: string[] }) {
  return (
    <div class="card form-narrow auth-card">
      <h1>Create account</h1>
      <ErrorBox messages={errors} />
      <form method="post" action="/register">
        <div class="field">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" value={username} autocomplete="username" required autofocus />
          <p class="help">3–32 lowercase letters, digits, or underscores.</p>
        </div>
        <div class="field">
          <label for="password">Password</label>
          <PasswordInput id="password" name="password" autocomplete="new-password" policy describedby="password-rules" />
          <PasswordChecklist id="password-rules" passwordId="password" usernameInputId="username" />
        </div>
        <div class="field">
          <label for="confirm">Confirm password</label>
          <PasswordInput id="confirm" name="confirm" autocomplete="new-password" describedby="confirm-match" />
          <PasswordMatch id="confirm-match" passwordId="password" confirmId="confirm" />
        </div>
        <div class="field">
          <label for="invite">Invite code</label>
          <input type="text" id="invite" name="invite" value={invite} autocomplete="off" required />
        </div>
        <div class="field">
          <button type="submit">Create account</button>
        </div>
      </form>
      <p class="muted">
        Already registered? <a href="/login">Log in</a>
      </p>
    </div>
  );
}

const loginSchema = z.object({ username: text, password: text, next: text });
const registerSchema = z.object({ username: text, password: text, confirm: text, invite: text });

export const authPages = new Hono<AppEnv>()
  .get("/login", (c) => {
    if (c.var.user) return c.redirect("/");
    return renderPage(c, { title: "Log in" }, <LoginForm next={safeNext(c.req.query("next"))} />);
  })
  .post("/login", async (c) => {
    let form: z.infer<typeof loginSchema>;
    try {
      form = await parseForm(c, loginSchema);
    } catch (err) {
      return renderPage(c, { title: "Log in", status: 400 }, <LoginForm error={formError(err)} />);
    }
    const next = safeNext(form.next);
    // Usernames are stored lowercased; verifyCredentials only trims.
    const user = await verifyCredentials(form.username.toLowerCase(), form.password);
    if (!user) {
      return renderPage(
        c,
        { title: "Log in", status: 401 },
        <LoginForm username={form.username} next={next} error="Wrong username or password." />,
      );
    }
    startSession(c, user.id);
    return c.redirect(next);
  })
  .get("/register", (c) => {
    if (c.var.user) return c.redirect("/");
    return renderPage(c, { title: "Create account" }, <RegisterForm invite={c.req.query("invite") ?? ""} />);
  })
  .post("/register", async (c) => {
    let form: z.infer<typeof registerSchema> | undefined;
    try {
      form = await parseForm(c, registerSchema);
      if (form.password !== form.confirm) {
        return renderPage(
          c,
          { title: "Create account", status: 400 },
          <RegisterForm username={form.username} invite={form.invite} errors={["Passwords don't match."]} />,
        );
      }
      const user = await registerWithInvite({
        username: form.username,
        password: form.password,
        inviteCode: form.invite.trim(),
      });
      startSession(c, user.id);
      setFlash(c, "success", "Welcome. Link your player tag to get started.");
      return c.redirect("/settings");
    } catch (err) {
      const errors = formErrors(err, {
        invalid_invite: "That invite code is invalid, expired, or already used.",
        conflict: "That username is taken. Pick another one.",
      });
      return renderPage(
        c,
        { title: "Create account", status: 400 },
        <RegisterForm username={form?.username} invite={form?.invite} errors={errors} />,
      );
    }
  })
  .post("/logout", (c) => {
    endSession(c);
    return c.redirect("/login");
  });

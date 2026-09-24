import { PASSWORD_MAX, PASSWORD_MIN, passwordPolicyClientConfig } from "../auth/passwordPolicy";
import { EyeIcon, EyeOffIcon } from "./icons";

interface PasswordInputProps {
  id: string;
  name: string;
  autocomplete: "current-password" | "new-password";
  /** Apply the policy's length bounds as HTML hints; leave off for current-password fields. */
  policy?: boolean;
  describedby?: string;
  autofocus?: boolean;
}

/** Password field with a show/hide toggle. The toggle ships hidden; public/app.js reveals and wires it. */
export function PasswordInput({ id, name, autocomplete, policy, describedby, autofocus }: PasswordInputProps) {
  return (
    <div class="input-with-btn">
      <input
        type="password"
        id={id}
        name={name}
        autocomplete={autocomplete}
        minlength={policy ? PASSWORD_MIN : undefined}
        // HTML maxlength counts UTF-16 units while the policy counts code points; doubling keeps the
        // browser from truncating a valid password full of astral characters (emoji). The server enforces the real cap.
        maxlength={policy ? PASSWORD_MAX * 2 : undefined}
        aria-describedby={describedby}
        autofocus={autofocus}
        required
        spellcheck={false}
        autocapitalize="off"
      />
      {/* One icon at a time: app.js flips the two spans' `hidden` along with aria-pressed. */}
      <button type="button" class="input-btn password-toggle" aria-label="Show Password" title="Show Password" aria-pressed="false" aria-controls={id} hidden>
        <span class="icon-slot" data-show-icon>
          <EyeIcon />
        </span>
        <span class="icon-slot" data-hide-icon hidden>
          <EyeOffIcon />
        </span>
      </button>
    </div>
  );
}

interface PasswordChecklistProps {
  id: string;
  passwordId: string;
  /** The account's username when known (settings); otherwise read live from `usernameInputId`. */
  username?: string;
  usernameInputId?: string;
}

/**
 * The policy's requirements as a plain list, which is useful help text without JS. public/app.js
 * turns it into a live checklist using the same rule parameters, serialized into data-policy.
 */
export function PasswordChecklist({ id, passwordId, username, usernameInputId }: PasswordChecklistProps) {
  const cfg = passwordPolicyClientConfig();
  return (
    <ul
      class="pw-checklist"
      id={id}
      data-policy={JSON.stringify(cfg)}
      data-password={passwordId}
      data-username={username}
      data-username-input={usernameInputId}
    >
      {cfg.rules.map((r) => (
        <li data-rule={r.id}>
          {r.label}
          <span class="sr-only" data-state></span>
        </li>
      ))}
    </ul>
  );
}

/** "Passwords match" line for under the confirm field; only meaningful live, so it ships hidden. */
export function PasswordMatch({ id, passwordId, confirmId }: { id: string; passwordId: string; confirmId: string }) {
  return (
    <ul class="pw-checklist pw-match" id={id} data-password={passwordId} data-confirm={confirmId} hidden>
      <li data-rule="match">
        Passwords match
        <span class="sr-only" data-state></span>
      </li>
    </ul>
  );
}

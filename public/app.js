// Progressive enhancement only; every page must work without this file.

// Card art is hotlinked from Supercell's CDN. Show the card name instead of a broken image.
// This script is deferred, so some images may have failed before the listener existed.
const markBroken = (img) => img.closest(".card-icon")?.classList.add("img-failed");
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.closest(".card-icon")) markBroken(e.target);
  },
  true,
);
for (const img of document.querySelectorAll(".card-icon img")) {
  if (img.complete && img.naturalWidth === 0) markBroken(img);
}

// Sync cooldown: count down the disabled button and re-enable it at zero.
for (const btn of document.querySelectorAll("button[data-retry-after]")) {
  let left = Number(btn.dataset.retryAfter);
  if (!Number.isFinite(left)) continue;
  const tick = () => {
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = btn.dataset.readyLabel || "Try again";
      return;
    }
    btn.textContent = `Try again in ${left}s`;
    left--;
  };
  const timer = setInterval(tick, 1000);
  tick();
}

// New API key: copy button inside the input, plus a best-effort copy on load.
const copyText = async (input) => {
  try {
    await navigator.clipboard.writeText(input.value);
    return true;
  } catch {
    // No Clipboard API (plain http on a LAN IP) or it was refused: the legacy path still works inside a click.
    input.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
};
const copyShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "\u2318C" : "Ctrl+C";

for (const btn of document.querySelectorAll(".copy-key")) {
  const input = document.getElementById(btn.getAttribute("aria-controls"));
  if (!input) continue;
  const status = document.querySelector(`[data-copy-status="${input.id}"]`);
  let timer;
  const flash = (ok, message, ms = 2000) => {
    clearTimeout(timer);
    btn.classList.toggle("copied", ok);
    if (status) status.textContent = message;
    if (ok) {
      timer = setTimeout(() => {
        btn.classList.remove("copied");
        if (status) status.textContent = "";
      }, ms);
    }
  };
  btn.hidden = false;
  btn.closest(".input-with-btn")?.classList.add("has-btn");
  btn.addEventListener("click", async () => {
    if (await copyText(input)) flash(true, "Copied");
    else {
      input.select();
      flash(false, `Press ${copyShortcut} to copy`);
    }
  });
  input.addEventListener("focus", () => input.select());

  if (input.hasAttribute("data-autocopy")) {
    // Browsers may refuse clipboard writes without a user gesture or while the tab isn't focused; that's
    // expected, so fall back quietly to a selected key and a hint rather than an error.
    const attempt = navigator.clipboard ? navigator.clipboard.writeText(input.value) : Promise.reject();
    attempt.then(
      () => flash(true, "Copied to clipboard", 4000),
      () => {
        input.select();
        flash(false, "Click the copy icon to copy");
      },
    );
  }
}

// Show/hide password. The buttons ship `hidden` so no-JS users never see a dead control.
for (const btn of document.querySelectorAll(".password-toggle")) {
  const input = document.getElementById(btn.getAttribute("aria-controls"));
  if (!input) continue;
  btn.hidden = false;
  btn.closest(".input-with-btn")?.classList.add("has-btn");
  // Keep focus (and the caret) in the input on mouse/touch clicks; keyboard users stay on the button.
  btn.addEventListener("mousedown", (e) => {
    if (document.activeElement === input) e.preventDefault();
  });
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    const hadFocus = document.activeElement === input;
    const { selectionStart, selectionEnd } = input;
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
    // Chrome moves the caret to the start after a type change made from a real click, and does it
    // asynchronously, so restoring it synchronously isn't enough.
    if (hadFocus && selectionStart !== null) {
      requestAnimationFrame(() => input.setSelectionRange(selectionStart, selectionEnd));
    }
  });
}

// Live password checklist. Rule parameters come from the server (data-policy) so they can't drift;
// the server still validates everything, including the common-password list that isn't shipped here.
const setRuleState = (li, ok) => {
  li.classList.toggle("ok", ok === true);
  li.classList.toggle("bad", ok === false);
  const state = li.querySelector("[data-state]");
  if (state) state.textContent = ok === null ? "" : ok ? " (done)" : " (not yet)";
};

for (const list of document.querySelectorAll(".pw-checklist[data-policy]")) {
  const policy = JSON.parse(list.dataset.policy);
  const input = document.getElementById(list.dataset.password);
  const usernameInput = list.dataset.usernameInput && document.getElementById(list.dataset.usernameInput);
  if (!input) continue;
  const classRes = policy.classPatterns.map((p) => new RegExp(p));
  const checks = {
    length: (chars) => chars.length >= policy.min && chars.length <= policy.max,
    classes: (chars) => {
      const seen = new Set(chars.map((ch) => classRes.findIndex((re) => re.test(ch))));
      return seen.size >= policy.minClasses;
    },
    username: (_chars, pw) => {
      const name = (usernameInput ? usernameInput.value : list.dataset.username || "").trim().toLowerCase();
      return name.length < policy.usernameMin || !pw.toLowerCase().includes(name);
    },
    repeated: (chars) => {
      const counts = new Map();
      for (const ch of chars) counts.set(ch.toLowerCase(), (counts.get(ch.toLowerCase()) || 0) + 1);
      return Math.max(0, ...counts.values()) <= chars.length * policy.maxSameShare;
    },
  };
  list.classList.add("live");
  const update = () => {
    const pw = input.value;
    const chars = [...pw];
    for (const li of list.querySelectorAll("li[data-rule]")) {
      const check = checks[li.dataset.rule];
      if (check) setRuleState(li, pw ? check(chars, pw) : null);
    }
  };
  input.addEventListener("input", update);
  usernameInput?.addEventListener("input", update);
  update();
}

for (const list of document.querySelectorAll(".pw-match")) {
  const input = document.getElementById(list.dataset.password);
  const confirm = document.getElementById(list.dataset.confirm);
  const li = list.querySelector("li");
  if (!input || !confirm || !li) continue;
  list.classList.add("live");
  const update = () => {
    list.hidden = !confirm.value;
    setRuleState(li, confirm.value ? confirm.value === input.value : null);
  };
  input.addEventListener("input", update);
  confirm.addEventListener("input", update);
  update();
}

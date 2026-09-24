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

// Header sync button. The server renders it disabled during the cooldown; count the label down and
// re-enable it at zero. The button is icon-only, so the countdown lives in its label and tooltip.
for (const btn of document.querySelectorAll("button[data-retry-after]")) {
  let left = Number(btn.dataset.retryAfter);
  if (!Number.isFinite(left)) continue;
  const setLabel = (label) => {
    btn.setAttribute("aria-label", label);
    btn.title = label;
  };
  const tick = () => {
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.removeAttribute("data-retry-after");
      setLabel(btn.dataset.readyLabel || "Sync Now");
      return;
    }
    setLabel(`Sync available in ${left}s`);
    left--;
  };
  const timer = setInterval(tick, 1000);
  tick();
}

// The sync POST redirects back to this page once the sync finishes (a few seconds); spin meanwhile.
for (const form of document.querySelectorAll("form.sync-form")) {
  const btn = form.querySelector(".sync-btn");
  form.addEventListener("submit", (e) => {
    if (btn.classList.contains("is-syncing")) {
      e.preventDefault();
      return;
    }
    btn.classList.add("is-syncing");
    btn.setAttribute("aria-busy", "true");
    btn.setAttribute("aria-label", "Syncing…");
    btn.title = "Syncing…";
  });
}
// A tab left open would otherwise keep saying "just now". Mirrors formatRelative in src/views/format.ts.
const relativeTime = (iso) => {
  const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 86400 * 30) return `${Math.round(seconds / 86400)}d ago`;
  return iso.slice(0, 10);
};
const syncTime = document.querySelector("time.sync-time[datetime]");
if (syncTime) setInterval(() => (syncTime.textContent = relativeTime(syncTime.dateTime)), 30_000);

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
  const showIcon = btn.querySelector("[data-show-icon]");
  const hideIcon = btn.querySelector("[data-hide-icon]");
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    const hadFocus = document.activeElement === input;
    const { selectionStart, selectionEnd } = input;
    input.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    const label = show ? "Hide Password" : "Show Password";
    btn.setAttribute("aria-label", label);
    btn.title = label;
    if (showIcon) showIcon.hidden = show;
    if (hideIcon) hideIcon.hidden = !show;
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

// Header player switcher. The server renders a plain <details> with submit buttons (works without JS);
// here it becomes a menu button: roles, aria-expanded, arrow keys, and Esc / outside-click to close.
for (const menu of document.querySelectorAll("details.player-menu")) {
  const trigger = menu.querySelector("summary");
  const panel = menu.querySelector(".menu");
  if (!trigger || !panel) continue;
  const items = [...panel.querySelectorAll("[data-menu-item]")];
  panel.id ||= "player-menu";
  panel.setAttribute("role", "menu");
  for (const el of panel.querySelectorAll("form, .menu-note")) el.setAttribute("role", "none");
  for (const item of items) {
    const radio = item.dataset.menuItem === "radio";
    item.setAttribute("role", radio ? "menuitemradio" : "menuitem");
    if (radio) item.setAttribute("aria-checked", String(item.getAttribute("aria-current") === "true"));
    item.removeAttribute("aria-current");
    item.tabIndex = -1;
  }
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-controls", panel.id);
  trigger.setAttribute("aria-expanded", "false");

  const focusItem = (i) => items[(i + items.length) % items.length]?.focus();
  const close = (refocus) => {
    menu.open = false;
    if (refocus) trigger.focus();
  };
  menu.addEventListener("toggle", () => {
    trigger.setAttribute("aria-expanded", String(menu.open));
    if (menu.open) {
      const checked = items.findIndex((el) => el.getAttribute("aria-checked") === "true");
      focusItem(Math.max(0, checked));
    }
  });
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      menu.open = true;
    }
  });
  panel.addEventListener("keydown", (e) => {
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") focusItem(i + 1);
    else if (e.key === "ArrowUp") focusItem(i - 1);
    else if (e.key === "Home") focusItem(0);
    else if (e.key === "End") focusItem(items.length - 1);
    else if (e.key === "Escape") close(true);
    else if (e.key === "Tab") return close(false);
    else return;
    e.preventDefault();
  });
  // <details> has no light-dismiss of its own.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.open && menu.contains(document.activeElement)) close(true);
  });
  document.addEventListener("click", (e) => {
    if (menu.open && !menu.contains(e.target)) close(false);
  });
}

// Battle rows: the time cell holds the real link (keyboard focus target, no-JS fallback, and what
// ctrl/cmd/middle-click open in a new tab); a plain click anywhere on the row opens it in a dialog.
// Assigned below when the dialog is supported; live filters call it on rows they swap in.
let wireBattleRows = () => {};
const modalTemplate = document.getElementById("battle-modal-template");
if (modalTemplate && "HTMLDialogElement" in window) {
  const dialog = modalTemplate.content.firstElementChild.cloneNode(true);
  document.body.append(dialog);
  const body = dialog.querySelector(".modal-body");
  const fullLink = dialog.querySelector(".modal-full");
  let opener = null;
  let request = 0;
  // True while the dialog owns the history entry it pushed, so closing it should go back.
  let ownsEntry = false;

  const setStatus = (html, busy) => {
    body.setAttribute("aria-busy", String(busy));
    body.innerHTML = `<div class="modal-status">${html}</div>`;
  };

  const load = async (href) => {
    const id = ++request;
    fullLink.href = href;
    setStatus('<p class="muted">Loading battle…</p>', true);
    try {
      const res = await fetch(`${href}?partial=1`, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (id !== request) return;
      // A redirect means the session ended (login page); let the full page handle it.
      if (res.redirected) {
        location.href = href;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      body.innerHTML = await res.text();
      body.setAttribute("aria-busy", "false");
      body.scrollTop = 0;
    } catch {
      if (id !== request) return;
      setStatus('<p>Couldn’t load this battle.</p><p><a class="btn btn-secondary btn-small" href="">Open the battle page</a></p>', false);
      body.querySelector(".modal-status a").href = href;
    }
    body.focus();
  };

  const open = (href, link, { push = true } = {}) => {
    opener = link;
    if (!dialog.open) {
      dialog.showModal();
      document.body.classList.add("modal-open");
    }
    if (push) {
      history.pushState({ battleModal: href }, "", href);
      ownsEntry = true;
    }
    load(href);
  };

  dialog.addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    request++;
    body.innerHTML = "";
    if (ownsEntry) {
      ownsEntry = false;
      history.back();
    }
    opener?.focus();
  });
  dialog.querySelector(".modal-close").addEventListener("click", () => dialog.close());
  // A click whose target is the <dialog> itself landed on the backdrop (content fills the box otherwise).
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });

  window.addEventListener("popstate", (e) => {
    const href = e.state?.battleModal;
    if (href) {
      // Forward onto an entry we pushed earlier: reopen it without pushing again.
      ownsEntry = true;
      open(href, document.querySelector(`.battle-row a.row-link[href="${CSS.escape(href)}"]`), { push: false });
    } else if (dialog.open) {
      ownsEntry = false;
      dialog.close();
    }
  });

  const modified = (e) => e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
  wireBattleRows = (root) => {
    for (const row of root.querySelectorAll("tr.battle-row[data-href]:not(.is-clickable)")) {
      const link = row.querySelector("a.row-link");
      if (!link) continue;
      row.classList.add("is-clickable");
      row.addEventListener("click", (e) => {
        const onLink = e.target.closest("a") === link;
        // Other controls in the row keep their own behaviour.
        if (!onLink && e.target.closest("a, button, input, select, textarea, summary, label")) return;
        // Don't turn a text selection drag into a navigation.
        if (!onLink && String(getSelection()).length > 0) return;
        if (modified(e)) {
          if (!onLink && (e.ctrlKey || e.metaKey)) window.open(link.href, "_blank", "noopener");
          return;
        }
        e.preventDefault();
        open(link.getAttribute("href"), link);
      });
      row.addEventListener("auxclick", (e) => {
        if (e.button === 1 && e.target.closest("a") !== link && !e.target.closest("a, button")) {
          window.open(link.href, "_blank", "noopener");
        }
      });
    }
  };
  wireBattleRows(document);
}

// Live filters: a filter form with data-live-filter applies as soon as a select or checkbox changes, and
// 500ms after typing stops in a text box. It fetches the same page with the new query and swaps every
// [data-live-swap] element by id, so the form itself (focus, caret, half-typed text) is never replaced.
// The URL is updated in place so reloads and bookmarks keep the filters. Without JS the form's
// <noscript> Apply button submits it normally.
for (const form of document.querySelectorAll("form[data-live-filter]")) {
  let timer;
  let controller;
  const regions = () => document.querySelectorAll(".live-results");

  const urlFor = () => {
    const url = new URL(form.getAttribute("action") || location.pathname, location.href);
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === "string" && v.trim() !== "") params.append(k, v);
    url.search = params.toString();
    return url;
  };

  const apply = async () => {
    clearTimeout(timer);
    const url = urlFor();
    controller?.abort();
    controller = new AbortController();
    for (const r of regions()) r.setAttribute("aria-busy", "true");
    try {
      const res = await fetch(url, { signal: controller.signal, credentials: "same-origin", headers: { Accept: "text/html" } });
      // Session ended (login redirect) or an error page: let a real navigation show it.
      if (res.redirected || !res.ok) {
        location.href = url.href;
        return;
      }
      const doc = new DOMParser().parseFromString(await res.text(), "text/html");
      for (const el of document.querySelectorAll("[data-live-swap][id]")) {
        const fresh = doc.getElementById(el.id);
        if (fresh) el.replaceWith(document.adoptNode(fresh));
      }
      history.replaceState(history.state, "", url.pathname + url.search);
      wireBattleRows(document);
    } catch (err) {
      if (err.name !== "AbortError") location.href = url.href;
    } finally {
      for (const r of regions()) r.removeAttribute("aria-busy");
    }
  };

  form.addEventListener("input", (e) => {
    if (!e.target.matches('input[type="search"], input[type="text"]')) return;
    clearTimeout(timer);
    timer = setTimeout(apply, 500);
  });
  form.addEventListener("change", (e) => {
    if (!e.target.matches("select, input[type=checkbox], input[type=radio]")) return;
    // A new sort starts in its own natural order rather than inheriting the last one's.
    if (e.target.name === "sort" && form.elements.order) form.elements.order.value = "";
    apply();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    apply();
  });
  // These links are swapped with the results, so listen on the form rather than on them.
  form.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-order-toggle]");
    const clear = e.target.closest("[data-live-clear]");
    if ((!toggle && !clear) || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    if (toggle && form.elements.order) form.elements.order.value = toggle.dataset.nextOrder;
    if (clear) {
      for (const el of form.elements) {
        if (el.type === "checkbox") el.checked = false;
        else if (el.type === "search" || el.type === "text") el.value = "";
      }
    }
    apply();
  });
}

// Progressive enhancement only; every page must work without this file.
// Lets CSS hide no-JS fallbacks (the deck page's typed card inputs) once this file runs.
document.documentElement.classList.add("js");

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
// Header forms carry the `next` rendered at page load, but live filters and the pager rewrite the URL in
// place since; send the URL on screen now, or the redirect brings back the old filters and page.
for (const input of document.querySelectorAll('form.sync-form input[name="next"], details.player-menu input[name="next"]')) {
  input.form.addEventListener("submit", () => (input.value = location.pathname + location.search));
}

// Save shows only once a field differs from what the server rendered; without JS it is always visible.
for (const form of document.querySelectorAll("form[data-save-on-change]")) {
  const btn = form.querySelector('button[type="submit"]');
  const inputs = [...form.querySelectorAll("input")];
  const update = () => (btn.hidden = inputs.every((i) => i.value.trim() === i.defaultValue));
  form.addEventListener("input", update);
  update();
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

// Server renders dates as formatDateTime in src/views/format.ts ("YYYY-MM-DD HH:mm UTC"); this rewrites
// them in the viewer's timezone. Titles may wrap that UTC text in more words, so only it is replaced.
const pad2 = (n) => String(n).padStart(2, "0");
const localDateTime = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};
const utcDateTime = (iso) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
// The data attributes are removed once handled, so re-running on a root only touches new content.
const localizeTimes = (root) => {
  for (const el of root.querySelectorAll("time[data-local-time]")) {
    el.textContent = localDateTime(el.dateTime);
    el.removeAttribute("data-local-time");
  }
  for (const el of root.querySelectorAll("[data-local-title]")) {
    const iso = el.getAttribute("data-local-title");
    el.title = el.title.replace(utcDateTime(iso), localDateTime(iso));
    el.removeAttribute("data-local-title");
  }
};
localizeTimes(document);

// Deck page (src/routes/pages/decks.tsx): one form with a view and an edit mode. The datalist doubles as
// the client-side card catalog, so tiles redraw as cards are typed; the server renders the same markup.
// Set when a deck saved inside the dialog, so closing it refreshes the deck list behind it.
let deckSavedInDialog = false;
const FORM_BITS = { evo: 1, hero: 2 };
const FORM_LABELS = { evo: "Evo", hero: "Hero" };
// Mirrors deckSlotForms in src/domain/deckSlots.ts: slot 1 Evo, slot 2 Hero, slot 3 (Wild) either.
const SLOT_FORMS = [["evo"], ["hero"], ["evo", "hero"]];
const slotAvailable = (index, forms) => (SLOT_FORMS[index] ?? []).filter((f) => forms & FORM_BITS[f]);

// Redraws a .card-icon (deck tile or picker card) for a datalist option shown in `shown` form (or base).
const fillCardIcon = (fig, name, opt, shown) => {
  const src = opt && ((shown === "evo" && opt.dataset.iconEvo) || (shown === "hero" && opt.dataset.iconHero) || opt.dataset.icon);
  fig.classList.toggle("evolved", shown === "evo");
  fig.classList.toggle("hero", shown === "hero");
  fig.classList.remove("img-failed");
  fig.title = name;
  fig.textContent = "";
  if (src) fig.append(Object.assign(document.createElement("img"), { src, alt: name, loading: "lazy" }));
  const fallback = document.createElement("span");
  fallback.className = "card-fallback";
  fallback.textContent = name;
  fig.append(fallback);
};

// Levels show what the held copies already pay for, like Collection's Max Out sort ("from Lv n").
// Pass the option only for an owned card.
const renderLevelBadge = (fig, fromEl, opt) => {
  fig.querySelector(".card-level")?.remove();
  fromEl.textContent = "";
  if (!opt?.dataset.to) return;
  const badge = document.createElement("span");
  badge.className = "card-level";
  badge.textContent = `Lv ${opt.dataset.to}`;
  fig.append(badge);
  if (Number(opt.dataset.to) > Number(opt.dataset.level)) fromEl.textContent = `from Lv ${opt.dataset.level}`;
};

const SLOT_NAMES = ["Evo", "Hero", "Wild"];
const RARITIES = ["common", "rare", "epic", "legendary", "champion"];
const CARD_TYPES = ["troop", "spell", "building"];
const capitalize = (s) => s[0].toUpperCase() + s.slice(1);
const CLOSE_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 6L6 18M6 6l12 12"/></svg>';

// Card picker for one deck slot, built from the deck page's datalist options. It lives on <body>, not in the
// deck form, so its inputs never submit with the deck; when the deck is in the app dialog it stacks above it.
const openCardPicker = ({ slot, options, onPick, returnFocus }) => {
  const hasPlayer = options.some((o) => o.dataset.owned !== undefined);
  const label = SLOT_NAMES[slot] ? `Slot ${slot + 1} · ${SLOT_NAMES[slot]}` : `Slot ${slot + 1}`;
  const picker = document.createElement("dialog");
  picker.className = "modal card-picker";
  picker.setAttribute("aria-label", `Choose a card for ${label}`);
  picker.innerHTML = `
    <div class="modal-head">
      <span class="modal-title"></span>
      <div class="spacer"></div>
      <button type="button" class="icon-btn" data-picker-close aria-label="Close" title="Close">${CLOSE_SVG}</button>
    </div>
    <div class="picker-filters">
      <input type="search" placeholder="Search cards" aria-label="Search cards" autocomplete="off" />
      <div class="picker-chips" role="group" aria-label="Rarity" data-filter="rarity"></div>
      <div class="picker-chips" role="group" aria-label="Type" data-filter="kind"></div>
    </div>
    <div class="modal-body picker-grid" tabindex="-1"></div>`;
  picker.querySelector(".modal-title").textContent = label;
  const filters = picker.querySelector(".picker-filters");
  const search = filters.querySelector('input[type="search"]');
  const grid = picker.querySelector(".picker-grid");
  const chosen = { rarity: new Set(), kind: new Set() };
  for (const [key, values] of [["rarity", RARITIES], ["kind", CARD_TYPES]]) {
    const box = filters.querySelector(`[data-filter="${key}"]`);
    for (const v of values) {
      const chip = Object.assign(document.createElement("button"), { type: "button", className: "picker-chip", textContent: capitalize(v) });
      chip.dataset.value = v;
      chip.setAttribute("aria-pressed", "false");
      box.append(chip);
    }
  }
  let allToggle = null;
  if (hasPlayer) {
    const sw = document.createElement("label");
    sw.className = "switch";
    sw.title = "Off: only cards you own, at your levels";
    allToggle = Object.assign(document.createElement("input"), { type: "checkbox", checked: true });
    allToggle.setAttribute("role", "switch");
    sw.append(allToggle, "All");
    filters.append(sw);
  }

  const renderGrid = () => {
    const q = search.value.trim().toLowerCase();
    const ownedOnly = allToggle ? !allToggle.checked : false;
    grid.textContent = "";
    for (const opt of options) {
      const d = opt.dataset;
      if (q && !opt.value.toLowerCase().includes(q)) continue;
      if (chosen.rarity.size && !chosen.rarity.has(d.rarity)) continue;
      if (chosen.kind.size && !chosen.kind.has(d.kind)) continue;
      if (ownedOnly && d.owned !== "1") continue;
      const held = ownedOnly ? Number(d.have ?? 0) : -1;
      const forms = slotAvailable(slot, Number(d.forms)).filter((f) => held & FORM_BITS[f]);
      const shown = forms[0] ?? null;

      const card = document.createElement("div");
      card.className = "picker-card";
      card.dataset.value = opt.value;
      const tags = document.createElement("div");
      tags.className = "slot-forms";
      for (const f of forms) {
        // Two forms: each tag is its own choice. One: a plain label, and the whole card picks it.
        const tag = document.createElement(forms.length > 1 ? "button" : "span");
        tag.className = `form-tag form-${f}${f === shown ? " is-active" : ""}`;
        tag.textContent = FORM_LABELS[f];
        if (forms.length > 1) {
          tag.type = "button";
          tag.dataset.form = f;
          tag.setAttribute("aria-label", `${opt.value}, ${FORM_LABELS[f]}`);
        }
        tags.append(tag);
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "picker-pick";
      btn.dataset.form = shown ?? "";
      // A span, not a figure: a button may only hold phrasing content.
      const fig = document.createElement("span");
      fig.className = "card-icon";
      fillCardIcon(fig, opt.value, opt, shown);
      btn.append(fig);
      if (ownedOnly) {
        const from = Object.assign(document.createElement("span"), { className: "slot-from muted small" });
        renderLevelBadge(fig, from, opt);
        btn.append(from);
      }
      btn.append(Object.assign(document.createElement("span"), { className: "coll-name", textContent: opt.value }));
      card.append(tags, btn);
      grid.append(card);
    }
    if (!grid.childElementCount) grid.innerHTML = '<p class="muted picker-empty">No cards match.</p>';
  };

  const hadModalOpen = document.body.classList.contains("modal-open");
  const close = () => picker.open && picker.close();
  picker.addEventListener("close", () => {
    picker.remove();
    if (!hadModalOpen) document.body.classList.remove("modal-open");
    returnFocus?.focus();
  });
  // Escape and close events stay on this dialog: it is a sibling of the app dialog on <body>, not inside it.
  picker.addEventListener("click", (e) => {
    if (e.target === picker) return close();
    if (e.target.closest("[data-picker-close]")) return close();
    const chip = e.target.closest(".picker-chip");
    if (chip) {
      const set = chosen[chip.parentElement.dataset.filter];
      const on = !set.has(chip.dataset.value);
      if (on) set.add(chip.dataset.value);
      else set.delete(chip.dataset.value);
      chip.setAttribute("aria-pressed", String(on));
      return renderGrid();
    }
    const card = e.target.closest(".picker-card");
    if (!card) return;
    const form = (e.target.closest("[data-form]") ?? card.querySelector(".picker-pick")).dataset.form;
    close();
    onPick(card.dataset.value, form || null);
  });
  search.addEventListener("input", renderGrid);
  allToggle?.addEventListener("change", renderGrid);

  renderGrid();
  document.body.append(picker);
  document.body.classList.add("modal-open");
  picker.showModal();
  search.focus();
};

const wireDeckPage = (root) => {
  for (const form of root.querySelectorAll("form[data-deck-page]:not([data-wired])")) {
    form.setAttribute("data-wired", "");
    const deckId = form.dataset.deckId;
    const options = new Map();
    for (const o of form.querySelectorAll("#card-names option")) options.set(o.value.toLowerCase(), o);
    const tiles = [...form.querySelectorAll(".deck-slot")];
    const levelToggle = form.querySelector("[data-level-toggle]");
    const avgEl = form.querySelector("[data-avg-elixir]");

    const optionFor = (tile) => options.get(tile.querySelector('input[name="cards"]').value.trim().toLowerCase());

    // Kept outside the DOM: retyping slot 3 passes through names with no forms, which empties the radios.
    const savedSlot3 = form.querySelector('input[name="slot3Form"]:checked')?.value ?? "evo";
    let slot3Choice = savedSlot3;

    const renderForms = (tile, index, opt) => {
      const box = tile.querySelector(".slot-forms");
      const available = opt ? slotAvailable(index, Number(opt.dataset.forms)) : [];
      box.textContent = "";
      for (const f of available) {
        if (available.length > 1) {
          const label = document.createElement("label");
          label.className = `form-tag form-${f}`;
          const radio = Object.assign(document.createElement("input"), { type: "radio", name: "slot3Form", value: f });
          radio.checked = f === (available.includes(slot3Choice) ? slot3Choice : "evo");
          radio.disabled = form.dataset.mode !== "edit";
          label.append(radio, FORM_LABELS[f]);
          box.append(label);
        } else {
          const span = document.createElement("span");
          span.className = `form-tag form-${f} is-active`;
          span.textContent = FORM_LABELS[f];
          box.append(span);
        }
      }
    };

    const tagForm = (tag) => (tag.classList.contains("form-hero") ? "hero" : "evo");

    // The deck's form for the slot, from the tags: the checked radio for two, the only tag otherwise.
    const activeForm = (tile) => {
      const tags = tile.querySelectorAll(".slot-forms .form-tag");
      if (tags.length > 1) return tile.querySelector(".slot-forms input:checked")?.value ?? null;
      return tags[0] ? tagForm(tags[0]) : null;
    };

    // Null when My Cards is off or there is no player data, so every form counts as held.
    const heldForms = (opt) => {
      if (!form.hasAttribute("data-levels") || opt?.dataset.owned === undefined) return null;
      return opt.dataset.owned === "1" ? Number(opt.dataset.have ?? 0) : 0;
    };

    // The form the tile shows: the deck's form, else (My Cards on) another form of this slot the player holds.
    const effectiveForm = (tile, opt) => {
      const active = activeForm(tile);
      const held = heldForms(opt);
      if (!active || held === null) return active;
      const usable = [...tile.querySelectorAll(".slot-forms .form-tag")].map(tagForm).filter((f) => held & FORM_BITS[f]);
      return usable.includes(active) ? active : (usable[0] ?? null);
    };

    const renderArt = (tile, opt, shown) => {
      const name = opt ? opt.value : tile.querySelector('input[name="cards"]').value.trim();
      fillCardIcon(tile.querySelector(".card-icon"), name, opt, opt ? shown : null);
    };

    // State 3 (not owned) outlines the tile red; state 2 (owned, lacks every form this slot offers) grey.
    const renderLevels = (tile, opt, shown) => {
      const held = heldForms(opt);
      const on = held !== null;
      const owned = on && opt.dataset.owned === "1";
      tile.classList.toggle("not-owned", on && !owned);
      tile.classList.toggle("form-missing", owned && activeForm(tile) !== null && shown === null);
      for (const tag of tile.querySelectorAll(".slot-forms .form-tag")) {
        const f = tagForm(tag);
        tag.hidden = on && !(held & FORM_BITS[f]);
        // With two tags the checked radio lights one; My Cards may show the other, so light that instead.
        if (tag.tagName === "LABEL") tag.classList.toggle("is-active", on && f === shown);
      }
      renderLevelBadge(tile.querySelector(".card-icon"), tile.querySelector(".slot-from"), owned ? opt : null);
    };

    // Mirrors averageElixir + formatElixir on the server over the known cards: one without a cost (Mirror) blanks it.
    const renderAvg = () => {
      const known = tiles.map(optionFor).filter(Boolean);
      const blank = !known.length || known.some((o) => o.dataset.elixir === undefined);
      const sum = known.reduce((total, o) => total + Number(o.dataset.elixir), 0);
      if (avgEl) avgEl.textContent = blank ? "–" : (sum / known.length).toFixed(1);
    };

    const renderTile = (tile, { forms = true } = {}) => {
      const opt = optionFor(tile);
      if (forms) renderForms(tile, Number(tile.dataset.slot), opt);
      const shown = effectiveForm(tile, opt);
      renderArt(tile, opt, shown);
      renderLevels(tile, opt, shown);
    };
    const renderAll = () => {
      for (const tile of tiles) renderTile(tile);
      renderAvg();
    };

    const setMode = (mode) => {
      form.dataset.mode = mode;
      for (const radio of form.querySelectorAll('input[name="slot3Form"]')) radio.disabled = mode !== "edit";
      for (const tile of tiles) {
        const fig = tile.querySelector(".card-icon");
        if (mode === "edit") {
          fig.tabIndex = 0;
          fig.setAttribute("role", "button");
          fig.setAttribute("aria-label", `Choose card ${Number(tile.dataset.slot) + 1}`);
        } else {
          fig.removeAttribute("tabindex");
          fig.removeAttribute("role");
          fig.removeAttribute("aria-label");
        }
      }
    };

    const pick = (tile, value, chosen) => {
      tile.querySelector('input[name="cards"]').value = value;
      if (Number(tile.dataset.slot) === 2 && chosen) slot3Choice = chosen;
      renderTile(tile);
      renderAvg();
    };
    const openPicker = (tile) => {
      const inDeck = new Set(tiles.map((t) => t.querySelector('input[name="cards"]').value.trim().toLowerCase()));
      openCardPicker({
        slot: Number(tile.dataset.slot),
        options: [...options.values()].filter((o) => !inDeck.has(o.value.toLowerCase())),
        onPick: (value, chosen) => pick(tile, value, chosen),
        returnFocus: tile.querySelector(".card-icon"),
      });
    };
    // Click only: the drag-to-reorder handler swallows the click that ends a drag, which must not open this.
    form.addEventListener("click", (e) => {
      const tile = e.target.closest(".deck-slot");
      if (!tile || form.dataset.mode !== "edit" || e.target.closest(".slot-forms, input")) return;
      openPicker(tile);
    });
    form.addEventListener("keydown", (e) => {
      if ((e.key !== "Enter" && e.key !== " ") || form.dataset.mode !== "edit") return;
      const fig = e.target.closest(".deck-slot .card-icon");
      if (!fig || fig !== e.target) return;
      e.preventDefault();
      openPicker(fig.closest(".deck-slot"));
    });

    form.addEventListener("input", (e) => {
      const tile = e.target.closest(".deck-slot");
      if (!tile || e.target.name !== "cards") return;
      renderTile(tile);
      renderAvg();
    });
    form.addEventListener("change", (e) => {
      const tile = e.target.closest(".deck-slot");
      if (!tile || e.target.name !== "slot3Form") return;
      slot3Choice = e.target.value;
      renderTile(tile, { forms: false });
    });
    levelToggle?.addEventListener("change", () => {
      form.toggleAttribute("data-levels", levelToggle.checked);
      for (const tile of tiles) renderTile(tile, { forms: false });
    });

    form.querySelector("[data-deck-edit]")?.addEventListener("click", (e) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setMode("edit");
      form.elements.name?.focus();
    });
    if (deckId) {
      const viewUrl = new URL(form.action);
      // Drop ?edit=1 so a reload shows the deck, not the editor.
      const inDialog = Boolean(form.closest("dialog"));
      const leaveEditUrl = () => {
        const path = viewUrl.pathname;
        if (inDialog ? !history.state?.battleModal : location.pathname !== path) return;
        const state = inDialog ? { ...history.state, battleModal: path } : history.state;
        history.replaceState(state, "", path);
        if (inDialog) form.closest("dialog").querySelector(".modal-full").href = path;
      };

      // Swaps in the server's partial for this deck; null when the caller should fall back to a navigation.
      const swap = async (init) => {
        const url = new URL(viewUrl);
        url.searchParams.set("partial", "1");
        let res;
        try {
          res = await fetch(url, { ...init, credentials: "same-origin", headers: { Accept: "text/html" } });
        } catch {
          return null;
        }
        if (res.redirected) {
          location.href = form.action;
          return res;
        }
        const levels = levelToggle?.checked;
        const holder = document.createElement("div");
        holder.innerHTML = await res.text();
        const fresh = holder.firstElementChild;
        if (!fresh?.matches("form[data-deck-page]")) return null;
        form.replaceWith(fresh);
        const freshToggle = fresh.querySelector("[data-level-toggle]");
        if (freshToggle && levels) freshToggle.checked = true;
        wireDeckPage(fresh.parentElement);
        if (freshToggle && levels) freshToggle.dispatchEvent(new Event("change"));
        localizeTimes(fresh);
        for (const img of fresh.querySelectorAll(".card-icon img")) {
          if (img.complete && img.naturalWidth === 0) markBroken(img);
        }
        return res;
      };

      const cancel = form.querySelector("[data-deck-cancel]");
      cancel?.addEventListener("click", async (e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        // After a failed save the form's defaults are the rejected values, so reset() can't bring back the deck.
        if (form.querySelector(".flash-error")) {
          if (!(await swap({ method: "GET" }))) location.href = cancel.href;
          else leaveEditUrl();
          return;
        }
        const levels = levelToggle?.checked;
        form.reset();
        // reset() also unchecks the level switch, which is a view setting rather than deck data.
        if (levelToggle) levelToggle.checked = levels;
        // Radios rebuilt for a since-changed card have no server default for reset() to restore.
        slot3Choice = savedSlot3;
        renderAll();
        setMode("view");
        leaveEditUrl();
      });
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        const res = await swap({ method: "POST", body: new FormData(form) });
        if (!res) {
          form.submit();
          return;
        }
        if (!res.ok || res.redirected) return;
        if (inDialog) deckSavedInDialog = true;
        leaveEditUrl();
      });
    }

    // Edit mode was chosen by the server; the radios must follow it after a client-side swap too.
    setMode(form.dataset.mode);
  }
};
wireDeckPage(document);

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
// Links with data-modal="<Kind>" (saved deck names) open their page's ?partial=1 in the same dialog.
let wireBattleRows = () => {};
const modalTemplate = document.getElementById("battle-modal-template");
if (modalTemplate && "HTMLDialogElement" in window) {
  const dialog = modalTemplate.content.firstElementChild.cloneNode(true);
  document.body.append(dialog);
  const body = dialog.querySelector(".modal-body");
  const fullLink = dialog.querySelector(".modal-full");
  const titleEl = dialog.querySelector(".modal-title");
  let opener = null;
  let request = 0;
  // True while the dialog owns the history entry it pushed, so closing it should go back.
  let ownsEntry = false;

  const setStatus = (html, busy) => {
    body.setAttribute("aria-busy", String(busy));
    body.innerHTML = `<div class="modal-status">${html}</div>`;
  };

  const load = async (href, kind) => {
    const id = ++request;
    fullLink.href = href;
    setStatus(`<p class="muted">Loading ${kind.toLowerCase()}…</p>`, true);
    try {
      const url = new URL(href, location.href);
      url.searchParams.set("partial", "1");
      const res = await fetch(url, { credentials: "same-origin", headers: { Accept: "text/html" } });
      if (id !== request) return;
      // A redirect means the session ended (login page); let the full page handle it.
      if (res.redirected) {
        location.href = href;
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      body.innerHTML = await res.text();
      localizeTimes(body);
      wireDeckPage(body);
      const heading = body.querySelector("h1[id]");
      if (heading) dialog.setAttribute("aria-labelledby", heading.id);
      body.setAttribute("aria-busy", "false");
      body.scrollTop = 0;
    } catch {
      if (id !== request) return;
      const noun = kind.toLowerCase();
      setStatus(`<p>Couldn’t load this ${noun}.</p><p><a class="btn btn-secondary btn-small" href="">Open the ${noun} page</a></p>`, false);
      body.querySelector(".modal-status a").href = href;
    }
    body.focus();
  };

  const open = (href, link, { push = true, kind = "Battle" } = {}) => {
    opener = link;
    titleEl.textContent = kind;
    if (!dialog.open) {
      dialog.showModal();
      document.body.classList.add("modal-open");
    }
    if (push) {
      history.pushState({ battleModal: href, modalKind: kind }, "", href);
      ownsEntry = true;
    }
    load(href, kind);
  };

  dialog.addEventListener("close", () => {
    document.body.classList.remove("modal-open");
    request++;
    body.innerHTML = "";
    if (deckSavedInDialog) {
      deckSavedInDialog = false;
      // liveShown, not location: history.back() below hasn't landed yet, so location is still the deck.
      if (document.querySelector(".live-results")) liveSwap(new URL(liveShown, location.href));
    }
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
      const sel = CSS.escape(href);
      const link = document.querySelector(`.battle-row[data-href="${sel}"], a[data-modal][href="${sel}"]`);
      open(href, link, { push: false, kind: e.state.modalKind ?? "Battle" });
    } else if (dialog.open) {
      ownsEntry = false;
      dialog.close();
    }
  });

  const modified = (e) => e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
  wireBattleRows = (root) => {
    for (const row of root.querySelectorAll("tr.battle-row[data-href]:not(.is-clickable)")) {
      const href = row.dataset.href;
      row.classList.add("is-clickable");
      // The row is the only way to open a battle, so it must be reachable and operable by keyboard.
      row.tabIndex = 0;
      row.setAttribute("aria-label", `Open battle: ${row.textContent.replace(/\s+/g, " ").trim().slice(0, 80)}`);
      row.addEventListener("click", (e) => {
        // Other controls in the row keep their own behaviour.
        if (e.target.closest("a, button, input, select, textarea, summary, label")) return;
        // Don't turn a text selection drag into a navigation.
        if (String(getSelection()).length > 0) return;
        if (modified(e)) {
          if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
          return;
        }
        open(href, row);
      });
      row.addEventListener("auxclick", (e) => {
        if (e.button === 1 && !e.target.closest("a, button")) window.open(href, "_blank", "noopener");
      });
      row.addEventListener("keydown", (e) => {
        if (e.target !== row || (e.key !== "Enter" && e.key !== " ")) return;
        e.preventDefault();
        open(href, row);
      });
    }
  };
  wireBattleRows(document);

  // Delegated, since live filters swap these links in and out.
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-modal]");
    if (!link || modified(e)) return;
    e.preventDefault();
    open(link.getAttribute("href"), link, { kind: link.dataset.modal });
  });
}

// Live results: fetch a page and swap every [data-live-swap] element by id, so the rest of the page (a
// filter form's focus, caret, half-typed text) is never replaced. A later call aborts an earlier one.
// Any failure falls back to a real navigation, which also shows the login page if the session ended.
let liveController;
// The URL whose results are on screen, so popstate can tell a pager step apart from a closed battle dialog.
let liveShown = location.pathname + location.search;
const liveSwap = async (url, { push = false } = {}) => {
  const regions = document.querySelectorAll(".live-results");
  liveController?.abort();
  const controller = (liveController = new AbortController());
  for (const r of regions) r.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(url, { signal: controller.signal, credentials: "same-origin", headers: { Accept: "text/html" } });
    if (res.redirected || !res.ok) {
      location.href = url.href;
      return false;
    }
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    for (const el of document.querySelectorAll("[data-live-swap][id]")) {
      const fresh = doc.getElementById(el.id);
      if (fresh) el.replaceWith(document.adoptNode(fresh));
    }
    liveShown = url.pathname + url.search;
    if (push) history.pushState({ live: true }, "", liveShown);
    else history.replaceState(history.state, "", liveShown);
    wireBattleRows(document);
    localizeTimes(document);
    wireDeckPage(document);
    return true;
  } catch (err) {
    if (err.name !== "AbortError") location.href = url.href;
    return false;
  } finally {
    if (controller === liveController) for (const r of regions) r.removeAttribute("aria-busy");
  }
};

// Pager links inside swapped results load in place. Each page gets its own history entry so Back steps
// through pages; popstate restores them. Listens on document because the links are swapped out.
if (document.querySelector("[data-live-swap]")) {
  document.addEventListener("click", async (e) => {
    const link = e.target.closest("[data-live-swap] .pager a[href]");
    if (!link || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (!(await liveSwap(new URL(link.href), { push: true }))) return;
    // The pager sits under the table; a long page would otherwise leave the new first rows off-screen.
    const section = document.querySelector("[data-live-swap] .pager")?.closest("section");
    if (section && section.getBoundingClientRect().top < 0) section.scrollIntoView({ block: "start" });
  });
  window.addEventListener("popstate", (e) => {
    // A battle dialog entry is handled above; closing it lands back on the results already shown.
    if (e.state?.battleModal || location.pathname + location.search === liveShown) return;
    liveSwap(new URL(location.href));
  });
}

// Live filters: a filter form with data-live-filter applies as soon as a select or checkbox changes, and
// 500ms after typing stops in a text box, via liveSwap. The URL is updated in place so reloads and
// bookmarks keep the filters. Without JS the form's <noscript> Apply button submits it normally.
for (const form of document.querySelectorAll("form[data-live-filter]")) {
  let timer;

  const urlFor = () => {
    const url = new URL(form.getAttribute("action") || location.pathname, location.href);
    const params = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === "string" && v.trim() !== "") params.append(k, v);
    url.search = params.toString();
    return url;
  };

  const apply = () => {
    clearTimeout(timer);
    liveSwap(urlFor());
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
        // A switch is a view mode like the sort, not a filter, so Clear leaves it alone.
        if (el.type === "checkbox" && el.getAttribute("role") !== "switch") el.checked = false;
        else if (el.type === "search" || el.type === "text") el.value = "";
      }
    }
    apply();
  });
}

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

document.addEventListener("DOMContentLoaded", () => {
  if (!navigator.clipboard) return;
  for (const el of document.querySelectorAll("[data-copy]")) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-secondary btn-small copy-btn";
    btn.textContent = "Copy";
    btn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(el.textContent.trim());
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Copy failed";
      }
    });
    el.after(btn);
  }
});

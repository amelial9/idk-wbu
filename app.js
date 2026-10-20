// app.js: wires the page together.
//
// The whole app state is one object, `state`:
//   {
//     tiers:  [{ key, name, color, weights: { good, normal, deserve, custom }, customOn }],
//     places: [{ id, name, tier, enabled }],
//     mood:   "good" | "normal" | "deserve" | "custom",
//   }
// Every change follows the same pattern: edit `state`, then call render().
// (Think of render functions as "rebuild this part of the page from state".)
//
// Nothing is saved. Every page load starts fresh from places.json, so edits
// made on the Places screen only last until the page is refreshed.

import { APP_NAME, STICKERS } from "./config.js";
import { MOODS, slices, pickIndex } from "./picker.js";
import { Wheel, colorSlices } from "./wheel.js";

// `$` is just a short name for "find one element by CSS selector".
const $ = (sel) => document.querySelector(sel);

let state = null;
let busy = false;         // true while any wheel is spinning
let lastScope = "combined";

const combinedWheel = new Wheel($("#wheel-combined"));
const tierWheels = new Map(); // tierKey -> { wheel, root }
let tierWheelKeys = "";       // which tiers the mini wheels were built for

// ==========================================================================
// Loading places.json
// ==========================================================================

async function loadPlaces() {
  try {
    const res = await fetch("places.json", { cache: "no-cache" });
    return normalize(await res.json());
  } catch (err) {
    console.error("Could not load places.json", err);
    return null;
  }
}

// Clean up data from places.json so the rest of the code can trust it
// (fills in defaults, drops broken entries). Throws an Error if it's not usable at all.
function normalize(data) {
  if (!data || !Array.isArray(data.tiers) || data.tiers.length === 0) {
    throw new Error("No tiers found");
  }
  const tiers = data.tiers
    .filter((t) => t && typeof t.key === "string" && t.key)
    .map((t) => ({
      key: t.key,
      name: String(t.name || t.key),
      color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : "#888888",
      weights: Object.fromEntries(
        MOODS.map((m) => [m, clamp(Number(t.weights?.[m]) || 0, 0, 100)])
      ),
      customOn: t.customOn !== false,
    }));
  if (tiers.length === 0) throw new Error("No valid tiers found");
  const tierKeys = new Set(tiers.map((t) => t.key));

  const places = (Array.isArray(data.places) ? data.places : [])
    .filter((p) => p && typeof p.name === "string" && p.name.trim())
    .map((p) => ({
      id: typeof p.id === "string" && p.id ? p.id : newId(),
      name: p.name.trim(),
      tier: tierKeys.has(p.tier) ? p.tier : tiers[0].key,
      enabled: p.enabled !== false,
    }));

  const mood = MOODS.includes(data.mood) ? data.mood : "normal";
  return { tiers, places, mood };
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

// Escape text before putting it inside HTML, so a place called "<b>" shows
// up as text instead of becoming a tag. Like html.escape() in Python.
function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// GIPHY image link for a sticker. With reduced motion turned on we use
// GIPHY's still version (giphy_s.gif) so nothing wiggles.
function stickerUrl(id) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return `https://media.giphy.com/media/${id}/${still ? "giphy_s" : "giphy"}.gif`;
}

function tierByKey(key) {
  return state.tiers.find((t) => t.key === key);
}

// ==========================================================================
// Rendering
// ==========================================================================

function render() {
  renderMood();
  renderTierWheelShells();
  renderWheels();
  renderPlaces();
}

// --- Mood meter ------------------------------------------------------------

function renderMood() {
  for (const radio of document.querySelectorAll('input[name="mood"]')) {
    radio.checked = radio.value === state.mood;
  }
  const moodSticker = $("#mood-sticker");
  const src = stickerUrl(STICKERS[state.mood]);
  if (moodSticker.src !== src) moodSticker.src = src;

  const panel = $("#custom-panel");
  panel.hidden = state.mood !== "custom";
  if (panel.hidden) return;

  panel.innerHTML = state.tiers
    .map(
      (t) => `
      <div class="custom-row">
        <label>
          <input type="checkbox" class="switch" data-tier="${esc(t.key)}" data-action="custom-on"
                 ${t.customOn ? "checked" : ""}>
          <span class="badge" style="--tier-color:${t.color}">${esc(t.name)}</span>
        </label>
        <input type="range" min="0" max="100" step="5" value="${t.weights.custom}"
               data-tier="${esc(t.key)}" data-action="custom-weight"
               aria-label="${esc(t.name)} weight" ${t.customOn ? "" : "disabled"}>
        <output>${t.weights.custom}</output>
      </div>`
    )
    .join("");
}

// --- Wheels ----------------------------------------------------------------

// Build one mini wheel card per tier. Only rebuilt when the set of tiers
// changes (e.g. after an Import), so spinning wheels aren't thrown away.
function renderTierWheelShells() {
  const keys = state.tiers.map((t) => t.key).join("|");
  if (keys !== tierWheelKeys) {
    tierWheelKeys = keys;
    tierWheels.clear();
    const grid = $("#tier-wheels");
    grid.innerHTML = "";
    for (const t of state.tiers) {
      const root = document.createElement("div");
      root.className = "tier-wheel";
      root.innerHTML = `
        <div class="wheel-wrap">
          <div class="pointer" aria-hidden="true"></div>
          <canvas></canvas>
        </div>
        <p class="empty empty-small" hidden>Nothing turned on</p>
        <div class="tier-wheel-info">
          <span class="badge"></span>
          <button class="btn btn-small" type="button" data-scope="${esc(t.key)}">Spin</button>
        </div>`;
      grid.appendChild(root);
      tierWheels.set(t.key, {
        root,
        wheel: new Wheel(root.querySelector("canvas"), { labels: false }),
      });
    }
  }
  // Names and colors can change without rebuilding.
  for (const t of state.tiers) {
    const { root } = tierWheels.get(t.key);
    const badge = root.querySelector(".badge");
    badge.textContent = t.name;
    badge.style.setProperty("--tier-color", t.color);
    root.querySelector("canvas").setAttribute("aria-label", `${t.name} wheel`);
  }
}

function slicesFor(scope) {
  return colorSlices(slices(state.places, state.tiers, state.mood, scope), state.tiers);
}

function renderWheels() {
  const combined = slicesFor("combined");
  combinedWheel.setSlices(combined);
  showEmpty($("#wheel-combined").parentElement, $("#empty-combined"), combined.length === 0);

  for (const [key, { root, wheel }] of tierWheels) {
    const s = slicesFor(key);
    wheel.setSlices(s);
    showEmpty(root.querySelector(".wheel-wrap"), root.querySelector(".empty"), s.length === 0);
  }
  updateSpinButtons();
}

function showEmpty(wheelEl, emptyEl, isEmpty) {
  wheelEl.hidden = isEmpty;
  emptyEl.hidden = !isEmpty;
}

function updateSpinButtons() {
  $("#spin-combined").disabled = busy || combinedWheel.slices.length === 0;
  for (const [key, { root, wheel }] of tierWheels) {
    root.querySelector("button").disabled = busy || wheel.slices.length === 0;
  }
  $("#spin-again").disabled = busy;
}

// --- Places screen ----------------------------------------------------------

function renderPlaces() {
  const container = $("#tier-sections");

  // Remember which "Tier settings" panels were open so re-rendering
  // doesn't snap them shut.
  const open = new Set(
    [...container.querySelectorAll("details[open]")].map((d) => d.dataset.tier)
  );

  const moodLabels = { good: "Being good", normal: "Normal day", deserve: "We deserve it" };

  container.innerHTML = state.tiers
    .map((t) => {
      const places = state.places.filter((p) => p.tier === t.key);
      const onCount = places.filter((p) => p.enabled).length;
      const tierOptions = (current) =>
        state.tiers
          .map((o) => `<option value="${esc(o.key)}" ${o.key === current ? "selected" : ""}>${esc(o.name)}</option>`)
          .join("");

      const rows = places
        .map(
          (p) => `
          <li class="place-row ${p.enabled ? "" : "is-off"}" data-id="${esc(p.id)}">
            <input type="checkbox" class="switch place-toggle" data-action="toggle"
                   ${p.enabled ? "checked" : ""} aria-label="${esc(p.name)} on or off">
            <input class="field place-name" data-action="rename" value="${esc(p.name)}" aria-label="Name">
            <select class="field place-move" data-action="move" aria-label="Tier for ${esc(p.name)}">
              ${tierOptions(p.tier)}
            </select>
            <button class="btn btn-small btn-danger place-delete" type="button" data-action="delete"
                    aria-label="Delete ${esc(p.name)}">Delete</button>
          </li>`
        )
        .join("");

      const weightInputs = Object.entries(moodLabels)
        .map(
          ([mood, label]) => `
          <label>${label}
            <input class="field" type="number" min="0" max="100" inputmode="numeric"
                   data-action="tier-weight" data-mood="${mood}" value="${t.weights[mood]}">
          </label>`
        )
        .join("");

      return `
        <section class="tier-section" data-tier="${esc(t.key)}" style="--tier-color:${t.color}">
          <div class="tier-section-head">
            <h2>${esc(t.name)}</h2>
            <span class="hint">${onCount} of ${places.length} on</span>
          </div>
          <details class="tier-settings" data-tier="${esc(t.key)}" ${open.has(t.key) ? "open" : ""}>
            <summary>Tier settings</summary>
            <div class="tier-settings-body">
              <label>Name <input class="field" data-action="tier-name" value="${esc(t.name)}"></label>
              <label>Color <input class="field" type="color" data-action="tier-color" value="${t.color}"></label>
              ${weightInputs}
            </div>
            <p class="hint">Weights are how much of the big wheel this tier gets in each mood. 0 = off.</p>
          </details>
          <ul class="place-list">${rows || '<li class="hint">No places yet.</li>'}</ul>
          <form class="add-place" data-tier="${esc(t.key)}">
            <input class="field" name="name" placeholder="Add a place" aria-label="New ${esc(t.name)} place" autocomplete="off">
            <button class="btn" type="submit">Add</button>
          </form>
        </section>`;
    })
    .join("");
}

// ==========================================================================
// Spinning and the result card
// ==========================================================================

function spin(scope) {
  if (busy) return;
  const wheel = scope === "combined" ? combinedWheel : tierWheels.get(scope)?.wheel;
  if (!wheel) return;

  // Pick FIRST (same weighted logic as picker.pick), then animate to it.
  const index = pickIndex(wheel.slices);
  if (index === -1) return;
  const place = wheel.slices[index].place;

  lastScope = scope;
  hideResult();
  busy = true;
  updateSpinButtons();
  wheel.spin(index, () => {
    busy = false;
    updateSpinButtons();
    showResult(place);
  });
}

function showResult(place) {
  const tier = tierByKey(place.tier);
  $("#result-name").textContent = place.name;
  const badge = $("#result-badge");
  badge.textContent = tier ? tier.name : place.tier;
  badge.style.setProperty("--tier-color", tier ? tier.color : "#888");
  $("#result").hidden = false;
  $("#spin-again").focus();
}

function hideResult() {
  $("#result").hidden = true;
}

// ==========================================================================
// Event handlers
// ==========================================================================

function setupEvents() {
  // Screen switching
  $("#nav-toggle").addEventListener("click", () => {
    const toPlaces = $("#screen-places").hidden;
    $("#screen-places").hidden = !toPlaces;
    $("#screen-wheel").hidden = toPlaces;
    $("#nav-toggle").textContent = toPlaces ? "Wheel" : "Places";
    window.scrollTo(0, 0);
    if (!toPlaces) renderWheels(); // canvases can't draw while hidden
  });

  // Mood meter (the 3 presets and Custom are one radio group)
  for (const radio of document.querySelectorAll('input[name="mood"]')) {
    radio.addEventListener("change", () => {
      state.mood = radio.value;
      render();
    });
  }

  // Custom panel: sliders update live without rebuilding the panel,
  // otherwise the slider would lose your finger mid-drag.
  $("#custom-panel").addEventListener("input", (e) => {
    if (e.target.dataset.action !== "custom-weight") return;
    const tier = tierByKey(e.target.dataset.tier);
    tier.weights.custom = Number(e.target.value);
    e.target.nextElementSibling.textContent = e.target.value;
    renderWheels();
  });
  $("#custom-panel").addEventListener("change", (e) => {
    if (e.target.dataset.action !== "custom-on") return;
    tierByKey(e.target.dataset.tier).customOn = e.target.checked;
    render();
  });

  // Spin buttons
  $("#spin-combined").addEventListener("click", () => spin("combined"));
  $("#tier-wheels").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-scope]");
    if (btn) spin(btn.dataset.scope);
  });
  $("#spin-again").addEventListener("click", () => spin(lastScope));

  // Result card closing: × button, tapping the backdrop, or Escape
  $("#result-close").addEventListener("click", hideResult);
  $("#result").addEventListener("click", (e) => {
    if (e.target.id === "result") hideResult();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideResult();
  });

  // Places screen. One listener for the whole list ("event delegation"):
  // each control says what it does in its data-action attribute.
  const sections = $("#tier-sections");

  sections.addEventListener("change", (e) => {
    const el = e.target;
    const action = el.dataset.action;
    const row = el.closest(".place-row");
    const place = row && state.places.find((p) => p.id === row.dataset.id);
    const tier = tierByKey(el.closest(".tier-section")?.dataset.tier);

    if (action === "toggle") place.enabled = el.checked;
    else if (action === "rename") {
      const name = el.value.trim();
      if (name) place.name = name; // empty name: just put the old one back
    } else if (action === "move") place.tier = el.value;
    else if (action === "tier-name") tier.name = el.value.trim() || tier.key;
    else if (action === "tier-color") tier.color = el.value;
    else if (action === "tier-weight") {
      tier.weights[el.dataset.mood] = clamp(Number(el.value) || 0, 0, 100);
    } else return;
    render();
  });

  sections.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="delete"]');
    if (!btn) return;
    const id = btn.closest(".place-row").dataset.id;
    const place = state.places.find((p) => p.id === id);
    if (!confirm(`Delete ${place.name}?`)) return;
    state.places = state.places.filter((p) => p.id !== id);
    render();
  });

  sections.addEventListener("submit", (e) => {
    e.preventDefault(); // stop the browser from reloading the page
    const form = e.target;
    const name = form.elements.name.value.trim();
    if (!name) return;
    state.places.push({ id: newId(), name, tier: form.dataset.tier, enabled: true });
    render();
    // Put the cursor back in the same box so you can add several in a row.
    $(`.add-place[data-tier="${CSS.escape(form.dataset.tier)}"] input`).focus();
  });

  // Redraw wheels when the screen size changes (e.g. phone rotates).
  window.addEventListener("resize", () => {
    combinedWheel.draw();
    for (const { wheel } of tierWheels.values()) wheel.draw();
  });
}

// ==========================================================================
// Start up
// ==========================================================================

async function main() {
  document.title = APP_NAME;
  $("#app-name").textContent = APP_NAME;
  for (const img of document.querySelectorAll("img[data-sticker]")) {
    img.src = stickerUrl(STICKERS[img.dataset.sticker]);
  }

  state = await loadPlaces();

  if (!state) {
    document.querySelector("main").innerHTML =
      '<p class="empty">Couldn\'t load places.json. If you opened index.html straight from disk, ' +
      "run a local server instead (see the README).</p>";
    return;
  }

  setupEvents();
  render();
}

main();

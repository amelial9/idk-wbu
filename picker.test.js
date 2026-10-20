// Run with:  node --test
// Uses Node's built-in test runner (like Python's unittest, nothing to install).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pick, slices } from "./picker.js";

const seed = JSON.parse(readFileSync(new URL("./places.json", import.meta.url)));
const tiers = seed.tiers;

// A tiny seeded random generator (mulberry32) so results are repeatable.
function seededRng(seedNum) {
  let a = seedNum >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Spin many times and collect the tiers that came up.
function tiersHit(places, mood, scope, n = 2000) {
  const rng = seededRng(1);
  const hit = new Set();
  for (let i = 0; i < n; i++) hit.add(pick(places, tiers, mood, scope, rng).tier);
  return hit;
}

test("mood filters tiers", () => {
  assert.deepEqual(tiersHit(seed.places, "good", "combined"), new Set(["green"]));
  assert.deepEqual(tiersHit(seed.places, "normal", "combined"), new Set(["green", "yellow"]));
  assert.deepEqual(tiersHit(seed.places, "deserve", "combined"), new Set(["green", "yellow", "red"]));
});

test("slice weights follow tier weight / places in tier", () => {
  const s = slices(seed.places, tiers, "normal", "combined");
  // green: 4 places share 0.7; yellow: 2 places share 0.3
  const chipotle = s.find((x) => x.place.name === "Chipotle");
  const tofu = s.find((x) => x.place.name === "Tofu house");
  assert.ok(Math.abs(chipotle.weight - 0.7 / 4) < 1e-9);
  assert.ok(Math.abs(tofu.weight - 0.3 / 2) < 1e-9);
  const sum = s.reduce((acc, x) => acc + x.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test("disabled places never appear", () => {
  const places = seed.places.map((p) => ({ ...p, enabled: p.name !== "Chipotle" }));
  const rng = seededRng(2);
  for (let i = 0; i < 2000; i++) {
    assert.notEqual(pick(places, tiers, "deserve", "combined", rng).name, "Chipotle");
  }
});

test("empty tier is dropped and weights renormalize", () => {
  // Turn off every yellow place: on "normal" only green is left, at 100%.
  const places = seed.places.map((p) => ({ ...p, enabled: p.tier !== "yellow" }));
  const s = slices(places, tiers, "normal", "combined");
  assert.ok(s.every((x) => x.place.tier === "green"));
  assert.ok(s.every((x) => Math.abs(x.weight - 0.25) < 1e-9));
});

test("single-tier scope ignores mood", () => {
  // Red is off on "good", but the red tier wheel still spins red only.
  assert.deepEqual(tiersHit(seed.places, "good", "red"), new Set(["red"]));
});

test("custom mode uses toggles and sliders", () => {
  const custom = tiers.map((t) => ({ ...t, customOn: t.key === "red" }));
  const rng = seededRng(3);
  for (let i = 0; i < 500; i++) {
    assert.equal(pick(seed.places, custom, "custom", "combined", rng).tier, "red");
  }
});

test("empty input returns null", () => {
  assert.equal(pick([], tiers, "deserve", "combined"), null);
  const allOff = seed.places.map((p) => ({ ...p, enabled: false }));
  assert.equal(pick(allOff, tiers, "deserve", "combined"), null);
  // "good" only has green, so with green all off there's nothing to pick
  const noGreen = seed.places.map((p) => ({ ...p, enabled: p.tier !== "green" }));
  assert.equal(pick(noGreen, tiers, "good", "combined"), null);
});

test("seeded rng gives repeatable results", () => {
  const run = () => {
    const rng = seededRng(42);
    return Array.from({ length: 20 }, () => pick(seed.places, tiers, "deserve", "combined", rng).name);
  };
  assert.deepEqual(run(), run());
});

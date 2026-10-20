// picker.js: the spin logic. No DOM, no browser stuff, so it can be tested
// with plain `node --test`.
//
// Quick JS notes for Python people:
//   - `export function f()` is like a public def that other files can import.
//   - `arr.filter(x => ...)` is a list comprehension with an `if`.
//   - `arr.map(x => ...)` is a list comprehension that transforms.
//   - `===` is plain equality (always use it instead of `==`).

// The moods the mood meter can be set to. Each tier stores one weight per mood
// in `tier.weights`, e.g. { good: 100, normal: 70, deserve: 50, custom: 50 }.
// A weight of 0 means "this tier is off for this mood".
export const MOODS = ["good", "normal", "deserve", "custom"];

// How much a tier counts for in the given mood. 0 = tier is off.
export function tierWeight(tier, mood) {
  if (mood === "custom" && !tier.customOn) return 0;
  const w = Number(tier.weights?.[mood]) || 0;
  return w > 0 ? w : 0;
}

// Build the list of wheel slices.
//
//   scope = "combined"  -> every enabled place whose tier is on for this mood
//   scope = "<tierKey>" -> every enabled place in that one tier (mood ignored)
//
// Returns a list like [{ place, weight }, ...] where the weights add up to 1.
// Each tier's share is split evenly among its places, so a tier with many
// places doesn't crowd out a tier with only a few. Empty list = nothing to spin.
export function slices(places, tiers, mood, scope) {
  // Which tiers are in play, and how much each one is worth.
  const tierShare = new Map(); // tierKey -> raw weight  (Map is like a dict)
  for (const tier of tiers) {
    if (scope === "combined") {
      const w = tierWeight(tier, mood);
      if (w > 0) tierShare.set(tier.key, w);
    } else if (tier.key === scope) {
      tierShare.set(tier.key, 1); // single-tier wheel: mood doesn't matter
    }
  }

  // Enabled places in those tiers, grouped by tier (keeps the list order).
  const eligible = places.filter((p) => p.enabled && tierShare.has(p.tier));
  const countByTier = new Map();
  for (const p of eligible) {
    countByTier.set(p.tier, (countByTier.get(p.tier) || 0) + 1);
  }

  // Drop tiers that ended up with zero places, then renormalize so the
  // remaining tier weights add up to 1.
  let total = 0;
  for (const [key, w] of tierShare) {
    if (countByTier.has(key)) total += w;
  }
  if (total === 0) return [];

  // Order slices by tier order so same-colored slices sit together.
  const tierOrder = tiers.map((t) => t.key);
  eligible.sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));

  return eligible.map((p) => ({
    place: p,
    weight: tierShare.get(p.tier) / total / countByTier.get(p.tier),
  }));
}

// Pick the index of one slice at random, respecting the weights.
// `rng` is a function returning a float in [0, 1), like Python's random.random.
export function pickIndex(sliceList, rng = Math.random) {
  if (sliceList.length === 0) return -1;
  let r = rng();
  for (let i = 0; i < sliceList.length; i++) {
    r -= sliceList[i].weight;
    if (r < 0) return i;
  }
  return sliceList.length - 1; // guard against float rounding
}

// The main function from the plan: returns the chosen place, or null.
export function pick(places, tiers, mood, scope, rng = Math.random) {
  const s = slices(places, tiers, mood, scope);
  const i = pickIndex(s, rng);
  return i === -1 ? null : s[i].place;
}

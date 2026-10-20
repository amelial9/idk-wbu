// wheel.js: draws a wheel on a <canvas> and animates a spin.
//
// The wheel never decides anything. app.js asks picker.js for a result first,
// then tells the wheel "spin until slice #i is under the pointer".

const FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

const TAU = Math.PI * 2; // one full turn in radians

export class Wheel {
  constructor(canvas, { labels = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.labels = labels;    // mini wheels skip text, it would be unreadable
    this.slices = [];        // [{ place, weight, color }]
    this.rotation = 0;       // current rotation in radians
    this.spinning = false;
    this.pending = null;     // slices handed to us mid-spin, applied after
  }

  // Replace the slices and redraw. Safe to call while spinning.
  setSlices(slices) {
    if (this.spinning) {
      this.pending = slices;
      return;
    }
    this.slices = slices;
    this.draw();
  }

  // Spin so that slice `index` ends up under the pointer at the top.
  // Calls onDone() when finished.
  spin(index, onDone) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Where the chosen slice starts and ends, as fractions of the circle.
    let start = 0;
    for (let i = 0; i < index; i++) start += this.slices[i].weight;
    const end = start + this.slices[index].weight;
    // Land somewhere inside the slice, not right on an edge.
    const target = start + (end - start) * (0.15 + Math.random() * 0.7);

    // A point at fraction f sits at angle rotation + f * TAU (0 = pointer).
    // So we need rotation = -target * TAU, plus a few full turns for drama.
    const wanted = mod(-target * TAU, TAU);
    const extra = mod(wanted - mod(this.rotation, TAU), TAU);
    const from = this.rotation;
    const to = this.rotation + extra + TAU * 5;

    if (reduceMotion) {
      this.rotation = to;
      this.draw();
      this.finish(onDone);
      return;
    }

    this.spinning = true;
    const duration = 3500; // ms
    const t0 = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 4); // fast start, slow stop
      this.rotation = from + (to - from) * eased;
      this.draw();
      if (t < 1) requestAnimationFrame(step);
      else this.finish(onDone);
    };
    requestAnimationFrame(step);
  }

  finish(onDone) {
    this.spinning = false;
    this.rotation = mod(this.rotation, TAU);
    onDone();
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.setSlices(p);
    }
  }

  draw() {
    const { canvas, ctx } = this;

    // Match the canvas pixel size to its on-screen size (sharp on retina).
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth;
    if (!size) return; // not visible yet
    if (canvas.width !== Math.round(size * dpr)) {
      canvas.width = canvas.height = Math.round(size * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    const c = size / 2;    // center
    const r = c - 2;       // radius
    if (this.slices.length === 0) return;

    // Canvas angle 0 points right; our pointer is at the top (-90 degrees).
    let angle = -Math.PI / 2 + this.rotation;
    const fontSize = Math.max(11, Math.round(size / 22));

    this.slices.forEach((s, i) => {
      const sweep = s.weight * TAU;

      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, r, angle, angle + sweep);
      ctx.closePath();
      ctx.fillStyle = s.color;
      ctx.fill();
      if (this.slices.length > 1) {
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Label: written outward along the middle of the slice.
      if (this.labels) {
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(angle + sweep / 2);
        ctx.fillStyle = textColorFor(s.color);
        ctx.font = `600 ${fontSize}px ${FONT_STACK}`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const maxWidth = r * 0.72;
        ctx.fillText(truncate(ctx, s.place.name, maxWidth), r - 12, 0);
        ctx.restore();
      }

      angle += sweep;
    });

    // Hub in the middle.
    ctx.beginPath();
    ctx.arc(c, c, Math.max(6, r * 0.09), 0, TAU);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
}

// Give each slice a color: its tier color, with every other slice in the same
// tier slightly lighter so neighbors are easy to tell apart.
export function colorSlices(sliceList, tiers) {
  const colorOf = new Map(tiers.map((t) => [t.key, t.color]));
  let prevTier = null;
  let n = 0;
  return sliceList.map((s) => {
    n = s.place.tier === prevTier ? n + 1 : 0;
    prevTier = s.place.tier;
    const base = colorOf.get(s.place.tier) || "#888888";
    return { ...s, color: n % 2 ? lighten(base, 0.22) : base };
  });
}

// --- small helpers ---------------------------------------------------------

// Python-style modulo (always positive), JS's % can return negatives.
function mod(a, b) {
  return ((a % b) + b) % b;
}

// Cut text down with "…" until it fits. Array.from splits by character, so
// Chinese characters and emoji aren't broken in half.
function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const chars = Array.from(text);
  while (chars.length > 1 && ctx.measureText(chars.join("") + "…").width > maxWidth) {
    chars.pop();
  }
  return chars.join("") + "…";
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lighten(hex, amount) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(v + (255 - v) * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

// Dark text on light slices, white text on dark slices.
function textColorFor(color) {
  const rgb = color.startsWith("#")
    ? hexToRgb(color)
    : color.match(/\d+/g).map(Number);
  const [r, g, b] = rgb;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#473c35" : "#ffffff";
}

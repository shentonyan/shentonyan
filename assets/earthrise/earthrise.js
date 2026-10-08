/*
 * earthrise.js — an ASCII animation of the Earth rising over a lunar horizon.
 *
 * Original implementation. Written from scratch for shentonyan's GitHub
 * profile; the idea of a halftone-dot ASCII "earthrise" scene was inspired by
 * the animated ASCII gallery at https://ascii.rest (by @bas3line), but no code
 * or artwork from that project is used or reproduced here.
 *
 * The scene is deterministic and loops seamlessly: every time-varying quantity
 * is a function of a normalised phase t in [0, 1), built only from sin/cos of
 * 2*pi*t, so frame N is identical to frame 0.
 *
 * Usage (browser):
 *     const scene = Earthrise.create({ cols: 150, rows: 40 });
 *     scene.draw(ctx, t);          // t in [0,1)
 *
 * Licence: MIT.
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- constants

  // Halftone ramp: four dot sizes, darkest first.
  var CHARS = [' ', '·', '•', '●'];

  // 4x4 Bayer matrix, normalised to [0,1). Breaks up the banding you get from
  // quantising a smooth gradient into four characters.
  var BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  // Colour ramps. Keeping the whole scene on a handful of short ramps gives the
  // picture a consistent, limited palette (~34 colours) and makes the GIF
  // quantise cleanly.
  var RAMP = {
    // Warm grey regolith, lit by a low sun.
    ground: ['#07060a', '#141017', '#241d20', '#382c2a', '#4f3f36', '#6b5747', '#8a735c', '#ab9277', '#cbb597', '#e6d6bc'],
    // Distant highlands, cooler and dimmer than the near ground.
    far: ['#0a0a10', '#15151f', '#22212d', '#31303c', '#43414c'],
    // Ocean, from the night edge to full daylight.
    ocean: ['#040c1e', '#0a1c3c', '#113058', '#1a4a7e', '#2767a4', '#3b86c6'],
    // Land: dark forest through to dry highland.
    land: ['#0a1a10', '#16331e', '#27492a', '#3d5f34', '#5d7340', '#87854f'],
    // Cloud decks and polar ice.
    cloud: ['#2a3747', '#4a5c70', '#77889b', '#a8b6c4', '#d6dee6', '#ffffff'],
    // Atmospheric limb on the sunlit side.
    atmo: ['#081e3e', '#10396b', '#1d5a9c', '#3a84cb', '#7cb4f0'],
    // Stars and galaxy band.
    star: ['#23283a', '#3d4559', '#6b7389', '#9aa4bb', '#dfe5f2', '#ffffff']
  };

  // ------------------------------------------------------------------- helpers

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(e0, e1, x) {
    var t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Integer hash -> [0,1), uniform. Math.imul keeps every step inside 32 bits;
  // a plain `*` here silently loses the low bits to double rounding and the
  // result is badly biased, which flattens every noise field built on it.
  function hash2(x, y) {
    var n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = Math.imul(n ^ (n >>> 15), 2246822519);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function hash3(x, y, z) {
    var n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
          + Math.imul(z | 0, 1442695041);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = Math.imul(n ^ (n >>> 15), 2246822519);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function vnoise2(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = x - xi, yf = y - yi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    var a = hash2(xi, yi), b = hash2(xi + 1, yi);
    var c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function vnoise3(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var xf = x - xi, yf = y - yi, zf = z - zi;
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    function corner(dz) {
      var a = hash3(xi, yi, zi + dz), b = hash3(xi + 1, yi, zi + dz);
      var c = hash3(xi, yi + 1, zi + dz), d = hash3(xi + 1, yi + 1, zi + dz);
      return lerp(lerp(a, b, u), lerp(c, d, u), v);
    }
    return lerp(corner(0), corner(1), w);
  }

  function fbm2(x, y, oct) {
    var s = 0, amp = 0.5, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * vnoise2(x * f, y * f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  }

  function fbm3(x, y, z, oct) {
    var s = 0, amp = 0.5, f = 1, norm = 0;
    for (var i = 0; i < oct; i++) {
      s += amp * vnoise3(x * f, y * f, z * f);
      norm += amp; amp *= 0.5; f *= 2;
    }
    return s / norm;
  }

  // Pick a character for a brightness in [0,1], dithered by cell position.
  function glyph(b, col, row) {
    var lvl = clamp(b, 0, 1) * (CHARS.length - 1);
    var base = Math.floor(lvl);
    var frac = lvl - base;
    var thr = BAYER[row & 3][col & 3] / 16;
    var idx = base + (frac > thr ? 1 : 0);
    return CHARS[clamp(idx, 0, CHARS.length - 1)];
  }

  // Pick a colour from a ramp by brightness in [0,1].
  function shade(ramp, b) {
    var i = Math.round(clamp(b, 0, 1) * (ramp.length - 1));
    return ramp[i];
  }

  // ---------------------------------------------------------------- the scene

  function create(opts) {
    opts = opts || {};
    var COLS = opts.cols || 150;
    var ROWS = opts.rows || 40;
    var CW = opts.cellW || 7;      // cell width in px
    var CH = opts.cellH || 12;     // cell height in px
    var FONT = opts.font || 12;    // font size in px
    var W = COLS * CW, H = ROWS * CH;

    // Nominal horizon, in rows. The moon's curvature puts it a little below
    // the vertical centre so the sky has room for the Earth.
    var HORIZON = Math.round(ROWS * 0.66);

    // -- lunar surface ------------------------------------------------------

    // Craters, deterministic from a fixed seed. x/z are world units.
    var craters = [];
    (function () {
      var n = 46;
      for (var i = 0; i < n; i++) {
        var a = hash2(i * 7 + 1, 3), b = hash2(i * 13 + 5, 11), c = hash2(i * 29 + 2, 17);
        craters.push({
          x: (a - 0.5) * 420,
          z: 3 + b * 150,
          r: 2.2 + c * c * 17,
          d: 0.5 + c * 2.6
        });
      }
      // One big crater on the left, to give the foreground a feature.
      craters.push({ x: -74, z: 26, r: 34, d: 4.2 });
    })();

    var boulders = [];
    (function () {
      for (var i = 0; i < 120; i++) {
        var a = hash2(i * 31 + 9, 23), b = hash2(i * 17 + 4, 41), c = hash2(i * 53 + 6, 59);
        boulders.push({
          x: (a - 0.5) * 380,
          z: 2 + b * 110,
          r: 0.5 + c * 1.5,
          h: 0.35 + c * 1.1
        });
      }
    })();

    function elevation(wx, wz) {
      var h = fbm2(wx * 0.011 + 40, wz * 0.011 + 40, 4) * 7.0 - 3.5;
      h += fbm2(wx * 0.07 + 7, wz * 0.07 + 7, 3) * 1.0;
      var i, c, dx, dz, r, t, rim;
      for (i = 0; i < craters.length; i++) {
        c = craters[i];
        dx = wx - c.x; dz = wz - c.z;
        r = Math.sqrt(dx * dx + dz * dz);
        if (r < c.r * 1.7) {
          t = r / c.r;
          if (t < 1) h -= c.d * (1 - t * t) * 0.95;
          rim = Math.exp(-Math.pow((t - 1.0) / 0.24, 2));
          h += c.d * 0.6 * rim;
        }
      }
      for (i = 0; i < boulders.length; i++) {
        c = boulders[i];
        dx = wx - c.x; dz = wz - c.z;
        r = Math.sqrt(dx * dx + dz * dz);
        if (r < c.r) h += c.h * (1 - r / c.r);
      }
      return h;
    }

    // Regolith albedo: mottled, with darker mare patches.
    function albedo(wx, wz) {
      var m = fbm2(wx * 0.006 + 90, wz * 0.006 + 90, 3);
      var mare = smoothstep(0.40, 0.66, m);
      var grain = fbm2(wx * 0.19 + 3, wz * 0.19 + 3, 2);
      return lerp(0.60, 0.84, 1 - mare) * (0.90 + 0.20 * grain);
    }

    // Sun: low and from the right, so shadows stretch left to right. Low
    // enough for long shadows, high enough that the regolith still reads.
    var SUN = (function () {
      var v = { x: 0.82, y: 0.46, z: -0.34 };
      var L = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      return { x: v.x / L, y: v.y / L, z: v.z / L };
    })();

    // Ray-march toward the sun; anything standing above the ray casts shade.
    function shadow(wx, wz, h) {
      var step = 1.35;
      for (var i = 1; i <= 16; i++) {
        var t = i * step;
        if (elevation(wx + SUN.x * t, wz + SUN.z * t) > h + SUN.y * t + 0.06) {
          return 0.24;
        }
      }
      return 1;
    }

    // Screen row -> world depth. A simple pinhole: the further down the screen,
    // the closer the ground.
    // A gentler curve than a true pinhole: the first rows below the horizon
    // would otherwise jump from 140 world units to 30 in three rows, which
    // destroys any vertical continuity and leaves the ground looking like
    // noise rather than terrain.
    var DEPTH_K = 95;
    function depthAt(row) {
      return DEPTH_K / (row - HORIZON + 1.8);
    }

    // Skyline: distant highlands and a ridge that break the flat horizon.
    var skyline = new Array(COLS);
    for (var sx = 0; sx < COLS; sx++) {
      var ridge = fbm2(sx * 0.021 + 5, 0.5, 3) * 2.4
                + fbm2(sx * 0.0065 + 19, 2.5, 2) * 4.0 - 1.35;
      skyline[sx] = HORIZON - Math.max(0, ridge);
    }

    // The ground never moves, so its characters and colours are computed once
    // and reused for every frame. This is most of the scene's cost.
    var groundCh = new Array(COLS * ROWS);
    var groundCo = new Array(COLS * ROWS);
    (function bakeGround() {
      for (var x = 0; x < COLS; x++) {
        var top = Math.floor(skyline[x]);
        for (var y = 0; y < ROWS; y++) {
          var k = y * COLS + x;
          if (y < top) { groundCh[k] = null; continue; }

          if (y < HORIZON) {
            // Distant highlands poking above the nominal horizon. The rim
            // catches the sun, so the crest is the brightest part of them.
            // The crest catches the sun; below it the slope falls into shade,
            // and the tone is matched to the near ground so the two do not
            // meet in a visible seam at the horizon line.
            var dh = fbm2(x * 0.11 + 60, y * 0.6 + 60, 3);
            var crest = 1 - smoothstep(0, 2.2, y - skyline[x]);
            var bFar = 0.17 + 0.20 * dh + 0.30 * crest;
            groundCh[k] = glyph(bFar, x, y);
            groundCo[k] = shade(RAMP.ground, bFar * 0.78);
            continue;
          }

          var d = depthAt(y);
          var wz = d;
          var wx = (x - COLS * 0.5) * d * 0.055;

          var e = 0.42 + d * 0.012;
          var hC = elevation(wx, wz);
          var hX = elevation(wx + e, wz);
          var hZ = elevation(wx, wz + e);

          // Surface normal from the height gradient.
          var nx = -(hX - hC) / e, nz = -(hZ - hC) / e, ny = 1;
          var nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
          nx /= nl; ny /= nl; nz /= nl;

          var mu = nx * SUN.x + ny * SUN.y + nz * SUN.z;
          var lit = Math.max(0, mu);

          // Lommel-Seeliger-ish falloff: regolith stays bright toward the
          // light and falls off fast away from it.
          var mu0 = Math.max(0.04, ny);
          var refl = lit / (lit + mu0);

          var b = albedo(wx, wz) * refl * 3.0;
          b *= shadow(wx, wz, hC);

          // The far ground is hazier and flatter; the near ground keeps its
          // full range. A little ambient keeps shadows from going pure black.
          var haze = smoothstep(230, 25, d);
          b = b * (0.62 + 0.38 * haze) + 0.075;

          groundCh[k] = glyph(b * 1.18, x, y);
          groundCo[k] = shade(RAMP.ground, b * 1.05);
        }
      }
    })();

    // -- sky ----------------------------------------------------------------

    // Fixed stars, plus four bright ones that twinkle.
    var stars = [];
    for (var y2 = 0; y2 < HORIZON + 2; y2++) {
      for (var x2 = 0; x2 < COLS; x2++) {
        var r2 = hash2(x2 * 3 + 101, y2 * 5 + 211);
        if (r2 < 0.013) {
          var sb = hash2(x2 + 7, y2 + 13);
          stars.push({ x: x2, y: y2, b: 0.18 + sb * sb * 0.62, tw: 0 });
        }
      }
    }
    var bright = [
      { x: Math.round(COLS * 0.11), y: Math.round(ROWS * 0.10), b: 1.0, tw: 1 },
      { x: Math.round(COLS * 0.78), y: Math.round(ROWS * 0.07), b: 0.95, tw: 2 },
      { x: Math.round(COLS * 0.93), y: Math.round(ROWS * 0.27), b: 0.9, tw: 3 },
      { x: Math.round(COLS * 0.34), y: Math.round(ROWS * 0.04), b: 0.85, tw: 4 }
    ];
    for (var bi = 0; bi < bright.length; bi++) stars.push(bright[bi]);

    // Faint galaxy band, baked once. The band follows a shallow diagonal
    // across the whole sky rather than a line that leaves the frame.
    var galaxy = [];
    for (var gy = 0; gy < HORIZON; gy++) {
      for (var gx = 0; gx < COLS; gx++) {
        var axis = 0.16 * gx + 3.0;
        var band = Math.exp(-Math.pow((gy - axis) / 5.5, 2));
        var g = fbm2(gx * 0.17 + 300, gy * 0.42 + 300, 3) * band;
        if (g > 0.50) galaxy.push({ x: gx, y: gy, b: (g - 0.50) * 1.2 });
      }
    }

    // -- Earth --------------------------------------------------------------

    var ER = opts.earthRadius || 10.5 * CH;              // radius in px
    var EX = COLS * CW * 0.355;                          // centre x in px
    var RISE = 13.3 * CH;                                // travel in px

    // Light on the Earth comes from the same side as the lunar sun, and far
    // enough round to the right that the terminator cuts across the disc.
    var ESUN = (function () {
      var v = { x: 0.72, y: 0.18, z: 0.67 };
      var L = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      return { x: v.x / L, y: v.y / L, z: v.z / L };
    })();

    function earthCentreY(t) {
      var base = HORIZON * CH + ER * 0.55;
      return base - RISE * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));
    }

    // Per-cell Earth shading. Returns null outside the disc and halo.
    function earthCell(x, y, t, spin, drift) {
      var px = (x + 0.5) * CW - EX;
      var py = (y + 0.5) * CH - earthCentreY(t);
      var r = Math.sqrt(px * px + py * py);
      if (r > ER * 1.11) return null;

      // Atmospheric halo just outside the limb, on the sunlit side.
      if (r > ER) {
        var falloff = 1 - (r - ER) / (ER * 0.11);
        var sideH = (px / r) * ESUN.x + (-py / r) * ESUN.y;
        var bH = Math.max(0, sideH) * falloff * 0.55;
        if (bH < 0.05) return null;
        return { ch: glyph(bH * 0.95, x, y), co: shade(RAMP.atmo, bH * 1.5) };
      }

      // Sphere normal.
      var nx = px / ER, nyw = -py / ER;
      var nz2 = 1 - nx * nx - nyw * nyw;
      if (nz2 < 0) nz2 = 0;
      var nz = Math.sqrt(nz2);

      var lam = nx * ESUN.x + nyw * ESUN.y + nz * ESUN.z;
      // A wide terminator: the lit side should fall off across the disc
      // rather than saturating to one flat tone.
      var dayS = smoothstep(-0.08, 0.70, lam);

      // Rotate the sampling point about the polar axis so the surface turns.
      var ca = Math.cos(spin), sa = Math.sin(spin);
      var rx = nx * ca + nz * sa;
      var rz = -nx * sa + nz * ca;

      // The sampling point only spans [-1,1], so the noise has to run at a
      // high enough frequency to put several lattice cells across the disc —
      // otherwise every cell lands in the same cell and the globe comes out
      // flat. Value-noise fbm also clusters around 0.5, so stretch it.
      var landN = fbm3(rx * 3.1 + 11, nyw * 3.1 + 11, rz * 3.1 + 11, 4);
      landN = clamp((landN - 0.5) * 2.3 + 0.5, 0, 1);
      // Threshold set so land covers roughly a third of the globe.
      var landMask = smoothstep(0.56, 0.68, landN);
      var isLand = landMask > 0.5;
      var icy = Math.abs(nyw) > 0.78 - 0.06 * landN;

      var cloudN = fbm3(rx * 4.3 + 61 + drift, nyw * 4.3 + 61, rz * 4.3 + 61 + drift * 0.6, 3);
      // Spiral the cloud field a little so storms read as swirls.
      var swirl = fbm3(rx * 1.9 + 140 + drift * 0.4, nyw * 1.9 + 140, rz * 1.9 + 140, 2);
      cloudN = clamp(((cloudN * 0.66 + swirl * 0.34) - 0.5) * 2.4 + 0.5, 0, 1);
      var cloudAmt = smoothstep(0.52, 0.74, cloudN);

      var limb = smoothstep(0.58, 1.0, Math.sqrt(nx * nx + nyw * nyw));

      var ramp, b;
      if (icy) {
        ramp = RAMP.cloud; b = 0.50 + 0.50 * dayS;
      } else if (isLand) {
        ramp = RAMP.land; b = 0.30 + 0.70 * dayS;
      } else {
        ramp = RAMP.ocean; b = 0.24 + 0.76 * dayS;
        // Specular glint where the sun reflects off the sea.
        var glint = Math.pow(Math.max(0, lam), 14);
        b = Math.min(1, b + glint * 0.55);
      }

      if (cloudAmt > 0.02) {
        var cb = (0.42 + 0.58 * dayS) * cloudAmt;
        if (cb > b * 0.70) { ramp = RAMP.cloud; b = Math.max(b, cb); }
      }

      // Blue atmospheric rim on the lit limb.
      if (limb > 0.3 && dayS > 0.08) {
        var rimB = limb * dayS;
        if (rimB > 0.55) { ramp = RAMP.atmo; b = Math.max(b, rimB * 0.9); }
      }

      // Night side: nearly black. It keeps just enough earthshine to hold the
      // round edge of the disc, so the globe does not read as a crescent with
      // a flat side cut off it.
      if (dayS < 0.03) {
        var edgeN = smoothstep(0.80, 1.0, Math.sqrt(nx * nx + nyw * nyw));
        var nb = 0.11 + 0.16 * edgeN + 0.04 * (isLand ? 0 : 1);
        return { ch: glyph(nb, x, y), co: shade(RAMP.star, nb * 0.9) };
      }

      return { ch: glyph(b * 0.97, x, y), co: shade(ramp, b) };
    }

    // -- draw ---------------------------------------------------------------

    function draw(ctx, t) {
      t = t - Math.floor(t);
      var spin = 0.42 * Math.sin(2 * Math.PI * t);
      var drift = 0.85 * Math.sin(2 * Math.PI * t) + 0.22 * Math.sin(4 * Math.PI * t);

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);

      ctx.font = FONT + 'px "DejaVu Sans Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      var i, c, cell, px, py;

      // Galaxy band, then stars, then the Earth, then the ground on top.
      for (i = 0; i < galaxy.length; i++) {
        c = galaxy[i];
        if (c.y >= skyline[c.x]) continue;
        ctx.fillStyle = shade(RAMP.star, c.b * 0.5);
        ctx.fillText(glyph(c.b * 0.55, c.x, c.y), (c.x + 0.5) * CW, (c.y + 0.5) * CH);
      }

      for (i = 0; i < stars.length; i++) {
        c = stars[i];
        if (c.y >= skyline[c.x]) continue;
        var b = c.b;
        if (c.tw) {
          b *= 0.55 + 0.45 * Math.sin(2 * Math.PI * (t * (c.tw + 1) + c.tw * 0.17));
        }
        ctx.fillStyle = shade(RAMP.star, b);
        ctx.fillText(glyph(b * 0.9, c.x, c.y), (c.x + 0.5) * CW, (c.y + 0.5) * CH);
      }

      var ecy = earthCentreY(t);
      var y0 = Math.max(0, Math.floor((ecy - ER * 1.12) / CH));
      var y1 = Math.min(ROWS - 1, Math.ceil((ecy + ER * 1.12) / CH));
      var x0 = Math.max(0, Math.floor((EX - ER * 1.12) / CW));
      var x1 = Math.min(COLS - 1, Math.ceil((EX + ER * 1.12) / CW));
      for (var ey = y0; ey <= y1; ey++) {
        for (var ex = x0; ex <= x1; ex++) {
          if (ey >= skyline[ex]) continue;   // hidden behind the lunar skyline
          cell = earthCell(ex, ey, t, spin, drift);
          if (!cell || cell.ch === ' ') continue;
          ctx.fillStyle = cell.co;
          ctx.fillText(cell.ch, (ex + 0.5) * CW, (ey + 0.5) * CH);
        }
      }

      for (var gy2 = 0; gy2 < ROWS; gy2++) {
        for (var gx2 = 0; gx2 < COLS; gx2++) {
          var k = gy2 * COLS + gx2;
          var ch = groundCh[k];
          if (!ch || ch === ' ') continue;
          ctx.fillStyle = groundCo[k];
          ctx.fillText(ch, (gx2 + 0.5) * CW, (gy2 + 0.5) * CH);
        }
      }
    }

    return { draw: draw, width: W, height: H, cols: COLS, rows: ROWS };
  }

  global.Earthrise = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);

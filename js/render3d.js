/*
 * Three.js renderer. Same global port as the 2D renderer it replaces:
 *   window.OrbitRender = { mount(canvas, options), setTime(jd), setFollow(idOrNull), onSelect(callback) }
 * Every position comes from KeplerEngine.positionAt(id, jd) -> {x, y, z, lon}: heliocentric ecliptic J2000, AU.
 * Time only moves when ui.js calls setTime. requestAnimationFrame time drives only camera tweens and cosmetic spin.
 *
 * Coordinate mapping, engine -> scene
 *   Engine frame: right-handed. +x points to the vernal equinox, +y to ecliptic longitude 90°, +z to the north ecliptic pole.
 *   Scene frame: three.js, right-handed, y-up.
 *     X = k·x,  Y = k·z,  Z = -k·y
 *   The axis swap is a -90° rotation about X (determinant +1, no mirror). The ecliptic is the XZ plane, ecliptic
 *   north is +Y, and prograde orbits run counter-clockwise when seen from +Y.
 *
 * Distance scale (radial power law, direction kept)
 *   k = DIST_K · r^DIST_P / r, with r = |(x, y, z)| in AU, so |scene position| = 12 · r^0.55 scene units.
 *   Mercury 7.2, Venus 10.0, Earth 12.0, Mars 15.0, Jupiter 29.6, Saturn 41.6, Uranus 61.0, Neptune 78.0 units.
 *   A purely radial map sends every plane through the Sun onto itself, so each orbit plane, inclination and node
 *   line stays exact. Only radial spacing is compressed, so eccentric orbits look a little rounder than in AU.
 *
 * Body size (not to distance scale)
 *   R = R_EARTH_UNITS · (radiusKm / 6378)^RADIUS_P = 0.45 · (radiusKm / 6378)^0.45 scene units.
 *   Mercury 0.29, Earth 0.45, Jupiter 1.33, Saturn 1.24. The Sun is a fixed 2.6 units.
 *   Every frame a body is scaled up, never down, so that its radius is at least MIN_ANGULAR_RADIUS times its
 *   camera distance (about 4 px on a 1000 px tall view). Inner planets stay visible when zoomed out.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const root = window;

const DIST_K = 12;
const DIST_P = 0.55;
const R_EARTH_KM = 6378;
const R_EARTH_UNITS = 0.45;
const RADIUS_P = 0.45;
const SUN_RADIUS = 2.6;
const MIN_ANGULAR_RADIUS = 0.0035;
const GAS_GIANT_KM = 20000;
const ICE_GIANT_KM = 30000;
const FALLBACK_COLOR = '#9aa4b2';

const ORBIT_SAMPLES = 512;
const ORBIT_RESAMPLE_DAYS = 3652.5;
const ORBIT_OPACITY = 0.38;
const DAYS_PER_CENTURY = 36525;
const DAYS_PER_YEAR = 365.25;
const DEG_PER_REV = 360;
const DEG = Math.PI / 180;

const PIXEL_RATIO_MAX = 2;
const FOV_DEG = 45;
const HOME_CAMERA = Object.freeze([0, 92, 150]);
const CAMERA_NEAR = 0.05;
const CAMERA_FAR = 9000;
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 900;
const DAMPING = 0.08;

const CLICK_PX = 5;
const FLY_MS = 1400;
const FOCUS_RADII = 5;
const FOCUS_MIN = 2.2;
const FOLLOW_TAU_MS = 220;
const FOLLOW_LOCK = 1e-4;
const MAX_FRAME_MS = 250;
const HIT_RADII = 1.6;
const LABEL_LIFT = 1.15;

const BLOOM = Object.freeze({ strength: 0.85, radius: 0.5, threshold: 0.32 });
const AMBIENT_INTENSITY = 0.05;
const SUN_LIGHT_INTENSITY = 2.8;
const PLANET_EMISSIVE = 0.07;

const STAR_COUNT = 6000;
const STAR_BAND_SHARE = 0.4;
const STAR_SHELL = Object.freeze({ inner: 2200, outer: 3600 });
const STAR_SIZE_PX = Object.freeze({ min: 0.7, max: 3.4 });
const STAR_PALETTE = Object.freeze(['#9bb0ff', '#aabfff', '#cad7ff', '#f8f7ff', '#fff4ea', '#ffd2a1', '#ffb56c']);
const NEBULA_COUNT = 6;
const NEBULA_DISTANCE = 2600;
const NEBULA_COLORS = Object.freeze(['#6a4cff', '#2f7dff', '#ff4fa3', '#22c3b5', '#9b5cff', '#ff8a4c']);

// NSSDCA Planetary Fact Sheet, "Obliquity to orbit". Venus 177.4° and Uranus 97.8° are folded to 2.6° and 82.2°
// because the negative dayHours in PLANETS already carries their retrograde spin. The pole is tilted about the
// scene X axis; pole azimuth is not modelled.
const OBLIQUITY_DEG = Object.freeze({
  mercury: 0.03, venus: 2.6, earth: 23.4, mars: 25.2, jupiter: 3.1, saturn: 26.7, uranus: 82.2, neptune: 28.3,
});

// Ring radii in planet radii. Saturn: C ring inner edge to A ring outer edge; Uranus: the faint epsilon-ring zone.
const RINGS = Object.freeze({
  saturn: Object.freeze({ inner: 1.24, outer: 2.27, profile: saturnRingAlpha, opacity: 1 }),
  uranus: Object.freeze({ inner: 1.64, outer: 2.02, profile: uranusRingAlpha, opacity: 0.55 }),
});

let jd = null;
let followId = null;
let selectCb = null;
let live = null;
const warned = new Set();

function warnOnce(key, message) {
  if (warned.has(key)) return;
  warned.add(key);
  const c = root.console;
  if (c && typeof c.warn === 'function') c.warn('[OrbitRender] ' + message);
}

function messageOf(err) {
  return err && typeof err.message === 'string' ? err.message : String(err);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isPositive(v) {
  return Number.isFinite(v) && v > 0;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function toScene(p, out = new THREE.Vector3()) {
  const r = Math.hypot(p.x, p.y, p.z);
  const k = r > 0 ? (DIST_K * Math.pow(r, DIST_P)) / r : 0;
  return out.set(p.x * k, p.z * k, -p.y * k);
}

function bodyRadius(radiusKm) {
  return isPositive(radiusKm) ? R_EARTH_UNITS * Math.pow(radiusKm / R_EARTH_KM, RADIUS_P) : R_EARTH_UNITS;
}

function periodDaysOf(elements) {
  if (elements == null) return null;
  const rate = elements.LRate;
  if (Number.isFinite(rate) && rate !== 0) return (DAYS_PER_CENTURY * DEG_PER_REV) / Math.abs(rate);
  if (isPositive(elements.a)) return DAYS_PER_YEAR * Math.pow(elements.a, 1.5);
  return null;
}

// Cosmetic, wall-clock spin: compressed so Jupiter does not blur and Venus still visibly turns.
function spinRateOf(dayHours) {
  if (!Number.isFinite(dayHours) || dayHours === 0) return 0;
  return Math.sign(dayHours) * 0.6 * Math.pow(24 / Math.abs(dayHours), 0.35);
}

function readPosition(engine, id, t) {
  let p;
  try {
    p = engine.positionAt(id, t);
  } catch (err) {
    warnOnce('pos:' + id, 'positionAt(' + id + ') threw: ' + messageOf(err));
    return null;
  }
  if (p == null || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
    warnOnce('pos:' + id, 'positionAt(' + id + ') returned no finite x, y and z');
    return null;
  }
  return p;
}

// ---------- procedural textures (canvas only, no image files) ----------

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const order = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = order[i & 255];
  const values = Float32Array.from({ length: 256 }, rand);
  const at = (x, y, z) => values[perm[perm[perm[x & 255] + (y & 255)] + (z & 255)]];
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  function noise(x, y, z) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const zi = Math.floor(z);
    const u = fade(x - xi);
    const v = fade(y - yi);
    const w = fade(z - zi);
    const x00 = lerp(at(xi, yi, zi), at(xi + 1, yi, zi), u);
    const x10 = lerp(at(xi, yi + 1, zi), at(xi + 1, yi + 1, zi), u);
    const x01 = lerp(at(xi, yi, zi + 1), at(xi + 1, yi, zi + 1), u);
    const x11 = lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }
  return function fbm(x, y, z, octaves) {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * f + o * 17.1, y * f + o * 31.7, z * f + o * 7.3);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  };
}

function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const n = m ? parseInt(m[1], 16) : 0x9aa4b2;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function shade(c, k) {
  return [c[0] * k, c[1] * k, c[2] * k];
}

function canvasOf(w, h) {
  const canvas = root.document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function srgbTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Equirectangular map. Noise is sampled on the unit sphere, so there is no seam at u = 0/1 and no polar pinch.
function paintSphere(w, h, pixel) {
  const canvas = canvasOf(w, h);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cosLat = Math.cos(lat);
    const py = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * 2 * Math.PI;
      const c = pixel(cosLat * Math.cos(lon), py, cosLat * Math.sin(lon), lat, lon);
      const i = 4 * (y * w + x);
      img.data[i] = clamp(c[0], 0, 255);
      img.data[i + 1] = clamp(c[1], 0, 255);
      img.data[i + 2] = clamp(c[2], 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function gasGiantTexture(body) {
  const fbm = makeNoise(seedOf(body.id));
  const base = rgbOf(body.color);
  const contrast = body.radiusKm > ICE_GIANT_KM ? 1 : 0.3;
  const light = mix(base, [255, 250, 240], 0.35);
  const dark = mix(shade(base, 0.62), [120, 70, 45], 0.25 * contrast);
  const spot = body.id === 'jupiter' ? { lat: -22 * DEG, lon: 1.2, a: 0.32, b: 0.13 } : null;
  return paintSphere(512, 256, (px, py, pz, lat, lon) => {
    const wobble = fbm(px * 3, py * 3, pz * 3, 4) - 0.5;
    const band = fbm(0.5, py * 9 + wobble * 1.6, 0.5, 4);
    const zone = 0.5 + (band - 0.5) * 2.2 * contrast;
    let c = mix(dark, light, clamp(zone, 0, 1));
    c = shade(c, 0.92 + 0.16 * fbm(px * 14, py * 30, pz * 14, 2));
    if (spot) {
      const dLon = Math.atan2(Math.sin(lon - spot.lon), Math.cos(lon - spot.lon));
      const d = Math.hypot(dLon / spot.a, (lat - spot.lat) / spot.b);
      if (d < 1) c = mix(c, [196, 98, 64], 0.75 * (1 - d * d));
    }
    return c;
  });
}

function rockyTexture(body) {
  const fbm = makeNoise(seedOf(body.id));
  const base = rgbOf(body.color);
  const isEarth = body.id === 'earth';
  const capLat = body.id === 'earth' || body.id === 'mars' ? 0.965 : 2;
  return paintSphere(512, 256, (px, py, pz) => {
    const n = fbm(px * 2.6, py * 2.6, pz * 2.6, 5);
    const detail = fbm(px * 11, py * 11, pz * 11, 3);
    let c;
    if (isEarth) {
      c = n > 0.53
        ? mix([86, 122, 62], [168, 146, 98], clamp((n - 0.53) * 5, 0, 1))
        : shade(base, 0.55 + 0.6 * n);
    } else {
      c = shade(base, 0.6 + 0.9 * (n - 0.5) + 0.25 * (detail - 0.5) + 0.25);
    }
    const cap = clamp((Math.abs(py) - capLat + 0.04 * detail) / 0.02, 0, 1);
    if (cap > 0) c = mix(c, [222, 228, 236], 0.8 * cap);
    return c;
  });
}

function sunTexture() {
  const fbm = makeNoise(seedOf('sun'));
  return srgbTexture(paintSphere(256, 128, (px, py, pz) => {
    const n = fbm(px * 6, py * 6, pz * 6, 4);
    return mix([255, 150, 40], [255, 236, 170], clamp(n * 1.5 - 0.2, 0, 1));
  }));
}

function radialTexture(stops, size = 256) {
  const canvas = canvasOf(size, size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return srgbTexture(canvas);
}

function nebulaTexture(seed) {
  const rand = mulberry32(seed);
  const size = 256;
  const canvas = canvasOf(size, size);
  const ctx = canvas.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const r = size * (0.08 + rand() * 0.22);
    const a = rand() * 2 * Math.PI;
    const d = Math.pow(rand(), 0.7) * size * 0.3;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d * 0.7;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${(0.05 + rand() * 0.08).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.7, 'rgba(0,0,0,0.6)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  return srgbTexture(canvas);
}

// t runs 0..1 from the inner edge (1.24 Rs) to the outer edge (2.27 Rs).
function saturnRingAlpha(t, n) {
  const r = 1.24 + t * 1.03;
  let a;
  if (r < 1.52) a = 0.22;
  else if (r < 1.95) a = 0.92;
  else if (r < 2.03) a = 0.06;
  else a = 0.68;
  if (r > 2.205 && r < 2.218) a = 0.1;
  return a * (0.75 + 0.5 * n);
}

function uranusRingAlpha(t, n) {
  const lines = [0.05, 0.3, 0.42, 0.55, 0.95];
  let a = 0.04;
  for (const at of lines) if (Math.abs(t - at) < 0.018) a = 0.55;
  return a * (0.8 + 0.4 * n);
}

function ringTexture(body, ring) {
  const w = 1024;
  const canvas = canvasOf(w, 4);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, 4);
  const fbm = makeNoise(seedOf(body.id + ':ring'));
  const tint = mix(rgbOf(body.color), [255, 255, 255], 0.2);
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1);
    const n = fbm(t * 60, 0.5, 0.5, 3);
    const alpha = ring.profile(t, n);
    const c = shade(tint, 0.75 + 0.35 * n);
    for (let y = 0; y < 4; y++) {
      const i = 4 * (y * w + x);
      img.data[i] = clamp(c[0], 0, 255);
      img.data[i + 1] = clamp(c[1], 0, 255);
      img.data[i + 2] = clamp(c[2], 0, 255);
      img.data[i + 3] = clamp(alpha * 255, 0, 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return srgbTexture(canvas);
}

// ---------- scene pieces ----------

function buildSun(scene) {
  const sun = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 64, 32),
    new THREE.MeshBasicMaterial({ map: sunTexture(), color: new THREE.Color(2.4, 1.9, 1.2) }),
  );
  const haloTex = radialTexture([
    [0, 'rgba(255,250,230,1)'],
    [0.18, 'rgba(255,214,120,0.85)'],
    [0.45, 'rgba(255,150,50,0.25)'],
    [1, 'rgba(255,120,30,0)'],
  ]);
  const halo = (scale, opacity) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex,
      color: 0xffd08a,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    s.scale.setScalar(scale);
    return s;
  };
  sun.add(core, halo(SUN_RADIUS * 4.2, 0.85), halo(SUN_RADIUS * 10, 0.14));
  sun.add(new THREE.PointLight(0xfff1dc, SUN_LIGHT_INTENSITY, 0, 0));
  scene.add(sun);
  return sun;
}

function buildStars(scene, pixelRatio) {
  const rand = mulberry32(seedOf('stars'));
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const bandTilt = new THREE.Matrix4().makeRotationX(62 * DEG);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < STAR_COUNT; i++) {
    const inBand = rand() < STAR_BAND_SHARE;
    const lon = rand() * 2 * Math.PI;
    const sinLat = inBand ? (rand() + rand() + rand() - 1.5) * 0.18 : rand() * 2 - 1;
    const cosLat = Math.sqrt(1 - sinLat * sinLat);
    const r = STAR_SHELL.inner + rand() * (STAR_SHELL.outer - STAR_SHELL.inner);
    v.set(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon)).multiplyScalar(r);
    if (inBand) v.applyMatrix4(bandTilt);
    v.toArray(positions, 3 * i);
    c.set(STAR_PALETTE[Math.floor(rand() * STAR_PALETTE.length)]);
    c.multiplyScalar(0.35 + 0.65 * rand());
    c.toArray(colors, 3 * i);
    sizes[i] = STAR_SIZE_PX.min + Math.pow(rand(), 3.2) * (STAR_SIZE_PX.max - STAR_SIZE_PX.min);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('starColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('starSize', new THREE.BufferAttribute(sizes, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { pixelRatio: { value: pixelRatio } },
    vertexShader: `
      attribute vec3 starColor;
      attribute float starSize;
      uniform float pixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = starColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = starSize * pixelRatio;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return points;
}

function buildNebulae(scene) {
  const rand = mulberry32(seedOf('nebulae'));
  const group = new THREE.Group();
  for (let i = 0; i < NEBULA_COUNT; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: nebulaTexture(seedOf('nebula' + i)),
      color: NEBULA_COLORS[i % NEBULA_COLORS.length],
      transparent: true,
      opacity: 0.1 + rand() * 0.1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }));
    const lon = rand() * 2 * Math.PI;
    const sinLat = rand() * 1.4 - 0.7;
    const cosLat = Math.sqrt(1 - sinLat * sinLat);
    sprite.position.set(cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon)).multiplyScalar(NEBULA_DISTANCE);
    sprite.scale.setScalar(900 + rand() * 900);
    sprite.material.rotation = rand() * Math.PI;
    group.add(sprite);
  }
  scene.add(group);
  return group;
}

function buildRing(body, ring, radius) {
  const inner = ring.inner * radius;
  const outer = ring.outer * radius;
  const geometry = new THREE.RingGeometry(inner, outer, 192, 1);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i));
    uv.setXY(i, (r - inner) / (outer - inner), 0.5);
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    map: ringTexture(body, ring),
    transparent: true,
    opacity: ring.opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    emissive: 0xffffff,
    emissiveIntensity: 0.02,
  }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function parseBody(row) {
  const radiusKm = isPositive(row.radiusKm) ? row.radiusKm : R_EARTH_KM;
  return {
    id: row.id,
    name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id,
    color: typeof row.color === 'string' && /^#[0-9a-f]{6}$/i.test(row.color) ? row.color : FALLBACK_COLOR,
    radiusKm,
    radius: bodyRadius(radiusKm),
    periodDays: periodDaysOf(row.elements),
    spinRate: spinRateOf(row.dayHours),
  };
}

function buildBody(m, row) {
  const body = parseBody(row);
  const ring = RINGS[body.id] || null;
  const anchor = new THREE.Group();
  anchor.name = 'planet:' + body.id;
  const tilt = new THREE.Group();
  tilt.rotation.x = (OBLIQUITY_DEG[body.id] || 0) * DEG;
  const map = srgbTexture(body.radiusKm > GAS_GIANT_KM ? gasGiantTexture(body) : rockyTexture(body));
  const spin = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius, 64, 32),
    new THREE.MeshStandardMaterial({
      map,
      roughness: 0.9,
      metalness: 0,
      emissive: 0xffffff,
      emissiveMap: map,
      emissiveIntensity: PLANET_EMISSIVE,
    }),
  );
  spin.userData.planetId = body.id;
  const proxy = new THREE.Mesh(
    new THREE.SphereGeometry(body.radius * Math.max(HIT_RADII, ring ? ring.outer : 1), 12, 8),
    new THREE.MeshBasicMaterial(),
  );
  proxy.visible = false;
  proxy.userData.planetId = body.id;
  tilt.add(spin, proxy);
  if (ring) tilt.add(buildRing(body, ring, body.radius));
  anchor.add(tilt);

  const el = root.document.createElement('div');
  el.className = 'planet-label';
  el.textContent = body.name;
  el.dataset.planetId = body.id;
  el.style.setProperty('--planet-color', body.color);
  const label = new CSS2DObject(el);
  label.center.set(0.5, 1);
  anchor.add(label);

  const orbitPositions = new Float32Array(ORBIT_SAMPLES * 3);
  const orbitGeometry = new THREE.BufferGeometry();
  orbitGeometry.setAttribute('position', new THREE.BufferAttribute(orbitPositions, 3));
  const orbit = new THREE.LineLoop(orbitGeometry, new THREE.LineBasicMaterial({
    color: body.color,
    transparent: true,
    opacity: ORBIT_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  orbit.name = 'orbit:' + body.id;
  orbit.visible = false;

  m.scene.add(anchor, orbit);
  return {
    ...body,
    extent: body.radius * (ring ? ring.outer : 1),
    anchor,
    tilt,
    spin,
    proxy,
    label,
    el,
    orbit,
    orbitCenterJd: null,
    placed: false,
  };
}

function ensureBodies(m) {
  if (m.bodies) return true;
  const planets = root.PLANETS;
  const engine = root.KeplerEngine;
  if (!Array.isArray(planets)) {
    warnOnce('need:PLANETS', 'window.PLANETS is not an array yet');
    return false;
  }
  if (!engine || typeof engine.positionAt !== 'function') {
    warnOnce('need:KeplerEngine', 'window.KeplerEngine.positionAt is not a function yet');
    return false;
  }
  const rows = planets.filter((row) => row != null && typeof row.id === 'string' && row.id !== '');
  if (rows.length < planets.length) {
    warnOnce('rows', 'skipped ' + (planets.length - rows.length) + ' PLANETS entries without a string id');
  }
  m.engine = engine;
  m.bodies = rows.map((row) => buildBody(m, row));
  m.byId = new Map(m.bodies.map((b) => [b.id, b]));
  paintLabelState(m);
  return true;
}

function sampleOrbit(m, body, centerJd) {
  if (body.periodDays === null) {
    warnOnce('orbit:' + body.id, body.id + ' has no usable LRate or a, so it gets no orbit line');
    return;
  }
  const attr = body.orbit.geometry.attributes.position;
  const v = new THREE.Vector3();
  const start = centerJd - body.periodDays / 2;
  for (let k = 0; k < ORBIT_SAMPLES; k++) {
    const p = readPosition(m.engine, body.id, start + (k * body.periodDays) / ORBIT_SAMPLES);
    if (!p) {
      body.orbit.visible = false;
      return;
    }
    toScene(p, v).toArray(attr.array, 3 * k);
  }
  attr.needsUpdate = true;
  body.orbit.geometry.computeBoundingSphere();
  body.orbit.visible = true;
  body.orbitCenterJd = centerJd;
}

function placeBodies(m, t) {
  for (const body of m.bodies) {
    if (body.orbitCenterJd === null || Math.abs(t - body.orbitCenterJd) > ORBIT_RESAMPLE_DAYS) {
      sampleOrbit(m, body, t);
    }
    const p = readPosition(m.engine, body.id, t);
    body.placed = p !== null;
    body.anchor.visible = body.placed;
    body.label.visible = body.placed;
    if (p) toScene(p, body.anchor.position);
  }
}

function spinAndScale(m, dtMs) {
  const camPos = m.camera.position;
  for (const body of m.bodies) {
    body.spin.rotation.y += (body.spinRate * dtMs) / 1000;
    const minRadius = camPos.distanceTo(body.anchor.position) * MIN_ANGULAR_RADIUS;
    const s = Math.max(1, minRadius / body.radius);
    body.tilt.scale.setScalar(s);
    body.label.position.set(0, body.radius * s * LABEL_LIFT, 0);
  }
}

// ---------- camera: fly-to tween and follow ----------

function flyTo(m, id) {
  const body = m.byId && m.byId.get(id);
  if (!body || !body.placed) return;
  const dir = new THREE.Vector3().subVectors(m.camera.position, m.controls.target);
  if (dir.lengthSq() < 1e-12) dir.set(0, 0.5, 1);
  dir.normalize();
  m.tween = {
    id,
    t0: root.performance.now(),
    fromTarget: m.controls.target.clone(),
    fromCamera: m.camera.position.clone(),
    dir,
    dist: Math.max(body.extent * FOCUS_RADII, FOCUS_MIN),
  };
}

function steerCamera(m, now, dtMs) {
  const controls = m.controls;
  const camera = m.camera;
  if (m.tween) {
    const tw = m.tween;
    const body = m.byId.get(tw.id);
    const k = easeInOutCubic(clamp((now - tw.t0) / FLY_MS, 0, 1));
    const endTarget = body.anchor.position;
    const endCamera = endTarget.clone().addScaledVector(tw.dir, tw.dist);
    controls.target.lerpVectors(tw.fromTarget, endTarget, k);
    camera.position.lerpVectors(tw.fromCamera, endCamera, k);
    if (k >= 1) {
      m.tween = null;
      m.followOffset = null;
      m.followLocked = followId === tw.id;
    }
    return;
  }
  if (followId === null) return;
  const body = m.byId.get(followId);
  if (!body) {
    warnOnce('follow:' + followId, 'setFollow(' + followId + ') names no planet');
    return;
  }
  if (!body.placed) return;
  // Decay a stored offset from the planet rather than chase it, so a fast planet is tracked without lag.
  if (m.followOffset === null) m.followOffset = new THREE.Vector3().subVectors(controls.target, body.anchor.position);
  const offset = m.followOffset;
  const reach = camera.position.distanceTo(controls.target);
  if (m.followLocked) {
    offset.set(0, 0, 0);
  } else {
    offset.multiplyScalar(Math.exp(-dtMs / FOLLOW_TAU_MS));
    if (offset.length() <= FOLLOW_LOCK * Math.max(reach, 1)) {
      offset.set(0, 0, 0);
      m.followLocked = true;
    }
  }
  const next = offset.clone().add(body.anchor.position);
  camera.position.add(next).sub(controls.target);
  controls.target.copy(next);
}

function paintLabelState(m) {
  if (!m.bodies) return;
  for (const body of m.bodies) {
    body.el.classList.toggle('is-selected', body.id === m.selectedId);
    body.el.classList.toggle('is-followed', body.id === followId);
  }
}

function select(m, id) {
  m.selectedId = id;
  paintLabelState(m);
  if (id !== null) flyTo(m, id);
  if (!selectCb) return;
  try {
    selectCb(id);
  } catch (err) {
    warnOnce('select', 'onSelect threw: ' + messageOf(err));
  }
}

function pick(m, clientX, clientY) {
  if (!m.bodies) return;
  const rect = m.canvas.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return;
  m.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  m.raycaster.setFromCamera(m.pointer, m.camera);
  const shown = m.bodies.filter((b) => b.anchor.visible);
  // A sphere hit beats the enlarged hit proxy of a nearer neighbour, e.g. Venus in front of Earth at conjunction.
  const hits = m.raycaster.intersectObjects(shown.map((b) => b.spin), false);
  const loose = hits.length > 0 ? hits : m.raycaster.intersectObjects(shown.map((b) => b.proxy), false);
  select(m, loose.length > 0 ? loose[0].object.userData.planetId : null);
}

// ---------- mount / loop ----------

function resize(m) {
  const w = m.canvas.clientWidth;
  const h = m.canvas.clientHeight;
  const pr = Math.min(root.devicePixelRatio > 0 ? root.devicePixelRatio : 1, m.pixelRatioMax);
  if (w === m.size.w && h === m.size.h && pr === m.size.pr) return w > 0 && h > 0;
  m.size = { w, h, pr };
  if (!(w > 0 && h > 0)) return false;
  m.renderer.setPixelRatio(pr);
  m.renderer.setSize(w, h, false);
  m.composer.setPixelRatio(pr);
  m.composer.setSize(w, h);
  m.labels.setSize(w, h);
  m.stars.material.uniforms.pixelRatio.value = pr;
  m.camera.aspect = w / h;
  m.camera.updateProjectionMatrix();
  return true;
}

function frameErrorKey(message) {
  return 'frame:' + message.replace(/\d+/g, '#');
}

function tick(m, now) {
  if (live !== m) return;
  m.raf = root.requestAnimationFrame((t) => tick(m, t));
  try {
    const dtMs = m.lastT === null ? 0 : clamp(now - m.lastT, 0, MAX_FRAME_MS);
    m.lastT = now;
    if (!resize(m)) return;
    const ready = ensureBodies(m) && Number.isFinite(jd);
    if (ready) {
      placeBodies(m, jd);
      steerCamera(m, now, dtMs);
    }
    m.controls.update();
    if (ready) spinAndScale(m, dtMs);
    m.composer.render();
    m.labels.render(m.scene, m.camera);
    m.frames += 1;
  } catch (err) {
    const msg = messageOf(err);
    warnOnce(frameErrorKey(msg), 'frame failed: ' + msg);
  }
}

function unmount(m) {
  m.abort.abort();
  root.cancelAnimationFrame(m.raf);
  m.controls.dispose();
  m.labels.domElement.remove();
  m.composer.dispose();
  m.renderer.dispose();
}

function mount(canvas, options) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('OrbitRender.mount expects a <canvas>');
  }
  if (live) unmount(live);
  const opts = options || {};
  const pixelRatioMax = isPositive(opts.pixelRatioMax) ? Math.min(opts.pixelRatioMax, PIXEL_RATIO_MAX) : PIXEL_RATIO_MAX;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020309);
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.fromArray(HOME_CAMERA);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = DAMPING;
  controls.enablePan = followId === null;
  controls.screenSpacePanning = true;
  controls.minDistance = ZOOM_MIN;
  controls.maxDistance = ZOOM_MAX;
  controls.target.set(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold));
  composer.addPass(new OutputPass());

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'label-layer';
  (canvas.parentElement || root.document.body).append(labels.domElement);

  const m = {
    canvas,
    renderer,
    scene,
    camera,
    controls,
    composer,
    labels,
    pixelRatioMax,
    abort: new root.AbortController(),
    raf: 0,
    lastT: null,
    frames: 0,
    size: { w: -1, h: -1, pr: -1 },
    raycaster: new THREE.Raycaster(),
    pointer: new THREE.Vector2(),
    press: null,
    tween: null,
    followLocked: false,
    followOffset: null,
    selectedId: null,
    engine: null,
    bodies: null,
    byId: null,
  };
  m.sun = buildSun(scene);
  m.stars = buildStars(scene, Math.min(root.devicePixelRatio || 1, pixelRatioMax));
  m.nebulae = buildNebulae(scene);
  live = m;

  const signal = m.abort.signal;
  controls.addEventListener('start', () => {
    if (m.tween) m.followOffset = null;
    m.tween = null;
  });
  canvas.addEventListener('pointerdown', (e) => {
    m.press = e.button === 0 ? { pointerId: e.pointerId, x: e.clientX, y: e.clientY } : null;
  }, { signal });
  canvas.addEventListener('pointermove', (e) => {
    const press = m.press;
    if (press && press.pointerId === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > CLICK_PX) {
      m.press = null;
    }
  }, { signal });
  canvas.addEventListener('pointerup', (e) => {
    const press = m.press;
    m.press = null;
    if (!press || press.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) <= CLICK_PX) pick(m, e.clientX, e.clientY);
  }, { signal });
  canvas.addEventListener('pointercancel', () => {
    m.press = null;
  }, { signal });

  m.raf = root.requestAnimationFrame((t) => tick(m, t));
}

function setTime(value) {
  if (!Number.isFinite(value)) {
    warnOnce('setTime', 'setTime ignored a non-finite jd');
    return;
  }
  jd = value;
}

function setFollow(idOrNull) {
  if (idOrNull == null) {
    followId = null;
  } else if (typeof idOrNull !== 'string') {
    warnOnce('setFollow', 'setFollow expects a planet id or null');
    return;
  } else if (idOrNull !== followId) {
    followId = idOrNull;
    if (live) {
      live.followLocked = false;
      live.followOffset = null;
    }
  }
  if (live) {
    live.controls.enablePan = followId === null;
    paintLabelState(live);
  }
}

function onSelect(callback) {
  if (callback == null) selectCb = null;
  else if (typeof callback === 'function') selectCb = callback;
  else warnOnce('onSelect', 'onSelect expects a function or null');
}

root.OrbitRender = Object.freeze({ mount, setTime, setFollow, onSelect });

// Filled only when a harness created this object before the module ran. This file does not create the name.
const receiver = root.__ORBIT_RENDER_TEST__;
if (receiver !== null && typeof receiver === 'object') {
  Object.assign(receiver, {
    THREE,
    DIST_K,
    DIST_P,
    ORBIT_SAMPLES,
    MIN_ANGULAR_RADIUS,
    toScene,
    bodyRadius,
    periodDaysOf,
    live: () => live,
    state: () => ({ jd, followId }),
  });
}

root.dispatchEvent(new root.Event('orbitrender:ready'));

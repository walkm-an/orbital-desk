/*
 * Sample times use JPL "Keplerian Elements for Approximate Positions of the Major
 * Planets", Table 1. LRate is mean longitude in degrees per Julian century (36525
 * days), so one revolution is 36525 * 360 / |LRate| days. Coordinates still come
 * from KeplerEngine.positionAt. If LRate is missing or zero, spacing falls back
 * to Kepler's third law, 365.25 * a^1.5 days.
 */
(function (root) {
  'use strict';

  if (root.OrbitRender) return;

  const ORBIT_SAMPLES = 128;
  const DAYS_PER_CENTURY = 36525;
  const DAYS_PER_YEAR = 365.25;
  const DEG_PER_REV = 360;
  const HOME_REACH_AU = 32;

  const HOME = Object.freeze({ x: 0, y: 0, reach: HOME_REACH_AU });
  const REACH_MIN_AU = 0.02;
  const REACH_MAX_AU = 200;

  const DOT_PX_MIN = 2.5;
  const DOT_PX_MAX = 9;
  const HIT_PX_MIN = 10;
  const FALLBACK_COLOR = '#9aa4b2';
  const ORBIT_ALPHA = 0.45;
  const SUN_CORE_PX = 4;
  const SUN_GLOW_PX = 18;
  const FOLLOW_RING_PX = 3;
  const LABEL_GAP_PX = 4;
  const LABEL_FONT = '12px sans-serif';
  const STATUS_AT = Object.freeze({ x: 8, y: 16 });

  const DRAG_PX = 5;
  const FOLLOW_TAU_MS = 220;
  const FOLLOW_LOCK_PX = 0.5;
  const WHEEL_ZOOM_PER_PX = 0.0015;
  const WHEEL_LINE_PX = 16;

  const NEED_TEXT = Object.freeze({
    time: null,
    PLANETS: '等待 PLANETS 数据',
    KeplerEngine: '等待 KeplerEngine',
  });

  const ORIGIN = Object.freeze({ x: 0, y: 0 });
  const IDLE = Object.freeze({ kind: 'idle' });
  const NONE = Object.freeze({ kind: 'none' });
  const CAPTURE = Object.freeze({ kind: 'capture' });
  const EMPTY_SCENE = Object.freeze({
    vp: { w: 1, h: 1 },
    sun: ORIGIN,
    orbits: [],
    markers: [],
    status: null,
  });

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function isPositive(v) {
    return Number.isFinite(v) && v > 0;
  }

  function hasArea(vp) {
    return vp.w >= 1 && vp.h >= 1;
  }

  function messageOf(err) {
    return err && typeof err.message === 'string' ? err.message : String(err);
  }

  function viewOf(cam, vp) {
    const pxPerAU = Math.min(vp.w, vp.h) / 2 / cam.reach;
    const camFromSun = toScreen({ pxPerAU, sunX: 0, sunY: 0 }, cam);
    return { pxPerAU, sunX: vp.w / 2 - camFromSun.x, sunY: vp.h / 2 - camFromSun.y };
  }

  function toScreen(view, p) {
    return { x: view.sunX + p.x * view.pxPerAU, y: view.sunY - p.y * view.pxPerAU };
  }

  function toWorld(view, s) {
    return { x: (s.x - view.sunX) / view.pxPerAU, y: (view.sunY - s.y) / view.pxPerAU };
  }

  function zoomAt(cam, vp, at, factor) {
    const reach = clamp(cam.reach / factor, REACH_MIN_AU, REACH_MAX_AU);
    const before = toWorld(viewOf(cam, vp), at);
    const after = toWorld(viewOf({ x: cam.x, y: cam.y, reach }, vp), at);
    return { x: cam.x + before.x - after.x, y: cam.y + before.y - after.y, reach };
  }

  function panBy(cam, vp, dx, dy) {
    const view = viewOf(cam, vp);
    const from = toWorld(view, ORIGIN);
    const to = toWorld(view, { x: dx, y: dy });
    return { x: cam.x - (to.x - from.x), y: cam.y - (to.y - from.y), reach: cam.reach };
  }

  function easeToward(cam, target, dtMs) {
    if (!(dtMs > 0)) return cam;
    const a = 1 - Math.exp(-dtMs / FOLLOW_TAU_MS);
    return { x: cam.x + (target.x - cam.x) * a, y: cam.y + (target.y - cam.y) * a, reach: cam.reach };
  }

  function screenDistance(view, a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y) * view.pxPerAU;
  }

  function wheelFactor(deltaY, deltaMode, pageH) {
    const px = deltaMode === 1 ? deltaY * WHEEL_LINE_PX : deltaMode === 2 ? deltaY * pageH : deltaY;
    return Math.exp(-px * WHEEL_ZOOM_PER_PX);
  }

  function backingSize(vp, dpr) {
    return { w: Math.max(1, Math.round(vp.w * dpr)), h: Math.max(1, Math.round(vp.h * dpr)) };
  }

  function dotRadius(radiusKm, minKm, maxKm) {
    if (!isPositive(radiusKm)) return DOT_PX_MIN;
    if (!(maxKm > minKm)) return (DOT_PX_MIN + DOT_PX_MAX) / 2;
    const t = Math.log(radiusKm / minKm) / Math.log(maxKm / minKm);
    return DOT_PX_MIN + clamp(t, 0, 1) * (DOT_PX_MAX - DOT_PX_MIN);
  }

  function periodDaysOf(elements) {
    if (elements == null) return null;
    const rate = elements.LRate;
    if (Number.isFinite(rate) && rate !== 0) return (DAYS_PER_CENTURY * DEG_PER_REV) / Math.abs(rate);
    if (isPositive(elements.a)) return DAYS_PER_YEAR * Math.pow(elements.a, 1.5);
    return null;
  }

  function orbitEpoch(jd) {
    return Math.floor(jd / DAYS_PER_YEAR) * DAYS_PER_YEAR;
  }

  function orbitTimes(epoch, periodDays) {
    return Array.from({ length: ORBIT_SAMPLES }, (_, k) => epoch + (k * periodDays) / ORBIT_SAMPLES);
  }

  function parseBodies(raw, report) {
    const rows = raw.filter((row) => row != null && typeof row.id === 'string' && row.id !== '');
    if (rows.length < raw.length) {
      report('rows', 'skipped ' + (raw.length - rows.length) + ' PLANETS entries without a string id');
    }
    const radii = rows.map((row) => row.radiusKm).filter(isPositive);
    const minKm = Math.min(...radii);
    const maxKm = Math.max(...radii);
    return rows.map((row) => {
      const periodDays = periodDaysOf(row.elements);
      if (periodDays === null) {
        report('orbit:' + row.id, row.id + ' has no usable LRate or a, so it gets no orbit line');
      }
      return {
        id: row.id,
        name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id,
        color: typeof row.color === 'string' && row.color !== '' ? row.color : FALLBACK_COLOR,
        dotPx: dotRadius(row.radiusKm, minKm, maxKm),
        periodDays,
      };
    });
  }

  function readPosition(engine, id, jd, report) {
    let p;
    try {
      p = engine.positionAt(id, jd);
    } catch (err) {
      report('pos:' + id, 'positionAt(' + id + ') threw: ' + messageOf(err));
      return null;
    }
    if (p == null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      report('pos:' + id, 'positionAt(' + id + ') returned no finite x and y');
      return null;
    }
    return { x: p.x, y: p.y };
  }

  function sampleOrbit(engine, body, epoch, report) {
    if (body.periodDays === null) return null;
    const times = orbitTimes(epoch, body.periodDays);
    const out = new Float64Array(2 * ORBIT_SAMPLES);
    for (let k = 0; k < ORBIT_SAMPLES; k++) {
      const p = readPosition(engine, body.id, times[k], report);
      if (!p) return null;
      out[2 * k] = p.x;
      out[2 * k + 1] = p.y;
    }
    return out;
  }

  function refreshSky(prev, planets, engine, jd, report) {
    if (!Number.isFinite(jd)) return { status: 'missing', need: 'time' };
    if (!Array.isArray(planets)) {
      report('need:PLANETS', 'window.PLANETS is not an array yet');
      return { status: 'missing', need: 'PLANETS' };
    }
    if (!engine || typeof engine.positionAt !== 'function') {
      report('need:KeplerEngine', 'window.KeplerEngine.positionAt is not a function yet');
      return { status: 'missing', need: 'KeplerEngine' };
    }
    const epoch = orbitEpoch(jd);
    const samePlanets = prev.status === 'ready' && prev.planets === planets;
    if (samePlanets && prev.engine === engine && prev.epoch === epoch) return prev;
    const bodies = samePlanets ? prev.tracks.map((t) => t.body) : parseBodies(planets, report);
    const tracks = bodies.map((body) => ({ body, orbit: sampleOrbit(engine, body, epoch, report) }));
    return { status: 'ready', planets, engine, epoch, tracks };
  }

  function locate(sky, jd, report) {
    if (sky.status !== 'ready') return [];
    const fixes = [];
    for (const track of sky.tracks) {
      const at = readPosition(sky.engine, track.body.id, jd, report);
      if (at) fixes.push({ body: track.body, at });
    }
    return fixes;
  }

  function compose(sky, fixes, cam, vp, followId) {
    const view = viewOf(cam, vp);
    const sun = toScreen(view, ORIGIN);
    if (sky.status !== 'ready') {
      return { vp, sun, orbits: [], markers: [], status: NEED_TEXT[sky.need] };
    }
    const orbits = [];
    for (const track of sky.tracks) {
      if (!track.orbit) continue;
      const pts = [];
      for (let k = 0; k < ORBIT_SAMPLES; k++) {
        pts.push(toScreen(view, { x: track.orbit[2 * k], y: track.orbit[2 * k + 1] }));
      }
      orbits.push({ color: track.body.color, pts });
    }
    const markers = fixes.map((fix) => {
      const s = toScreen(view, fix.at);
      return {
        id: fix.body.id,
        name: fix.body.name,
        color: fix.body.color,
        x: s.x,
        y: s.y,
        r: fix.body.dotPx,
        followed: fix.body.id === followId,
      };
    });
    return { vp, sun, orbits, markers, status: null };
  }

  function hitTest(markers, at) {
    let best = null;
    let bestD = Infinity;
    for (const m of markers) {
      const d = Math.hypot(m.x - at.x, m.y - at.y);
      if (d <= Math.max(m.r, HIT_PX_MIN) && d <= bestD) {
        best = m.id;
        bestD = d;
      }
    }
    return best;
  }

  function gestureStep(g, ev) {
    if (g.kind === 'idle') {
      if (ev.type === 'down' && ev.button === 0) {
        return { gesture: { kind: 'press', pointerId: ev.pointerId, origin: ev.at }, effect: CAPTURE };
      }
      return { gesture: g, effect: NONE };
    }
    if (ev.pointerId !== g.pointerId || ev.type === 'down') return { gesture: g, effect: NONE };
    if (ev.type === 'cancel') return { gesture: IDLE, effect: NONE };
    if (g.kind === 'press') {
      const dx = ev.at.x - g.origin.x;
      const dy = ev.at.y - g.origin.y;
      const far = Math.hypot(dx, dy) > DRAG_PX;
      if (ev.type === 'up') {
        return { gesture: IDLE, effect: far ? { kind: 'pan', dx, dy } : { kind: 'click', at: g.origin } };
      }
      if (!far) return { gesture: g, effect: NONE };
      return { gesture: { kind: 'drag', pointerId: g.pointerId, last: ev.at }, effect: { kind: 'pan', dx, dy } };
    }
    if (ev.type === 'up') return { gesture: IDLE, effect: NONE };
    return {
      gesture: { kind: 'drag', pointerId: g.pointerId, last: ev.at },
      effect: { kind: 'pan', dx: ev.at.x - g.last.x, dy: ev.at.y - g.last.y },
    };
  }

  let jd = null;
  let followId = null;
  let followPhase = 'ease';
  let selectCb = null;
  let cam = HOME;
  let sky = { status: 'missing', need: 'time' };
  let live = null;
  const warned = new Set();

  function warnOnce(key, message) {
    if (warned.has(key)) return;
    warned.add(key);
    const c = root.console;
    if (c && typeof c.warn === 'function') c.warn('[OrbitRender] ' + message);
  }

  function measure(canvas) {
    const r = canvas.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height };
  }

  function syncBackingStore(m, vp, dpr) {
    const want = backingSize(vp, dpr);
    const c = m.canvas;
    if (c.width === want.w && c.height === want.h) return want;
    c.width = want.w;
    c.height = want.h;
    if (!m.pinned) m.pinned = pinUnsizedAxes(c, vp);
    return want;
  }

  // A canvas with no author CSS size takes its box from the width and height attributes.
  // Without a pin, the backing store feeds back into layout and grows by devicePixelRatio every frame.
  function pinUnsizedAxes(canvas, vp) {
    const after = measure(canvas);
    if (after.w !== vp.w) canvas.style.width = vp.w + 'px';
    if (after.h !== vp.h) canvas.style.height = vp.h + 'px';
    return after.w !== vp.w || after.h !== vp.h;
  }

  const HALO_STROKE = 'rgba(0, 0, 0, 0.75)';
  const HALO_FILL = '#e8ecf2';

  function haloText(ctx, text, x, y) {
    ctx.strokeStyle = HALO_STROKE;
    ctx.fillStyle = HALO_FILL;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
  }

  function frameErrorKey(message) {
    return 'frame:' + message.replace(/\d+/g, '#');
  }

  function paint(ctx, scene, backing) {
    const vp = scene.vp;
    ctx.setTransform(backing.w / vp.w, 0, 0, backing.h / vp.h, 0, 0);
    ctx.clearRect(0, 0, vp.w, vp.h);

    ctx.globalAlpha = ORBIT_ALPHA;
    ctx.lineWidth = 1;
    for (const orbit of scene.orbits) {
      ctx.strokeStyle = orbit.color;
      ctx.beginPath();
      ctx.moveTo(orbit.pts[0].x, orbit.pts[0].y);
      for (let k = 1; k < orbit.pts.length; k++) ctx.lineTo(orbit.pts[k].x, orbit.pts[k].y);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const sun = scene.sun;
    const glow = ctx.createRadialGradient(sun.x, sun.y, 0, sun.x, sun.y, SUN_GLOW_PX);
    glow.addColorStop(0, '#fffbe8');
    glow.addColorStop(SUN_CORE_PX / SUN_GLOW_PX, '#ffd34d');
    glow.addColorStop(1, 'rgba(255, 170, 40, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(sun.x, sun.y, SUN_GLOW_PX, 0, 2 * Math.PI);
    ctx.fill();

    ctx.lineWidth = 1.5;
    for (const m of scene.markers) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, 2 * Math.PI);
      ctx.fill();
      if (m.followed) {
        ctx.strokeStyle = m.color;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r + FOLLOW_RING_PX, 0, 2 * Math.PI);
        ctx.stroke();
      }
    }

    ctx.font = LABEL_FONT;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    for (const m of scene.markers) haloText(ctx, m.name, m.x + m.r + LABEL_GAP_PX, m.y);
    if (scene.status) haloText(ctx, scene.status, STATUS_AT.x, STATUS_AT.y);
  }

  function tick(m, now) {
    if (live !== m) return;
    // Schedule first. A zero-area canvas returns below and must not end the loop.
    m.raf = root.requestAnimationFrame((t) => tick(m, t));
    try {
      const vp = measure(m.canvas);
      if (!hasArea(vp)) return;
      const backing = syncBackingStore(m, vp, root.devicePixelRatio > 0 ? root.devicePixelRatio : 1);
      const dt = m.lastT === null ? 0 : now - m.lastT;
      m.lastT = now;
      sky = refreshSky(sky, root.PLANETS, root.KeplerEngine, jd, warnOnce);
      const fixes = locate(sky, jd, warnOnce);

      const dragging = m.gesture.kind === 'drag';
      if (followId !== null && dragging) {
        followPhase = 'ease';
      } else if (followId !== null) {
        const fix = fixes.find((f) => f.body.id === followId);
        if (fix) {
          if (followPhase === 'ease') {
            const next = easeToward(cam, fix.at, dt);
            if (screenDistance(viewOf(next, vp), next, fix.at) <= FOLLOW_LOCK_PX) followPhase = 'lock';
            else cam = next;
          }
          if (followPhase === 'lock') cam = { x: fix.at.x, y: fix.at.y, reach: cam.reach };
        } else if (sky.status === 'ready') {
          warnOnce('follow:' + followId, 'setFollow(' + followId + ') names no planet with a position');
        }
      }

      m.scene = compose(sky, fixes, cam, vp, followId);
      paint(m.ctx, m.scene, backing);
    } catch (err) {
      const msg = messageOf(err);
      warnOnce(frameErrorKey(msg), 'frame failed: ' + msg);
    }
  }

  function onPointer(m, type, e) {
    const rect = measure(m.canvas);
    const step = gestureStep(m.gesture, {
      type,
      pointerId: e.pointerId,
      button: e.button,
      at: { x: e.clientX - rect.left, y: e.clientY - rect.top },
    });
    m.gesture = step.gesture;
    const fx = step.effect;
    if (fx.kind === 'capture') {
      m.canvas.setPointerCapture(e.pointerId);
    } else if (fx.kind === 'pan' && hasArea(rect)) {
      cam = panBy(cam, rect, fx.dx, fx.dy);
      followPhase = 'ease';
    } else if (fx.kind === 'click') {
      const id = hitTest(m.scene.markers, fx.at);
      if (id !== null && selectCb) {
        try {
          selectCb(id);
        } catch (err) {
          warnOnce('select', 'onSelect threw: ' + messageOf(err));
        }
      }
    }
  }

  function onWheel(m, e) {
    e.preventDefault();
    const rect = measure(m.canvas);
    if (!hasArea(rect)) return;
    const at = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    cam = zoomAt(cam, rect, at, wheelFactor(e.deltaY, e.deltaMode, rect.h));
    followPhase = 'ease';
  }

  function mount(canvas, options) {
    const ctx = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!ctx) throw new TypeError('OrbitRender.mount expects a <canvas> with a 2d context');
    if (live) {
      live.abort.abort();
      root.cancelAnimationFrame(live.raf);
    }
    const m = {
      canvas,
      ctx,
      abort: new root.AbortController(),
      raf: 0,
      lastT: null,
      gesture: IDLE,
      scene: EMPTY_SCENE,
      pinned: false,
    };
    live = m;
    canvas.style.touchAction = 'none';
    const signal = m.abort.signal;
    canvas.addEventListener('pointerdown', (e) => onPointer(m, 'down', e), { signal });
    canvas.addEventListener('pointermove', (e) => onPointer(m, 'move', e), { signal });
    canvas.addEventListener('pointerup', (e) => onPointer(m, 'up', e), { signal });
    canvas.addEventListener('pointercancel', (e) => onPointer(m, 'cancel', e), { signal });
    // Once capture is gone the pointerup can land elsewhere, and a touch gesture would wait
    // forever on a pointer id that never comes back.
    canvas.addEventListener('lostpointercapture', (e) => onPointer(m, 'cancel', e), { signal });
    canvas.addEventListener('wheel', (e) => onWheel(m, e), { signal, passive: false });
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
    } else if (idOrNull !== followId) {
      followId = idOrNull;
      followPhase = 'ease';
    }
  }

  function onSelect(callback) {
    if (callback == null) selectCb = null;
    else if (typeof callback === 'function') selectCb = callback;
    else warnOnce('onSelect', 'onSelect expects a function or null');
  }

  root.OrbitRender = Object.freeze({ mount, setTime, setFollow, onSelect });

  // Filled only when a harness created this object before the script ran. This file does not create the name.
  const receiver = root.__ORBIT_RENDER_TEST__;
  if (receiver !== null && typeof receiver === 'object') {
    Object.assign(receiver, {
      HOME,
      ORBIT_SAMPLES,
      DRAG_PX,
      HIT_PX_MIN,
      FOLLOW_TAU_MS,
      FOLLOW_LOCK_PX,
      viewOf,
      toScreen,
      toWorld,
      zoomAt,
      panBy,
      easeToward,
      screenDistance,
      wheelFactor,
      backingSize,
      dotRadius,
      hitTest,
      gestureStep,
      periodDaysOf,
      orbitEpoch,
      orbitTimes,
      parseBodies,
      readPosition,
      sampleOrbit,
      refreshSky,
      locate,
      compose,
    });
  }
})(window);

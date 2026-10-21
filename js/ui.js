(function () {
  'use strict';

  const SPEEDS = Object.freeze([0.1, 1, 10, 100, 1000]);
  const DEFAULT_SPEED = 1;

  const PLAYBACK = Object.freeze({
    paused: Object.freeze({ advances: false, toggleTo: 'playing', label: '▶ 播放' }),
    playing: Object.freeze({ advances: true, toggleTo: 'paused', label: '⏸ 暂停' }),
  });
  const INITIAL_MODE = 'paused';

  const THRESHOLD_AU = Object.freeze(
    Object.assign(Object.create(null), {
      mercury: 0.02,
      venus: 0.02,
      earth: 0.02,
      mars: 0.02,
      jupiter: 0.02,
      saturn: 0.02,
      uranus: 0.1,
      neptune: 0.1,
    }),
  );

  const INITIAL_INSTANT_MS = Date.UTC(2026, 9, 21, 12, 0, 0);
  const UNIX_EPOCH_JD = 2440587.5;
  const MS_PER_DAY = 86400000;
  const MAX_FRAME_SEC = 0.25;
  const PANEL_INTERVAL_MS = 250;
  const DASH = '\u2014';
  const RENDER_READY_EVENT = 'orbitrender:ready';
  const RENDER_SCRIPT_SELECTOR = 'script[data-orbit-render]';
  const RENDER_WAIT_MS = 15000;

  const CARD_FIELDS = Object.freeze([
    Object.freeze({ label: '半径', text: (reading) => formatRadius(reading.body.radiusKm) }),
    Object.freeze({ label: '自转', text: (reading) => formatSpin(reading.body.dayHours) }),
    Object.freeze({ label: '卫星数', text: (reading) => formatCount(reading.body.moons) }),
    Object.freeze({ label: '当前日距', text: (reading) => formatAu(reading.a && heliocentricAu(reading.a), 4) }),
    Object.freeze({ label: 'A 引擎经度', text: (reading) => formatDeg(reading.a && reading.a.lon, 3) }),
    Object.freeze({ label: 'B 引擎经度', text: (reading) => formatDeg(reading.b && reading.b.lon, 3) }),
  ]);

  const DEVIATION_COLUMNS = Object.freeze([
    Object.freeze({ label: 'A 经度', text: (reading) => formatDeg(reading.a && reading.a.lon, 2) }),
    Object.freeze({ label: 'B 经度', text: (reading) => formatDeg(reading.b && reading.b.lon, 2) }),
    Object.freeze({ label: '经度差', text: (reading) => formatDeg(reading.dLonDeg, 3) }),
    Object.freeze({ label: '距离差', text: (reading) => formatAu(reading.dPosAu, 4) }),
  ]);

  const MISSING_ENGINE = Object.freeze({
    positionAt() {
      throw new Error('engine missing');
    },
  });

  const NO_RENDER = Object.freeze({
    mount() {},
    setTime() {},
    onSelect() {},
  });

  function initialClock(jd) {
    return Object.freeze({
      mode: INITIAL_MODE,
      speed: DEFAULT_SPEED,
      jd,
      lastFrameMs: null,
    });
  }

  function togglePlayback(clock) {
    return Object.freeze({ ...clock, mode: PLAYBACK[clock.mode].toggleTo });
  }

  function setSpeed(clock, speed) {
    return Object.freeze({ ...clock, speed });
  }

  function jumpTo(clock, jd) {
    return Object.freeze({ ...clock, jd });
  }

  function tick(clock, nowMs) {
    const dtSec = clock.lastFrameMs === null
      ? 0
      : Math.min(Math.max((nowMs - clock.lastFrameMs) / 1000, 0), MAX_FRAME_SEC);
    const daysPerSec = PLAYBACK[clock.mode].advances ? clock.speed : 0;
    return Object.freeze({
      ...clock,
      jd: clock.jd + daysPerSec * dtSec,
      lastFrameMs: nowMs,
    });
  }

  function panelsDue(lastPaint, jd, nowMs) {
    return jd !== lastPaint.jd && nowMs - lastPaint.atMs >= PANEL_INTERVAL_MS;
  }

  function jdToUtcMs(jd) {
    return (jd - UNIX_EPOCH_JD) * MS_PER_DAY;
  }

  function formatReadout(jd) {
    const jdText = `JD ${jd.toFixed(3)}`;
    try {
      const ms = Math.round(jdToUtcMs(jd) / 60000) * 60000;
      const iso = new Date(ms).toISOString();
      const t = iso.indexOf('T');
      return `${iso.slice(0, t)} ${iso.slice(t + 1, t + 6)} UTC · ${jdText}`;
    } catch {
      return jdText;
    }
  }

  function utcDayValue(ms) {
    const iso = new Date(ms).toISOString();
    return iso.slice(0, iso.indexOf('T'));
  }

  function noonUtcFromDateValue(value) {
    const match = /^(\d{4,6})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const date = new Date(Date.UTC(2000, 0, 1, 12, 0, 0));
    // setUTCFullYear keeps years 0 to 99. Date.UTC maps those years onto 1900 to 1999.
    date.setUTCFullYear(year, month, day);
    const roundTrips = date.getUTCFullYear() === year
      && date.getUTCMonth() === month
      && date.getUTCDate() === day;
    return roundTrips ? date : null;
  }

  function lonGapDeg(lonA, lonB) {
    return Math.abs(((((lonA - lonB) % 360) + 540) % 360) - 180);
  }

  function distanceAu(p, q) {
    return Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  }

  function heliocentricAu(p) {
    return Math.hypot(p.x, p.y, p.z);
  }

  function thresholdAuFor(id) {
    return THRESHOLD_AU[id] ?? null;
  }

  function isAlarm(thresholdAu, dPosAu) {
    return thresholdAu !== null && dPosAu !== null && dPosAu > thresholdAu;
  }

  function measure(body, a, b) {
    const both = a !== null && b !== null;
    const dLonDeg = both ? lonGapDeg(a.lon, b.lon) : null;
    const dPosAu = both ? distanceAu(a, b) : null;
    return Object.freeze({
      body,
      a,
      b,
      dLonDeg,
      dPosAu,
      alarm: isAlarm(body.thresholdAu, dPosAu),
    });
  }

  function readAll(engines, bodies, jd) {
    return bodies.map((body) => measure(
      body,
      snapshotPosition(engines.a, body.id, jd),
      snapshotPosition(engines.b, body.id, jd),
    ));
  }

  function cardLines(reading) {
    return CARD_FIELDS.map((field) => field.text(reading));
  }

  function rowCells(reading) {
    return DEVIATION_COLUMNS.map((column) => column.text(reading));
  }

  function thresholdLegend(bodies) {
    const groups = [];
    for (const body of bodies) {
      if (body.thresholdAu === null) continue;
      let group = groups.find((item) => item.thresholdAu === body.thresholdAu);
      if (!group) {
        group = { thresholdAu: body.thresholdAu, names: [] };
        groups.push(group);
      }
      group.names.push(body.name);
    }
    groups.sort((a, b) => a.thresholdAu - b.thresholdAu);
    if (groups.length === 0) return '';
    const parts = groups.map((group) => `${group.names.join(' ')} > ${group.thresholdAu} AU`);
    return `${parts.join('，')} 标红`;
  }

  function formatDeg(value, digits) {
    return value === null ? DASH : `${value.toFixed(digits)}°`;
  }

  function formatAu(value, digits) {
    return value === null ? DASH : `${value.toFixed(digits)} AU`;
  }

  function formatSpin(hours) {
    if (hours === null) return DASH;
    const abs = Math.abs(hours);
    const span = abs >= 48 ? `${(abs / 24).toFixed(2)} 天` : `${abs.toFixed(2)} 小时`;
    return hours < 0 ? `${span}（逆行）` : span;
  }

  function formatRadius(km) {
    if (km === null) return DASH;
    const text = String(Math.round(km)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${text} km`;
  }

  function formatCount(n) {
    return n === null ? DASH : String(n);
  }

  function hasMethods(obj, names) {
    return obj !== null && typeof obj === 'object' && names.every((name) => typeof obj[name] === 'function');
  }

  function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  function parseBodies(raw) {
    const seen = new Set();
    const bodies = [];
    for (const entry of raw) {
      if (!entry || typeof entry.id !== 'string' || entry.id === '' || seen.has(entry.id)) continue;
      seen.add(entry.id);
      bodies.push(Object.freeze({
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
        color: typeof entry.color === 'string' ? entry.color : '#8899aa',
        radiusKm: finiteOrNull(entry.radiusKm),
        dayHours: finiteOrNull(entry.dayHours),
        moons: finiteOrNull(entry.moons),
        thresholdAu: thresholdAuFor(entry.id),
      }));
    }
    return Object.freeze(bodies);
  }

  function snapshotPosition(engine, id, jd) {
    let p;
    try {
      p = engine.positionAt(id, jd);
    } catch {
      return null;
    }
    if (!p || ![p.x, p.y, p.z, p.lon].every(Number.isFinite)) return null;
    return Object.freeze({ x: p.x, y: p.y, z: p.z, lon: p.lon });
  }

  function julianDayOf(kepler, date) {
    try {
      const jd = kepler.toJD(date);
      return Number.isFinite(jd) ? jd : null;
    } catch {
      return null;
    }
  }

  function parseSelection(bodies, raw) {
    return typeof raw === 'string' && bodies.some((body) => body.id === raw) ? raw : null;
  }

  function parseSpeed(raw) {
    return SPEEDS.find((speed) => String(speed) === raw) ?? null;
  }

  function readPorts(g) {
    const problems = [];
    const need = (ok, name, file, effect) => {
      if (!ok) problems.push(`缺少 window.${name}（${file} 未加载或出错）：${effect}`);
      return ok;
    };
    const bodies = need(Array.isArray(g.PLANETS), 'PLANETS', 'data/planets.js', '行星列表为空')
      ? parseBodies(g.PLANETS)
      : Object.freeze([]);
    const kepler = need(hasMethods(g.KeplerEngine, ['toJD', 'positionAt']), 'KeplerEngine', 'js/kepler.js', '时间控制已停用')
      ? g.KeplerEngine
      : null;
    const alt = need(hasMethods(g.AltEngine, ['positionAt']), 'AltEngine', 'js/alt.js', `B 引擎列显示为 ${DASH}`)
      ? g.AltEngine
      : MISSING_ENGINE;
    const render = need(
      hasMethods(g.OrbitRender, ['mount', 'setTime', 'onSelect']),
      'OrbitRender',
      'js/render3d.js',
      '画布不可用',
    )
      ? g.OrbitRender
      : NO_RENDER;
    return { bodies, kepler, alt, render, problems };
  }

  function buildView(doc, bodies) {
    const byId = (id) => doc.getElementById(id);
    const canvas = byId('orbit-canvas');
    const problems = byId('desk-problems');
    const timeControls = byId('time-controls');
    const readout = byId('sim-readout');
    const playButton = byId('play-toggle');
    const speedGroup = byId('speed-group');
    const dateInput = byId('date-input');
    const cardEmpty = byId('card-empty');
    const card = byId('planet-card');
    const cardTitle = byId('card-title');
    const cardSwatch = byId('card-swatch');
    const cardFields = byId('card-fields');
    const deviationHead = byId('deviation-head');
    const deviationBody = byId('deviation-body');
    const legend = byId('threshold-legend');

    const speedRadios = [];
    for (const speed of SPEEDS) {
      const label = doc.createElement('label');
      label.className = 'speed';
      const input = doc.createElement('input');
      input.type = 'radio';
      input.name = 'speed';
      input.value = String(speed);
      const span = doc.createElement('span');
      span.textContent = `${speed}x`;
      label.append(input, span);
      speedGroup.append(label);
      speedRadios.push(input);
    }

    const cardValues = [];
    for (const field of CARD_FIELDS) {
      const term = doc.createElement('dt');
      term.textContent = field.label;
      const value = doc.createElement('dd');
      value.textContent = DASH;
      cardFields.append(term, value);
      cardValues.push(value);
    }

    const headRow = doc.createElement('tr');
    const nameHead = doc.createElement('th');
    nameHead.textContent = '行星';
    headRow.append(nameHead);
    for (const column of DEVIATION_COLUMNS) {
      const th = doc.createElement('th');
      th.textContent = column.label;
      headRow.append(th);
    }
    deviationHead.append(headRow);

    const rows = bodies.map((body) => {
      const tr = doc.createElement('tr');
      const th = doc.createElement('th');
      th.scope = 'row';
      const swatch = doc.createElement('span');
      swatch.className = 'swatch';
      swatch.style.backgroundColor = body.color;
      th.append(swatch, doc.createTextNode(body.name));
      tr.append(th);
      const cells = [];
      DEVIATION_COLUMNS.forEach(() => {
        const td = doc.createElement('td');
        td.textContent = DASH;
        tr.append(td);
        cells.push(td);
      });
      deviationBody.append(tr);
      return { tr, cells };
    });

    legend.textContent = thresholdLegend(bodies);

    return {
      canvas,
      problems,
      timeControls,
      readout,
      playButton,
      speedGroup,
      speedRadios,
      dateInput,
      cardEmpty,
      card,
      cardTitle,
      cardSwatch,
      cardValues,
      rows,
    };
  }

  function paintProblems(view, problems) {
    view.problems.hidden = problems.length === 0;
    view.problems.textContent = problems.join('\n');
  }

  function paintControls(view, clock) {
    view.playButton.textContent = PLAYBACK[clock.mode].label;
    for (const radio of view.speedRadios) {
      radio.checked = radio.value === String(clock.speed);
    }
  }

  function paintPanels(view, jd, readings, selectedId) {
    view.readout.textContent = formatReadout(jd);
    readings.forEach((reading, i) => {
      const row = view.rows[i];
      rowCells(reading).forEach((text, j) => {
        row.cells[j].textContent = text;
      });
      row.tr.classList.toggle('is-alarm', reading.alarm);
    });
    const selected = readings.find((reading) => reading.body.id === selectedId) ?? null;
    view.card.hidden = selected === null;
    view.cardEmpty.hidden = selected !== null;
    if (selected === null) return;
    view.cardTitle.textContent = selected.body.name;
    view.cardSwatch.style.backgroundColor = selected.body.color;
    cardLines(selected).forEach((text, i) => {
      view.cardValues[i].textContent = text;
    });
  }

  function boot(g, doc) {
    const ports = readPorts(g);
    const view = buildView(doc, ports.bodies);
    const problems = ports.problems.slice();
    const jd0 = ports.kepler === null ? null : julianDayOf(ports.kepler, new Date(INITIAL_INSTANT_MS));
    if (jd0 === null) {
      if (ports.kepler !== null) problems.push('KeplerEngine.toJD 返回无效值：时间控制已停用');
      view.timeControls.disabled = true;
      paintProblems(view, problems);
      return;
    }

    view.dateInput.value = utcDayValue(INITIAL_INSTANT_MS);
    const engines = { a: ports.kepler, b: ports.alt };
    let clock = initialClock(jd0);
    let selectedId = null;
    let lastPaint = { jd: NaN, atMs: -Infinity };
    let render = ports.render;

    const report = (line) => {
      problems.push(line);
      paintProblems(view, problems);
    };
    const repaint = (nowMs) => {
      paintPanels(view, clock.jd, readAll(engines, ports.bodies, clock.jd), selectedId);
      lastPaint = { jd: clock.jd, atMs: nowMs };
    };
    const frame = (nowMs) => {
      g.requestAnimationFrame(frame);
      clock = tick(clock, nowMs);
      try {
        render.setTime(clock.jd);
      } catch (err) {
        render = NO_RENDER;
        report(`OrbitRender.setTime 出错：${err.message}`);
      }
      if (panelsDue(lastPaint, clock.jd, nowMs)) repaint(nowMs);
    };

    try {
      render.mount(view.canvas);
      render.onSelect((raw) => {
        const nextId = parseSelection(ports.bodies, raw);
        if (nextId === selectedId) return;
        selectedId = nextId;
        repaint(g.performance.now());
      });
    } catch (err) {
      render = NO_RENDER;
      report(`OrbitRender.mount 出错：${err.message}`);
    }

    view.playButton.addEventListener('click', () => {
      clock = togglePlayback(clock);
      paintControls(view, clock);
    });
    view.speedGroup.addEventListener('change', (event) => {
      const speed = parseSpeed(event.target.value);
      if (speed === null) return;
      clock = setSpeed(clock, speed);
      paintControls(view, clock);
    });
    view.dateInput.addEventListener('change', () => {
      const date = noonUtcFromDateValue(view.dateInput.value);
      if (date === null) return;
      const jd = julianDayOf(ports.kepler, date);
      if (jd === null) {
        report(`KeplerEngine.toJD 无法换算 ${view.dateInput.value}`);
        return;
      }
      clock = jumpTo(clock, jd);
      repaint(g.performance.now());
    });

    paintProblems(view, problems);
    paintControls(view, clock);
    frame(g.performance.now());
  }

  function reportBootCrash(doc, err) {
    try {
      const box = doc.getElementById('desk-problems');
      box.hidden = false;
      box.textContent = `界面启动失败：${err && err.message}`;
    } catch {
    }
  }

  const probe = globalThis.ORBITAL_DESK_PROBE;
  if (probe !== null && typeof probe === 'object') {
    probe.ui = Object.freeze({
      SPEEDS,
      PLAYBACK,
      THRESHOLD_AU,
      INITIAL_INSTANT_MS,
      initialClock,
      togglePlayback,
      setSpeed,
      jumpTo,
      tick,
      panelsDue,
      jdToUtcMs,
      formatReadout,
      utcDayValue,
      noonUtcFromDateValue,
      lonGapDeg,
      distanceAu,
      thresholdAuFor,
      measure,
      readAll,
      cardLines,
      rowCells,
      thresholdLegend,
      parseBodies,
      snapshotPosition,
      julianDayOf,
      parseSelection,
      parseSpeed,
      readPorts,
    });
  }

  // render3d.js is an ES module that imports three.js from a CDN, so it runs after this classic script.
  // Boot once it announces itself, or once its script fails or times out; readPorts then reports it as missing.
  function whenRenderSettles(g, doc, done) {
    if (g.OrbitRender) {
      done();
      return;
    }
    let settled = false;
    const script = doc.querySelector(RENDER_SCRIPT_SELECTOR);
    const finish = () => {
      if (settled) return;
      settled = true;
      g.clearTimeout(timer);
      g.removeEventListener(RENDER_READY_EVENT, finish);
      if (script) script.removeEventListener('error', finish);
      done();
    };
    const timer = g.setTimeout(finish, RENDER_WAIT_MS);
    g.addEventListener(RENDER_READY_EVENT, finish);
    if (script) script.addEventListener('error', finish);
  }

  if (typeof document !== 'undefined') {
    whenRenderSettles(globalThis, document, () => {
      try {
        boot(globalThis, document);
      } catch (err) {
        reportBootCrash(document, err);
      }
    });
  }
})();

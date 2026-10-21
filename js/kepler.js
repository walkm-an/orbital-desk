// Source: JPL Solar System Dynamics, "Approximate Positions of the Planets",
// Table 1 (1800 AD to 2050 AD).
// https://ssd.jpl.nasa.gov/planets/approx_pos.html
(function (root) {
  var J2000_JD = 2451545.0;
  var DAYS_PER_CENTURY = 36525;
  var UNIX_EPOCH_JD = 2440587.5;
  var MS_PER_DAY = 86400000;
  var DEG = Math.PI / 180;
  var KEPLER_TOL_RAD = 1e-9;
  var KEPLER_MAX_ITER = 30;
  var ELEMENT_KEYS = [
    'a', 'e', 'I', 'L', 'longPeri', 'longNode',
    'aRate', 'eRate', 'IRate', 'LRate', 'longPeriRate', 'longNodeRate'
  ];

  function utcMillis(date) {
    var match, year, month, day, ms, check;
    if (date instanceof Date) {
      return date.getTime();
    }
    if (typeof date !== 'string') {
      throw new Error('toJD expects a Date or a UTC date string');
    }
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (match) {
      year = Number(match[1]);
      month = Number(match[2]);
      day = Number(match[3]);
      ms = Date.UTC(year, month - 1, day);
      check = new Date(ms);
      if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
        throw new Error('toJD received an invalid date');
      }
      return ms;
    }
    if (/[zZ]$/.test(date) || /[+-]\d{2}:\d{2}$/.test(date) || /[+-]\d{4}$/.test(date)) {
      return Date.parse(date);
    }
    throw new Error('toJD date string must be YYYY-MM-DD or include a Z or numeric offset');
  }

  function utcMillisToJD(ms) {
    return ms / MS_PER_DAY + UNIX_EPOCH_JD;
  }

  function toJD(date) {
    var ms = utcMillis(date);
    if (!Number.isFinite(ms)) {
      throw new Error('toJD received an invalid date');
    }
    return utcMillisToJD(ms);
  }

  function wrap180(deg) {
    var x = deg % 360;
    if (x > 180) {
      x -= 360;
    } else if (x < -180) {
      x += 360;
    }
    return x;
  }

  function solveEccentricAnomaly(meanAnomalyDeg, eccentricity) {
    var M, E, n, denom, dE;
    if (!(eccentricity >= 0 && eccentricity < 1)) {
      throw new Error('Eccentricity must be in [0, 1)');
    }
    M = wrap180(meanAnomalyDeg) * DEG;
    E = M + eccentricity * Math.sin(M);
    for (n = 0; n < KEPLER_MAX_ITER; n += 1) {
      denom = 1 - eccentricity * Math.cos(E);
      dE = (M - (E - eccentricity * Math.sin(E))) / denom;
      E += dE;
      if (Math.abs(dE) < KEPLER_TOL_RAD) {
        return E;
      }
    }
    throw new Error('Kepler equation did not converge');
  }

  function orbitalPlanePosition(a, eccentricity, E) {
    var cosE = Math.cos(E);
    var sinE = Math.sin(E);
    var factor = 1 - eccentricity * cosE;
    var r = a * factor;
    var cosNu = (cosE - eccentricity) / factor;
    var sinNu = (Math.sqrt(1 - eccentricity * eccentricity) * sinE) / factor;
    return {
      x: r * cosNu,
      y: r * sinNu
    };
  }

  function eclipticPosition(orb, el) {
    var omega = (el.longPeri - el.longNode) * DEG;
    var node = el.longNode * DEG;
    var inc = el.I * DEG;
    var cosW = Math.cos(omega);
    var sinW = Math.sin(omega);
    var cosN = Math.cos(node);
    var sinN = Math.sin(node);
    var cosI = Math.cos(inc);
    var sinI = Math.sin(inc);
    var x = (cosW * cosN - sinW * sinN * cosI) * orb.x
      + (-sinW * cosN - cosW * sinN * cosI) * orb.y;
    var y = (cosW * sinN + sinW * cosN * cosI) * orb.x
      + (-sinW * sinN + cosW * cosN * cosI) * orb.y;
    var z = (sinW * sinI) * orb.x + (cosW * sinI) * orb.y;
    var lon = Math.atan2(y, x) / DEG;
    if (lon < 0) {
      lon += 360;
    }
    return { x: x, y: y, z: z, lon: lon };
  }

  function findPlanet(id) {
    var planets = root.PLANETS;
    var i;
    if (!planets || typeof planets.length !== 'number') {
      throw new Error('window.PLANETS is not available');
    }
    for (i = 0; i < planets.length; i += 1) {
      if (planets[i] && planets[i].id === id) {
        return planets[i];
      }
    }
    throw new Error('Unknown planet id: ' + id);
  }

  function elementsOf(planet) {
    var el = planet.elements;
    var i, key;
    if (!el) {
      throw new Error('Planet ' + planet.id + ' has no elements');
    }
    for (i = 0; i < ELEMENT_KEYS.length; i += 1) {
      key = ELEMENT_KEYS[i];
      if (!Number.isFinite(el[key])) {
        throw new Error('Planet ' + planet.id + ' element ' + key + ' is not a finite number');
      }
    }
    return el;
  }

  function propagate(el, T) {
    return {
      a: el.a + el.aRate * T,
      e: el.e + el.eRate * T,
      I: el.I + el.IRate * T,
      L: el.L + el.LRate * T,
      longPeri: el.longPeri + el.longPeriRate * T,
      longNode: el.longNode + el.longNodeRate * T
    };
  }

  function positionAt(id, jd) {
    var planet, el0, T, el, E;
    if (!Number.isFinite(jd)) {
      throw new Error('positionAt expects a finite Julian Date');
    }
    planet = findPlanet(id);
    el0 = elementsOf(planet);
    T = (jd - J2000_JD) / DAYS_PER_CENTURY;
    el = propagate(el0, T);
    E = solveEccentricAnomaly(el.L - el.longPeri, el.e);
    return eclipticPosition(orbitalPlanePosition(el.a, el.e, E), el);
  }

  root.KeplerEngine = {
    toJD: toJD,
    positionAt: positionAt
  };
})(typeof window !== 'undefined' ? window : globalThis);

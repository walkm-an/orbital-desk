/*
 * Source: Paul Schlyter, "How to compute planetary positions",
 * https://stjarnhimlen.se/comp/ppcomp.html
 */
(function () {
  "use strict";

  var DEG2RAD = Math.PI / 180;
  var RAD2DEG = 180 / Math.PI;
  var JD_2000_JAN_0 = 2451543.5;
  var J2000_PRECESS_DEG_PER_DAY = 3.82394e-5;
  var KEPLER_TOL_DEG = 0.001;

  // Angles are degrees. a is AU. at0 is 2000 Jan 0.0 UT.
  var ORBIT = {
    mercury: {
      N: { at0: 48.3313, perDay: 3.24587e-5 },
      i: { at0: 7.0047, perDay: 5.00e-8 },
      w: { at0: 29.1241, perDay: 1.01444e-5 },
      a: { at0: 0.387098, perDay: 0 },
      e: { at0: 0.205635, perDay: 5.59e-10 },
      M: { at0: 168.6562, perDay: 4.0923344368 }
    },
    venus: {
      N: { at0: 76.6799, perDay: 2.46590e-5 },
      i: { at0: 3.3946, perDay: 2.75e-8 },
      w: { at0: 54.8910, perDay: 1.38374e-5 },
      a: { at0: 0.723330, perDay: 0 },
      e: { at0: 0.006773, perDay: -1.302e-9 },
      M: { at0: 48.0052, perDay: 1.6021302244 }
    },
    earth: {
      N: { at0: 0.0, perDay: 0 },
      i: { at0: 0.0, perDay: 0 },
      w: { at0: 282.9404, perDay: 4.70935e-5 },
      a: { at0: 1.000000, perDay: 0 },
      e: { at0: 0.016709, perDay: -1.151e-9 },
      M: { at0: 356.0470, perDay: 0.9856002585 }
    },
    mars: {
      N: { at0: 49.5574, perDay: 2.11081e-5 },
      i: { at0: 1.8497, perDay: -1.78e-8 },
      w: { at0: 286.5016, perDay: 2.92961e-5 },
      a: { at0: 1.523688, perDay: 0 },
      e: { at0: 0.093405, perDay: 2.516e-9 },
      M: { at0: 18.6021, perDay: 0.5240207766 }
    },
    jupiter: {
      N: { at0: 100.4542, perDay: 2.76854e-5 },
      i: { at0: 1.3030, perDay: -1.557e-7 },
      w: { at0: 273.8777, perDay: 1.64505e-5 },
      a: { at0: 5.20256, perDay: 0 },
      e: { at0: 0.048498, perDay: 4.469e-9 },
      M: { at0: 19.8950, perDay: 0.0830853001 }
    },
    saturn: {
      N: { at0: 113.6634, perDay: 2.38980e-5 },
      i: { at0: 2.4886, perDay: -1.081e-7 },
      w: { at0: 339.3939, perDay: 2.97661e-5 },
      a: { at0: 9.55475, perDay: 0 },
      e: { at0: 0.055546, perDay: -9.499e-9 },
      M: { at0: 316.9670, perDay: 0.0334442282 }
    },
    uranus: {
      N: { at0: 74.0005, perDay: 1.3978e-5 },
      i: { at0: 0.7733, perDay: 1.9e-8 },
      w: { at0: 96.6612, perDay: 3.0565e-5 },
      a: { at0: 19.18171, perDay: -1.55e-8 },
      e: { at0: 0.047318, perDay: 7.45e-9 },
      M: { at0: 142.5905, perDay: 0.011725806 }
    },
    neptune: {
      N: { at0: 131.7806, perDay: 3.0173e-5 },
      i: { at0: 1.7700, perDay: -2.55e-7 },
      w: { at0: 272.8461, perDay: -6.027e-6 },
      a: { at0: 30.05826, perDay: 3.313e-8 },
      e: { at0: 0.008606, perDay: 2.15e-9 },
      M: { at0: 260.2471, perDay: 0.005995147 }
    }
  };

  var PERTURB = {
    jupiter: {
      lon: [
        { amp: -0.332, fn: "sin", mj: 2, ms: -5, mu: 0, phase: -67.6 },
        { amp: -0.056, fn: "sin", mj: 2, ms: -2, mu: 0, phase: 21 },
        { amp: 0.042, fn: "sin", mj: 3, ms: -5, mu: 0, phase: 21 },
        { amp: -0.036, fn: "sin", mj: 1, ms: -2, mu: 0, phase: 0 },
        { amp: 0.022, fn: "cos", mj: 1, ms: -1, mu: 0, phase: 0 },
        { amp: 0.023, fn: "sin", mj: 2, ms: -3, mu: 0, phase: 52 },
        { amp: -0.016, fn: "sin", mj: 1, ms: -5, mu: 0, phase: -69 }
      ]
    },
    saturn: {
      lon: [
        { amp: 0.812, fn: "sin", mj: 2, ms: -5, mu: 0, phase: -67.6 },
        { amp: -0.229, fn: "cos", mj: 2, ms: -4, mu: 0, phase: -2 },
        { amp: 0.119, fn: "sin", mj: 1, ms: -2, mu: 0, phase: -3 },
        { amp: 0.046, fn: "sin", mj: 2, ms: -6, mu: 0, phase: -69 },
        { amp: 0.014, fn: "sin", mj: 1, ms: -3, mu: 0, phase: 32 }
      ],
      lat: [
        { amp: -0.020, fn: "cos", mj: 2, ms: -4, mu: 0, phase: -2 },
        { amp: 0.018, fn: "sin", mj: 2, ms: -6, mu: 0, phase: -49 }
      ]
    },
    uranus: {
      lon: [
        { amp: 0.040, fn: "sin", mj: 0, ms: 1, mu: -2, phase: 6 },
        { amp: 0.035, fn: "sin", mj: 0, ms: 1, mu: -3, phase: 33 },
        { amp: -0.015, fn: "sin", mj: 1, ms: 0, mu: -1, phase: 20 }
      ]
    }
  };

  function wrap360(deg) {
    var x = deg % 360;
    if (x < 0) x += 360;
    return x;
  }

  function linear(term, d) {
    return term.at0 + term.perDay * d;
  }

  function meanAnomaly(id, d) {
    return wrap360(linear(ORBIT[id].M, d));
  }

  function precessionToJ2000(d) {
    return -J2000_PRECESS_DEG_PER_DAY * d;
  }

  function eccentricAnomaly(Mdeg, e) {
    var M = wrap360(Mdeg) * DEG2RAD;
    var E = M + e * Math.sin(M) * (1 + e * Math.cos(M));
    var tol = KEPLER_TOL_DEG * DEG2RAD;
    var n;
    var next;
    for (n = 0; n < 12; n++) {
      next = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      if (Math.abs(next - E) < tol) return next;
      E = next;
    }
    return E;
  }

  function radiusAndTrueAnomaly(a, e, Mdeg) {
    var E = eccentricAnomaly(Mdeg, e);
    var xv = a * (Math.cos(E) - e);
    var yv = a * Math.sqrt(1 - e * e) * Math.sin(E);
    return {
      r: Math.sqrt(xv * xv + yv * yv),
      v: Math.atan2(yv, xv)
    };
  }

  function eclipticOfDate(el, rv) {
    var N = el.N * DEG2RAD;
    var inc = el.i * DEG2RAD;
    var vw = rv.v + el.w * DEG2RAD;
    var cosN = Math.cos(N);
    var sinN = Math.sin(N);
    var cosVW = Math.cos(vw);
    var sinVW = Math.sin(vw);
    var cosI = Math.cos(inc);
    var xh = rv.r * (cosN * cosVW - sinN * sinVW * cosI);
    var yh = rv.r * (sinN * cosVW + cosN * sinVW * cosI);
    var zh = rv.r * sinVW * Math.sin(inc);
    return {
      lon: Math.atan2(yh, xh) * RAD2DEG,
      lat: Math.atan2(zh, Math.sqrt(xh * xh + yh * yh)) * RAD2DEG,
      r: rv.r
    };
  }

  function sumTerms(terms, mj, ms, mu) {
    var total = 0;
    var i;
    var term;
    var arg;
    for (i = 0; i < terms.length; i++) {
      term = terms[i];
      arg = (term.mj * mj + term.ms * ms + term.mu * mu + term.phase) * DEG2RAD;
      total += term.amp * Math[term.fn](arg);
    }
    return total;
  }

  function perturbations(id, d) {
    var spec = PERTURB[id];
    var mj;
    var ms;
    var mu;
    if (!spec) return { lon: 0, lat: 0 };
    mj = meanAnomaly("jupiter", d);
    ms = meanAnomaly("saturn", d);
    mu = meanAnomaly("uranus", d);
    return {
      lon: spec.lon ? sumTerms(spec.lon, mj, ms, mu) : 0,
      lat: spec.lat ? sumTerms(spec.lat, mj, ms, mu) : 0
    };
  }

  function place(spec, id, d) {
    var el = {
      N: linear(spec.N, d),
      i: linear(spec.i, d),
      w: linear(spec.w, d),
      a: linear(spec.a, d),
      e: linear(spec.e, d),
      M: linear(spec.M, d)
    };
    var sph = eclipticOfDate(el, radiusAndTrueAnomaly(el.a, el.e, el.M));
    var corr;
    var lon;
    var lat;
    var cosLat;
    if (id === "earth") {
      sph.lon += 180;
      sph.lat = 0;
    }
    corr = perturbations(id, d);
    lon = sph.lon + corr.lon + precessionToJ2000(d);
    lat = (sph.lat + corr.lat) * DEG2RAD;
    cosLat = Math.cos(lat);
    lon *= DEG2RAD;
    return {
      x: sph.r * Math.cos(lon) * cosLat,
      y: sph.r * Math.sin(lon) * cosLat,
      z: sph.r * Math.sin(lat),
      lon: wrap360(lon * RAD2DEG)
    };
  }

  function positionAt(id, jd) {
    var spec = ORBIT[id];
    if (!spec) throw new Error("unknown planet: " + id);
    if (typeof jd !== "number" || !isFinite(jd)) {
      throw new Error("jd must be a finite number");
    }
    return place(spec, id, jd - JD_2000_JAN_0);
  }

  window.AltEngine = { positionAt: positionAt };
})();

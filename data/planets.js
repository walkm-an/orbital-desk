/*
Orbital elements are from JPL Solar System Dynamics, Approximate Positions
of the Planets, Table 1. Values are the J2000 epoch. The frame is the mean
ecliptic and equinox of J2000. The valid interval is 1800 AD to 2050 AD.
https://ssd.jpl.nasa.gov/planets/approx_pos.html
The earth record uses the EM Bary row. Table 1 has no separate Earth orbit.
EM Bary is the Earth/Moon barycenter.

Physical fields are from the NASA NSSDCA Planetary Fact Sheet, Metric,
last updated 18 March 2025.
https://nssdc.gsfc.nasa.gov/planetary/factsheet/
radiusKm is half the equatorial diameter on that sheet.
*/

window.PLANETS = [
  {
    id: "mercury",
    name: "水星",
    color: "#b8b2a8",
    radiusKm: 2439.5,
    massKg: 0.330e24,
    dayHours: 1407.6,
    moons: 0,
    elements: {
      a: 0.38709927,
      e: 0.20563593,
      I: 7.00497902,
      L: 252.25032350,
      longPeri: 77.45779628,
      longNode: 48.33076593,
      aRate: 0.00000037,
      eRate: 0.00001906,
      IRate: -0.00594749,
      LRate: 149472.67411175,
      longPeriRate: 0.16047689,
      longNodeRate: -0.12534081
    }
  },
  {
    id: "venus",
    name: "金星",
    color: "#e6c36a",
    radiusKm: 6052,
    massKg: 4.87e24,
    dayHours: -5832.5,
    moons: 0,
    elements: {
      a: 0.72333566,
      e: 0.00677672,
      I: 3.39467605,
      L: 181.97909950,
      longPeri: 131.60246718,
      longNode: 76.67984255,
      aRate: 0.00000390,
      eRate: -0.00004107,
      IRate: -0.00078890,
      LRate: 58517.81538729,
      longPeriRate: 0.00268329,
      longNodeRate: -0.27769418
    }
  },
  {
    id: "earth",
    name: "地球",
    color: "#4c9be8",
    radiusKm: 6378,
    massKg: 5.97e24,
    dayHours: 23.9,
    moons: 1,
    elements: {
      a: 1.00000261,
      e: 0.01671123,
      I: -0.00001531,
      L: 100.46457166,
      longPeri: 102.93768193,
      longNode: 0.0,
      aRate: 0.00000562,
      eRate: -0.00004392,
      IRate: -0.01294668,
      LRate: 35999.37244981,
      longPeriRate: 0.32327364,
      longNodeRate: 0.0
    }
  },
  {
    id: "mars",
    name: "火星",
    color: "#e07a4c",
    radiusKm: 3396,
    massKg: 0.642e24,
    dayHours: 24.6,
    moons: 2,
    elements: {
      a: 1.52371034,
      e: 0.09339410,
      I: 1.84969142,
      L: -4.55343205,
      longPeri: -23.94362959,
      longNode: 49.55953891,
      aRate: 0.00001847,
      eRate: 0.00007882,
      IRate: -0.00813131,
      LRate: 19140.30268499,
      longPeriRate: 0.44441088,
      longNodeRate: -0.29257343
    }
  },
  {
    id: "jupiter",
    name: "木星",
    color: "#d9a066",
    radiusKm: 71492,
    massKg: 1898e24,
    dayHours: 9.9,
    moons: 95,
    elements: {
      a: 5.20288700,
      e: 0.04838624,
      I: 1.30439695,
      L: 34.39644051,
      longPeri: 14.72847983,
      longNode: 100.47390909,
      aRate: -0.00011607,
      eRate: -0.00013253,
      IRate: -0.00183714,
      LRate: 3034.74612775,
      longPeriRate: 0.21252668,
      longNodeRate: 0.20469106
    }
  },
  {
    id: "saturn",
    name: "土星",
    color: "#f2e2b6",
    radiusKm: 60268,
    massKg: 568e24,
    dayHours: 10.7,
    moons: 274,
    elements: {
      a: 9.53667594,
      e: 0.05386179,
      I: 2.48599187,
      L: 49.95424423,
      longPeri: 92.59887831,
      longNode: 113.66242448,
      aRate: -0.00125060,
      eRate: -0.00050991,
      IRate: 0.00193609,
      LRate: 1222.49362201,
      longPeriRate: -0.41897216,
      longNodeRate: -0.28867794
    }
  },
  {
    id: "uranus",
    name: "天王星",
    color: "#6fd3c7",
    radiusKm: 25559,
    massKg: 86.8e24,
    dayHours: -17.2,
    moons: 28,
    elements: {
      a: 19.18916464,
      e: 0.04725744,
      I: 0.77263783,
      L: 313.23810451,
      longPeri: 170.95427630,
      longNode: 74.01692503,
      aRate: -0.00196176,
      eRate: -0.00004397,
      IRate: -0.00242939,
      LRate: 428.48202785,
      longPeriRate: 0.40805281,
      longNodeRate: 0.04240589
    }
  },
  {
    id: "neptune",
    name: "海王星",
    color: "#6d7cff",
    radiusKm: 24764,
    massKg: 102e24,
    dayHours: 16.1,
    moons: 16,
    elements: {
      a: 30.06992276,
      e: 0.00859048,
      I: 1.77004347,
      L: -55.12002969,
      longPeri: 44.96476227,
      longNode: 131.78422574,
      aRate: 0.00026291,
      eRate: 0.00005105,
      IRate: 0.00035372,
      LRate: 218.45945325,
      longPeriRate: -0.32241464,
      longNodeRate: -0.00508664
    }
  }
];

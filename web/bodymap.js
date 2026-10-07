/* Interactive front/back anatomical chart, traced as SVG regions from the
   reference layout. Effort colors are supplied by workout data. */

const MUSCLE_LABELS = {
  neck: 'Neck',
  traps: 'Traps',
  'front-delts': 'Front delts',
  'side-delts': 'Side delts',
  'rear-delts': 'Rear delts',
  chest: 'Chest',
  back: 'Lats',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  'lower-back': 'Lower back',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves'
};

/* Heads-up: MUSCLE_EMOJI is no longer used for body-map markers. We keep the
   object only so old callers (e.g. tooltip builds elsewhere) do not break. */
const MUSCLE_EMOJI = {};

/* ---------------------------------------------------------------------------
   Silhouette path data (left side only; pair() mirrors it)
   --------------------------------------------------------------------------- */

const B = {
  'head': 'M150 8 C138.6 8 131.95 14.65 131.95 25.1 L131.95 31.75 Q129.1 37.45 134.8 43.15 L136.7 49.8 Q142.4 56.45 150 57.4 Q159.5 56.45 164.25 49.8 L166.15 43.15 Q171.85 37.45 169 31.75 L169 25.1 C169 14.65 162.35 8 150 8 Z',
  'neck': 'M137.65 48.85 Q139.55 59.3 136.7 66.9 L125.3 72.6 L150 92.55 L174.7 72.6 L164.25 66.9 Q161.4 59.3 163.3 48.85 Q158.55 58.35 150 58.35 Q142.4 58.35 137.65 48.85 Z',
  'torso': 'M150 72.6 C135.75 69.75 112.95 70.7 101.55 81.15 L104.4 105.85 Q112 129.6 117.7 153.35 L118.65 171.4 L113.9 186.6 Q117.7 204.65 138.6 220.8 L150 226.5 L161.4 220.8 Q182.3 204.65 186.1 186.6 L181.35 171.4 L182.3 153.35 Q188 129.6 195.6 105.85 L198.45 81.15 C187.05 70.7 164.25 69.75 150 72.6 Z',
  'arm': 'M107.25 75.45 C93.95 74.5 92.05 86.85 90.15 100.15 L86.35 118.2 Q75.9 132.45 72.1 148.6 L68.3 167.6 L60.7 185.65 L71.15 191.35 Q82.55 176.15 90.15 163.8 L102.5 142.9 Q106.3 137.2 106.3 125.8 L114.85 103 Q117.7 84.95 107.25 75.45 Z',
  'hand': 'M59.75 184.7 L71.15 190.4 L69.25 200.85 L69.25 215.1 L66.4 217.95 L65.45 206.55 L62.6 222.7 L59.75 223.65 L60.7 206.55 L55 223.65 L52.15 222.7 L55.95 205.6 L48.35 218.9 L45.5 217.95 L51.2 202.75 L43.6 208.45 L41.7 206.55 L52.15 196.1 L43.6 198.95 L41.7 197.05 L52.15 189.45 Z',
  'leg': 'M114.85 176.15 Q127.2 183.75 141.45 211.3 L142.4 228.4 L137.65 255 L134.8 270.2 L133.85 282.55 Q136.7 294.9 131 315.8 L120.55 344.3 L118.65 359.5 L109.15 359.5 L106.3 337.65 Q101.55 317.7 104.4 301.55 L108.2 284.45 L107.25 270.2 Q103.45 253.1 105.35 226.5 Q102.5 204.65 114.85 176.15 Z',
  'foot': 'M109.15 356.65 L118.65 357.6 L119.6 369 L117.7 385.15 Q119.6 394.65 112.95 397.5 L105.35 395.6 L93.95 388 L100.6 376.6 Z'
};

const B_BACK = {
  'head': 'M150 8 C140.5 8 134.8 14.65 134.8 25.1 L134.8 30.8 Q131 36.5 136.7 42.2 L139.55 51.7 L150 59.3 L160.45 51.7 L163.3 42.2 Q168.05 36.5 164.25 30.8 L164.25 25.1 C164.25 14.65 159.5 8 150 8 Z',
  'neck': 'M139.55 42.2 L140.5 54.55 Q137.65 65 129.1 68.8 L150 84.95 L170.9 68.8 Q162.35 65 159.5 54.55 L160.45 42.2 L150 33.65 Z',
  'torso': 'M150 67.85 C135.75 65 114.85 65 104.4 76.4 L108.2 101.1 Q112.95 120.1 119.6 142.9 L120.55 160.95 L113.9 180.9 Q117.7 198 139.55 215.1 L150 219.85 L160.45 215.1 Q182.3 198 186.1 180.9 L179.45 160.95 L180.4 142.9 Q187.05 120.1 191.8 101.1 L195.6 76.4 C185.15 65 164.25 65 150 67.85 Z',
  'arm': 'M110.1 68.8 C99.65 69.75 93.95 80.2 93.95 92.55 L86.35 114.4 Q77.8 129.6 74 146.7 L67.35 168.55 L61.65 189.45 L72.1 194.2 L84.45 176.15 Q93 161.9 97.75 142.9 L109.15 121.05 Q113.9 103 119.6 85.9 Z',
  'hand': 'M61.65 188.5 L72.1 193.25 L71.15 202.75 L73.05 215.1 L71.15 217.95 L67.35 208.45 L65.45 225.55 L62.6 225.55 L63.55 208.45 L57.85 225.55 L55 224.6 L58.8 207.5 L50.25 218.9 L47.4 217 L55 203.7 L47.4 209.4 L45.5 206.55 L55.95 196.1 L48.35 198.95 L47.4 197.05 L56.9 190.4 Z',
  'leg': 'M119.6 167.6 Q133.85 166.65 149.05 188.5 L145.25 217 L137.65 247.4 L128.15 271.15 L127.2 288.25 Q131 304.4 122.45 327.2 L110.1 350.95 L110.1 366.15 L98.7 366.15 L95.85 344.3 L97.75 328.15 L105.35 302.5 L108.2 288.25 L109.15 271.15 L109.15 246.45 L111.05 220.8 Q106.3 205.6 111.05 190.4 Z',
  'foot': 'M97.75 358.55 L109.15 358.55 L110.1 378.5 L112.95 388 Q111.05 394.65 103.45 395.6 L93.95 393.7 L93 387.05 Z'
};

/* ---------------------------------------------------------------------------
   Muscle regions. Coordinates are the left half only for paired groups; the
   shape list is concatenated in draw order so later muscles overlap earlier
   ones the way they sit on the body.
   --------------------------------------------------------------------------- */

const FRONT = {
  'neck': 'M136,58 Q150,69 164,58 L164,69 L150,91 L136,69 Z',
  'traps': 'M136,65 L150,91 L123,78 Z',
  'chest': 'M150 89.7 L143.35 74.5 Q123.4 68.8 109.15 74.5 L112 96.35 Q114.85 110.6 132.9 114.4 L150 108.7 Z',
  'side-delts': 'M108.2 74.5 Q96.8 74.5 93 86.85 L91.1 104.9 L97.75 102.05 L106.3 89.7 Z',
  'front-delts': 'M108.2 74.5 Q99.65 76.4 97.75 86.85 L94.9 105.85 L112 95.4 Z',
  'biceps': 'M95.85 102.05 L111.05 96.35 Q108.2 113.45 104.4 124.85 L91.1 138.15 L85.4 133.4 Q85.4 118.2 95.85 102.05 Z',
  'forearms': 'M81.6 133.4 L89.2 138.15 L82.55 156.2 L66.4 184.7 L62.6 183.75 L72.1 154.3 Z',
  'obliques': 'M113.9 111.55 L131.95 116.3 L132.9 153.35 L119.6 149.55 L117.7 130.55 Z',
  'abs1': 'M150 108.7 Q137.65 106.8 131.95 118.2 L131.95 125.8 Q141.45 120.1 150 122.95 Z',
  'abs2': 'M131.95 127.7 Q141.45 121.05 150 124.85 L150 138.15 Q140.5 133.4 131.95 141 Z',
  'abs3': 'M131.95 142.9 Q141.45 135.3 150 141 L150 153.35 Q140.5 148.6 131.95 155.25 Z',
  'abs4': 'M131.95 155.25 Q141.45 150.5 150 155.25 L150 157.15 Q139.55 161.9 131.95 158.1 Z',
  'quadLat': 'M115.8 185.65 Q104.4 205.6 108.2 233.15 Q110.1 253.1 122.45 266.4 L128.15 255 L124.35 230.3 Z',
  'quadRec': 'M119.6 185.65 L137.65 210.35 L141.45 232.2 L131.95 261.65 L127.2 266.4 L126.25 241.7 L115.8 216.05 Z',
  'quadMed': 'M137.65 227.45 L140.5 252.15 L135.75 271.15 Q126.25 274 127.2 261.65 Z',
  'calves': 'M130.05 296.8 Q132.9 310.1 122.45 339.55 L117.7 346.2 L119.6 321.5 Z'
};

const BACK = {
  'neck': 'M150 33.65 Q145.25 33.65 140.5 46 L139.55 55.5 L150 66.9 Z',
  'traps': 'M150 68.8 L127.2 67.85 L122.45 82.1 L130.05 97.3 L150 113.45 Z',
  'back': 'M114.85 95.4 L130.05 98.25 L149.05 114.4 L132.9 123.9 L127.2 146.7 L117.7 141 L115.8 122.95 Z',
  'lower-back': 'M150 115.35 L134.8 133.4 L122.45 151.45 L121.5 167.6 Q138.6 166.65 150 178.05 Z',
  'side-delts': 'M122.45 68.8 Q103.45 65.95 96.8 80.2 L94.9 95.4 Q112.95 94.45 123.4 83.05 Z',
  'rear-delts': 'M125.3 84.95 L131 98.25 L115.8 115.35 L105.35 105.85 L111.05 93.5 Z',
  'triceps': 'M94.9 98.25 L109.15 94.45 L105.35 116.3 L97.75 138.15 Q89.2 141.95 82.55 135.3 L86.35 118.2 Z',
  'forearms': 'M82.55 138.15 L96.8 140.05 L85.4 163.8 L70.2 191.35 L62.6 188.5 L74 158.1 Z',
  'hamstrings': 'M112 217 L130.05 223.65 L148.1 218.9 L140.5 247.4 L128.15 283.5 L119.6 281.6 L118.65 253.1 L108.2 281.6 L110.1 252.15 Z',
  'calves': 'M117.7 285.4 Q126.25 283.5 126.25 299.65 L124.35 319.6 L118.65 336.7 Q109.15 339.55 105.35 329.1 L99.65 330.05 L106.3 304.4 Z',
  'glutes': 'M150 178.05 Q136.7 164.75 121.5 168.55 L116.75 190.4 L110.1 211.3 Q124.35 226.5 149.05 217.95 Z'
};

/* ---------------------------------------------------------------------------
   Leader-line callouts: the anatomical names printed around the figures.
   `side` picks the label column, `y` is the first line's baseline and `dot`
   is where the leader lands on the muscle. Same seven labels per view as the
   printed chart, so shared groups (neck, forearms, calves) are named once.
   --------------------------------------------------------------------------- */

const CALLOUTS = {
  "front": [
    {
      "side": "left",
      "y": 48,
      "lines": [
        "PECTORALIS",
        "MAJOR"
      ],
      "dot": [
        126,
        90
      ]
    },
    {
      "side": "left",
      "y": 112,
      "lines": [
        "BICEPS BRACHII"
      ],
      "dot": [
        90,
        129
      ]
    },
    {
      "side": "left",
      "y": 179,
      "lines": [
        "FOREARMS"
      ],
      "dot": [
        73,
        164
      ]
    },
    {
      "side": "left",
      "y": 268,
      "lines": [
        "QUADRICEPS"
      ],
      "dot": [
        116,
        237
      ]
    },
    {
      "side": "right",
      "y": 49,
      "lines": [
        "ANTERIOR",
        "DELTOID"
      ],
      "dot": [
        195,
        89
      ]
    },
    {
      "side": "right",
      "y": 131,
      "lines": [
        "SERRATUS",
        "ANTERIOR"
      ],
      "dot": [
        181,
        131
      ]
    },
    {
      "side": "right",
      "y": 179,
      "lines": [
        "CORE"
      ],
      "dot": [
        168,
        160
      ]
    }
  ],
  "back": [
    {
      "side": "right",
      "y": 30,
      "lines": [
        "TRAPEZIUS"
      ],
      "dot": [
        170,
        71
      ]
    },
    {
      "side": "right",
      "y": 62,
      "lines": [
        "MEDIAL &",
        "POSTERIOR",
        "DELTOID"
      ],
      "dot": [
        200,
        86
      ]
    },
    {
      "side": "right",
      "y": 125,
      "lines": [
        "TRICEPS"
      ],
      "dot": [
        207,
        119
      ]
    },
    {
      "side": "right",
      "y": 177,
      "lines": [
        "LATISSIMUS",
        "DORSI"
      ],
      "dot": [
        176,
        129
      ]
    },
    {
      "side": "right",
      "y": 237,
      "lines": [
        "GLUTES"
      ],
      "dot": [
        180,
        208
      ]
    },
    {
      "side": "right",
      "y": 287,
      "lines": [
        "HAMSTRINGS"
      ],
      "dot": [
        182,
        263
      ]
    },
    {
      "side": "right",
      "y": 345,
      "lines": [
        "GASTROCNEMIUS"
      ],
      "dot": [
        181,
        309
      ]
    }
  ]
};

/**
 * CSS class for a muscle's effort level.
 * 0 -> bm-none (plain silhouette grey), 1..4 -> bm-effort-1..4, which
 * style.css collapses into the three chart tiers (1-2 yellow, 3 orange,
 * 4 pink).
 */
function getEffortClass(muscle) {
  if (!muscle) return 'bm-none';
  const level = Math.min(4, Math.max(0, Math.round(muscle.level || 0)));
  return level === 0 ? 'bm-none' : 'bm-effort-' + level;
}

function levelOf(muscle) {
  if (!muscle) return 0;
  return Math.min(4, Math.max(0, Math.round(muscle.level || 0)));
}

/** Get a tooltip text for a muscle with effort information */
function getEffortTooltip(muscle, name) {
  const label = MUSCLE_LABELS[name] || name;
  const never = muscle == null || muscle.daysAgo === null || muscle.daysAgo === undefined;
  if (never) return label + ': never trained';

  const level = levelOf(muscle);
  // The backend sends `daysAgo` (Code.js muscleStatus) — not `lastTrained`,
  // which does not exist, so this used to say "never trained" for everything.
  const when = muscle.daysAgo === 0 ? 'trained today' : muscle.daysAgo + 'd ago';

  const base = label + ' — ' + when;
  const effortText = level === 0 ? '' : ' · Effort ' + level + '/4';
  const intensityText = muscle.intensity ? ' · ' + muscle.intensity + '× weekly target' : '';
  const loadText = muscle.load7d ? ' · ' + muscle.load7d + ' kcal/7d' : '';
  const sessionsText = muscle.sessions7d ? ' · ' + muscle.sessions7d + '× this week' : '';

  return base + effortText + intensityText + loadText + sessionsText;
}

/* The three chart tiers, top use first (same order as the printed legend). */
const EFFORT_TIERS = [
  { cls: 'bm-effort-4', label: 'Most used' },
  { cls: 'bm-effort-3', label: 'Moderately used' },
  { cls: 'bm-effort-1', label: 'Least used' }
];

/** Legend under the figures: one swatch per chart tier. */
function buildEffortLegend(status) {
  const trained = status
    ? Object.keys(status).filter(function (k) {
        return levelOf(status[k]) > 0;
      }).length
    : 0;

  return `
    <div class="bm-effort-legend">
      <div class="bm-effort-levels">
        ${EFFORT_TIERS.map(item => `
          <div class="bm-effort-level">
            <span class="bm-effort-dot ${item.cls}"></span>
            <span class="bm-effort-label">${item.label}</span>
          </div>
        `).join('')}
      </div>
      <div class="bm-legend-title">Effort over the last 7 days · ${trained}/17 trained</div>
    </div>
  `;
}

/** Repeat a left-side SVG snippet on the right by mirroring it around x=150. */
function pair(left) {
  return left + '<g transform="translate(300,0) scale(-1,1)">' + left + '</g>';
}

/** A muscle region: filled shapes inherit the effort colour from the group. */
function region(muscle, shapes) {
  return `<g class="bm-region" data-muscle="${muscle}">${shapes}</g>`;
}

/** Anatomical divider inside a muscle group (tendon, head boundary). */
function line(d) {
  return `<path class="bm-line" d="${d}"/>`;
}

/** Contour detail on the plain silhouette (joints, jaw, fingers, toes). */
function contour(d) {
  return `<path class="bm-contour" d="${d}"/>`;
}

const LINE_HEIGHT = 11;
const LABEL_X = { left: 50, right: 240 };

/** One printed-style callout: stacked name + leader line + landing dot. */
function callout(spec) {
  const left = spec.side === 'left';
  const anchor = LABEL_X[spec.side];
  const dotX = spec.dot[0];
  const dotY = spec.dot[1];
  const last = spec.y + (spec.lines.length - 1) * LINE_HEIGHT;

  const text = spec.lines.map(function (t, i) {
    return `<text x="${anchor}" y="${spec.y + i * LINE_HEIGHT}" ` +
      `text-anchor="${left ? 'end' : 'start'}">${t}</text>`;
  }).join('');

  // The leader leaves the label block's vertical centre and curves into the dot.
  const sx = anchor + (left ? 5 : -5);
  const sy = (spec.y + last) / 2;
  const ex = dotX + (left ? -3 : 3);
  const ey = dotY - 3;
  const cx = (sx + ex) / 2 + (left ? -6 : 6);
  const cy = (sy + ey) / 2 - 4;

  return `${text}
    <path class="bm-lead" d="M${sx},${sy} Q${cx},${cy} ${ex},${ey}"/>
    <path class="bm-lead" d="M${ex + (left ? -5 : 5)},${ey - 3} L${ex},${ey} L${ex + (left ? -5 : 5)},${ey + 4}"/>`;
}

/** Grey silhouette: head, neck, torso, arms, hands, legs, feet. */
function baseBody(view) {
  const shape = view === 'back' ? B_BACK : B;

  return `
  <g class="bm-base">
    <ellipse class="bm-shadow" cx="150" cy="411" rx="63" ry="7"/>
    ${pair(`<path class="bm-flesh" d="${shape.leg}"/>`)}
    ${pair(`<path class="bm-joint" d="${shape.foot}"/>`)}
    ${pair(`<path class="bm-flesh" d="${shape.arm}"/>`)}
    ${pair(`<path class="bm-joint" d="${shape.hand}"/>`)}

    <path class="bm-flesh" d="${shape.torso}"/>
    <path class="bm-flesh" d="${shape.neck}"/>
    <path class="bm-flesh" d="${shape.head}"/>
    ${view === 'back' ? contour('M137,46 Q145,28 150,33 Q155,28 163,46') : contour('M136,52 Q150,64 164,52')}
  </g>`;
}

/** Joint markers sit on top of the muscles, like the printed chart. */
function jointDetail(view) {
  const details = view === 'back'
    ? contour('M108,287 Q119,282 126,290') + contour('M98,359 L110,359')
    : contour('M108,278 L118,284 L132,286') + contour('M110,358 L119,360');
  return '<g class="bm-joints">' + pair(details) + '</g>';
}

function calloutsFor(view) {
  return `
  <g class="bm-labels" aria-hidden="true">
    ${CALLOUTS[view].map(callout).join('')}
  </g>`;
}

/* ============================== FRONT VIEW =============================== */

function figureFront() {
  const F = FRONT;
  return `
  <svg class="bm-svg" viewBox="-55 0 400 420" role="img" aria-label="Front view, muscles trained from the front">
    ${baseBody('front')}

    ${region('neck', `<path d="${F.neck}"/>`)}

    ${region('traps', pair(`<path d="${F.traps}"/>`))}

    ${region('chest', pair(`<path d="${F.chest}"/>`))}

    ${region('obliques', pair(`<path d="${F.obliques}"/>` + line('M115,119 L128,125 M116,127 L129,133 M117,135 L130,141 M118,143 L131,149')))}

    ${region('abs', pair(`<path d="${F.abs1}"/><path d="${F.abs2}"/>` +
      `<path d="${F.abs3}"/><path d="${F.abs4}"/>`))}

    ${region('side-delts', pair(`<path d="${F['side-delts']}"/>`))}

    ${region('front-delts', pair(`<path d="${F['front-delts']}"/>`))}

    ${region('biceps', pair(`<path d="${F.biceps}"/>`))}

    ${region('forearms', pair(`<path d="${F.forearms}"/>`))}

    ${region('quads', pair(`<path d="${F.quadLat}"/><path d="${F.quadRec}"/>` +
      `<path d="${F.quadMed}"/>`))}

    ${region('calves', pair(`<path d="${F.calves}"/>`))}


    <g class="bm-contour">
      ${pair(contour('M121,160 L146,212 L150,222') + contour('M126,161 L139,208') + contour('M119,176 L132,214') + contour('M108,289 Q100,325 112,354'))}
    </g>
    ${jointDetail('front')}
    ${calloutsFor('front')}
  </svg>`;
}

/* =============================== BACK VIEW =============================== */

function figureBack() {
  const K = BACK;
  return `
  <svg class="bm-svg" viewBox="30 0 400 420" role="img" aria-label="Back view, muscles trained from behind">
    ${baseBody('back')}

    ${region('neck', pair(`<path d="${K.neck}"/>`))}

    ${region('traps', pair(`<path d="${K.traps}"/>`))}

    ${region('back', pair(`<path d="${K.back}"/>`))}

    ${region('lower-back', pair(`<path d="${K['lower-back']}"/>`))}

    ${region('side-delts', pair(`<path d="${K['side-delts']}"/>`))}

    ${region('rear-delts', pair(`<path d="${K['rear-delts']}"/>`))}

    ${region('triceps', pair(`<path d="${K.triceps}"/>`))}

    ${region('forearms', pair(`<path d="${K.forearms}"/>`))}

    ${region('hamstrings', pair(`<path d="${K.hamstrings}"/>`))}

    ${region('calves', pair(`<path d="${K.calves}"/>`))}

    ${region('glutes', pair(`<path d="${K.glutes}"/>`))}

    ${jointDetail()}
    ${calloutsFor('back')}
  </svg>`;
}

/** Paint both figures and colour every muscle region from `status`. */
function renderBodyMap(root, status) {
  if (!root) return;
  const statusMap = status || {};

  root.innerHTML =
    `<div class="bm-stage">
      <div class="bm-grid">
        <div class="bm-figure" data-view="front">${figureFront()}</div>
        <div class="bm-figure" data-view="back">${figureBack()}</div>
      </div>
      ${buildEffortLegend(statusMap)}
    </div>`;

  // Apply effort classes to all muscle regions
  root.querySelectorAll('.bm-region').forEach(function (g) {
    const name = g.getAttribute('data-muscle');
    const muscle = statusMap[name];

    const effortClass = getEffortClass(muscle);
    // Colour lives on the <g> via the effort class in style.css; children
    // that declare their own fill/stroke (anatomical lines) keep theirs.
    g.setAttribute('fill', 'currentColor');
    // CSS supplies white anatomical seams independently of effort fill.
    g.classList.add(effortClass);

    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');

    const tooltip = getEffortTooltip(muscle, name);
    g.setAttribute('aria-label', tooltip);
    // Real days-since-trained, so applyBodyWindow() can filter. This used to
    // assign '' either way, which made every region fade out as out-of-window.
    g.dataset.days = (muscle && muscle.daysAgo !== null && muscle.daysAgo !== undefined)
      ? String(muscle.daysAgo) : '';
    g.dataset.tip = tooltip;
  });
}

// Browser-safe export: in the PWA `module` does not exist, and an unguarded
// assignment here threw "module is not defined" on every page load.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    renderBodyMap,
    getEffortClass,
    buildEffortLegend,
    getEffortTooltip,
    MUSCLE_LABELS,
    MUSCLE_EMOJI
  };
}

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
  'head': 'M150,8 C164,8 170,17 169,31 L169,40 C167,51 160,58 150,59 C140,58 133,51 131,40 L131,31 C130,17 136,8 150,8 Z',
  'neck': 'M137,48 L163,48 L164,64 Q167,71 178,75 L150,93 L122,75 Q133,71 136,64 Z',
  'torso': 'M150,75 C137,73 121,75 111,85 L111,112 Q115,135 119,151 L120,172 L113,190 Q115,206 135,215 L150,230 L165,215 Q185,206 187,190 L180,172 L181,151 Q185,135 189,112 L189,85 C179,75 163,73 150,75 Z',
  'arm': 'M113,80 C101,80 96,90 94,104 L86,126 L76,151 L65,177 L55,195 L65,201 L82,178 L92,156 L103,137 L112,117 Q124,93 113,80 Z',
  'hand': 'M55,195 L65,201 L66,211 L74,222 L71,224 L64,217 L66,232 L63,233 L59,219 L60,237 L57,237 L54,220 L51,235 L48,233 L49,218 L44,230 L41,228 L48,212 L43,216 L40,214 L49,203 Z',
  'leg': 'M115,185 Q131,184 150,217 L141,239 L137,272 L133,291 L135,316 L132,343 L127,369 L116,369 L106,340 Q101,316 105,291 L109,271 Q101,243 105,218 Z',
  'foot': 'M116,365 L127,365 L126,379 Q133,391 130,397 Q119,403 110,395 L103,391 L109,379 Z'
};

/* ---------------------------------------------------------------------------
   Muscle regions. Coordinates are the left half only for paired groups; the
   shape list is concatenated in draw order so later muscles overlap earlier
   ones the way they sit on the body.
   --------------------------------------------------------------------------- */

const FRONT = {
  'neck': 'M136,58 Q150,69 164,58 L164,69 L150,91 L136,69 Z',
  'traps': 'M136,65 L150,91 L123,78 Z',
  'chest': 'M150,92 L145,77 Q129,72 117,79 L111,101 Q116,115 130,116 L150,111 Z',
  'side-delts': 'M115,79 Q101,76 96,90 L93,109 Q106,104 113,96 Z',
  'front-delts': 'M116,79 L123,78 L115,99 L105,108 L98,103 Q106,96 108,81 Z',
  'biceps': 'M99,108 L109,105 L100,128 L91,141 L84,145 L83,133 L90,117 Z',
  'forearms': 'M82,144 L90,141 L82,166 L64,197 L58,194 L69,167 Z',
  'obliques': 'M114,115 L129,117 L132,155 L119,159 L118,139 Z',
  'abs1': 'M150,109 Q139,107 132,119 L132,130 Q141,124 150,126 Z',
  'abs2': 'M132,132 Q141,126 150,129 L150,143 Q140,140 132,145 Z',
  'abs3': 'M132,147 Q140,142 150,145 L150,157 Q140,153 132,159 Z',
  'abs4': 'M132,161 Q141,156 150,159 L150,162 Q140,166 132,162 Z',
  'quadLat': 'M114,188 Q105,204 108,229 L116,254 L121,267 L125,256 L120,221 Z',
  'quadRec': 'M117,190 L132,214 L139,234 L130,264 L124,269 L123,244 L115,218 Z',
  'quadMed': 'M137,230 L139,250 L133,271 Q125,277 123,265 L129,247 Z',
  'calves': 'M131,297 Q139,313 129,343 L125,350 L124,334 Z'
};

const BACK = {
  'neck': 'M150,34 Q141,35 136,58 L133,68 L150,73 Z',
  'traps': 'M150,69 L128,69 L122,81 L127,95 L150,114 Z',
  'back': 'M124,98 L150,115 L137,135 L130,148 L119,143 L115,121 Z',
  'lower-back': 'M150,117 L135,139 L121,165 L121,175 Q139,172 150,187 Z',
  'side-delts': 'M124,71 Q105,67 98,81 L95,96 Q109,98 124,84 Z',
  'rear-delts': 'M124,83 L128,95 L115,109 L106,101 L109,94 Z',
  'triceps': 'M96,99 L108,98 L104,117 L93,142 Q85,146 79,138 L86,122 Z',
  'forearms': 'M79,141 L92,145 L81,167 L65,199 L56,195 L68,168 Z',
  'hamstrings': 'M110,222 L130,222 L139,230 L133,263 L125,292 L118,287 L117,260 L107,278 L108,251 Z',
  'calves': 'M117,292 Q128,286 132,304 L130,322 L125,338 Q114,342 110,328 L109,315 Z',
  'glutes': 'M150,179 Q134,168 122,177 L116,198 L111,216 Q124,230 149,220 Z'
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

  return `
  <g class="bm-base">
    <ellipse class="bm-shadow" cx="150" cy="411" rx="63" ry="7"/>
    ${pair(`<path class="bm-flesh" d="${B.leg}"/>`)}
    ${pair(`<path class="bm-joint" d="${B.foot}"/>`)}
    ${pair(`<path class="bm-flesh" d="${B.arm}"/>`)}
    ${pair(`<path class="bm-joint" d="${B.hand}"/>`)}

    <path class="bm-flesh" d="${B.torso}"/>
    <path class="bm-flesh" d="${B.neck}"/>
    ${pair(`<ellipse class="bm-flesh" cx="128" cy="37" rx="3.4" ry="5.6"/>`)}
    <path class="bm-flesh" d="${B.head}"/>
    ${view === 'back' ? contour('M137,50 C143,55 157,55 163,50') : contour('M139,52 C144,58 156,58 161,52')}
  </g>`;
}

/** Joint markers sit on top of the muscles, like the printed chart. */
function jointDetail() {
  return '<g class="bm-joints">' + pair(contour('M105,280 L116,286 L130,282') + contour('M116,365 L127,365')) + '</g>';
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
      ${pair(contour('M119,164 L144,215 L150,223') + contour('M124,164 L138,211') + contour('M111,184 L132,216') + contour('M107,291 L118,313 L116,361'))}
    </g>
    ${jointDetail()}
    ${calloutsFor('front')}
  </svg>`;
}

/* =============================== BACK VIEW =============================== */

function figureBack() {
  const K = BACK;
  return `
  <svg class="bm-svg" viewBox="30 0 400 420" role="img" aria-label="Back view, muscles trained from behind">
    ${baseBody('back')}

    ${region('neck', `<path d="${K.neck}"/>`)}

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

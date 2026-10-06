/* =============================================================================
   bodymap.js - front/back muscle map
   =============================================================================
   Pure SVG. 17 tracked muscle groups, each a distinct region coloured by how
   hard it has been trained (backend effort level 0-4), rendered as the classic
   three-tier anatomical chart:

     most used  (level 4)    -> pink
     moderate   (level 3)    -> orange
     least used (level 1-2)  -> yellow
     never      (level 0)    -> plain silhouette grey

   Geometry notes
   --------------
   Both figures share one silhouette body so the two views line up exactly.
   The standing figure is ~7.5 heads tall (head 52 units of a 400-unit body)
   and mirrored halves are built with pair(), which reflects a left-side
   snippet around x=100, so every paired muscle stays perfectly symmetric.

   Colour lives on the <g class="bm-region"> element via the effort class in
   style.css; child shapes inherit it, while the white anatomical lines and
   the card-coloured seams are declared per child so they stay crisp.
   ==========================================================================*/

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
   Landmarks (viewBox 0 0 200 400, body axis at x=100)

     head ......... y 11 - 61     (52 units = 1 head, figure is ~7.5 heads)
     shoulder ..... y 84          outer delt at x=60
     armpit ....... y 130
     waist ........ y 171         x 80-120
     hip .......... y 204         x 76-124
     crotch ....... y 226
     elbow ........ y 170
     wrist ........ y 242         fingertips y 266 (mid-thigh)
     knee ......... y 297
     ankle ........ y 374
     sole ......... y 394
   --------------------------------------------------------------------------- */

const BODY = '#a9a6a1';   // silhouette grey
const JOINT = '#95928d';  // hands / feet, a shade darker
const SEAM = '#f6f4f1';   // card colour: separates regions like the reference
const LINE = '#ffffff';   // anatomical outline lines

/* Left-side base body paths (mirrored with pair()). */
const P = {
  head: 'M100,11 C110,11 117,22 117,36 C117,50 110,61 100,61 C90,61 83,50 83,36 C83,22 90,11 100,11 Z',
  neck: 'M91,52 L109,52 L112,80 L88,80 Z',
  torso:
    'M100,72 C90,72 79,76 71,84 C63,91 59,101 60,113 C61,125 66,135 70,143 ' +
    'C75,153 79,161 80,171 C81,181 80,191 78,201 C77,209 79,217 85,222 ' +
    'C89,225 95,226 100,226 Z',
  upperArm: 'M73,92 C66,112 62,140 60,170',
  lowerArm: 'M60,168 C56,192 55,220 56,242',
  hand: 'M45,231 C39,242 38,256 44,265 C51,273 60,269 61,257 L61,236 Z',
  thigh:
    'M100,212 C90,212 81,216 77,225 C72,237 70,252 71,268 C72,282 74,291 78,297 ' +
    'L97,299 C99,289 100,270 100,254 Z',
  shin:
    'M97,300 C89,305 81,316 79,332 C77,348 79,363 84,374 L94,374 ' +
    'C96,358 98,330 99,312 Z',
  foot: 'M78,372 L97,372 C100,379 101,388 101,394 L75,394 C74,386 75,378 78,372 Z'
};

/**
 * CSS class for a muscle's effort level.
 * 0 -> bm-none (plain silhouette grey), 1..4 -> bm-effort-1..4, which
 * style.css collapses into the three chart tiers (1-2 yellow, 3 orange,
 * 4 pink).
 */
function getEffortClass(muscle) {
  if (!muscle) return 'bm-none';
  const level = Math.min(5, Math.max(0, muscle.level || 0));
  return level === 0 ? 'bm-none' : 'bm-effort-' + level;
}

function levelOf(muscle) {
  if (!muscle) return 0;
  return Math.min(5, Math.max(0, Math.round(muscle.level || 0)));
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

/* The three chart tiers, top use first (same order as the reference legend). */
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

/** Repeat a left-side SVG snippet on the right by mirroring it around x=100. */
function pair(left) {
  return left + '<g transform="translate(200,0) scale(-1,1)">' + left + '</g>';
}

/** A muscle region: filled shapes inherit the effort colour from the group. */
function region(muscle, shapes) {
  return `<g class="bm-region" data-muscle="${muscle}">${shapes}</g>`;
}

/** White anatomical divider, drawn on top of whatever colour the region has. */
function line(d) {
  return `<path d="${d}" fill="none" stroke="${LINE}" stroke-width="1.1" stroke-linecap="round"/>`;
}

function baseBody(view) {
  const head =
    view === 'front'
      ? `<path class="bm-jaw" d="M91,52 C95,57 105,57 109,52" fill="none" stroke="${LINE}" stroke-width="1.1" stroke-linecap="round"/>`
      : `<path class="bm-jaw" d="M90,57 C94,63 106,63 110,57" fill="none" stroke="${LINE}" stroke-width="1.1" stroke-linecap="round"/>`;

  return `
  <g class="bm-base">
    <ellipse class="bm-shadow" cx="100" cy="397" rx="46" ry="5"/>
    ${pair(`
      <path d="${P.thigh}" fill="${BODY}"/>
      <path d="${P.shin}" fill="${BODY}"/>
      <path d="${P.foot}" fill="${JOINT}"/>
    `)}
    ${pair(`
      <path d="${P.upperArm}" fill="none" stroke="${BODY}" stroke-width="25" stroke-linecap="round"/>
      <path d="${P.lowerArm}" fill="none" stroke="${BODY}" stroke-width="21" stroke-linecap="round"/>
      <path d="${P.hand}" fill="${JOINT}"/>
      ${line('M52,236 L50,258')}
      ${line('M57,239 L55,259')}
      ${line('M47,242 L45,259')}
    `)}
    ${pair(`<path d="${P.torso}" fill="${BODY}"/>`)}
    <path d="${P.neck}" fill="${BODY}"/>
    <path d="${P.head}" fill="${BODY}"/>
    ${head}
  </g>`;
}

/* ============================== FRONT VIEW =============================== */

function figureFront() {
  return `
  <svg class="bm-svg" viewBox="0 0 200 400" role="img" aria-label="Front view, muscles trained from the front">
    ${baseBody('front')}

    ${region('neck', `
      <path d="M92,54 L108,54 L111,80 L89,80 Z"/>
      ${line('M96,55 C94,63 93,71 92,79')}
    `)}

    ${region('traps', pair(`
      <path d="M94,74 C85,77 77,81 70,88 C78,90 86,88 91,84 C96,80 99,77 99,74 Z"/>
    `))}

    ${region('side-delts', pair(`
      <path d="M74,84 C66,88 61,97 60,109 C59,120 63,129 70,131 C75,132 79,128 80,121 L79,93 C78,88 76,83 74,84 Z"/>
      ${line('M74,88 C70,97 68,109 69,122')}
    `))}

    ${region('front-delts', pair(`
      <path d="M80,90 C86,85 92,83 97,84 L97,104 C93,114 86,120 80,122 C78,112 78,99 80,90 Z"/>
      ${line('M83,90 C85,99 85,109 83,119')}
    `))}

    ${region('chest', pair(`
      <path d="M98,84 C90,82 83,85 79,93 C76,101 76,113 79,122 C83,130 91,133 98,131 Z"/>
      ${line('M79,110 C86,113 93,112 98,107')}
    `))}

    ${region('biceps', pair(`
      <path d="M72,98 C65,102 61,115 60,131 C59,146 61,161 66,169 C70,173 74,169 75,159 C76,143 75,122 74,108 C73,100 73,96 72,98 Z"/>
      ${line('M61,110 C60,128 61,146 65,164')}
    `))}

    ${region('forearms', pair(`
      <path d="M64,176 C58,183 54,199 53,216 C52,230 55,242 59,247 C63,250 66,245 66,233 C67,215 67,193 66,180 Z"/>
      ${line('M55,186 C54,206 54,226 57,244')}
    `))}

    ${region('abs', pair(`
      <rect x="88" y="132" width="12" height="16" rx="4"/>
      <rect x="88" y="150" width="12" height="16" rx="4"/>
      <rect x="88" y="168" width="12" height="16" rx="4"/>
      <path d="M88,186 L100,186 L100,204 C95,209 90,203 88,194 Z"/>
    `))}

    ${region('obliques', pair(`
      <path d="M88,126 C81,134 77,150 78,168 C78,183 82,194 88,202 L88,186 L88,126 Z"/>
      ${line('M84,130 C81,140 80,152 80,164')}
      ${line('M85,144 C82,153 81,163 82,173')}
    `))}

    ${region('quads', pair(`
      <path d="M99,216 C91,217 85,222 82,231 C78,244 76,262 77,278 C78,289 81,296 85,298 C90,301 95,297 97,289 C99,274 100,246 100,224 Z"/>
      ${line('M93,222 C91,242 90,266 90,290')}
      ${line('M86,232 C84,250 83,270 85,290')}
      ${line('M96,240 C96,260 96,276 96,288')}
    `))}

    ${region('calves', pair(`
      <path d="M96,304 C89,309 83,320 81,334 C79,348 81,362 85,372 L93,373 C95,357 96,334 98,312 Z"/>
      ${line('M88,308 C86,326 86,348 88,368')}
    `))}
  </svg>`;
}

/* =============================== BACK VIEW =============================== */

function figureBack() {
  return `
  <svg class="bm-svg" viewBox="0 0 200 400" role="img" aria-label="Back view, muscles trained from behind">
    ${baseBody('back')}

    ${region('neck', `
      <path d="M92,54 L108,54 L110,80 L90,80 Z"/>
      ${line('M94,56 C94,64 95,72 96,79')}
      ${line('M106,56 C106,64 105,72 104,79')}
    `)}

    ${region('traps', pair(`
      <path d="M100,72 C86,74 75,81 68,90 C79,95 90,103 96,113 C99,121 100,128 100,134 Z"/>
      ${line('M83,87 C88,95 93,105 96,114')}
    `))}

    ${region('side-delts', pair(`
      <path d="M74,84 C66,88 61,97 60,109 C59,120 63,129 70,131 C75,132 79,128 80,121 L79,93 C78,88 76,83 74,84 Z"/>
      ${line('M74,88 C70,97 68,109 69,122')}
    `))}

    ${region('rear-delts', pair(`
      <path d="M80,92 C86,86 92,84 97,85 L97,104 C93,114 87,120 81,122 C79,113 78,100 80,92 Z"/>
      ${line('M84,90 C86,99 86,110 83,119')}
    `))}

    ${region('triceps', pair(`
      <path d="M73,100 C66,104 62,117 61,133 C60,148 62,163 67,171 C71,175 75,171 76,161 C77,145 76,124 75,110 C74,102 74,98 73,100 Z"/>
      ${line('M63,114 C62,132 63,150 68,167')}
    `))}

    ${region('back', pair(`
      <path d="M97,116 C88,121 78,130 74,142 C70,155 71,170 75,184 C81,195 90,200 99,201 L100,196 L100,116 Z"/>
      ${line('M92,124 C86,136 81,152 79,170')}
      ${line('M87,140 C82,152 79,166 79,182')}
    `))}

    ${region('lower-back', `
      <path d="M93,178 L107,178 L109,206 C103,213 97,213 91,206 Z"/>
      ${line('M100,180 L100,210')}
    `)}

    ${region('glutes', `
      <path d="M100,204 C92,202 82,205 78,214 C74,225 76,239 83,246 C90,251 96,248 100,242 C104,248 110,251 117,246 C124,239 126,225 122,214 C118,205 108,202 100,204 Z"/>
      ${line('M100,206 L100,246')}
      ${line('M87,212 C83,222 83,234 88,243')}
      ${line('M113,212 C117,222 117,234 112,243')}
    `)}

    ${region('forearms', pair(`
      <path d="M64,176 C58,183 54,199 53,216 C52,230 55,242 59,247 C63,250 66,245 66,233 C67,215 67,193 66,180 Z"/>
      ${line('M55,186 C54,206 54,226 57,244')}
    `))}

    ${region('hamstrings', pair(`
      <path d="M99,250 C90,255 83,266 79,281 C76,292 78,299 83,303 L95,304 C97,293 99,268 100,252 Z"/>
      ${line('M90,256 C86,270 84,286 85,300')}
      ${line('M86,268 C83,280 82,292 84,301')}
    `))}

    ${region('calves', pair(`
      <path d="M97,304 C88,309 79,321 77,338 C75,355 78,367 83,374 L93,375 C95,360 97,334 99,314 Z"/>
      ${line('M91,310 C86,328 84,350 85,370')}
    `))}
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
    g.setAttribute('stroke', 'currentColor');
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

/* =============================================================================
   bodymap.js - front/back muscular anime-style body map
   =============================================================================
   Pure SVG. 17 tracked muscle groups, each a distinct region coloured by how
   hard it has been trained (backend effort level 0-4). Regions use
   currentColor so the effort class in style.css drives the look.

   Mirrored halves are built with pair(), which reflects a left-side snippet
   around x=100, so every paired muscle stays perfectly symmetric.
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

// Geometric uppercase sans-serif used for the logo wordmark.
const LOGO_FONT = 'Inter, Outfit, system-ui, sans-serif';

/**
 * CSS class for a muscle's effort level.
 * 0 -> bm-none (flat unhighlighted), 1..4 -> bm-effort-1..4 (bright red).
 */
function getEffortClass(muscle) {
  if (!muscle) return 'bm-none';
  const level = Math.min(5, Math.max(0, muscle.level || 0));
  return level === 0 ? 'bm-none' : 'bm-effort-' + level;
}

/** Which muscles should be highlighted in bright red? */
function isHighlighted(muscleName) {
  return (
    muscleName === 'neck' ||
    muscleName === 'traps' ||
    muscleName === 'rear-delts' ||
    muscleName === 'back' ||
    muscleName === 'forearms' ||
    muscleName === 'triceps'
  );
}

/** Class prefix for a muscle region's fill color. */
function muscleFillClass(muscleName) {
  return isHighlighted(muscleName) ? 'bm-region-hl' : 'bm-region-flat';
}

/** Get a tooltip text for a muscle with effort information */
function getEffortTooltip(muscle, name) {
  const emoji = MUSCLE_EMOJI[name] || '';
  const label = MUSCLE_LABELS[name] || name;
  const never = muscle == null || muscle.daysAgo === null || muscle.daysAgo === undefined;
  if (never) return emoji + ' ' + label + ': never trained';

  const level = Math.min(5, Math.max(0, muscle.level || 0));
  // The backend sends `daysAgo` (Code.js muscleStatus) — not `lastTrained`,
  // which does not exist, so this used to say "never trained" for everything.
  const when = muscle.daysAgo === 0 ? 'trained today' : muscle.daysAgo + 'd ago';

  const base = emoji + ' ' + label + ' — ' + when;
  const effortText = level === 0 ? '' : ' · Effort ' + level + '/4';
  const intensityText = muscle.intensity ? ' · ' + muscle.intensity + '× weekly target' : '';
  const loadText = muscle.load7d ? ' · ' + muscle.load7d + ' kcal/7d' : '';
  const sessionsText = muscle.sessions7d ? ' · ' + muscle.sessions7d + '× this week' : '';

  return base + effortText + intensityText + loadText + sessionsText;
}

/** Legend under the figures: one swatch per effort level. */
function buildEffortLegend(status) {
  const statusLevels = [
    { level: 0, label: 'Never trained', color: 'bm-none' },
    { level: 1, label: 'Light session', color: 'bm-effort-1' },
    { level: 2, label: 'Solid training', color: 'bm-effort-2' },
    { level: 3, label: 'Hard week', color: 'bm-effort-3' },
    { level: 4, label: 'Maxed out', color: 'bm-effort-4' }
  ];

  return `
    <div class="bm-effort-legend">
      <div class="bm-legend-title">How hard you've trained it · last 7 days</div>
      <div class="bm-effort-levels">
        ${statusLevels.map(item => `
          <div class="bm-effort-level">
            <span class="bm-effort-dot ${item.color}"></span>
            <span class="bm-effort-label">${item.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/** Repeat a left-side SVG snippet on the right by mirroring it around x=100. */
function pair(left) {
  return left + '<g transform="translate(200,0) scale(-1,1)">' + left + '</g>';
}

/* Shared charcoal silhouette: same landmarks on both views. Light-gray stroke
   only; muscles are flat (unhighlighted) until the highlight list kicks in. */
function baseBody(extra) {
  return `
    <g class="bm-base" fill="#26324a" stroke="#cfd8e0" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
      <!-- neck -->
      <path d="M89,46 L111,46 L114,76 L86,76 Z"/>
      <!-- torso: broad shoulders -> V-taper -> hips -->
      <path d="M100,62
               C87,62 74,66 63,76
               C54,85 50,96 51,110
               L59,152
               C63,172 70,192 75,212
               L80,232
               L120,232
               L125,212
               C130,192 137,172 141,152
               L149,110
               C150,96 146,85 137,76
               C126,66 113,62 100,62 Z"/>
      <!-- arms + hands (left, mirrored) -->
      ${pair(`
        <path d="M59,94 C51,116 46,140 45,164" fill="none" stroke-width="23" stroke-linecap="round"/>
        <path d="M45,168 C41,190 39,212 42,232" fill="none" stroke-width="18" stroke-linecap="round"/>
        <path d="M42,235 C37,242 37,252 42,256 C47,260 53,258 54,251 C55,243 51,237 47,234 Z"/>
      `)}
      <!-- legs + feet (left, mirrored) -->
      ${pair(`
        <path d="M85,232 C81,266 81,298 84,330" fill="none" stroke-width="31" stroke-linecap="round"/>
        <path d="M84,334 C84,354 84,372 85,386" fill="none" stroke-width="20" stroke-linecap="round"/>
        <path d="M75,383 L97,383 C100,387 101,392 101,395 L73,395 C72,390 73,386 75,383 Z"/>
      `)}
      ${extra || ''}
    </g>`;
}

/* GARAGE GYM logo: square + stacked dumbbell icon, then the wordmark.
   Rendered once per figure so the bottom-center position lands between the two
   silhouettes. */
const LOGO_SVG = `
  <svg class="bm-logo" viewBox="0 0 300 120" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="bmLogoBg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#344055"/>
        <stop offset="100%" stop-color="#222c40"/>
      </linearGradient>
    </defs>
    <!-- square frame -->
    <rect x="20" y="22" width="44" height="44" rx="8" ry="8" fill="url(#bmLogoBg)" stroke="#cfd8e0" stroke-width="2"/>
    <!-- stacked dumbbell: two rectangles -->
    <rect x="28" y="38" width="14" height="22" rx="3" ry="3" fill="#cfd8e0"/>
    <rect x="28" y="62" width="14" height="22" rx="3" ry="3" fill="#cfd8e0"/>
    <!-- center bar -->
    <rect x="24" y="32" width="36" height="8" rx="2" ry="2" fill="#cfd8e0"/>
    <rect x="24" y="60" width="36" height="8" rx="2" ry="2" fill="#cfd8e0"/>
  </svg>
  <div class="bm-logo-text">
    <span class="bm-logo-wordmark">GARAGE GYM</span>
    <span class="bm-logo-tagline">REVIEWS</span>
  </div>`;

function figureFront() {
  return `
  <svg viewBox="0 0 200 400" class="bm-svg" role="img" aria-label="Front muscular anatomy">
    <defs>
      <linearGradient id="bmBody" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1d2939"/>
        <stop offset="100%" stop-color="#101725"/>
      </linearGradient>
      <linearGradient id="bmHair" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1f2b3d"/>
        <stop offset="100%" stop-color="#0b111c"/>
      </linearGradient>
    </defs>

    ${baseBody(`
      <!-- head -->
      <ellipse cx="100" cy="34" rx="21" ry="25" stroke="#243247"/>
      <!-- hair: swept crop with a highlight strand -->
      <path d="M100,7 C82,7 76,20 77,34 C78,40 79,43 80,45
               C80,34 84,26 92,22 C100,18 112,20 117,27
               C121,33 122,40 121,46 C124,40 125,28 121,19
               C117,11 110,7 100,7 Z" fill="url(#bmHair)" stroke="#0b111c"/>
      <path d="M86,18 C93,13 104,12 111,16" fill="none" stroke="#33465f" stroke-width="1.6" stroke-linecap="round"/>
      <!-- face: brow, eyes, nose and jaw shading -->
      <path d="M88,32 C91,30 95,30 97,32" fill="none" stroke="#0b111c" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M103,32 C105,30 109,30 112,32" fill="none" stroke="#0b111c" stroke-width="1.8" stroke-linecap="round"/>
      <path d="M92,37 C94,38 96,38 97,37" fill="none" stroke="#0b111c" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M103,37 C104,38 106,38 108,37" fill="none" stroke="#0b111c" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M100,36 L100,44 C100,46 98,47 96,47" fill="none" stroke="#0b111c" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M94,52 C97,54 103,54 106,52" fill="none" stroke="#0b111c" stroke-width="1.6" stroke-linecap="round"/>
      <!-- collarbones -->
      ${pair('<path d="M97,76 C90,79 82,82 74,84" fill="none" stroke="#0b111c" stroke-width="1.6" stroke-linecap="round"/>')}
    `)}

    <!-- ===================== TRACKED MUSCLES (front) ===================== -->

    <g class="bm-region bm-region-flat" data-muscle="neck" fill="currentColor" stroke="currentColor">
      <path d="M90,50 L110,50 L112,74 L88,74 Z"/>
      ${pair('<path d="M97,52 C94,60 92,67 91,73" fill="none" stroke="rgba(6,12,22,0.55)" stroke-width="1.4" stroke-linecap="round"/>')}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="traps" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M92,68 C83,70 73,76 64,86 C72,86 81,83 89,79 Z"/>
        <path d="M70,84 C76,82 83,79 89,76" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="side-delts" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M66,84 C58,89 55,99 56,111 C57,121 62,127 69,127 C74,127 77,122 77,115 L77,92 C73,86 69,81 66,84 Z"/>
        <path d="M63,92 C60,101 59,111 61,121" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="front-delts" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M78,86 C84,82 90,80 96,81 L96,100 C92,109 85,115 79,117 C76,107 76,94 78,86 Z"/>
        <path d="M82,88 C85,96 85,106 82,114" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="chest" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M80,94 C86,88 93,86 99,88 L99,116 C93,122 85,122 80,116 C78,108 78,100 80,94 Z"/>
        <path d="M80,120 C86,126 94,128 99,126 L99,142 C92,146 84,143 80,134 Z"/>
        <path d="M82,104 C87,108 93,110 98,110" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M83,132 C88,137 94,139 99,138" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="biceps" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M59,114 C53,128 50,144 51,159 C52,169 57,174 62,173 C68,171 71,162 71,150 C71,135 68,122 63,114 C61,111 60,111 59,114 Z"/>
        <path d="M60,124 C57,138 56,152 58,166" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.4" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="forearms" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M56,177 C51,193 48,213 50,232 C53,241 59,243 62,237 C64,222 64,203 62,187 C61,179 58,174 56,177 Z"/>
        <path d="M56,184 C53,200 52,218 54,234" fill="none" stroke="rgba(6,12,22,0.4)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="abs" fill="currentColor" stroke="currentColor">
      ${pair(`
        <rect x="86" y="148" width="13" height="15" rx="4"/>
        <rect x="86" y="165" width="13" height="15" rx="4"/>
        <rect x="86" y="182" width="13" height="15" rx="4"/>
        <path d="M87,199 L99,199 L99,213 C95,217 90,215 87,209 Z"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="obliques" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M74,150 C71,167 71,186 75,202 L84,213 L85,195 L84,150 Z"/>
        <path d="M78,140 C81,144 84,146 87,147" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M77,147 C80,151 83,153 86,154" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M74,166 C77,176 78,188 80,199" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="quads" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M86,240 C83,270 83,300 86,327 C91,333 97,333 99,327 C101,300 101,270 99,242 Z"/>
        <path d="M89,246 C87,274 87,302 89,326" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M94,252 C96,276 96,300 95,320" fill="none" stroke="rgba(6,12,22,0.35)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="calves" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M84,342 C82,358 82,374 84,387 C88,391 94,391 96,387 C97,374 97,358 95,344 Z"/>
        <path d="M89,348 C88,364 88,378 89,388" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    ${LOGO_SVG}
  </svg>`;
}

function figureBack() {
  return `
  <svg viewBox="0 0 200 400" class="bm-svg" role="img" aria-label="Back muscular anatomy">
    <defs>
      <linearGradient id="bmBodyB" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1d2939"/>
        <stop offset="100%" stop-color="#101725"/>
      </linearGradient>
    </defs>

    ${baseBody(`
      <!-- head + hair from behind -->
      <ellipse cx="100" cy="34" rx="21" ry="25" fill="#131c2b" stroke="#243247"/>
      <path d="M100,7 C79,7 74,22 75,38 C76,50 80,57 84,60
               L116,60 C120,57 124,50 125,38 C126,22 121,7 100,7 Z"
            fill="url(#bmHair)" stroke="#0b111c"/>
      <path d="M88,16 C95,11 106,11 113,16" fill="none" stroke="#33465f" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M84,52 C90,58 110,58 116,52" fill="none" stroke="#0b111c" stroke-width="1.4" stroke-linecap="round"/>
      <!-- nape -->
      <path d="M92,60 L108,60 L108,70 L92,70 Z" fill="#131c2b"/>
    `)}

    <!-- ===================== TRACKED MUSCLES (back) ===================== -->

    <g class="bm-region bm-region-flat" data-muscle="neck" fill="currentColor" stroke="currentColor">
      ${pair('<path d="M91,58 L100,58 L100,76 L89,76 Z"/>')}
      <path d="M100,58 L109,58 L111,76 L100,76 Z"/>
    </g>

    <g class="bm-region bm-region-flat" data-muscle="traps" fill="currentColor" stroke="currentColor">
      <path d="M92,62 C83,66 72,74 62,88
               C72,84 81,81 90,79
               L90,104 L100,112 L110,104 L110,79
               C119,81 128,84 138,88
               C128,74 117,66 108,62 Z"/>
      <path d="M100,72 L100,108" fill="none" stroke="rgba(6,12,22,0.55)" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M84,80 C90,88 92,96 93,104" fill="none" stroke="rgba(6,12,22,0.4)" stroke-width="1.3" stroke-linecap="round"/>
      <path d="M116,80 C110,88 108,96 107,104" fill="none" stroke="rgba(6,12,22,0.4)" stroke-width="1.3" stroke-linecap="round"/>
    </g>

    <g class="bm-region bm-region-flat" data-muscle="side-delts" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M66,86 C58,91 55,101 56,113 C57,123 62,129 69,129 C74,129 77,124 77,117 L77,94 C73,88 69,83 66,86 Z"/>
        <path d="M63,94 C60,103 59,113 61,123" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="rear-delts" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M77,96 C82,89 88,86 94,87 L94,104 C89,113 83,119 77,121 C75,112 75,103 77,96 Z"/>
        <path d="M80,97 C83,104 83,112 80,119" fill="none" stroke="rgba(6,12,22,0.45)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="back" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M77,122 C71,138 67,158 67,178 C74,190 84,197 95,198 L95,152 L93,124 Z"/>
        <path d="M74,134 C71,152 71,172 75,188" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M80,146 C78,162 79,178 83,190" fill="none" stroke="rgba(6,12,22,0.35)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
      <path d="M100,120 L100,198" fill="none" stroke="rgba(6,12,22,0.55)" stroke-width="1.6" stroke-linecap="round"/>
    </g>

    <g class="bm-region bm-region-flat" data-muscle="lower-back" fill="currentColor" stroke="currentColor">
      <path d="M92,180 L108,180 L111,206 C106,212 94,212 89,206 Z"/>
      <path d="M100,182 L100,210" fill="none" stroke="rgba(6,12,22,0.55)" stroke-width="1.5" stroke-linecap="round"/>
      ${pair('<path d="M95,186 C94,194 94,202 96,208" fill="none" stroke="rgba(6,12,22,0.35)" stroke-width="1.2" stroke-linecap="round"/>')}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="triceps" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M59,116 C53,130 50,146 51,161 C52,171 57,176 62,175 C68,173 71,164 71,152 C71,137 68,124 63,116 C61,113 60,113 59,116 Z"/>
        <path d="M61,126 C57,140 56,154 58,168" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.4" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="forearms" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M56,179 C51,195 48,214 50,233 C53,242 59,244 62,238 C64,223 64,204 62,188 C61,180 58,176 56,179 Z"/>
        <path d="M56,186 C53,202 52,219 54,235" fill="none" stroke="rgba(6,12,22,0.4)" stroke-width="1.3" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="glutes" fill="currentColor" stroke="currentColor">
      <path d="M100,205 C90,203 80,207 77,219 C74,233 79,247 90,251
               C96,253 99,249 100,243
               C101,249 104,253 110,251 C121,247 126,233 123,219
               C120,207 110,203 100,205 Z"/>
      <path d="M100,206 L100,246" fill="none" stroke="rgba(6,12,22,0.55)" stroke-width="1.5" stroke-linecap="round"/>
      ${pair('<path d="M86,214 C83,224 84,236 90,244" fill="none" stroke="rgba(6,12,22,0.4)" stroke-width="1.3" stroke-linecap="round"/>')}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="hamstrings" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M86,254 C83,280 83,306 86,328 C91,334 97,334 99,328 C101,306 101,280 99,256 Z"/>
        <path d="M91,260 C89,286 89,310 91,328" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M87,276 C86,296 87,314 89,324" fill="none" stroke="rgba(6,12,22,0.3)" stroke-width="1.2" stroke-linecap="round"/>
      `)}
    </g>

    <g class="bm-region bm-region-flat" data-muscle="calves" fill="currentColor" stroke="currentColor">
      ${pair(`
        <path d="M84,342 C81,357 81,373 84,386 C88,391 95,391 97,386 C98,373 98,357 96,344 Z"/>
        <path d="M90,348 C88,361 88,374 90,386" fill="none" stroke="rgba(6,12,22,0.5)" stroke-width="1.4" stroke-linecap="round"/>
      `)}
    </g>

    ${LOGO_SVG}
  </svg>`;
}

/** Paint both figures and colour every muscle region from `status`. */
function renderBodyMap(root, status) {
  if (!root) return;

  root.innerHTML =
    `<div class="bm-grid">
      <div class="bm-figure" data-view="front" role="img" aria-label="Front muscular anatomy">
        ${figureFront()}
      </div>
      <div class="bm-figure" data-view="back" role="img" aria-label="Back muscular anatomy">
        ${figureBack()}
      </div>
    </div>
    ${buildEffortLegend(status)}`;

  // Apply effort classes to all muscle regions
  root.querySelectorAll('.bm-region').forEach(function (g) {
    const name = g.getAttribute('data-muscle');
    const muscle = status[name];

    const effortClass = getEffortClass(muscle);
    // Colour lives on the <g>; children inherit it only where they do not
    // declare their own fill (detail strokes keep fill="none", stroke-only
    // limbs keep their explicit stroke), so shapes stay crisp.
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

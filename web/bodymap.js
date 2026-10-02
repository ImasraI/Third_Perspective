/* ============================================================================
   bodymap.js - front/back muscular anime-style body map
   ============================================================================
   Pure SVG. 12 muscle groups, each a distinct path that can be coloured
   by recovery status. Uses currentColor so CSS tone classes drive the look.
   ==========================================================================*/

const MUSCLE_LABELS = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  glutes: 'Glutes',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  calves: 'Calves'
};

const MUSCLE_EMOJI = {
  chest: '🫁', back: '🔙', shoulders: '🤷', biceps: '💪', triceps: '💪',
  forearms: '🦾', abs: '🧱', obliques: '🌀', glutes: '🍑',
  quads: '🦵', hamstrings: '🦵', calves: '👟'
};

/**
 * Determine the CSS class for a muscle based on its effort level.
 *
 * Effort level 0 = nothing trained, 1 = light, 2 = solid, 3 = hard, 4 = maxed.
 * 5+ is displayed as level 4 for visual consistency.
 */
function getEffortClass(muscle) {
  if (!muscle) return 'bm-none';
  const level = Math.min(5, Math.max(0, muscle.level || 0));
  return level === 0 ? 'bm-none' : `bm-effort-${level}`;
}

/** Get a tooltip text for a muscle with effort information */
function getEffortTooltip(muscle, name) {
  if (!muscle) return (MUSCLE_EMOJI[name] || '') + ' ' + (MUSCLE_LABELS[name] || name) + ': never trained';

  const level = Math.min(5, Math.max(0, muscle.level || 0));
  const when = muscle.lastTrained
    ? muscle.lastTrained === 'today'
      ? 'trained today'
      : muscle.lastTrained + 'd ago'
    : 'never trained';

  const base = (MUSCLE_EMOJI[name] || '') + ' ' + (MUSCLE_LABELS[name] || name) + ' — ' + when;
  const effortText = level === 0 ? '' : ` · Effort ${level}/5`;
  const intensityText = level === 0 ? '' : ` · Intensity ${muscle.intensity}`;
  const loadText = muscle.load7d ? ` · ${muscle.load7d} load` : '';
  const sessionsText = muscle.sessions7d ? ` · ${muscle.sessions7d}× this week` : '';

  return base + effortText + intensityText + loadText + sessionsText;
}

/** Enhanced legend showing both status and effort levels */
function buildEffortLegend(status) {
  const levels = [0, 1, 2, 3, 4];
  const statusLevels = [
    { level: 0, label: 'Never trained', color: 'bm-none' },
    { level: 1, label: 'Light session', color: 'bm-effort-1' },
    { level: 2, label: 'Solid training', color: 'bm-effort-2' },
    { level: 3, label: 'Hard week', color: 'bm-effort-3' },
    { level: 4, label: 'Maxed out', color: 'bm-effort-4' }
  ];

  return `
    <div class="bm-effort-legend">
      <div class="bm-legend-title">Effort Level</div>
      <div class="bm-effort-levels">
        ${statusLevels.map(item => `
          <div class="bm-effort-level ${item.color}">
            <span class="bm-effort-dot"></span>
            <span class="bm-effort-label">${item.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function figureFront() {
  return `
  <svg viewBox="0 0 200 400" class="bm-svg" role="img" aria-label="Front muscular anatomy">
    <defs>
      <linearGradient id="bmBaseF" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e2a3a"/>
        <stop offset="100%" stop-color="#121a25"/>
      </linearGradient>
    </defs>

    <!-- BASE SILHOUETTE (front) - subtle under-layer -->
    <g class="bm-base" fill="url(#bmBaseF)">
      <ellipse cx="100" cy="34" rx="22" ry="26"/>
      <path d="M90,56 h20 v14 h-20 z"/>
      <path d="M100,68
               C76,68 60,78 56,96
               L62,152 C64,170 74,182 86,186
               L86,200 h28 v-14 h-28 z"/>
      <path d="M86,200 h28 v10 h-28 z"/>
      <path d="M57,94 C43,114 38,146 36,200" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M143,94 C157,114 162,146 164,200" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M87,206 C83,252 82,308 84,364" stroke-width="28" stroke-linecap="round" fill="none"/>
      <path d="M113,206 C117,252 118,308 116,364" stroke-width="28" stroke-linecap="round" fill="none"/>
    </g>

    <!-- SHOULDERS (anterior delts) -->
    <g data-muscle="shoulders" data-view="front" class="bm-region">
      <ellipse cx="62" cy="84" rx="16" ry="10" transform="rotate(-15 62 84)"/>
      <ellipse cx="138" cy="84" rx="16" ry="10" transform="rotate(15 138 84)"/>
    </g>

    <!-- CHEST (pectoralis major - upper & lower) -->
    <g data-muscle="chest" data-view="front" class="bm-region">
      <path d="M78,96
               C84,92 93,90 100,91
               L100,120
               C94,122 84,120 78,116 Z"/>
      <path d="M122,96
               C116,92 107,90 100,91
               L100,120
               C106,122 116,120 122,116 Z"/>
      <path d="M82,116
               C86,122 94,126 100,127
               L100,140
               C93,138 85,134 82,128 Z"/>
      <path d="M118,116
               C114,122 106,126 100,127
               L100,140
               C107,138 115,134 118,128 Z"/>
    </g>

    <!-- BICEPS (short & long head) -->
    <g data-muscle="biceps" data-view="front" class="bm-region">
      <path d="M54,122 C50,138 48,152 47,164" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M146,122 C150,138 152,152 153,164" stroke-width="16" stroke-linecap="round" fill="none"/>
      <ellipse cx="56" cy="140" rx="9" ry="6" transform="rotate(-5 56 140)"/>
      <ellipse cx="144" cy="140" rx="9" ry="6" transform="rotate(5 144 140)"/>
    </g>

    <!-- FOREARMS -->
    <g data-muscle="forearms" data-view="front" class="bm-region">
      <path d="M46,170 C43,182 41,192 40,200" stroke-width="13" stroke-linecap="round" fill="none"/>
      <path d="M154,170 C157,182 159,192 160,200" stroke-width="13" stroke-linecap="round" fill="none"/>
      <ellipse cx="48" cy="185" rx="7" ry="4"/>
      <ellipse cx="152" cy="185" rx="7" ry="4"/>
    </g>

    <!-- ABS (6-pack + lower) -->
    <g data-muscle="abs" data-view="front" class="bm-region">
      <rect x="85" y="122" width="13" height="14" rx="4"/>
      <rect x="102" y="122" width="13" height="14" rx="4"/>
      <rect x="85" y="138" width="13" height="14" rx="4"/>
      <rect x="102" y="138" width="13" height="14" rx="4"/>
      <rect x="85" y="154" width="13" height="14" rx="4"/>
      <rect x="102" y="154" width="13" height="14" rx="4"/>
      <path d="M86,170 Q100,176 114,170 L113,182 Q100,176 87,182 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
    </g>

    <!-- OBLIQUES -->
    <g data-muscle="obliques" data-view="front" class="bm-region">
      <path d="M76,126 C70,142 68,158 72,172" stroke-width="11" stroke-linecap="round" fill="none"/>
      <path d="M124,126 C130,142 132,158 128,172" stroke-width="11" stroke-linecap="round" fill="none"/>
      <path d="M72,130 C66,144 64,160 68,174" stroke-width="9" stroke-linecap="round" fill="none"/>
      <path d="M128,130 C134,144 136,160 132,174" stroke-width="9" stroke-linecap="round" fill="none"/>
    </g>

    <!-- QUADS (4 heads) -->
    <g data-muscle="quads" data-view="front" class="bm-region">
      <path d="M88,212 C85,246 85,270 86,290" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M112,212 C115,246 115,270 114,290" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M86,220 C82,250 82,272 83,290" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M114,220 C118,250 118,272 117,290" stroke-width="16" stroke-linecap="round" fill="none"/>
    </g>

    <!-- CALVES (front - tibialis + gastrocnemius medial/lateral) -->
    <g data-muscle="calves" data-view="front" class="bm-region">
      <path d="M86,300 C86,320 86,340 86,356" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M114,300 C114,320 114,340 114,356" stroke-width="16" stroke-linecap="round" fill="none"/>
      <ellipse cx="88" cy="320" rx="9" ry="5"/>
      <ellipse cx="112" cy="320" rx="9" ry="5"/>
    </g>
  </svg>`;
}

function figureBack() {
  return `
  <svg viewBox="0 0 200 400" class="bm-svg" role="img" aria-label="Back muscular anatomy">
    <defs>
      <linearGradient id="bmBaseB" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1e2a3a"/>
        <stop offset="100%" stop-color="#121a25"/>
      </linearGradient>
    </defs>

    <!-- BASE SILHOUETTE (back) -->
    <g class="bm-base" fill="url(#bmBaseB)">
      <ellipse cx="100" cy="34" rx="22" ry="26"/>
      <path d="M90,56 h20 v14 h-20 z"/>
      <path d="M100,68
               C76,68 60,78 56,96
               L62,152 C64,170 74,182 86,186
               L86,200 h28 v-14 h-28 z"/>
      <path d="M86,200 h28 v10 h-28 z"/>
      <path d="M57,94 C43,114 38,146 36,200" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M143,94 C157,114 162,146 164,200" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M87,206 C83,252 82,308 84,364" stroke-width="28" stroke-linecap="round" fill="none"/>
      <path d="M113,206 C117,252 118,308 116,364" stroke-width="28" stroke-linecap="round" fill="none"/>
    </g>

    <!-- BACK (trapezius + latissimus dorsi) -->
    <g data-muscle="back" data-view="back" class="bm-region">
      <!-- Traps -->
      <path d="M80,82 C92,90 108,90 120,82 L116,96 C106,102 94,102 84,96 Z"/>
      <path d="M84,96 C88,110 92,124 94,140 L70,140 C66,126 66,112 70,100 Z"/>
      <path d="M116,96 C112,110 108,124 106,140 L130,140 C134,126 134,112 130,100 Z"/>
      <!-- Lats -->
      <path d="M72,140 C78,160 82,180 84,200 L68,200 C64,180 62,160 64,144 Z"/>
      <path d="M128,140 C122,160 118,180 116,200 L132,200 C136,180 138,160 136,144 Z"/>
      <!-- Lower back / erector spinae -->
      <path d="M92,170 C94,200 94,220 92,240 L108,240 C106,220 106,200 108,170 Z"/>
    </g>

    <!-- SHOULDERS (rear delts) -->
    <g data-muscle="shoulders" data-view="back" class="bm-region">
      <ellipse cx="62" cy="84" rx="15" ry="9" transform="rotate(-10 62 84)"/>
      <ellipse cx="138" cy="84" rx="15" ry="9" transform="rotate(10 138 84)"/>
    </g>

    <!-- TRICEPS (long, lateral, medial heads) -->
    <g data-muscle="triceps" data-view="back" class="bm-region">
      <path d="M54,122 C50,138 48,152 47,164" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M146,122 C150,138 152,152 153,164" stroke-width="16" stroke-linecap="round" fill="none"/>
      <ellipse cx="56" cy="140" rx="9" ry="6" transform="rotate(5 56 140)"/>
      <ellipse cx="144" cy="140" rx="9" ry="6" transform="rotate(-5 144 140)"/>
    </g>

    <!-- FOREARMS (back) -->
    <g data-muscle="forearms" data-view="back" class="bm-region">
      <path d="M46,170 C43,182 41,192 40,200" stroke-width="13" stroke-linecap="round" fill="none"/>
      <path d="M154,170 C157,182 159,192 160,200" stroke-width="13" stroke-linecap="round" fill="none"/>
      <ellipse cx="48" cy="185" rx="7" ry="4"/>
      <ellipse cx="152" cy="185" rx="7" ry="4"/>
    </g>

    <!-- GLUTES -->
    <g data-muscle="glutes" data-view="back" class="bm-region">
      <ellipse cx="90" cy="194" rx="15" ry="13"/>
      <ellipse cx="110" cy="194" rx="15" ry="13"/>
      <path d="M88,200 Q90,210 92,200 L108,200 Q110,210 112,200 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5"/>
    </g>

    <!-- HAMSTRINGS -->
    <g data-muscle="hamstrings" data-view="back" class="bm-region">
      <path d="M88,210 C85,242 85,266 86,284" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M112,210 C115,242 115,266 114,284" stroke-width="22" stroke-linecap="round" fill="none"/>
      <path d="M86,218 C82,246 82,268 83,286" stroke-width="16" stroke-linecap="round" fill="none"/>
      <path d="M114,218 C118,246 118,268 117,286" stroke-width="16" stroke-linecap="round" fill="none"/>
    </g>

    <!-- CALVES (back - gastrocnemius + soleus) -->
    <g data-muscle="calves" data-view="back" class="bm-region">
      <path d="M86,294 C87,316 86,338 86,354" stroke-width="17" stroke-linecap="round" fill="none"/>
      <path d="M114,294 C113,316 114,338 114,354" stroke-width="17" stroke-linecap="round" fill="none"/>
      <ellipse cx="88" cy="315" rx="10" ry="6"/>
      <ellipse cx="112" cy="315" rx="10" ry="6"/>
    </g>
  </svg>`;
}

/** Paint both figures and colour every muscle region from `status`. */
function renderBodyMap(root, status) {
  if (!root) return;

  // Render the SVG figures
  const front = figureFront();
  const back = figureBack();

  root.innerHTML =
    `<div class="bm-grid">
      <div class="bm-figure" data-view="front" role="img" aria-label="Front muscular anatomy">
        ${front}
      </div>
      <div class="bm-figure" data-view="back" role="img" aria-label="Back muscular anatomy">
        ${back}
      </div>
    </div>
    ${buildEffortLegend(status)}`;

  // Apply effort classes to all muscle regions
  root.querySelectorAll('.bm-region').forEach(function (g) {
    const name = g.getAttribute('data-muscle');
    const muscle = status[name];

    // Set the effort class based on effort level
    const effortClass = getEffortClass(muscle);
    g.setAttribute('fill', 'currentColor');
    g.setAttribute('stroke', 'currentColor');
    g.classList.add(effortClass);
    g.style.color = '';

    // Propagate to children so effort wins over base fill
    g.querySelectorAll('*').forEach(function (child) {
      child.setAttribute('fill', 'currentColor');
      child.setAttribute('stroke', 'currentColor');
    });

    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');

    // Generate tooltip with effort information
    const tooltip = getEffortTooltip(muscle, name);
    g.setAttribute('aria-label', tooltip);
    g.dataset.days = muscle?.lastTrained ? '' : '';
    g.dataset.tip = tooltip;
  });
}

module.exports = {
  renderBodyMap,
  getEffortClass,
  buildEffortLegend,
  getEffortTooltip,
  MUSCLE_LABELS,
  MUSCLE_EMOJI
};
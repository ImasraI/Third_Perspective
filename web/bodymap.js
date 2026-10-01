/* ============================================================================
   bodymap.js - front/back human body map with per-muscle training status
   ============================================================================
   Pure SVG. No dependencies. `renderBodyMap(el, muscleStatus)` paints a
   front + back figure where each muscle is coloured by how recently it was
   trained:
       < 3 days   -> green   (recovering)
       3-6 days   -> amber   (due again soon)
       7-13 days  -> orange  (overdue)
       never      -> slate   (untrained)
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

/** Colour class for a muscle given its status from the API. */
function muscleTone(m) {
  if (!m || !m.trained) return 'bm-none';
  const d = m.daysAgo;
  if (d === 0) return 'bm-fresh';
  if (d <= 2) return 'bm-recent';
  if (d <= 6) return 'bm-due';
  if (d <= 13) return 'bm-overdue';
  return 'bm-cold';
}

/* --------------------------------------------------------------------------
   Geometry. Limbs are thick round-capped strokes so the figure stays clean at
   any size; muscle regions are short strokes / paths layered on top.
   viewBox is 0 0 200 400 for both figures.
   -------------------------------------------------------------------------- */

function figureFront() {
  return `
  <svg viewBox="0 0 200 400" class="bm-svg" role="img" aria-label="Front of body muscle map">
    <defs>
      <linearGradient id="bmBase" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#243044"/>
        <stop offset="100%" stop-color="#1a2332"/>
      </linearGradient>
    </defs>

    <!-- ============ BASE SILHOUETTE (front) ============ -->
    <g class="bm-base">
      <ellipse cx="100" cy="34" rx="21" ry="25" fill="url(#bmBase)"/>
      <path d="M91,55 h18 v12 h-18 z" fill="url(#bmBase)"/>
      <path d="M100,66
               C76,66 60,76 56,94
               L62,150 C64,168 74,180 86,184
               L86,198 h28 v-14 h-28 z"
            fill="url(#bmBase)"/>
      <path d="M86,198 h28 v10 h-28 z" fill="url(#bmBase)"/>
      <path d="M58,92 C44,112 39,144 37,198" stroke="url(#bmBase)" stroke-width="21"
            fill="none" stroke-linecap="round"/>
      <path d="M142,92 C156,112 161,144 163,198" stroke="url(#bmBase)" stroke-width="21"
            fill="none" stroke-linecap="round"/>
      <path d="M88,204 C84,250 83,306 85,362" stroke="url(#bmBase)" stroke-width="27"
            fill="none" stroke-linecap="round"/>
      <path d="M112,204 C116,250 117,306 115,362" stroke="url(#bmBase)" stroke-width="27"
            fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ SHOULDERS (front delts) ============ -->
    <g data-muscle="shoulders" data-view="front" class="bm-region">
      <path d="M60,86 C68,80 76,78 82,79" stroke-width="17" fill="none" stroke-linecap="round"/>
      <path d="M140,86 C132,80 124,78 118,79" stroke-width="17" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ CHEST ============ -->
    <g data-muscle="chest" data-view="front" class="bm-region">
      <path d="M74,96 C82,92 94,91 99,92 L99,116 C92,118 82,116 76,111 Z"/>
      <path d="M126,96 C118,92 106,91 101,92 L101,116 C108,118 118,116 124,111 Z"/>
    </g>

    <!-- ============ BICEPS ============ -->
    <g data-muscle="biceps" data-view="front" class="bm-region">
      <path d="M52,120 C48,136 46,150 45,162" stroke-width="15" fill="none" stroke-linecap="round"/>
      <path d="M148,120 C152,136 154,150 155,162" stroke-width="15" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ FOREARMS ============ -->
    <g data-muscle="forearms" data-view="front" class="bm-region">
      <path d="M44,168 C41,180 39,190 38,198" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="M156,168 C159,180 161,190 162,198" stroke-width="12" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ ABS ============ -->
    <g data-muscle="abs" data-view="front" class="bm-region">
      <rect x="84" y="120" width="14" height="15" rx="5"/>
      <rect x="102" y="120" width="14" height="15" rx="5"/>
      <rect x="84" y="137" width="14" height="15" rx="5"/>
      <rect x="102" y="137" width="14" height="15" rx="5"/>
      <rect x="88" y="154" width="24" height="14" rx="6"/>
      <rect x="89" y="170" width="22" height="12" rx="5"/>
    </g>

    <!-- ============ OBLIQUES ============ -->
    <g data-muscle="obliques" data-view="front" class="bm-region">
      <path d="M76,124 C72,138 72,154 76,168" stroke-width="10" fill="none" stroke-linecap="round"/>
      <path d="M124,124 C128,138 128,154 124,168" stroke-width="10" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ QUADS ============ -->
    <g data-muscle="quads" data-view="front" class="bm-region">
      <path d="M88,210 C85,244 85,268 86,288" stroke-width="21" fill="none" stroke-linecap="round"/>
      <path d="M112,210 C115,244 115,268 114,288" stroke-width="21" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ CALVES (front) ============ -->
    <g data-muscle="calves" data-view="front" class="bm-region">
      <path d="M86,298 C86,318 86,338 86,354" stroke-width="15" fill="none" stroke-linecap="round"/>
      <path d="M114,298 C114,318 114,338 114,354" stroke-width="15" fill="none" stroke-linecap="round"/>
    </g>
  </svg>`;
}

function figureBack() {
  return `
  <svg viewBox="0 0 200 400" class="bm-svg" role="img" aria-label="Back of body muscle map">
    <!-- ============ BASE SILHOUETTE (back) ============ -->
    <g class="bm-base">
      <ellipse cx="100" cy="34" rx="21" ry="25" fill="#1a2332"/>
      <path d="M91,55 h18 v12 h-18 z" fill="#1a2332"/>
      <path d="M100,66
               C76,66 60,76 56,94
               L62,150 C64,168 74,180 86,184
               L86,198 h28 v-14 h-28 z"
            fill="#1a2332"/>
      <path d="M86,198 h28 v10 h-28 z" fill="#1a2332"/>
      <path d="M58,92 C44,112 39,144 37,198" stroke="#1a2332" stroke-width="21"
            fill="none" stroke-linecap="round"/>
      <path d="M142,92 C156,112 161,144 163,198" stroke="#1a2332" stroke-width="21"
            fill="none" stroke-linecap="round"/>
      <path d="M88,204 C84,250 83,306 85,362" stroke="#1a2332" stroke-width="27"
            fill="none" stroke-linecap="round"/>
      <path d="M112,204 C116,250 117,306 115,362" stroke="#1a2332" stroke-width="27"
            fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ BACK (traps + lats) ============ -->
    <g data-muscle="back" data-view="back" class="bm-region">
      <path d="M78,82 C90,90 110,90 122,82 L118,96 C108,102 92,102 82,96 Z"/>
      <path d="M74,98 C80,124 84,150 86,178 L70,178 C66,150 66,122 68,100 Z"/>
      <path d="M126,98 C120,124 116,150 114,178 L130,178 C134,150 134,122 132,100 Z"/>
    </g>

    <!-- ============ SHOULDERS (rear delts) ============ -->
    <g data-muscle="shoulders" data-view="back" class="bm-region">
      <path d="M60,86 C68,80 76,78 82,79" stroke-width="16" fill="none" stroke-linecap="round"/>
      <path d="M140,86 C132,80 124,78 118,79" stroke-width="16" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ TRICEPS ============ -->
    <g data-muscle="triceps" data-view="back" class="bm-region">
      <path d="M52,120 C48,136 46,150 45,162" stroke-width="15" fill="none" stroke-linecap="round"/>
      <path d="M148,120 C152,136 154,150 155,162" stroke-width="15" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ FOREARMS (back) ============ -->
    <g data-muscle="forearms" data-view="back" class="bm-region">
      <path d="M44,168 C41,180 39,190 38,198" stroke-width="12" fill="none" stroke-linecap="round"/>
      <path d="M156,168 C159,180 161,190 162,198" stroke-width="12" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ GLUTES ============ -->
    <g data-muscle="glutes" data-view="back" class="bm-region">
      <ellipse cx="90" cy="192" rx="13" ry="12"/>
      <ellipse cx="110" cy="192" rx="13" ry="12"/>
    </g>

    <!-- ============ HAMSTRINGS ============ -->
    <g data-muscle="hamstrings" data-view="back" class="bm-region">
      <path d="M88,208 C85,240 85,264 86,282" stroke-width="21" fill="none" stroke-linecap="round"/>
      <path d="M112,208 C115,240 115,264 114,282" stroke-width="21" fill="none" stroke-linecap="round"/>
    </g>

    <!-- ============ CALVES (back) ============ -->
    <g data-muscle="calves" data-view="back" class="bm-region">
      <path d="M86,292 C87,314 86,336 86,352" stroke-width="16" fill="none" stroke-linecap="round"/>
      <path d="M114,292 C113,314 114,336 114,352" stroke-width="16" fill="none" stroke-linecap="round"/>
    </g>
  </svg>`;
}

/** Paint both figures and colour every muscle region from `status`. */
function renderBodyMap(root, status) {
  if (!root) return;
  const st = status || {};
  root.innerHTML =
    `<div class="bm-grid">
       <div class="bm-figure">${figureFront()}</div>
       <div class="bm-figure">${figureBack()}</div>
     </div>`;

  root.querySelectorAll('.bm-region').forEach(function (g) {
    const name = g.getAttribute('data-muscle');
    const tone = muscleTone(st[name]);
    g.setAttribute('fill', 'currentColor');
    g.setAttribute('stroke', 'currentColor');
    g.classList.add(tone);
    g.style.color = '';
    // Remove the hardcoded silhouette colour so the tone class wins.
    g.querySelectorAll('*').forEach(function (child) {
      child.setAttribute('fill', 'currentColor');
      child.setAttribute('stroke', 'currentColor');
    });
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    const m = st[name] || {};
    const when = m.daysAgo === null || m.daysAgo === undefined
      ? 'never trained'
      : (m.daysAgo === 0 ? 'trained today' : m.daysAgo + 'd ago');
    g.setAttribute('aria-label', (MUSCLE_LABELS[name] || name) + ': ' + when);
    g.dataset.tip = (MUSCLE_EMOJI[name] || '') + ' ' + (MUSCLE_LABELS[name] || name) + ' — ' + when +
      (m.sessions7d ? ' · ' + m.sessions7d + '× this week' : '');
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { renderBodyMap, muscleTone, MUSCLE_LABELS, MUSCLE_EMOJI };
}

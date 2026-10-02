# ThirdPerspective — Setup Guide (Web PWA + Apps Script)

## Architecture
- **Frontend**: Static PWA (HTML/JS/CSS) hosted on **Netlify** (or Vercel, GitHub Pages).
- **Backend**: Google **Apps Script** bound to a Google Sheet — stores data, calls Gemini, keeps the API key secret.
- **AI**: Google Gemini (`gemini-2.5-flash` or `gemini-1.5-flash`) via REST; key lives in Apps Script **Script Properties**.

No Telegram, no bot, no server you manage.

---

## 1. Google Sheet + Apps Script

1. Create a new Google Sheet (or use an existing one).
2. Extensions → **Apps Script**.
3. Delete the contents of `Code.gs` in the Apps Script editor and paste the full contents of `Code.js` from this repo. (The file is named `.js` in the repo but is pasted into the single `Code.gs` script file.)
4. Project Settings → **Script properties**, add:
   - `GEMINI_API_KEY` — your Gemini API key (get one at https://aistudio.google.com/apikey).
   - `APP_KEY` *(optional)* — a shared secret; if set, the PWA must send the same value in `appKey` header/body to call any endpoint except `ping` and `gemini.test`.
   - `tracker_goals` *(optional)* — goals are stored here as JSON; the app reads and writes it automatically.
5. Deploy → **New deployment** → Type: **Web app** → Execute as: **Me** → Who has access: **Anyone**. This must be **Anyone** for browser requests to work — "Anyone with Google account" or "Anyone with link" will fail CORS.
6. Copy the **Web app URL** (ends with `/exec`). This is your **API endpoint**.
7. Paste that `/exec` URL into the PWA: gear icon (⚙️) → **API Endpoint** → **Save & sync**.

> The script auto-creates 7 sheets on first `state` call: `Nutrition`, `Workouts`, `Expenses`, `Study`, `Tasks`, `Classes`, `Foods`. Goals are stored in the `tracker_goals` Script Property, not in a sheet.

---

## 2. Configure the PWA (Netlify)

### Option A: Netlify drag-and-drop (simplest)
1. Go to https://app.netlify.com/drop
2. Drag the **`web/`** folder from this repo onto the page.
3. Netlify gives you a `*.netlify.app` URL — open it.

### Option B: Netlify CLI (for updates)
```bash
npm i -g netlify-cli
netlify login
netlify deploy --prod --dir=web
```

### Option C: Git-backed (auto-deploy on push)
1. Push this repo to GitHub.
2. Netlify → "Add new site" → "Import from Git" → pick the repo.
3. Build command: *empty* — Publish directory: `web`
4. Deploy.

---

## 3. Wire the PWA to your Apps Script

1. Open your Netlify URL.
2. Click the **gear (Settings)** icon → paste your Apps Script `/exec` URL into **API Endpoint**.
3. If you set `APP_KEY` in Script Properties, paste the same value into **App Key**.
4. Click **Save**. The app will fetch `state` and show the dashboard.

> Settings are stored in `localStorage` (`gt.apiUrl`, `gt.appKey`, `gt.tab`) — no server-side config needed.

---

## 4. Verify it works

| Tab | Quick test |
|-----|------------|
| **Today** | Shows calories, macros, workouts, study, expenses, tasks for today. |
| **Food** | Type `2 eggs and 150g chicken breast` → Parse → Add. Macros appear instantly. Type `3 eggs` → autocomplete picks the cached "egg" (72 kcal/egg) → no Gemini call. |
| **Body** | Log a workout: `squat 5x5 and leg press`. Front/back SVG highlights quads + glutes for 7 days. |
| **Money** | `spent 50000 lunch` → shows in today/month totals with category. |
| **Study** | `studied 45 min react` → adds to daily total. |
| **Tasks** | Add, toggle complete, delete. |
| **More** | Goals, Classes, delete rows, export. |

**PWA install**: Chrome/Edge shows an install button (or use the 📥 button in Settings). Works offline for reads; writes queue until online.

---

## 5. Gemini model / limits

- Default model: `gemini-2.5-flash` (free tier, 1500 req/min).
- Change it in `Code.js` → `GEMINI_MODEL` constant.
- If quota is hit, the parser falls back to a local stub (food shows `~` and must be filled manually).

---

## 6. Customising goals

Settings → Goals:
- Daily calories / protein / carbs / fat
- Daily study minutes target
- Monthly budget (toman / any currency)
- Timezone (default `Asia/Tehran`)

Values are saved to **Script Properties** → persist across redeploys.

---

## 7. Updating

- **Frontend only**: replace `web/` on Netlify (drag-drop or `netlify deploy --prod --dir=web`).
- **Backend only**: edit Apps Script → Deploy → **Manage deployments** → pencil icon → **New version** → Deploy.
- **Both**: do both; they're independent.

---

## 8. Troubleshooting

| Symptom | Fix |
|---------|-----|
| "Failed to fetch" / CORS error | Make sure the Apps Script deployment access is **Anyone**. The PWA uses `text/plain` POST to avoid preflight. Also confirm the URL ends with `/exec`, not `/dev`. |
| Buttons do nothing, console shows `Cannot read properties of null (reading 'addEventListener')` | Stale cached `app.js`/`index.html`. Hard-reload with `Ctrl+Shift+R` (or clear site data). |
| `gemini.test` returns `ok: false` | Script Property `GEMINI_API_KEY` missing or invalid. |
| Food macros look wrong | The AI may have guessed. Edit the numbers inline before hitting **Add** — the corrected values are cached for next time. |
| Body map doesn't colour | Workouts must include at least one valid muscle from the 12-group list. |
| Install button never appears | Ensure HTTPS (Netlify provides it), manifest.json + sw.js are served, and you've interacted with the page once. |

---

## 9. File map (what to touch)

| File | Purpose |
|------|---------|
| `Code.js` | Apps Script backend — all API actions, Sheets schema, Gemini prompts. |
| `web/index.html` | Single-page shell, tabs, modals, Tailwind + Lucide CDN. |
| `web/app.js` | All client logic: API calls, forms, charts, food library, body map. |
| `web/bodymap.js` | Front/back SVG + colour logic for muscle recovery. |
| `web/style.css` | Glassmorphism theme, autocomplete, parse preview. |
| `web/sw.js` | App-shell cache (static assets only). |
| `web/manifest.json` | PWA metadata, icons (inline SVG data URIs). |
| `tests/test_api.js` | Node sandbox regression suite (98 tests). |
| `run_dashboard.bat` | Quick LAN static server for local testing. |

---

## 10. Security notes

- **Gemini key never leaves Apps Script** — the PWA only sees the parsed result.
- `APP_KEY` (if set) is sent from the PWA in the request body; keep it out of public repos.
- No user auth beyond `APP_KEY` — the sheet is your personal database.
- All traffic is HTTPS (Netlify + Apps Script).

---

## 11. License / credits

MIT. Built with:
- Google Apps Script / Sheets
- Gemini API
- Chart.js, Tailwind CSS, Lucide icons (all CDN)
- No build step, no framework, no lock-in.
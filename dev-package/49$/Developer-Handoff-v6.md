# Developer Handoff — v6 Monitor Build ($49/month tier)

## What this build is

Transform The Doc Mirror from a one-time $19 PDF audit into a recurring $49/month growth platform. The Monitor tier reruns the full audit every Monday, tracks competitor changes, generates fresh content, and sends actionable tasks — all surfaced through a SaaS dashboard at `/dashboard`.

**19 features from the spec, organised into 12 dashboard sections.** See `frontend/dashboard.html` for the exact UI.

## Sprint plan (4 weeks)

### Sprint A — Week 1: Foundation
- Run the v6 schema migrations (`database/schema.sql` — appended at the bottom, 6 new tables)
- Seed `awareness_calendar` from `database/awareness-calendar.json` (one-off SQL insert script)
- Build the `/dashboard` page using `frontend/dashboard.html` as the UI shell
- Build `GET /api/dashboard` endpoint — returns the `MonitorDashboardData` shape
- Set up subscriber auth (JWT) — `monitor_subscribers` table
- Wire up Stripe subscription webhook to create a row in `monitor_subscribers`

### Sprint B — Week 2: Weekly cron + competitor intelligence
- Build `POST /api/weekly-cron` (runs every Monday 9AM IST per subscriber)
- The cron orchestrates: full audit → competitor snapshot → diff vs last week → store change alerts
- Build `GET /api/competitor-snapshots/:userId` for the watchlist UI
- Set up Resend email template for weekly report (with PDF attachment)

### Sprint C — Week 3: Content generation engine
- Wire up the 5 new Monitor Claude prompts (see api-spec.ts SECTION 12)
  - `generateWeeklyContentPack`
  - `generateWeeklyTasks`
  - `generateTopicalCampaign`
  - `generateReviewTemplates`
  - `generateReputationResponse`
- Build `POST /api/content-pack/generate` and `POST /api/tasks/weekly/generate`
- Hook the topical campaign engine into the cron: every Monday, look up `awareness_calendar` for this month + specialty + region, then call `generateTopicalCampaign`

### Sprint D — Week 4: Reputation + polish
- Build `POST /api/reputation/respond`
- Set up new-review detection (poll Google reviews via SerpApi nightly)
- Trigger Claude response draft when new <=3 star review detected
- Final polish on dashboard interactions, performance, mobile responsive

## File-by-file changes from v5.1

| File | What changed |
|---|---|
| `frontend/dashboard.html` | **Completely rewritten** — 12 sections, sidebar nav, Chart.js trend chart, all 19 features visualized. 860 lines. |
| `database/schema.sql` | **6 new tables appended** — monitor_subscribers, weekly_score_snapshots, competitor_snapshots, weekly_tasks, content_packs, awareness_calendar, reputation_alerts |
| `database/awareness-calendar.json` | **NEW** — 65 medical observances tagged by specialty + region. Seed into `awareness_calendar` table on first deploy. |
| `api/api-spec.ts` | **v6 sections appended** — SECTION 10 (types), 11 (endpoints), 12 (Claude prompts), 13 (schema). 5 new prompts added. |
| `docs/Developer-Handoff-v6.md` | This file. Read this first. |

## Critical implementation notes

### 1. The `GET /api/dashboard` payload shape

Look at `api-spec.ts` SECTION 10 → `MonitorDashboardData` type. The dashboard.html currently runs on a `DEMO` object hard-coded at the bottom of the file. To wire it up:

```typescript
// In dashboard.html, replace the DEMO block with:
const response = await fetch('/api/dashboard', { credentials: 'include' })
const data = await response.json()
populateDashboard(data)  // implement this function to map data → DOM
```

The DEMO object is a perfect spec for what the API should return. Match its shape exactly.

### 2. The weekly cron is the heart of the system

`POST /api/weekly-cron` runs once per subscriber per week. The whole product collapses if this fails silently. Wrap every step in try/catch, log every failure to Sentry, and email Ayush if any subscriber's cron fails twice in a row.

Order of operations (must run in this sequence — each depends on the previous):

```typescript
async function weeklyCronForSubscriber(subscriberId: string) {
  const sub = await getSubscriber(subscriberId)

  // 1. Full audit (same as /api/audit but writes to weekly_score_snapshots)
  const audit = await runFullAudit(sub)
  const snapshot = await storeWeeklySnapshot(sub, audit)

  // 2. Snapshot the 3 watched competitors
  const competitors = await snapshotCompetitors(sub)
  await storeCompetitorSnapshots(sub, competitors)

  // 3. Diff vs last week — generate change alerts
  const lastWeek = await getLastWeekSnapshot(sub.id)
  const alerts = generateChangeAlerts(snapshot, lastWeek, competitors)

  // 4. Get this month's topical campaign
  const month = new Date().getMonth() + 1
  const observances = await getAwarenessForMonth(month, sub.specialty, sub.region)
  const campaign = await callClaude(MONITOR_PROMPTS.generateTopicalCampaign(sub, observances[0]))

  // 5. Generate weekly content pack (9 pieces)
  const contentPack = await callClaude(MONITOR_PROMPTS.generateWeeklyContentPack(sub, campaign))
  await storeContentPack(sub, contentPack)

  // 6. Generate weekly tasks (5-7)
  const tasks = await callClaude(MONITOR_PROMPTS.generateWeeklyTasks(sub, snapshot, competitors))
  await storeWeeklyTasks(sub, tasks)

  // 7. Detect new reviews → reputation alerts
  await checkForNewReviews(sub)  // calls /api/reputation/respond if rating <= 3

  // 8. Send weekly email with PDF attached
  await sendWeeklyEmail(sub, snapshot, tasks, campaign)
}
```

### 3. The topical campaign engine (Feature 13, the differentiator)

For each subscriber, every Monday:

1. Get current month (e.g. June = 6)
2. Query `awareness_calendar` where `month = 6 AND specialty_tags @> ARRAY[sub.specialty] AND region_tags @> ARRAY[sub.region]`
3. If multiple observances match (e.g. cardiologist in June matches "American Heart Month" and "Men's Health Month"), prioritise by: region-specific first → then global → then alphabetical
4. Pass the chosen observance to `generateTopicalCampaign` prompt
5. Use the response to seed the content pack generation

Critically: **the content pack must reference the campaign theme by name** (e.g. "Love Your Heart Month") in every piece. The dashboard topical banner shows this campaign theme prominently.

### 4. Pricing and metering

```
4 weekly full audits (real AI queries × 4 platforms): ~$6.00
4 content packs (9 pieces × Claude generation):       ~$2.40
4 weekly task lists + roadmap updates:                ~$0.80
Reputation response drafts (variable):                ~$0.20
Email + storage:                                      ~$0.30
─────────────────────────────────────────────────────────────
Total: ~$9.70/subscriber/month at $49 = 80% gross margin
```

If a subscriber regenerates content or tasks manually mid-week, that's incremental cost. Cap manual regenerations at 2/week per subscriber to prevent abuse.

### 5. Stripe integration

Use Stripe Billing for the $49/month subscription. Webhook `customer.subscription.created` → insert into `monitor_subscribers`. Webhook `customer.subscription.deleted` → set `monitor_subscribers.active = FALSE` (don't delete — keep history). The cron skips inactive subscribers automatically.

## How to verify the build is working

After deploy, log in as a test subscriber and check:

1. **Dashboard loads in < 2 seconds** — no spinner on critical sections (score, AI tracker, competitors)
2. **All 12 sections visible** — campaign banner at top, roadmap at bottom
3. **Score trend chart renders** (Chart.js)
4. **Sidebar nav active state** updates on scroll
5. **Tasks are checkable** — clicking toggles done state
6. **No console errors**
7. **Trigger weekly cron manually** — should produce new content pack, new tasks, new snapshot in DB
8. **Send a test weekly email** — should arrive in Resend logs with PDF attached
9. **AI Rank Tracker shows real positions** — not placeholders
10. **Topical Campaign banner shows the actual current month's campaign** — verify against `awareness-calendar.json`

If all 10 check out, Monitor is live.

## What NOT to do

- Don't run the cron synchronously inside an HTTP request — use a queue (Vercel Cron, Inngest, or Supabase Edge Functions scheduled)
- Don't store generated content pack items in the user's UI state — always read from DB so subscribers can edit/publish status
- Don't let an AI query failure block the whole cron — degrade gracefully (skip AI section, still send email)
- Don't expose `/api/weekly-cron` publicly — gate it behind a cron secret header
- Don't send the weekly email before the new content + tasks are stored — race condition that's bitten products before

## Questions

hello@thedocmirror.com

---

**Files in this package for v6:**

- `frontend/dashboard.html` — the SaaS dashboard
- `frontend/pdf-report-template.html` — unchanged from v5.1 (15 pages)
- `api/api-spec.ts` — extended with v6 sections 10–13
- `database/schema.sql` — v6 tables appended at bottom
- `database/awareness-calendar.json` — seed data for Feature 13
- `docs/Developer-Handoff-v6.md` — this file
- `docs/Developer-Handoff-v5.md` — previous handoff (v5.1 PDF rebuild)
- `docs/Developer-Guide.docx` — full reference doc

Read this file → read api-spec.ts SECTION 10–13 → look at dashboard.html → run schema.sql.

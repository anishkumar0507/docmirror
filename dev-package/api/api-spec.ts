/**
 * The Doc Mirror — Complete API Specification v4
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MAJOR CHANGES IN v4:
 *   — Done For You tier ($149) REMOVED entirely (not honestly automatable)
 *   — 3 tiers only: Free, $19 Report, $49 Monitor
 *   — Hybrid AI Visibility scoring: synthetic on free tier, real AI queries on paid
 *   — Public preview pages: auto-created at /preview/[slug], noindex until opt-in
 *   — 7-pillar update: replaced Website Quality + Social Presence with
 *       AI Visibility Signals (5pts) + Directory & Citation Presence (5pts)
 *   — New endpoints: POST /api/preview/create, GET /api/preview/[slug],
 *       POST /api/preview/publish
 *   — Brand: "Doctor Visibility Score" everywhere (not "Patient Visibility Score")
 *
 * SPRINT BUILD ORDER:
 *   Sprint 1 (Week 1-2): Waitlist + email capture + basic /api/audit (Google Places)
 *   Sprint 2 (Week 3-4): Full /api/audit (7 pillars + synthetic AI scoring + Claude prompts)
 *                        + /api/report (PDF) + /api/checkout + Stripe webhook + Preview pages
 *   Sprint 3 (Week 5-6): Weekly cron for Monitor + auth + dashboard + REAL AI queries on paid
 *
 * ENVIRONMENT VARIABLES:
 *   GOOGLE_PLACES_API_KEY    — Google Places API (Sprint 1, required)
 *   GOOGLE_PAGESPEED_KEY     — PageSpeed Insights API (Sprint 2)
 *   SERPAPI_KEY              — Local rank + brand search + directory detection (Sprint 2)
 *   YOUTUBE_API_KEY          — YouTube Data API v3 — FREE (Sprint 2, paid tier feature)
 *   ANTHROPIC_API_KEY        — Claude API for all AI prompts (Sprint 2)
 *   OPENAI_API_KEY           — ChatGPT queries for paid tier ONLY (Sprint 3)
 *   GOOGLE_AI_API_KEY        — Gemini queries for paid tier ONLY (Sprint 3)
 *   PERPLEXITY_API_KEY       — Perplexity queries for paid tier ONLY (Sprint 3)
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY
 *   RESEND_API_KEY
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
 *   STRIPE_PRICE_REPORT, STRIPE_PRICE_MONITOR (only two products — no DFY)
 *
 * COST PER AUDIT:
 *   Free check (synthetic AI):                   ~$0.18
 *   $19 report (real AI queries × 4 platforms):  ~$1.40
 *   $49 Monitor subscriber per month:            ~$6.00 (4 weekly audits)
 */


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 1: AUDIT RESPONSE SCHEMA (v4)
// ═══════════════════════════════════════════════════════════════════════════

export type AuditResponse = {
  auditId: string
  notFound: false
  generatedAt: string
  plan: 'free' | 'report' | 'monitor'  // NO 'dfy' in v4

  doctorName: string
  specialty: string
  city: string
  state: string
  previewSlug?: string

  score: number
  scorePrev?: number
  verdict: 'critical' | 'warning' | 'moderate' | 'strong'

  pillars: {
    gmb: number          // 0-30
    rating: number       // 0-20
    reviews: number      // 0-15
    photos: number       // 0-10
    rank: number         // 0-15
    aiVisibility: number // 0-5  (NEW v4, replaces websiteQuality)
    directories: number  // 0-5  (NEW v4, replaces socialPresence)
  }

  aiVisibility: {
    google: number
    chatgpt: number
    gemini: number
    claude: number
    isReal: boolean      // true = real queries, false = synthetic signals
  }
  aiCompetitors: string[]
  aiQuery: string
  aiQueryResults?: {
    chatgpt:    { query: string, response: string, doctorAppeared: boolean, position?: number }[]
    gemini:     { query: string, response: string, doctorAppeared: boolean, position?: number }[]
    claude:     { query: string, response: string, doctorAppeared: boolean, position?: number }[]
    perplexity: { query: string, response: string, doctorAppeared: boolean, position?: number }[]
  }

  patientLoss?: {
    monthlyLow: number
    monthlyHigh: number
    annualRevenueLow: number
    annualRevenueHigh: number
    methodology: string
  }

  rating: number
  reviewCount: number
  hasHours: boolean
  hoursText?: string
  phone?: string
  website?: string
  address?: string
  photoCount: number
  localRank: number
  hasDescription: boolean
  categories: string[]
  recentReviews: { text: string, rating: number, date: string }[]

  directories: {
    healthgrades: { found: boolean, url?: string, reviewCount?: number }
    zocdoc:       { found: boolean, url?: string }
    vitals:       { found: boolean, url?: string }
    webmd:        { found: boolean, url?: string }
    doximity:     { found: boolean, url?: string }
    totalScore: number
  }

  brandSearch: {
    avgMonthlySearches: number
    threeMonthChange: number
    trend: 'rising' | 'stable' | 'declining'
    peakMonth?: string
  }

  youtube?: {
    channelFound: boolean
    subscriberCount?: number
    totalViews?: number
    videoCount?: number
    shortsRatio?: number
    lastUploadDaysAgo?: number
    topVideo?: { title: string, views: number }
  }

  issues: { severity: 'critical' | 'warning', pillar: string, text: string }[]

  topCompetitor: {
    name: string
    rating?: number
    reviewCount?: number
    localRank?: number
  }
  competitors: {
    name: string
    score?: number
    googleScore?: number
    aiScore?: number
    rating?: number
    reviewCount?: number
  }[]

  fixes?: { title: string, steps: string, copyText?: string, impact: 'high'|'medium'|'low', pillar: string, timeMinutes: number }[]
  sentiment?: { positive: string[], negative: string[], dominantTone: string, reviewThemes: string[] }
  competitorNarrative?: string
  seoKeywords?: { primary: string[], secondary: string[], longTail: string[] }
  contentStrategy?: { pillars: string[], reelIdeas: { hook: string, topic: string }[], blogTitles: string[], postingCadence: string }
  patientJourney?: {
    stages: { stage: number, name: string, status: 'winning'|'losing'|'neutral', touchpoint: string, currentGap?: string, winAction: string }[]
    stagesWinning: number
    stagesLosing: number
    criticalStage: string
  }
  ninetyDayPlan?: {
    phase1: { focus: string, actions: string[], kpis: string[], estimatedScoreGain: number }
    phase2: { focus: string, actions: string[], kpis: string[], estimatedScoreGain: number }
    phase3: { focus: string, actions: string[], kpis: string[], estimatedScoreGain: number }
    projectedScoreAt90Days: number
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 2: SCORING ALGORITHM (v4 — 7 pillars, total 100)
// ═══════════════════════════════════════════════════════════════════════════

export const PILLAR_SCORING = {

  gmb: (data: any): number => {
    let s = 0
    if (data.name)                      s += 5
    if (data.address)                   s += 5
    if (data.phone)                     s += 5
    if (data.hasHours)                  s += 7
    if (data.website)                   s += 4
    if (data.description?.length > 100) s += 4
    return Math.min(s, 30)
  },

  rating: (r: number): number => {
    if (!r)        return 0
    if (r >= 4.8)  return 20
    if (r >= 4.5)  return 17
    if (r >= 4.0)  return 14
    if (r >= 3.5)  return 10
    if (r >= 3.0)  return 5
    return 2
  },

  reviews: (n: number): number => {
    if (n >= 50) return 15
    if (n >= 20) return 11
    if (n >= 10) return 7
    if (n >= 5)  return 4
    if (n >= 1)  return 1
    return 0
  },

  photos: (n: number): number => {
    if (n >= 10) return 10
    if (n >= 5)  return 7
    if (n >= 1)  return 4
    return 0
  },

  rank: (p: number): number => {
    if (!p || p > 10) return 0
    if (p === 1)  return 15
    if (p === 2)  return 12
    if (p === 3)  return 8
    if (p <= 5)   return 4
    return 2
  },

  // NEW v4: AI Visibility Signals — 5 pts (synthetic on free, real on paid)
  aiVisibility: (data: any): number => {
    let s = 0
    if (data.wikipediaFound)                    s += 1.5
    if (data.healthgrades?.reviewCount > 10)    s += 1
    if (data.hasMedicalOrganizationSchema)      s += 1
    if (data.citationCount >= 5)                s += 0.5
    else if (data.citationCount >= 2)           s += 0.25
    if (data.zocdoc?.found || data.vitals?.found) s += 1
    return Math.min(Math.round(s * 10) / 10, 5)
  },

  // NEW v4: Directory & Citation Presence — 5 pts
  directories: (data: any): number => {
    let s = 0
    if (data.healthgrades?.found) s += 1.5
    if (data.zocdoc?.found)       s += 1
    if (data.vitals?.found)       s += 1
    if (data.webmd?.found)        s += 0.5
    if (data.doximity?.found)     s += 1
    return Math.min(Math.round(s * 10) / 10, 5)
  },
}

// Total: 30 + 20 + 15 + 10 + 15 + 5 + 5 = 100


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 3: AI VISIBILITY SCORING — SYNTHETIC vs REAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * FREE TIER: Compute aiVisibility synthetically. No real AI API calls.
 * IMPORTANT: Label as "AI Visibility Signal Score" — NOT "ChatGPT score".
 * Cost: ~$0.02. Latency: <1 sec.
 */
export function computeSyntheticAiScores(data: any) {
  const wiki         = data.wikipediaFound ? 1 : 0
  const healthgrades = data.healthgrades?.reviewCount > 10 ? 1 : (data.healthgrades?.found ? 0.5 : 0)
  const schema       = data.hasMedicalOrganizationSchema ? 1 : 0
  const citations    = Math.min((data.citationCount || 0) / 10, 1)
  const directories  = ((data.healthgrades?.found ? 0.25 : 0)
                      + (data.zocdoc?.found ? 0.25 : 0)
                      + (data.vitals?.found ? 0.25 : 0)
                      + (data.doximity?.found ? 0.25 : 0))

  // Each platform weights signals differently based on observed training behaviour
  const google  = Math.round(Math.min((data.localRank ? (11 - data.localRank) * 10 : 30) + schema * 10, 100))
  const chatgpt = Math.round(wiki * 30 + healthgrades * 20 + schema * 15 + citations * 20 + directories * 15)
  const gemini  = Math.round(wiki * 25 + healthgrades * 20 + schema * 20 + citations * 20 + directories * 15)
  const claude  = Math.round(wiki * 25 + healthgrades * 25 + schema * 15 + citations * 20 + directories * 15)

  return { google, chatgpt, gemini, claude, isReal: false }
}

/**
 * PAID TIER ($19, $49): Run actual queries against ChatGPT, Gemini, Claude, Perplexity.
 * 5 queries per platform. Parse responses for doctor's name appearance.
 * Cost: ~$1.20. Latency: 15-20 sec (parallel).
 */
export async function runRealAiQueries(doctor: any) {
  const queries = [
    `Best ${doctor.specialty} in ${doctor.city}`,
    `Top rated ${doctor.specialty} ${doctor.city} ${doctor.state}`,
    `${doctor.specialty} accepting new patients ${doctor.city}`,
    `Highly recommended ${doctor.specialty} near ${doctor.city}`,
    `Best ${doctor.specialty} for new patients in ${doctor.city}`,
  ]

  // Run all 4 platforms in parallel
  const [chatgpt, gemini, claude, perplexity] = await Promise.all([
    runChatGptQueries(queries, doctor),    // POST api.openai.com/v1/chat/completions (gpt-4o + web search)
    runGeminiQueries(queries, doctor),     // POST generativelanguage.googleapis.com gemini-1.5-pro
    runClaudeQueries(queries, doctor),     // POST api.anthropic.com claude-sonnet-4 + web_search_20250305 tool
    runPerplexityQueries(queries, doctor), // POST api.perplexity.ai sonar-pro
  ])

  return { chatgpt, gemini, claude, perplexity }
}

/**
 * Per-platform query handler. Parses AI response to find doctor name + position.
 * Returns: { query, response, doctorAppeared: bool, position?: number }
 */
async function runChatGptQueries(queries: string[], doctor: any) {
  // For each query, call OpenAI chat completions with web_search enabled
  // Parse response → check for doctor.lastName mention
  // Position = order of mention if doctor appears in a list
}

async function runGeminiQueries(queries: string[], doctor: any) {
  // Google AI Studio API
}

async function runClaudeQueries(queries: string[], doctor: any) {
  // Anthropic API with web_search tool
}

async function runPerplexityQueries(queries: string[], doctor: any) {
  // Perplexity sonar-pro (live web search built-in)
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 4: PATIENT LOSS ESTIMATE (paid tier only)
// ═══════════════════════════════════════════════════════════════════════════

export function estimatePatientLoss(data: any) {
  const ctrByPos: Record<number, number> = {
    1: 0.28, 2: 0.19, 3: 0.13, 4: 0.06, 5: 0.06,
    6: 0.02, 7: 0.02, 8: 0.02, 9: 0.02, 10: 0.02,
  }
  const yourCtr   = data.localRank ? (ctrByPos[data.localRank] || 0.005) : 0.005
  const topCtr    = 0.28
  const ctrGap    = Math.max(topCtr - yourCtr, 0)
  const volume    = data.brandSearch?.localCategoryVolume || 1000
  const missedLow  = Math.round(volume * ctrGap * 0.05)
  const missedHigh = Math.round(volume * ctrGap * 0.12)

  return {
    monthlyLow: missedLow,
    monthlyHigh: missedHigh,
    annualRevenueLow: missedLow * 12 * 200,
    annualRevenueHigh: missedHigh * 12 * 500,
    methodology: `Based on ${volume} monthly category searches, your rank #${data.localRank || 'none'}, and 5-12% healthcare conversion rate.`,
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 5: PREVIEW PAGE SYSTEM (NEW v4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every free audit auto-creates a preview page in Supabase.
 * Default: is_public=false → page renders with <meta name="robots" content="noindex">
 * After email submission or payment, doctor can opt in to publish publicly.
 */

export function generateSlug(name: string, specialty: string, city: string, state: string): string {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const hash  = Math.random().toString(36).substring(2, 6)
  return `${clean(name)}-${clean(specialty)}-${clean(city)}-${state.toLowerCase()}-${hash}`
}

/**
 * POST /api/preview/create
 * Called automatically at end of /api/audit run.
 */
export async function createPreviewPage(audit: AuditResponse) {
  const slug = generateSlug(audit.doctorName, audit.specialty, audit.city, audit.state)
  // INSERT INTO preview_pages (slug, audit_id, doctor_name, specialty, city, state,
  //   audit_data, is_public, created_at) VALUES (...)
  return { slug, previewUrl: `https://thedocmirror.com/preview/${slug}` }
}

/**
 * GET /api/preview/[slug]
 * Page renders with noindex meta if is_public=false.
 */
export async function getPreviewPage(slug: string) {
  // SELECT * FROM preview_pages WHERE slug = $1
  // Increment view_count
  // Return { ...data, isIndexable: data.is_public }
}

/**
 * POST /api/preview/publish
 * Doctor opts in to make preview public.
 */
export async function publishPreviewPage(slug: string, email: string) {
  // UPDATE preview_pages SET is_public=true, email=$2, made_public_at=NOW() WHERE slug=$1
  // Ping Google Search Console to trigger re-indexing
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 6: CLAUDE PROMPTS (all return strict JSON)
// Model: claude-sonnet-4-20250514. max_tokens: 1000. Always wrap in try/catch.
// ═══════════════════════════════════════════════════════════════════════════

export const CLAUDE_PROMPTS = {

  issues: (d: any) => `Generate 5 issues for ${d.specialty} in ${d.city}, ${d.state}. Score ${d.score}/100. Data: ${JSON.stringify({pillars: d.pillars, rating: d.rating, reviews: d.reviewCount, photos: d.photoCount, rank: d.localRank, ai: d.aiVisibility, directories: d.directories})}.
Order by patient acquisition impact. Each must be specific to this doctor.
Respond ONLY with JSON: {"issues":[{"severity":"critical|warning","pillar":"gmb|rating|reviews|photos|rank|aiVisibility|directories","text":"..."}]}`,

  fixes: (d: any) => `Generate 5 fixes for ${d.specialty} in ${d.city}. Issues: ${JSON.stringify(d.issues)}.
Each fix: title, step-by-step (<15 min), copy-paste text where applicable, impact, pillar, time.
Respond ONLY with JSON: {"fixes":[{"title":"...","steps":"...","copyText":"...","impact":"high|medium|low","pillar":"...","timeMinutes":N}]}`,

  competitorNarrative: (doctor: any, comps: any[]) => `Analyse competitive position for ${doctor.doctorName} (score ${doctor.score}, ${doctor.rating}★, ${doctor.reviewCount} reviews, rank #${doctor.localRank}) vs top competitors: ${comps.slice(0,3).map(c=>`${c.name} (${c.score}, ${c.rating}★, ${c.reviewCount} reviews)`).join('; ')}.
Write exactly 3 sentences: (1) Why top competitor wins, (2) Most achievable gap to close first, (3) Realistic 90-day position.
Respond ONLY with JSON: {"narrative":"sentence1 sentence2 sentence3"}`,

  patientJourney: (d: any) => `Map 5-stage patient journey for ${d.specialty} in ${d.city}: 1.Symptom Awareness 2.Searching for Help 3.Evaluating Doctor 4.Making Contact 5.Post-visit Advocacy.
Data: GMB ${d.pillars.gmb}/30, Rating ${d.rating}, Reviews ${d.reviewCount}, Photos ${d.photoCount}, Rank ${d.localRank}, AI ${JSON.stringify(d.aiVisibility)}, Directories ${JSON.stringify(d.directories)}.
For each stage: status (winning/losing/neutral), gap if losing, fix action.
Respond ONLY with JSON: {"stages":[{"stage":N,"name":"...","status":"...","touchpoint":"...","currentGap":"...","winAction":"..."}],"stagesWinning":N,"stagesLosing":N,"criticalStage":"..."}`,

  ninetyDayPlan: (d: any) => `Create 90-day plan for ${d.specialty} in ${d.city}, ${d.state}. Score ${d.score}/100. Issues: ${d.issues?.map((i:any)=>i.text).join('; ')}.
Phase 1 (Days 1-30): Quick wins <2hr total, no website needed.
Phase 2 (Days 31-60): Content + reviews.
Phase 3 (Days 61-90): Authority + competitive.
4-5 actions + 3 KPIs per phase. Realistic score gain. 100% no-hire actions.
Respond ONLY with JSON: {"phase1":{"focus":"...","actions":["..."],"kpis":["..."],"estimatedScoreGain":N},"phase2":{...},"phase3":{...},"projectedScoreAt90Days":N}`,

  sentiment: (reviews: any[]) => `Analyse ${reviews.length} reviews: ${reviews.map(r=>r.text).join(' | ').substring(0,4000)}.
5-6 praised qualities, 3-4 flagged concerns, dominant tone (3 words), 3 recurring themes.
Respond ONLY with JSON: {"positive":["..."],"negative":["..."],"dominantTone":"...","reviewThemes":["..."]}`,

  seoKeywords: (specialty: string, city: string, state: string) => `Generate keyword strategy for ${specialty} in ${city}, ${state}.
Primary (3-4 high-intent high-vol), Secondary (5-6 medium), Long-tail (6-8 specific low-comp).
Respond ONLY with JSON: {"primary":["..."],"secondary":["..."],"longTail":["..."]}`,

  contentStrategy: (specialty: string, issues: any[], sentiment: any) => `Content strategy for ${specialty}. Issues: ${issues?.slice(0,3).map(i=>i.text).join('; ')}. Themes: ${sentiment?.reviewThemes?.join(', ')}.
4 content pillars, 3 Reel ideas with hooks, 2 SEO blog titles, posting cadence.
Respond ONLY with JSON: {"pillars":["..."],"reelIdeas":[{"hook":"...","topic":"..."}],"blogTitles":["..."],"postingCadence":"..."}`,
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: ENDPOINTS (12 total in v4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 *  1.  POST /api/waitlist          Sprint 1
 *  2.  POST /api/email-capture     Sprint 1
 *  3.  POST /api/audit             Sprint 1→2 (full)→3 (real AI on paid)
 *  4.  POST /api/preview/create    Sprint 2 (called by /api/audit)
 *  5.  GET  /api/preview/[slug]    Sprint 2 (renders preview page)
 *  6.  POST /api/preview/publish   Sprint 2 (opt-in to public)
 *  7.  POST /api/report            Sprint 2 (PDF generation)
 *  8.  POST /api/checkout          Sprint 2 (Stripe session)
 *  9.  POST /api/stripe/webhook    Sprint 2
 *  10. POST /api/weekly-check      Sprint 3 (Vercel cron, every Monday 9AM EST)
 *  11. POST /api/auth/login        Sprint 3 (Supabase magic link)
 *  12. GET  /api/dashboard         Sprint 3
 *
 * REMOVED from v3: any DFY-related endpoints. The 'dfy' plan value is gone.
 */


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: SUPABASE SCHEMA ADDITIONS (v4)
// ═══════════════════════════════════════════════════════════════════════════

export const SCHEMA_V4_ADDITIONS = `
-- NEW v4: preview_pages table
CREATE TABLE IF NOT EXISTS preview_pages (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  slug           TEXT        UNIQUE NOT NULL,
  audit_id       TEXT,
  doctor_name    TEXT        NOT NULL,
  specialty      TEXT,
  city           TEXT,
  state          TEXT,
  audit_data     JSONB       NOT NULL,
  is_public      BOOLEAN     DEFAULT FALSE,
  email          TEXT,
  view_count     INTEGER     DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  made_public_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_preview_slug   ON preview_pages(slug);
CREATE INDEX IF NOT EXISTS idx_preview_public ON preview_pages(is_public);

-- v4: New columns in audit_cache
ALTER TABLE audit_cache
  ADD COLUMN IF NOT EXISTS ai_visibility_data JSONB,
  ADD COLUMN IF NOT EXISTS directories_data   JSONB,
  ADD COLUMN IF NOT EXISTS patient_loss_data  JSONB,
  ADD COLUMN IF NOT EXISTS preview_slug       TEXT;

-- v4: DFY plan removed from subscribers
ALTER TABLE subscribers DROP CONSTRAINT IF EXISTS subscribers_plan_check;
ALTER TABLE subscribers ADD CONSTRAINT subscribers_plan_check CHECK (plan IN ('monitor'));
`


// ═══════════════════════════════════════════════════════════════════════════
// END OF API SPEC v4
// ═══════════════════════════════════════════════════════════════════════════

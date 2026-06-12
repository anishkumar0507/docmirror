/**
 * The Doc Mirror — Complete API Specification v6
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MAJOR ADDITIONS IN v6 (Monitor / $49 build):
 *   ─── Backend (8 NEW endpoints) ───
 *   — GET  /api/dashboard                      — main dashboard payload
 *   — POST /api/weekly-cron                    — weekly Monday 9AM job per subscriber
 *   — GET  /api/competitor-snapshots/:userId   — historical competitor data
 *   — POST /api/content-pack/generate          — generate weekly content (Feature 6)
 *   — POST /api/tasks/weekly/generate          — generate personalized tasks (Feature 5)
 *   — POST /api/review-templates               — SMS/WhatsApp/email review request copy
 *   — GET  /api/awareness/:specialty/:region   — get this month's topical campaign
 *   — POST /api/reputation/respond             — Claude-draft response to a new review
 *
 *   ─── Database (5 NEW tables) ───
 *   — competitor_snapshots   — historical competitor data, snapshotted weekly
 *   — weekly_tasks           — generated personalized tasks per subscriber
 *   — content_packs          — weekly content packs (9 items per pack)
 *   — awareness_calendar     — 65+ medical observances seeded from JSON file
 *   — reputation_alerts      — new reviews flagged for response
 *
 *   ─── Claude prompts (5 NEW) ───
 *   — generateWeeklyContentPack    — 9 pieces across IG/GBP/FB/WA/Blog
 *   — generateWeeklyTasks          — 5-7 tasks ranked by impact, with est. score gain
 *   — generateTopicalCampaign      — uses awareness_calendar to drive content
 *   — generateReviewTemplates      — SMS/WhatsApp/email request copy
 *   — generateReputationResponse   — Claude-drafted public response to a critical review
 *
 *   ─── New types added to AuditResponse for Monitor subscribers ───
 *   — MonitorDashboardData, TopicalCampaign, WeeklyTask, ContentPackItem, ReputationAlert
 *
 * CARRIED OVER FROM v5.1:
 *   — 15-page PDF report (Executive Summary, AI Visibility, Patient Loss,
 *     Content Engine, Production & Compliance, Monitor Upsell, Methodology)
 *   — Specialty + score + region awareness in all Claude prompts
 *   — Validation: validatePillarTotal() blocks broken reports
 *
 * SPRINT PLAN FOR v6 (Monitor build):
 *   Sprint A (Week 1): DB tables + /api/dashboard endpoint + auth + sidebar UI
 *   Sprint B (Week 2): Weekly cron + competitor snapshots + change detection
 *   Sprint C (Week 3): Content pack + weekly tasks + topical campaign engine
 *   Sprint D (Week 4): Reputation monitor + review templates + email reports + polish
 *
 * COST PER MONITOR SUBSCRIBER PER MONTH (v6):
 *   4 weekly full audits (real AI queries × 4 platforms): ~$6.00
 *   4 content packs (Claude generation):                  ~$2.40
 *   4 weekly task lists + roadmap updates:                ~$0.80
 *   Reputation response drafts (variable):                ~$0.20
 *   Email + storage:                                      ~$0.30
 *   ─────────────────────────────────────────────────────────────
 *   Total: ~$9.70/subscriber/month at $49 = 80% gross margin
 *
 * The Doc Mirror — v5.1 → v6 changelog continues below.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The Doc Mirror — Complete API Specification v5.1
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * MAJOR CHANGES IN v5.1 (Social Content Engine + Compliance pages):
 *   — PDF report expanded from 13 pages to 15 pages
 *   — Page 10 NEW: Social Media Content Engine
 *       · 4-category content map (Education, Lifestyle, Behind the Practice, Community)
 *       · 12 specialty + location-aware sub-categories with topic ideas
 *       · 30-day visual posting calendar (Mon/Wed/Fri)
 *       · 12-topic ready-to-film library
 *       · Platform mix recommendations (Instagram, YouTube Shorts, WhatsApp Business)
 *   — Page 11 NEW: Production & Compliance Guide
 *       · Shoot production essentials (lighting, framing, wardrobe, audio)
 *       · Caption framework (Hook → Value → CTA → Disclaimer → Hashtags)
 *       · Universal medical compliance rules (6 rules)
 *       · Specialty-specific compliance cautions (region + specialty aware)
 *       · Pre-publish checklist (10 items)
 *   — 2 new Claude prompts: socialContentStrategy + specialtyComplianceDonts
 *   — New AuditResponse fields: socialContent, complianceFramework, hashtagLocation,
 *     hashtagSpecialty, specialtyDonts
 *
 * MAJOR CHANGES IN v5 (PDF report rebuild):
 *   — PDF report expanded from 6 pages to 13 pages
 *   — Executive Summary added (page 2) — Claude-generated TL;DR with revenue headline
 *   — AI Visibility section added to PDF (page 3) — was missing entirely in v4
 *   — Patient Loss Estimate added to PDF (page 6) — with methodology + formula
 *   — Monitor tier upsell page added (page 12) — sample alert mockup + $49 CTA
 *   — Methodology page added (page 13) — data sources, timestamp, score formula
 *   — Pillar table fixed: now shows all 7 pillars (was 5), math validates to total
 *   — Competitor table fixed: DVS scores now populated per competitor
 *   — Name cleaning: doctorNameClean strips "Dr." prefix to avoid "Dr. Dr X"
 *   — Geography awareness: region/currency/per-patient value adapt to US vs India
 *   — Specialty awareness: Claude prompts now refuse inappropriate fixes
 *   — Score-adaptive content: 98+ doctors get protection plans, not turnaround plans
 *   — Response templates added: 3 ready-to-paste templates (positive, neutral, critical)
 *   — Methodology timestamp added: every report shows when AI queries were run
 *
 * CARRIED OVER FROM v4:
 *   — Done For You tier ($149) remains REMOVED (not automatable)
 *   — 3 tiers: Free, $19 Report, $49 Monitor
 *   — Hybrid AI scoring: synthetic free / real paid
 *   — Public preview pages at /preview/[slug]
 *   — 7 pillars with AI Visibility + Directory & Citation Presence
 *   — Brand: "Doctor Visibility Score"
 *
 * SPRINT BUILD ORDER (unchanged from v4):
 *   Sprint 1 (Week 1-2): Waitlist + email + basic /api/audit
 *   Sprint 2 (Week 3-4): Full /api/audit + Claude prompts + /api/report PDF + Stripe
 *   Sprint 3 (Week 5-6): Weekly cron + auth + dashboard + REAL AI queries on paid
 *
 * COST PER AUDIT (v5.1):
 *   Free check (synthetic AI):                   ~$0.18
 *   $19 report (real AI queries × 4 + 10 Claude prompts incl 2 new): ~$1.65
 *   $49 Monitor subscriber per month:            ~$7.00
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
  doctorNameClean: string             // NEW v5: stripped of "Dr." prefix to avoid "Dr. Dr X"
  specialty: string
  city: string
  state: string                       // Required — never empty (default "" hidden in display)
  region: 'US' | 'IN' | 'OTHER'       // NEW v5: drives currency, directories, etc.
  currencySymbol: '$' | '₹'           // NEW v5: derived from region
  valuePerPatientLow: number          // NEW v5: 200 (US) or 500 (IN)
  valuePerPatientHigh: number         // NEW v5: 500 (US) or 2000 (IN)
  previewSlug?: string

  score: number
  pillarTotal: number                  // NEW v5: must equal score, used to detect calc bugs
  scorePrev?: number
  verdict: 'critical' | 'warning' | 'moderate' | 'strong'
  verdictLabel: string                 // NEW v5: human-readable (e.g. "Strong Visibility")
  tierLabel: string                    // NEW v5: e.g. "Full 7-Pillar AI Visibility Audit"

  // NEW v5: Executive summary (Claude-generated, score-adaptive)
  execSummary: {
    headline: string                   // 1-line summary of revenue at risk
    paragraph1: string                 // Where the doctor stands today
    paragraph2: string                 // The biggest gap and what it costs
    paragraph3: string                 // What to do about it
    top3Priorities: string[]           // 3 specific actions
  }

  pillars: {
    gmb: number; rating: number; reviews: number
    photos: number; rank: number; aiVisibility: number; directories: number
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

  // NEW v5.1: Social Media Content Strategy (Page 10) — generated by Claude
  socialContent?: {
    cat1_subcats: Array<[string, string[]]>   // [subcategory_name, [topic1, topic2, topic3]]
    cat2_subcats: Array<[string, string[]]>
    cat3_subcats: Array<[string, string[]]>
    cat4_subcats: Array<[string, string[]]>
    calendar: Array<[string, Array<[string, string]>]>  // [week_name, [[category, topic], ...]]
    topic_library: Array<[string, string]>    // [topic_title, topic_description] — 12 items
  }

  // NEW v5.1: Compliance (Page 11) — region + specialty aware
  complianceFramework?: string  // e.g. "MCI Code, IMC Regulations 2002, ..." (India) or "FTC, FDA Guidance" (US)
  hashtagLocation?: string       // e.g. "JamshedpurCardiologist"
  hashtagSpecialty?: string      // e.g. "HeartHealth"
  specialtyDonts?: string[]      // 5-7 specialty-specific don't items
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
// SECTION 6: CLAUDE PROMPTS v5 (specialty-aware + score-adaptive + geo-aware)
// Model: claude-sonnet-4-20250514. max_tokens: 1500. Always wrap in try/catch.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper: tag every prompt with specialty constraints so Claude refuses
 * inappropriate fixes. Keeps a single source of truth for ethics guardrails.
 */
const SPECIALTY_GUARDRAILS: Record<string, string> = {
  psychiatrist: 'NEVER suggest before/after photos, patient case study photos, ' +
                'or any imagery that could violate patient confidentiality. ' +
                'Mental health practice — emphasise credentials, testimonials, ' +
                'educational content. Avoid promotional/transformational framing.',
  psychologist: 'NEVER suggest before/after photos or patient transformation imagery. ' +
                'Avoid medical-procedure framing. Emphasise educational content, ' +
                'therapy modalities, and academic credentials.',
  obgyn:        'Avoid pregnancy/procedure photos that could compromise patient privacy. ' +
                'Frame content around education and prevention, not transformation.',
  pediatrician: 'NEVER suggest patient (child) photos. Avoid any imagery of minors. ' +
                'Focus on clinic environment, credentials, parent testimonials.',
  oncologist:   'Avoid before/after framing. Emphasise care quality, multidisciplinary ' +
                'team, and outcomes statistics where appropriate.',
  dermatologist: 'Before/after photos are appropriate if patient consent is documented. ' +
                 'Mention consent requirement explicitly in any photo-related advice.',
}

function guardrailsFor(specialty: string): string {
  const key = specialty.toLowerCase().replace(/[^a-z]/g, '')
  return SPECIALTY_GUARDRAILS[key] || 'Apply standard medical practice ethics. ' +
    'Patient privacy is paramount. Only suggest content/imagery the doctor can ethically produce.'
}

/**
 * Helper: pick the right tone based on score level.
 * 85+ doctors don't need "fix" framing — they need protection/leadership framing.
 */
function planFraming(score: number): { mode: string, tone: string } {
  if (score >= 85) return {
    mode: 'protection',
    tone: 'Focus on protecting the existing strong position. Identify maintenance ' +
          'risks and competitive threats. Frame fixes as "lead extension" not "catch-up".'
  }
  if (score >= 70) return {
    mode: 'optimisation',
    tone: 'Focus on closing the gap to top-3 competitors. Identify specific pillars ' +
          'where 5–10 point gains are realistic. Frame as "lock in your top-tier position".'
  }
  if (score >= 50) return {
    mode: 'catchup',
    tone: 'Focus on closing major gaps. Frame as "competitors are pulling ahead — ' +
          'here is how to catch up". Urgent but constructive tone.'
  }
  return {
    mode: 'rebuild',
    tone: 'Focus on foundational fixes. Acknowledge the situation honestly without ' +
          'shaming. Frame as "every doctor here is just one fix away from major gains".'
  }
}


export const CLAUDE_PROMPTS = {

  // NEW v5 — Executive Summary (drives the PDF page 2 headline)
  execSummary: (d: any) => {
    const framing = planFraming(d.score)
    return `You are writing the executive summary for a Doctor Visibility Report for ${d.doctorNameClean}, a ${d.specialty} in ${d.city}, ${d.state || ''}.

Score: ${d.score}/100 (${d.verdictLabel}).
Tone: ${framing.tone}
Region: ${d.region} (currency: ${d.currencySymbol}).

Estimated patient loss: ${d.patientLoss?.monthlyLow}-${d.patientLoss?.monthlyHigh} patients/month, ${d.currencySymbol}${d.patientLoss?.annualRevenueLow}-${d.currencySymbol}${d.patientLoss?.annualRevenueHigh}/year revenue at risk.

Top pillar gaps: ${Object.entries(d.pillars).sort((a:any,b:any)=>a[1]-b[1]).slice(0,3).map(([k,v])=>k+':'+v).join(', ')}.
AI scores: ChatGPT ${d.aiVisibility?.chatgpt}, Gemini ${d.aiVisibility?.gemini}, Claude ${d.aiVisibility?.claude}.

${guardrailsFor(d.specialty)}

Write:
1. headline: ONE sentence summarising the financial impact + the specific opportunity
2. paragraph1 (60-80 words): Where the doctor stands today vs competitors. Use specific numbers.
3. paragraph2 (60-80 words): The single biggest gap — what it costs in patients/revenue and why it matters.
4. paragraph3 (60-80 words): What can be done about it in the next 30 days. Give one concrete first action.
5. top3Priorities: array of 3 specific actions (one short sentence each, action verbs)

Respond ONLY with JSON:
{"headline":"...","paragraph1":"...","paragraph2":"...","paragraph3":"...","top3Priorities":["...","...","..."]}`
  },

  // UPDATED v5 — specialty + score aware
  issues: (d: any) => {
    const framing = planFraming(d.score)
    return `You are a patient acquisition consultant for ${d.specialty}s in ${d.city}.
${guardrailsFor(d.specialty)}

Doctor: ${d.doctorNameClean}, ${d.specialty}, ${d.city}, ${d.state || ''}.
Score: ${d.score}/100 (${d.verdictLabel}). Mode: ${framing.mode}.
Data: ${JSON.stringify({pillars: d.pillars, rating: d.rating, reviews: d.reviewCount, photos: d.photoCount, rank: d.localRank, ai: d.aiVisibility, directories: d.directories})}

Generate 5 issues ordered by patient acquisition impact for this specialty.
- For score 85+: focus on competitive threats and AI visibility gaps, not basic fixes
- For score 50-84: balance foundational gaps and competitive gaps
- For score <50: focus on foundational gaps first
- Every issue must reference ${d.specialty}-specific context, not generic medical advice.
- Never suggest anything the specialty guardrails forbid.

Respond ONLY with JSON: {"issues":[{"severity":"critical|warning","pillar":"gmb|rating|reviews|photos|rank|aiVisibility|directories","text":"..."}]}`
  },

  // UPDATED v5 — specialty + score aware, copy-paste text always included
  fixes: (d: any) => {
    const framing = planFraming(d.score)
    return `You are a digital optimisation specialist for ${d.specialty}s in ${d.city}.
${guardrailsFor(d.specialty)}

Score: ${d.score}/100. Mode: ${framing.mode}. ${framing.tone}
Issues identified: ${JSON.stringify(d.issues)}
Region: ${d.region}. Use ${d.region === 'IN' ? 'Practo, JustDial, Lybrate, Apollo247' : 'Healthgrades, Zocdoc, Vitals, WebMD'} as directory examples.

Generate 5 fixes ordered by score impact.
Each fix must include:
- title (one line, action verb)
- steps (numbered, completable in <15 min, written for someone who's never optimised a GMB before)
- copyText (ready-to-paste text — review request, GMB description, etc — written in the doctor's voice)
- impact (high|medium|low based on score points it adds)
- pillar (which pillar it improves)
- timeMinutes (realistic estimate)
- estimatedScoreGain (specific points number, not range)

CRITICAL: never violate the specialty guardrails. For ${d.specialty}, avoid any inappropriate framing.

Respond ONLY with JSON: {"fixes":[{"title":"...","steps":"...","copyText":"...","impact":"high|medium|low","pillar":"...","timeMinutes":N,"estimatedScoreGain":N}]}`
  },

  competitorNarrative: (doctor: any, comps: any[]) => `You are a competitive intelligence analyst for ${doctor.specialty}s in ${doctor.city}.

The doctor: ${doctor.doctorNameClean} (score ${doctor.score}, ${doctor.rating}★, ${doctor.reviewCount} reviews, rank #${doctor.localRank}).
Top 3 competitors:
${comps.slice(0,3).map((c:any,i:number) => `${i+1}. ${c.name} (DVS ${c.score || '?'}, ${c.rating}★, ${c.reviewCount} reviews, photos ${c.photoCount || 0}, rank #${c.localRank || '?'})`).join('\n')}

Write exactly 3 sentences for the competitor narrative section:
1. Specifically why the top competitor outranks this doctor (cite the exact data gap, not generic advice)
2. The single most achievable gap to close first and its expected impact in 30 days
3. The realistic competitive position this doctor can achieve in 90 days

Be specific. Use actual names and numbers. No generic advice. No filler.

Respond ONLY with JSON: {"narrative":"sentence1 sentence2 sentence3"}`,

  patientJourney: (d: any) => `Map the 5-stage patient journey for ${d.specialty} in ${d.city}: 1.Symptom Awareness 2.Searching for Help 3.Evaluating Doctor 4.Making Contact 5.Post-visit Advocacy.

${guardrailsFor(d.specialty)}

Data: GMB ${d.pillars.gmb}/30, Rating ${d.rating}, Reviews ${d.reviewCount}, Photos ${d.photoCount}, Rank ${d.localRank}, AI scores ${JSON.stringify(d.aiVisibility)}, Directories ${JSON.stringify(d.directories)}.

For each stage: status (winning/losing/neutral), touchpoint (the specific channel patients use at this stage), the gap if losing (one specific sentence), and the one action that fixes it.

Respond ONLY with JSON: {"stages":[{"stage":N,"name":"...","status":"...","touchpoint":"...","currentGap":"...","winAction":"..."}],"stagesWinning":N,"stagesLosing":N,"criticalStage":"..."}`,

  ninetyDayPlan: (d: any) => {
    const framing = planFraming(d.score)
    return `Create a 90-day plan for ${d.specialty} in ${d.city}, ${d.state || ''}. Region: ${d.region}.

Score: ${d.score}/100. Mode: ${framing.mode}. ${framing.tone}
${guardrailsFor(d.specialty)}

Issues: ${d.issues?.map((i:any)=>i.text).join('; ')}.

Phase 1 (Days 1-30): ${framing.mode === 'protection' ? 'Lock in current advantages, identify monitoring routines' : 'Quick wins <2hr total, no website needed'}.
Phase 2 (Days 31-60): ${framing.mode === 'protection' ? 'Build moat: AI visibility signals + content authority' : 'Content + reviews + AI signal building'}.
Phase 3 (Days 61-90): ${framing.mode === 'protection' ? 'Establish market leadership + competitor differentiation' : 'Authority + competitive moves'}.

For each phase: 4-5 specific actions, 3 measurable KPIs with numeric targets, realistic estimated score gain (0-1 for protection mode, 5-12 for catchup, 8-15 for rebuild).

Every action must be 100% completable without hiring. Use ${d.region === 'IN' ? 'Practo, JustDial' : 'Healthgrades, Zocdoc'} where directory work is mentioned.

Respond ONLY with JSON: {"phase1":{"focus":"...","actions":["..."],"kpis":["..."],"estimatedScoreGain":N},"phase2":{...},"phase3":{...},"projectedScoreAt90Days":N}`
  },

  sentiment: (reviews: any[]) => `Analyse ${reviews.length} patient reviews: ${reviews.map(r=>r.text).join(' | ').substring(0,4000)}.

Identify: 5-6 most-praised qualities (single words), 3-4 most-flagged concerns (single words), dominant tone (3 words), 3 recurring themes (short phrases).

Respond ONLY with JSON: {"positive":["..."],"negative":["..."],"dominantTone":"...","reviewThemes":["..."]}`,

  // NEW v5 — Response templates
  responseTemplates: (d: any, sentiment: any) => `Write 3 review response templates for ${d.doctorNameClean}, a ${d.specialty} in ${d.city}.
${guardrailsFor(d.specialty)}

Praised themes: ${sentiment?.positive?.join(', ')}.
Concerns flagged: ${sentiment?.negative?.join(', ')}.

Write:
1. positive: Response to a glowing 5-star review (thanking patient specifically for the qualities they praised)
2. neutral: Response to a 3-star or mixed review (acknowledging the positive, addressing the specific concern, inviting offline dialogue)
3. critical: Response to a 1-2 star negative review (empathetic, never defensive, invites offline resolution, never disputes facts publicly)

Each response: 2-3 sentences. Doctor's voice — warm but professional. Never apologetic or defensive. Never reveals medical details. ${d.region === 'IN' ? 'Use language appropriate for Indian patient communication.' : 'Use clear US healthcare communication tone.'}

Respond ONLY with JSON: {"positive":"...","neutral":"...","critical":"..."}`,

  seoKeywords: (specialty: string, city: string, state: string) => `Generate keyword strategy for ${specialty} in ${city}${state ? ', ' + state : ''}.
Primary (3-4 high-intent high-vol), Secondary (5-6 medium), Long-tail (6-8 specific low-comp).
All keywords must be realistic queries patients actually type.
Respond ONLY with JSON: {"primary":["..."],"secondary":["..."],"longTail":["..."]}`,

  contentStrategy: (specialty: string, issues: any[], sentiment: any) => `Content strategy for ${specialty}.
${guardrailsFor(specialty)}
Issues: ${issues?.slice(0,3).map(i=>i.text).join('; ')}. Themes: ${sentiment?.reviewThemes?.join(', ')}.

4 content pillars, 3 Reel ideas with hooks (each appropriate for the specialty), 2 SEO blog titles, posting cadence.

Respond ONLY with JSON: {"pillars":["..."],"reelIdeas":[{"hook":"...","topic":"..."}],"blogTitles":["..."],"postingCadence":"..."}`,

  // NEW v5.1 — Social Media Content Engine (page 10 of PDF report)
  socialContentStrategy: (d: any) => `Generate a complete social media content engine for ${d.doctorNameClean}, a ${d.specialty} in ${d.city}, ${d.state || ''}.
Region: ${d.region}.
${guardrailsFor(d.specialty)}

Generate FOUR category clusters, each with 3 sub-categories. Each sub-category needs 2-3 specific topic ideas that are:
- Specialty-appropriate (no inappropriate framing)
- Locally relevant (mention ${d.city}, local foods, local festivals, local context where applicable)
- ${d.region === 'IN' ? 'Indian context: mention festivals like Chhath, Diwali, Eid; Indian foods; tier-2 city accessibility issues' : 'US context: insurance, telemedicine, local community health'}

Categories:
1. Education & Awareness (common conditions, procedure explainers, myth vs fact)
2. Lifestyle & Prevention (diet, exercise, stress & sleep)
3. Behind the Practice (equipment, team, process)
4. Community & Local Health (local initiatives, cultural context, local FAQs)

Also generate:
- A 30-day Mon/Wed/Fri posting calendar (4 weeks × 3 posts = 12 entries), mapping each slot to one category and one specific topic
- A "ready-to-film topic library" — 12 specific topics, each with a 1-line title and 1-line description

Respond ONLY with JSON: {"cat1_subcats":[[name,[topic1,topic2,topic3]],...3 entries],"cat2_subcats":[...],"cat3_subcats":[...],"cat4_subcats":[...],"calendar":[[week_name,[[cat,topic],...3 days]],...4 weeks],"topic_library":[[title,description],...12 items]}`,

  // NEW v5.1 — Specialty compliance don'ts for the production/compliance page
  specialtyComplianceDonts: (d: any) => `Generate 6 specialty-specific "don't" rules for medical marketing compliance for a ${d.specialty}.
Region: ${d.region}. ${d.region === 'IN' ? 'Indian framework: MCI Code, IMC Regulations 2002, Drug & Magic Remedies Act 1954.' : 'US framework: FTC, FDA guidance, HIPAA.'}
${guardrailsFor(d.specialty)}

Each don't should be 1 sentence, specific to this specialty, and start with an action verb (Never, Avoid, Do not).
Include at least:
- 1 rule about patient imagery / privacy
- 1 rule about treatment outcome claims
- 1 rule about competitive language
- 1 rule about medication advice

Respond ONLY with JSON: {"donts":["...","...","...","...","...","..."]}`,
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7: v5 HELPER FUNCTIONS (name cleaning, region, PDF placeholders)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Strip "Dr.", "Dr", "Doctor" prefixes from a name to prevent "Dr. Dr X".
 * Always re-applies "Dr." cleanly when displaying.
 */
export function cleanDoctorName(name: string): string {
  return name
    .replace(/^(dr\.?|doctor)\s+/i, '')   // remove leading Dr/Dr./Doctor
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detect region from city/state. Used to drive currency, directories, value-per-patient.
 * Defaults to US. Add new regions here as you expand.
 */
const INDIAN_STATES = [
  'maharashtra','karnataka','tamil nadu','jharkhand','delhi','west bengal',
  'gujarat','rajasthan','uttar pradesh','telangana','andhra pradesh',
  'kerala','punjab','haryana','bihar','odisha','assam','madhya pradesh'
]
const INDIAN_CITIES = [
  'mumbai','delhi','bangalore','bengaluru','chennai','kolkata','hyderabad',
  'pune','ahmedabad','jaipur','lucknow','ranchi','jamshedpur','indore',
  'kanpur','nagpur','patna','bhopal','surat','vadodara','coimbatore','kochi'
]

export function detectRegion(city: string, state?: string): 'US' | 'IN' | 'OTHER' {
  const c = (city || '').toLowerCase().trim()
  const s = (state || '').toLowerCase().trim()
  if (INDIAN_STATES.some(x => s.includes(x))) return 'IN'
  if (INDIAN_CITIES.some(x => c.includes(x))) return 'IN'
  // Default to US — most signups are US doctors
  return 'US'
}

/**
 * Region-specific defaults: currency, value-per-patient, primary directories.
 * Used in PDF rendering and patient-loss calculation.
 */
export function regionDefaults(region: 'US' | 'IN' | 'OTHER') {
  if (region === 'IN') return {
    currencySymbol: '₹',
    valuePerPatientLow: 500,
    valuePerPatientHigh: 2000,
    primaryDirectories: ['Practo', 'JustDial', 'Lybrate', 'Apollo247'],
  }
  return {
    currencySymbol: '$',
    valuePerPatientLow: 200,
    valuePerPatientHigh: 500,
    primaryDirectories: ['Healthgrades', 'Zocdoc', 'Vitals', 'WebMD'],
  }
}

/**
 * Verdict label + color from a score.
 * Used on PDF cover + executive summary.
 */
export function verdictFromScore(score: number) {
  if (score >= 85) return { label: 'Strong Visibility',  color: 'cv-strong' }
  if (score >= 70) return { label: 'Moderate Visibility',color: 'cv-moderate' }
  if (score >= 50) return { label: 'Needs Attention',    color: 'cv-warning' }
  return                  { label: 'Critical Gaps',      color: 'cv-critical' }
}

/**
 * CRITICAL VALIDATION: ensure pillar scores sum to the headline score.
 * If they don't match, REJECT the report — do not generate PDF.
 * This catches the bug that produced the "98 vs 72" report in the Dr. Sinha example.
 */
export function validatePillarTotal(audit: any): { valid: boolean, expected: number, actual: number } {
  const p = audit.pillars
  const actual = (p.gmb || 0) + (p.rating || 0) + (p.reviews || 0) +
                 (p.photos || 0) + (p.rank || 0) + (p.aiVisibility || 0) + (p.directories || 0)
  return {
    valid: actual === audit.score,
    expected: audit.score,
    actual,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 7B: PDF PLACEHOLDER MAPPING — every {{TOKEN}} in pdf-report-template.html
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Use this function in /api/report to populate the PDF template from audit data.
 * Returns a map of placeholder → value. Pass through string replacement.
 *
 * If validatePillarTotal(audit).valid === false, refuse to generate the PDF
 * and return an error to the user (don't email a broken report).
 */
/**
 * Use this function in /api/report to populate the PDF template from audit data.
 * Returns a map of placeholder → value. Pass through string replacement.
 *
 * If validatePillarTotal(audit).valid === false, refuse to generate the PDF
 * and return an error to the user (don't email a broken report).
 *
 * v5.1: Default totalPages is now 15 (Content Engine + Compliance pages added)
 */
export function buildPdfPlaceholders(audit: AuditResponse, totalPages: number = 15): Record<string, string> {
  const region = regionDefaults(audit.region)
  const verdict = verdictFromScore(audit.score)

  return {
    // Core identity
    '{{DOCTOR_NAME_CLEAN}}':  'Dr. ' + cleanDoctorName(audit.doctorName),
    '{{SPECIALTY}}':          audit.specialty,
    '{{CITY}}':               audit.city,
    '{{STATE}}':              audit.state || '',
    '{{STATE_DISPLAY}}':      audit.state ? ', ' + audit.state : '',  // avoid trailing comma
    '{{REGION}}':             audit.region,
    '{{REPORT_DATE}}':        new Date(audit.generatedAt).toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'}),
    '{{SCORE}}':              String(audit.score),
    '{{VERDICT_LABEL}}':      verdict.label,
    '{{VERDICT_COLOR}}':      verdict.color,
    '{{TOTAL_PAGES}}':        String(totalPages),
    '{{CURRENCY_SYMBOL}}':    region.currencySymbol,
    '{{TIER_LABEL}}':         'Full 7-Pillar AI Visibility Audit',
    '{{REVIEW_COUNT}}':       String(audit.reviewCount || 0),
    '{{VALUE_PER_PATIENT_LOW}}':  String(region.valuePerPatientLow),
    '{{VALUE_PER_PATIENT_HIGH}}': String(region.valuePerPatientHigh),

    // Executive summary (Claude-generated)
    '{{EXEC_HEADLINE}}':      audit.execSummary?.headline || '',
    '{{EXEC_PARAGRAPH_1}}':   audit.execSummary?.paragraph1 || '',
    '{{EXEC_PARAGRAPH_2}}':   audit.execSummary?.paragraph2 || '',
    '{{EXEC_PARAGRAPH_3}}':   audit.execSummary?.paragraph3 || '',
    '{{EXEC_TOP_3_PRIORITIES_HTML}}':
      (audit.execSummary?.top3Priorities || []).map((p, i) =>
        `<div class="exec-priority"><div class="ep-num">${i+1}</div><div class="ep-text">${escapeHtml(p)}</div></div>`
      ).join(''),

    // AI Visibility (4 platforms)
    '{{AI_GOOGLE_SCORE}}':    String(audit.aiVisibility?.google || 0),
    '{{AI_CHATGPT_SCORE}}':   String(audit.aiVisibility?.chatgpt || 0),
    '{{AI_GEMINI_SCORE}}':    String(audit.aiVisibility?.gemini || 0),
    '{{AI_CLAUDE_SCORE}}':    String(audit.aiVisibility?.claude || 0),
    '{{AI_GOOGLE_COLOR}}':    colorForScore(audit.aiVisibility?.google || 0),
    '{{AI_CHATGPT_COLOR}}':   colorForScore(audit.aiVisibility?.chatgpt || 0),
    '{{AI_GEMINI_COLOR}}':    colorForScore(audit.aiVisibility?.gemini || 0),
    '{{AI_CLAUDE_COLOR}}':    colorForScore(audit.aiVisibility?.claude || 0),
    '{{AI_GOOGLE_FILL}}':     fillForScore(audit.aiVisibility?.google || 0),
    '{{AI_CHATGPT_FILL}}':    fillForScore(audit.aiVisibility?.chatgpt || 0),
    '{{AI_GEMINI_FILL}}':     fillForScore(audit.aiVisibility?.gemini || 0),
    '{{AI_CLAUDE_FILL}}':     fillForScore(audit.aiVisibility?.claude || 0),
    '{{AI_IS_REAL_BADGE}}':   audit.aiVisibility?.isReal
                                ? '● Live queries run on your behalf'
                                : '● Signal-based estimate',
    '{{AI_RUN_TIMESTAMP_TEXT}}': audit.aiVisibility?.isReal
                                ? `Queries run live on ${new Date(audit.generatedAt).toLocaleString()}.`
                                : '',
    '{{AI_QUERIES_RAN_HTML}}': buildAiQueriesHtml(audit),
    '{{AI_COMPETITORS_HTML}}': (audit.aiCompetitors || []).slice(0, 3).map((name, i) =>
      `<div class="ai-rec-doc"><div class="air-rank">${i+1}</div>${escapeHtml(name)}</div>`
    ).join(''),
    '{{AI_NOT_DETECTED_TEXT}}': audit.aiCompetitors?.length > 0
                                ? `⚠ You were not detected in the top AI-surfaced recommendations.`
                                : `✓ You appear in some AI recommendations. Strengthen this position with the fixes on page 7.`,

    // Pillars (with status, fill colors, percentages)
    ...buildPillarPlaceholders(audit),
    '{{PILLAR_TOTAL}}':      String(validatePillarTotal(audit).actual),

    // Competitor table + narrative
    '{{COMPETITOR_TABLE_HTML}}':    buildCompetitorTableHtml(audit),
    '{{COMPETITOR_NARRATIVE_HTML}}': buildNarrativeHtml(audit.competitorNarrative || ''),

    // Patient loss
    '{{LOSS_MONTHLY_LOW}}':   formatNumber(audit.patientLoss?.monthlyLow || 0),
    '{{LOSS_MONTHLY_HIGH}}':  formatNumber(audit.patientLoss?.monthlyHigh || 0),
    '{{LOSS_ANNUAL_LOW}}':    formatNumber(audit.patientLoss?.annualRevenueLow || 0),
    '{{LOSS_ANNUAL_HIGH}}':   formatNumber(audit.patientLoss?.annualRevenueHigh || 0),
    '{{LOSS_METHODOLOGY_TEXT}}': audit.patientLoss?.methodology || '',
    '{{LOSS_FORMULA_HTML}}':  buildLossFormulaHtml(audit, region),

    // Fix guide
    '{{FIX_GUIDE_HTML}}':     buildFixGuideHtml(audit.fixes || []),

    // Sentiment + response templates
    '{{SENTIMENT_POSITIVE_HTML}}': (audit.sentiment?.positive || []).map(w => `<span class="sent-tag">${escapeHtml(w)}</span>`).join(''),
    '{{SENTIMENT_NEGATIVE_HTML}}': (audit.sentiment?.negative || []).map(w => `<span class="sent-tag">${escapeHtml(w)}</span>`).join(''),
    '{{RESPONSE_TEMPLATES_HTML}}': buildResponseTemplatesHtml((audit as any).responseTemplates),

    // SEO
    '{{SEO_PRIMARY_HTML}}':   (audit.seoKeywords?.primary || []).map(k => `<span class="kw-tag kw-primary">${escapeHtml(k)}</span>`).join(''),
    '{{SEO_SECONDARY_HTML}}': (audit.seoKeywords?.secondary || []).map(k => `<span class="kw-tag kw-secondary">${escapeHtml(k)}</span>`).join(''),
    '{{SEO_LONGTAIL_HTML}}':  (audit.seoKeywords?.longTail || []).map(k => `<span class="kw-tag kw-longtail">${escapeHtml(k)}</span>`).join(''),

    // Content
    '{{CONTENT_PILLARS_HTML}}': (audit.contentStrategy?.pillars || []).map(p => `<div class="content-item">${escapeHtml(p)}</div>`).join(''),
    '{{CONTENT_REELS_HTML}}':   (audit.contentStrategy?.reelIdeas || []).map(r => `<div class="content-item"><strong>${escapeHtml(r.hook)}</strong><br>${escapeHtml(r.topic)}</div>`).join(''),
    '{{CONTENT_BLOGS_HTML}}':   (audit.contentStrategy?.blogTitles || []).map(b => `<div class="content-item">${escapeHtml(b)}</div>`).join(''),
    '{{CONTENT_CADENCE}}':      audit.contentStrategy?.postingCadence || '',

    // Patient journey
    '{{JOURNEY_STAGES_HTML}}':  buildJourneyHtml(audit.patientJourney?.stages || []),
    '{{JOURNEY_CRITICAL_STAGE}}': audit.patientJourney?.criticalStage || '',

    // 90-day plan
    '{{PLAN_PHASE1_HTML}}':   buildPhaseHtml(audit.ninetyDayPlan?.phase1, 1),
    '{{PLAN_PHASE2_HTML}}':   buildPhaseHtml(audit.ninetyDayPlan?.phase2, 2),
    '{{PLAN_PHASE3_HTML}}':   buildPhaseHtml(audit.ninetyDayPlan?.phase3, 3),
    '{{PLAN_PROJECTED_SCORE}}': String(audit.ninetyDayPlan?.projectedScoreAt90Days || audit.score),

    // Monitor upsell sample alert
    '{{MONITOR_SAMPLE_ALERT_HTML}}': buildSampleAlertHtml(audit),

    // Methodology
    '{{METHODOLOGY_SOURCES_HTML}}':  buildMethodologySourcesHtml(audit),
    '{{METHODOLOGY_TIMESTAMP}}':      new Date(audit.generatedAt).toLocaleString('en-US', {dateStyle: 'long', timeStyle: 'short'}),
  }
}

// PDF helper functions (implemented in your /api/report route)
function colorForScore(s: number): string { return s>=70?'aps-strong':s>=40?'aps-mid':'aps-weak' }
function fillForScore(s: number): string  { return s>=70?'aif-strong':s>=40?'aif-mid':'aif-weak' }
function formatNumber(n: number): string  { return n.toLocaleString() }
function escapeHtml(s: string): string    { return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] || c)) }

// Stub implementations — developer fills these in /api/report
function buildAiQueriesHtml(audit: any): string {
  // Build the AI queries box from audit.aiQueryResults. Show each query + appeared/notfound badge.
  // Example: <div class="ai-query-item"><span class="aq-text">best cardiologist Houston</span>
  //          <span class="aq-result aqr-notfound">Not found</span></div>
  return '...' // see api-spec for HTML structure
}
function buildCompetitorTableHtml(audit: any): string { return '...' /* tbody rows with you + competitors */ }
function buildNarrativeHtml(narrative: string): string {
  return narrative.split(/(?<=[.!?])\s+/).filter(s => s.trim()).map(s => `<span class="cn-sentence">${escapeHtml(s)}</span>`).join('')
}
function buildLossFormulaHtml(audit: any, region: any): string {
  return `Monthly searches × CTR gap × conversion rate × ${region.currencySymbol}${region.valuePerPatientLow}-${region.valuePerPatientHigh}/patient × 12 months`
}
function buildFixGuideHtml(fixes: any[]): string { return '...' /* each fix as a .fix-item block */ }
function buildResponseTemplatesHtml(templates: any): string {
  if (!templates) return ''
  return `<div class="resp-template"><strong>For 5-star reviews:</strong> ${escapeHtml(templates.positive || '')}</div>` +
         `<div class="resp-template"><strong>For mixed reviews:</strong> ${escapeHtml(templates.neutral || '')}</div>` +
         `<div class="resp-template"><strong>For critical reviews:</strong> ${escapeHtml(templates.critical || '')}</div>`
}
function buildJourneyHtml(stages: any[]): string { return '...' /* each stage as .journey-stage block */ }
function buildPhaseHtml(phase: any, num: number): string { return '...' /* .plan-phase block with actions + KPIs */ }
function buildPillarPlaceholders(audit: any): Record<string, string> { return {} /* all PILLAR_* tokens */ }
function buildSampleAlertHtml(audit: any): string {
  // Show a mock alert: "Your score went from X to Y last week. Dr. Competitor gained 12 reviews."
  return `<p>Your score moved <strong class="alert-delta-up">+3</strong> this week to <strong>${audit.score + 3}/100</strong>.</p>` +
         `<p><strong>${audit.topCompetitor?.name || 'Your top competitor'}</strong> gained <strong class="alert-delta-down">+12 new reviews</strong> in the past 7 days. They now lead in review volume by ${(audit.topCompetitor?.reviewCount || 100) - (audit.reviewCount || 0)} reviews.</p>` +
         `<p><strong>AI rank change:</strong> You moved up <strong class="alert-delta-up">2 positions</strong> on Claude this week.</p>` +
         `<p style="margin-top:8px;color:#3D4D5C">→ <strong>Suggested action:</strong> Run a 3-day review push targeting recent satisfied patients.</p>`
}
function buildMethodologySourcesHtml(audit: any): string {
  const region = regionDefaults(audit.region)
  return [
    'Google Places API — Business profile, reviews, photos, hours',
    'SerpApi — Local pack rank, brand search volume, organic visibility',
    'YouTube Data API v3 — Channel statistics (if found)',
    `Real AI queries — ChatGPT (OpenAI), Gemini (Google), Claude (Anthropic), Perplexity${audit.aiVisibility?.isReal ? '' : ' [paid tier only — this is a signal-based estimate]'}`,
    `Directory checks — ${region.primaryDirectories.join(', ')}`,
    'Wikipedia API — Notability check',
    'Claude AI — Sentiment analysis, fix prioritisation, narrative generation',
  ].map(s => `<li>${s}</li>`).join('')
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 8: ENDPOINTS (12 total in v4-v5)
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
// SECTION 9: SUPABASE SCHEMA ADDITIONS (v4-v5)
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
// END OF API SPEC v5 — v6 ADDITIONS BELOW
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// SECTION 10: v6 MONITOR TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type MonitorSubscriber = {
  userId: string
  email: string
  practiceName: string
  doctorNameClean: string
  specialty: string
  city: string
  state: string
  region: 'US' | 'IN' | 'OTHER'
  subscribedAt: string         // ISO date
  weeklyCronDay: number        // 1 = Monday (default)
  weeklyCronHour: number       // 9 = 9AM local time (default)
  active: boolean
}

export type WeeklyScoreSnapshot = {
  subscriberId: string
  weekOf: string               // ISO date (Monday)
  overall: number              // 0-100
  google: number               // 0-100
  ai: number                   // 0-100 (average of 4 platforms)
  chatgpt: number
  gemini: number
  claude: number
  perplexity: number
  pillars: AuditResponse['pillars']
  aiRanks: {                   // position in top-10, null if not found
    googleAiOverview: number | null
    chatgpt: number | null
    gemini: number | null
    perplexity: number | null
  }
  queriesRunThisWeek: string[]
}

export type CompetitorSnapshot = {
  subscriberId: string
  weekOf: string
  competitorName: string
  competitorPlaceId: string
  score: number
  rating: number
  reviewCount: number
  photoCount: number
  localRank: number
  aiMentionsCount: number
  newPostsThisWeek: number
  recentChanges: string[]      // human-readable summary lines
}

export type WeeklyTask = {
  id: string
  subscriberId: string
  weekOf: string
  title: string                // max 100 chars, action verb
  description: string          // 1-2 sentences with copy-paste content where relevant
  estimatedMinutes: number
  location: string             // "Google Business Profile" | "Instagram + GBP" | "WhatsApp Business" | "Practo" etc.
  pillar: 'gmb' | 'rating' | 'reviews' | 'photos' | 'rank' | 'aiVisibility' | 'directories'
  estimatedScoreGain: number   // realistic, 1-3 typically
  completed: boolean
  completedAt?: string
  copyPasteContent?: string    // optional ready-to-paste text
}

export type ContentPackItem = {
  id: string
  subscriberId: string
  weekOf: string
  campaignTheme: string        // from awareness_calendar
  platform: 'instagram_reel' | 'instagram_carousel' | 'instagram_post'
          | 'gbp_post' | 'facebook_post' | 'whatsapp_status' | 'blog'
  headline: string             // 50-80 char hook
  body: string                 // full caption / script
  hashtags: string[]
  imagePrompt?: string         // for visual designer / Canva
  scriptSeconds?: number       // for video formats
  publishedAt?: string
}

export type TopicalCampaign = {
  campaignTheme: string
  observanceName: string
  month: number
  description: string
  weeklyThemes: string[]       // 4 themes, one per week of the month
  whyNow: string               // 1-2 sentence relevance to this doctor
  searchVolumeMultiplier: number  // e.g. 1.47 = 47% higher than baseline
}

export type ReputationAlert = {
  id: string
  subscriberId: string
  detectedAt: string
  source: 'google' | 'practo' | 'healthgrades' | 'facebook'
  reviewRating: number         // 1-5
  reviewSnippet: string        // first 200 chars
  reviewerName: string
  topics: string[]             // ["wait_times", "front_desk", "communication"]
  severity: 'critical' | 'concerning' | 'moderate'
  suggestedResponse: string    // Claude-drafted
  responded: boolean
  respondedAt?: string
}

export type MonitorDashboardData = {
  subscriber: MonitorSubscriber
  weekOf: string
  thisWeekSnapshot: WeeklyScoreSnapshot
  lastWeekSnapshot?: WeeklyScoreSnapshot
  trendTwelveWeeks: WeeklyScoreSnapshot[]
  topicalCampaign: TopicalCampaign
  competitorSnapshots: CompetitorSnapshot[]   // 3 watched competitors
  changeAlerts: Array<{
    type: 'review_gain' | 'photo_upload' | 'rank_change' | 'gbp_post' | 'rating_change'
    competitor?: string
    description: string
    impact: 'high' | 'medium' | 'win' | 'low'
    daysAgo: number
  }>
  weeklyTasks: WeeklyTask[]
  contentPack: ContentPackItem[]
  reputationAlerts: ReputationAlert[]
  reviewTracker: {
    currentCount: number
    weeklyDelta: number
    topCompetitorCount: number
    catchUpTarget: { competitorName: string, reviewsNeeded: number, weeksRequired: number }
    weeklyVelocityTarget: number
    weeklyVelocityActual: number
  }
  seoHealth: Array<{
    metric: 'gmb' | 'reviews' | 'photos' | 'citations' | 'nap' | 'speed' | 'schema' | 'rank'
    status: 'ok' | 'warn' | 'err'
    detail: string
  }>
  roadmap: {
    phase1: { focus: string, actions: string[], scoreTarget: number }
    phase2: { focus: string, actions: string[], scoreTarget: number }
    phase3: { focus: string, actions: string[], scoreTarget: number }
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 11: v6 ENDPOINTS (8 NEW for Monitor)
// ═══════════════════════════════════════════════════════════════════════════
/*
GET /api/dashboard
  Auth: subscriber JWT
  Query: ?week=YYYY-MM-DD (optional, defaults to current week)
  Returns: MonitorDashboardData
  Cache: 60 seconds
  Notes: Powers the entire /dashboard UI. The dashboard.html does ONE fetch and
         passes data to a populateDashboard(data) function.

POST /api/weekly-cron
  Auth: internal cron secret (not subscriber)
  Runs: every Monday 9AM IST (configurable per subscriber)
  Body: { subscriberId } or { all: true } for batch mode
  Process:
    1. Run full audit (same as /api/audit) — write to weekly_score_snapshots
    2. Snapshot 3 watched competitors → write to competitor_snapshots
    3. Diff vs last week → generate change alerts → store in DB
    4. Look up this month's topical campaign from awareness_calendar
    5. Generate weekly content pack (5 prompts in parallel) → store in content_packs
    6. Generate weekly tasks → store in weekly_tasks
    7. Check for new reviews across sources → store reputation_alerts
    8. Send weekly email via Resend with PDF attached

GET /api/competitor-snapshots/:userId
  Query: ?weeks=12 (default 12, max 52)
  Returns: array of CompetitorSnapshot grouped by competitor
  Use: historical trend lines for competitor watchlist

POST /api/content-pack/generate
  Auth: subscriber JWT
  Body: { campaignTheme?: string, forceRegenerate?: boolean }
  Returns: ContentPackItem[] (9 items)
  Notes: Called on-demand if subscriber wants more content mid-week, or
         automatically by /api/weekly-cron

POST /api/tasks/weekly/generate
  Auth: subscriber JWT
  Returns: WeeklyTask[]
  Notes: Tasks are score-adaptive (96+ doctors get protection tasks, 50-
         doctors get foundation tasks). Tasks reference specific competitor
         data from this week's snapshot.

POST /api/review-templates
  Auth: subscriber JWT
  Body: { templateType: 'sms' | 'whatsapp' | 'email', targetCompetitor?: string }
  Returns: { template: string, personalizationVars: string[] }
  Notes: targetCompetitor lets you generate "you need 12 more reviews than X" copy

GET /api/awareness/:specialty/:region
  Auth: subscriber JWT
  Query: ?month=6 (defaults to current month)
  Returns: TopicalCampaign[]
  Notes: Reads from awareness_calendar table (seeded from awareness-calendar.json)

POST /api/reputation/respond
  Auth: subscriber JWT
  Body: { reputationAlertId: string }
  Returns: { suggestedResponse: string }
  Notes: Generates a Claude-drafted response. Subscriber reviews and posts manually.
*/


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 12: v6 CLAUDE PROMPTS (5 NEW for Monitor)
// ═══════════════════════════════════════════════════════════════════════════

export const MONITOR_PROMPTS = {

  // 1. Weekly content pack — 9 pieces across 5 platforms
  generateWeeklyContentPack: (d: MonitorSubscriber, campaign: TopicalCampaign) => `
You are creating a weekly social content pack for ${d.doctorNameClean}, a ${d.specialty} in ${d.city}, ${d.state || ''}.
Region: ${d.region}. Active campaign: "${campaign.campaignTheme}" — ${campaign.description}

${guardrailsFor(d.specialty)}

Generate exactly 9 ready-to-publish content pieces:
  3 Instagram (1 Reel script with hook + 30-45 sec body + caption, 1 Carousel 7-slide brief, 1 Post caption)
  2 Google Business Posts (100-150 words each + image suggestion + CTA)
  1 Facebook Post (longer-form, 150-200 words)
  2 WhatsApp Status (15-sec format, single message + image prompt)
  1 Blog post (800-1,200 word SEO-targeted, primary keyword "${d.specialty} in ${d.city}")

EVERY piece must:
  - Tie to the "${campaign.campaignTheme}" theme
  - Be specialty-appropriate (no inappropriate framing per guardrails above)
  - Include 5-10 hashtags mixing location + specialty + condition + brand
  - Include an educational disclaimer at end of caption
  - Have a clear single CTA (book / save / follow / call)

Respond ONLY with JSON:
{"items":[{"platform":"instagram_reel|instagram_carousel|instagram_post|gbp_post|facebook_post|whatsapp_status|blog","headline":"...","body":"...","hashtags":["#..."],"imagePrompt":"...","scriptSeconds":30}]}
`,

  // 2. Weekly task generation — score-adaptive, references competitor data
  generateWeeklyTasks: (d: MonitorSubscriber, current: WeeklyScoreSnapshot, competitors: CompetitorSnapshot[]) => `
You are generating this week's tasks for ${d.doctorNameClean} (${d.specialty}, ${d.city}).
Current score: ${current.overall}/100. Region: ${d.region}.
Top competitor data: ${competitors.slice(0,1).map(c => `${c.competitorName} (score ${c.score}, ${c.reviewCount} reviews, ${c.photoCount} photos)`).join(' | ')}

Pillar scores: ${JSON.stringify(current.pillars)}

${guardrailsFor(d.specialty)}

${planFraming(current.overall).tone}

Generate 5-7 tasks for THIS WEEK (Mon-Sun). Every task must be:
  - Completable in <60 minutes
  - Specific to this doctor's data (cite their actual numbers)
  - Reference a competitor where helpful ("Brahmananda just added 4 photos — you have 1")
  - Have a clear location (where they do the work)
  - Have a realistic estimatedScoreGain (1-3 points per task is realistic; only foundation work earns 3+)
  - Specialty-appropriate

For each task, also include copyPasteContent where applicable (review request templates, post drafts, etc).

Respond ONLY with JSON:
{"tasks":[{"title":"...","description":"...","estimatedMinutes":N,"location":"...","pillar":"...","estimatedScoreGain":N,"copyPasteContent":"..."}]}
`,

  // 3. Topical campaign generator — feeds Feature 13
  generateTopicalCampaign: (d: MonitorSubscriber, observance: { name: string, campaignTheme: string, description: string }) => `
Generate a 4-week content campaign for ${d.doctorNameClean} (${d.specialty}, ${d.city}, ${d.region}).
Observance: "${observance.name}" — ${observance.description}
Campaign theme: "${observance.campaignTheme}"

${guardrailsFor(d.specialty)}

For each of 4 weeks, define one weekly theme that builds on the campaign.
Example progression for "Love Your Heart Month" (cardiology):
  Week 1: "Know your numbers" — BP, cholesterol basics
  Week 2: "Heart-healthy daily habits" — diet, exercise
  Week 3: "Silent signs to watch" — symptoms
  Week 4: "When to see a cardiologist" — escalation guidance

Also provide:
  - whyNow: 1-2 sentence relevance to THIS doctor in THIS city (mention local context if applicable)
  - searchVolumeMultiplier: realistic estimate vs baseline (1.0 = normal, 1.5 = 50% higher, 2.5 = peak)

Respond ONLY with JSON:
{"weeklyThemes":["...","...","...","..."],"whyNow":"...","searchVolumeMultiplier":N.NN}
`,

  // 4. Review request templates — region + competitor aware
  generateReviewTemplates: (d: MonitorSubscriber, target?: { name: string, reviewCount: number }) => `
Generate 3 review request templates for ${d.doctorNameClean} (${d.specialty} in ${d.city}, ${d.region}).
${target ? `Catch-up target: ${target.name} has ${target.reviewCount} reviews. Use this gap motivationally but tactfully.` : ''}

${guardrailsFor(d.specialty)}

Generate:
  1. SMS template (160 chars max, formal, with Google review link variable)
  2. WhatsApp template (warmer tone, can be longer, includes the doctor's name + clinic name)
  3. Email template (subject + 80-120 word body, professional)

All templates must:
  - Be ${d.region === 'IN' ? 'culturally appropriate for Indian patient communication' : 'natural for US patient communication'}
  - Include variables: {patient_name}, {google_review_link}, {doctor_name}
  - Have a single clear ask
  - Never sound desperate or transactional
  - Comply with medical advertising rules (no inducements)

Respond ONLY with JSON:
{"sms":"...","whatsapp":"...","email":{"subject":"...","body":"..."}}
`,

  // 5. Reputation response draft — for new critical/concerning reviews
  generateReputationResponse: (d: MonitorSubscriber, alert: { rating: number, snippet: string, topics: string[], reviewerName: string }) => `
Draft a public response to this review for ${d.doctorNameClean} (${d.specialty}).
Review: ${alert.rating} stars from ${alert.reviewerName}
Snippet: "${alert.snippet}"
Topics identified: ${alert.topics.join(', ')}

${guardrailsFor(d.specialty)}

Rules for this response:
  - 2-3 sentences max
  - Doctor's voice — warm, professional, accountable
  - Never defensive, never dispute facts publicly
  - Acknowledge specific concern raised (cite a topic)
  - Offer offline resolution (phone or WhatsApp callback)
  - Never apologize generically; address the specific issue
  - Never reveal medical details
  - HIPAA / patient privacy compliant
  - ${d.region === 'IN' ? 'Tone appropriate for Indian patient communication, slightly more formal' : 'Direct US healthcare tone'}

Respond ONLY with JSON:
{"response":"...","tone":"empathetic|accountable|warm","internalNote":"private note for the doctor on what to also do offline"}
`,
}


// ═══════════════════════════════════════════════════════════════════════════
// SECTION 13: v6 SCHEMA ADDITIONS (5 NEW TABLES)
// Run after v4-v5 schema. See schema.sql for the actual DDL.
// ═══════════════════════════════════════════════════════════════════════════
/*
-- Table 1: weekly score snapshots (Feature 1, 9, 17)
CREATE TABLE weekly_score_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  overall_score INT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  google_score INT NOT NULL,
  ai_score INT NOT NULL,
  chatgpt_score INT, gemini_score INT, claude_score INT, perplexity_score INT,
  pillars JSONB NOT NULL,
  ai_ranks JSONB NOT NULL,
  queries_run JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subscriber_id, week_of)
);
CREATE INDEX idx_wss_subscriber_week ON weekly_score_snapshots(subscriber_id, week_of DESC);

-- Table 2: competitor snapshots (Feature 2, 4, 14, 18)
CREATE TABLE competitor_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  competitor_name TEXT NOT NULL,
  competitor_place_id TEXT NOT NULL,
  score INT NOT NULL,
  rating NUMERIC(2,1),
  review_count INT,
  photo_count INT,
  local_rank INT,
  ai_mentions_count INT,
  new_posts_this_week INT,
  recent_changes JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subscriber_id, week_of, competitor_place_id)
);
CREATE INDEX idx_cs_subscriber_week ON competitor_snapshots(subscriber_id, week_of DESC);

-- Table 3: weekly tasks (Feature 5)
CREATE TABLE weekly_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  estimated_minutes INT,
  location TEXT,
  pillar TEXT,
  estimated_score_gain INT,
  copy_paste_content TEXT,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wt_subscriber_week ON weekly_tasks(subscriber_id, week_of DESC);

-- Table 4: content packs (Feature 6, 16)
CREATE TABLE content_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  week_of DATE NOT NULL,
  campaign_theme TEXT,
  platform TEXT NOT NULL,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  hashtags TEXT[],
  image_prompt TEXT,
  script_seconds INT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cp_subscriber_week ON content_packs(subscriber_id, week_of DESC);

-- Table 5: awareness calendar (Feature 13)
-- Seeded from awareness-calendar.json on initial deployment
CREATE TABLE awareness_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observance_name TEXT NOT NULL,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  day INT CHECK (day BETWEEN 1 AND 31),
  specialty_tags TEXT[] NOT NULL,
  region_tags TEXT[] NOT NULL,
  campaign_theme TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_ac_month ON awareness_calendar(month);
CREATE INDEX idx_ac_specialty_tags ON awareness_calendar USING GIN(specialty_tags);
CREATE INDEX idx_ac_region_tags ON awareness_calendar USING GIN(region_tags);

-- Table 6: reputation alerts (Feature 8)
CREATE TABLE reputation_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscriber_id UUID NOT NULL REFERENCES monitor_subscribers(id) ON DELETE CASCADE,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('google','practo','healthgrades','facebook')),
  review_rating INT NOT NULL CHECK (review_rating BETWEEN 1 AND 5),
  review_snippet TEXT NOT NULL,
  reviewer_name TEXT,
  topics TEXT[],
  severity TEXT CHECK (severity IN ('critical','concerning','moderate')),
  suggested_response TEXT,
  responded BOOLEAN DEFAULT FALSE,
  responded_at TIMESTAMPTZ
);
CREATE INDEX idx_ra_subscriber ON reputation_alerts(subscriber_id, detected_at DESC) WHERE responded = FALSE;
*/

// END OF API SPEC v6
// ═══════════════════════════════════════════════════════════════════════════

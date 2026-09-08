#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// reconcile-agency — finish agency signups that paid but were never provisioned.
//
// Five signups got stuck because profiles.plan='agency' was rejected by a check
// constraint that had not been migrated yet. Their accounts exist, their payments
// may be real, and nothing else was written. This finds them and finishes them.
//
// It is deliberately NOT a second implementation of provisioning: it calls the
// SAME provisionAgencyOrg() the live route calls, so a row written here is
// identical to a row written by a normal checkout.
//
// SAFETY
//   • --dry-run is the DEFAULT. Nothing is written unless --apply is passed.
//   • A subscription is only provisioned when Razorpay itself says it is paid:
//     status in active/authenticated/charged, on the agency plan, and the plan
//     bills exactly what lib/pricing.js says the agency plan costs.
//   • Anything that fails a check is reported and skipped, never guessed at.
//
// USAGE
//   node scripts/reconcile-agency.js                 # dry run, all candidates
//   node scripts/reconcile-agency.js --apply         # actually provision
//   node scripts/reconcile-agency.js --email a@b.com # limit to one account
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');
const Razorpay = require('razorpay');
const { getSupabaseClient } = require('../lib/supabase-client');
const pricing = require('../lib/pricing');
const { provisionAgencyOrg } = require('../routes/agency');

const APPLY = process.argv.includes('--apply');
const emailArgIdx = process.argv.indexOf('--email');
const ONLY_EMAIL = emailArgIdx > -1 ? String(process.argv[emailArgIdx + 1] || '').toLowerCase() : null;

const ACCEPTED_STATUS = ['active', 'authenticated', 'charged'];

function rz() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

function line(s) { console.log(s); }
function pad(s, n) {
  s = String(s == null ? '' : s);
  return (s.length > n - 1 ? s.slice(0, n - 2) + '…' : s).padEnd(n);
}

(async () => {
  const supabase = getSupabaseClient();
  const client = rz();
  const keyMode = (process.env.RAZORPAY_KEY_ID || '').startsWith('rzp_live') ? 'LIVE' : 'TEST';
  const agencyPlanId = process.env.RAZORPAY_AGENCY_PLAN_ID || '';
  const expected = pricing.orgPlanPrice('agency', 'INR');

  line('');
  line('  reconcile-agency  ' + (APPLY ? '*** APPLY — WILL WRITE ***' : '(dry run — no writes)'));
  line('  razorpay key mode : ' + keyMode + (keyMode === 'TEST' ? '   → these are TEST payments; no real money moved' : '   → LIVE: real money'));
  line('  agency plan       : ' + (agencyPlanId || '(unset)'));
  line('  expected price    : ' + expected.amount + ' ' + expected.currency + ' (' + expected.display + ')');
  line('');

  // ── Candidates: accounts that are NOT on the agency plan and own no org ────
  let q = supabase.from('profiles').select('id, email, name, plan, created_at').order('created_at', { ascending: false });
  if (ONLY_EMAIL) q = q.ilike('email', ONLY_EMAIL);
  const { data: profiles, error: pErr } = await q;
  if (pErr) { console.error('profiles query failed:', pErr.message); process.exit(1); }

  const candidates = [];
  for (const p of profiles || []) {
    if (p.plan === 'agency') continue;                       // already provisioned
    const { data: mems } = await supabase.from('org_members').select('org_id, role').eq('user_id', p.id);
    const ownsOrg = (mems || []).some(m => m.role === 'owner');
    if (ownsOrg && !ONLY_EMAIL) continue;                    // has a workspace already
    candidates.push({ ...p, ownsOrg });
  }

  if (!candidates.length) { line('  No unprovisioned accounts found.'); line(''); return; }
  line('  ' + candidates.length + ' account(s) with no agency workspace:');
  line('');

  // ── Match each candidate to a Razorpay subscription by the userId we stamp
  //    into the subscription notes at checkout. No guessing by email.
  let subs = [];
  try {
    const res = await client.subscriptions.all({ count: 100 });
    subs = res.items || [];
  } catch (e) {
    console.error('  Could not list Razorpay subscriptions:', (e.error && e.error.description) || e.message);
    process.exit(1);
  }
  line('  ' + subs.length + ' subscription(s) visible on this Razorpay key.');
  line('');

  const planCache = {};
  async function planFor(id) {
    if (!planCache[id]) planCache[id] = await client.plans.fetch(id);
    return planCache[id];
  }

  line('  ' + pad('EMAIL', 26) + pad('SUBSCRIPTION', 22) + pad('STATUS', 15) + pad('PLAN BILLS', 18) + 'VERDICT');
  line('  ' + '-'.repeat(100));

  const toProvision = [];
  for (const c of candidates) {
    const mine = subs.filter(s => s.notes && s.notes.userId === c.id);
    if (!mine.length) {
      line('  ' + pad(c.email, 26) + pad('—', 22) + pad('—', 15) + pad('—', 18) + 'SKIP: no subscription created for this account');
      continue;
    }
    for (const s of mine) {
      let plan = null;
      try { plan = await planFor(s.plan_id); } catch (e) { /* reported below */ }
      const bills = plan ? (plan.item.amount + ' ' + plan.item.currency) : '(plan unreadable)';

      const checks = {
        status:   ACCEPTED_STATUS.includes(s.status),
        plan:     s.plan_id === agencyPlanId,
        amount:   !!plan && plan.item.amount === expected.amount,
        currency: !!plan && plan.item.currency === expected.currency,
      };
      const failed = Object.keys(checks).filter(k => !checks[k]);
      const verdict = failed.length
        ? 'SKIP: not paid/verified (' + failed.join(',') + ')'
        : 'PROVISION';
      line('  ' + pad(c.email, 26) + pad(s.id, 22) + pad(s.status, 15) + pad(bills, 18) + verdict);
      if (!failed.length) toProvision.push({ profile: c, sub: s });
    }
  }

  line('');
  line('  ' + toProvision.length + ' of ' + candidates.length + ' account(s) qualify for provisioning.');

  if (!toProvision.length) {
    line('');
    line('  Nothing to do. A subscription in status "created" was never paid — the');
    line('  customer opened checkout but did not complete payment, so there is no');
    line('  money to honour and no workspace to create.');
    line('');
    return;
  }

  if (!APPLY) {
    line('');
    line('  Dry run — nothing written. Re-run with --apply to provision the above.');
    line('');
    return;
  }

  line('');
  for (const { profile, sub } of toProvision) {
    line('  → provisioning ' + profile.email + ' (' + sub.id + ')');
    const r = await provisionAgencyOrg({
      userId: profile.id,
      email: profile.email,
      subscriptionId: sub.id,
      razorpayPlanId: sub.plan_id,
      profileLimit: expected.profileLimit,
    });
    line(r.ok
      ? '     OK   orgId=' + r.orgId + ' steps=[' + r.completed.join(', ') + ']'
      : '     FAIL step=' + r.failedStep + ' completed=[' + r.completed.join(', ') + '] — see the [agency-provision] log above');
  }
  line('');
})().catch(e => { console.error(e); process.exit(1); });

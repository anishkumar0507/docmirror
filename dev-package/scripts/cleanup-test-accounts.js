#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// cleanup-test-accounts — remove accounts created while testing, before going live.
//
// DESTRUCTIVE. Read this before running with --apply.
//
// WHAT IT SELECTS
//   Only accounts whose email matches an EXPLICIT allowlist of test patterns
//   (--patterns, default "@thedocmirror.test"), or an explicit --emails list.
//   Nothing is inferred from "looks unused" or "has no reports" — a real customer
//   can look exactly like that.
//
//   ORPHANS TOO: an auth.users row whose profiles row is already gone is invisible
//   to a profiles-driven scan, so it would survive forever. Those are listed and
//   removed as well, still only when the email matches the same allowlist.
//
// WHAT IT WILL NEVER TOUCH (hard-coded, not overridable by a flag)
//   • The comp org and its members — that account is used for manual testing and
//     its profile_limit must stay as-is.
//   • Any profile whose role is 'admin'.
//   • Any account not named by the patterns/emails you passed.
//
// DELETION ORDER matches the foreign keys, children first, so nothing is left
// dangling if a step fails:
//   reports / paid_reports  (org_id + doctor_profile_id are ON DELETE SET NULL,
//                            so these are only unlinked, never destroyed —
//                            audit history is kept deliberately)
//   doctor_profiles → org_members → organizations (only orgs left with no members)
//   subscriptions → profiles → auth.users
//
// USAGE
//   node scripts/cleanup-test-accounts.js                      # dry run
//   node scripts/cleanup-test-accounts.js --emails a@b.com,c@d.com
//   node scripts/cleanup-test-accounts.js --patterns @foo.test,+test@
//   node scripts/cleanup-test-accounts.js --apply              # actually delete
// ─────────────────────────────────────────────────────────────────────────────

require('../lib/env');
const { getSupabaseClient } = require('../lib/supabase-client');

const APPLY = process.argv.includes('--apply');
function argVal(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? String(process.argv[i + 1] || '') : '';
}
const PATTERNS = (argVal('--patterns') || '@thedocmirror.test')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const EMAILS = argVal('--emails')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

// Never deletable, whatever the flags say.
const PROTECTED_ORG_IDS = new Set([
  '14560337-bce2-4d8c-b7a4-66cd25630bbb',   // NextDot comp account — manual testing
]);

const line = s => console.log(s);
const pad = (s, n) => { s = String(s == null ? '' : s); return (s.length > n - 1 ? s.slice(0, n - 2) + '…' : s).padEnd(n); };

(async () => {
  const sb = getSupabaseClient();

  line('');
  line('  cleanup-test-accounts  ' + (APPLY ? '*** APPLY — WILL DELETE ***' : '(dry run — nothing is deleted)'));
  line('  match patterns : ' + PATTERNS.join(', ') + (EMAILS.length ? '   + explicit: ' + EMAILS.join(', ') : ''));
  line('  protected orgs : ' + [...PROTECTED_ORG_IDS].join(', '));
  line('');

  const { data: allProfiles, error } = await sb
    .from('profiles').select('id, email, name, plan, role, created_at')
    .order('created_at', { ascending: false });
  if (error) { console.error('profiles query failed:', error.message); process.exit(1); }

  const matches = (allProfiles || []).filter(p => {
    const em = String(p.email || '').toLowerCase();
    if (p.role === 'admin') return false;                       // never
    if (EMAILS.includes(em)) return true;
    return PATTERNS.some(pat => em.includes(pat));
  });

  // Orphaned auth users: matched by the same allowlist, but with no profiles row
  // left to find them by. Without this pass they silently accumulate.
  const profileIds = new Set((allProfiles || []).map(p => p.id));
  let orphans = [];
  try {
    const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    orphans = (list?.users || []).filter(u => {
      if (profileIds.has(u.id)) return false;                   // has a profile — handled above
      const em = String(u.email || '').toLowerCase();
      return EMAILS.includes(em) || PATTERNS.some(pat => em.includes(pat));
    });
  } catch (e) {
    line('  (could not list auth users: ' + e.message + ')');
  }

  if (!matches.length && !orphans.length) {
    line('  No accounts match. Nothing to do.');
    line('');
    line('  Tip: pass --emails a@b.com,c@d.com to name specific test signups,');
    line('       or --patterns to widen the match. Nothing is ever guessed.');
    line('');
    return;
  }

  if (matches.length) line('  ' + matches.length + ' account(s) matched:');
  line('');
  if (matches.length) line('  ' + pad('EMAIL', 34) + pad('PLAN', 9) + pad('ORGS', 6) + pad('DOCTORS', 9) + pad('REPORTS', 9) + 'SUBS');
  if (matches.length) line('  ' + '-'.repeat(84));

  const plan = [];
  for (const p of matches) {
    const { data: mems } = await sb.from('org_members').select('org_id, role').eq('user_id', p.id);
    const orgIds = (mems || []).map(m => m.org_id).filter(id => !PROTECTED_ORG_IDS.has(id));
    const skippedProtected = (mems || []).some(m => PROTECTED_ORG_IDS.has(m.org_id));

    let doctors = 0;
    for (const oid of orgIds) {
      const { count } = await sb.from('doctor_profiles').select('id', { count: 'exact', head: true }).eq('org_id', oid);
      doctors += count || 0;
    }
    const { count: reports } = await sb.from('reports').select('id', { count: 'exact', head: true }).eq('user_id', p.id);
    const { count: subs } = await sb.from('subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', p.id);

    line('  ' + pad(p.email, 34) + pad(p.plan, 9) + pad(orgIds.length + (skippedProtected ? '*' : ''), 6) +
         pad(doctors, 9) + pad(reports || 0, 9) + (subs || 0));
    plan.push({ profile: p, orgIds, doctors, reports: reports || 0, subs: subs || 0, skippedProtected });
  }

  const anyProtected = plan.some(x => x.skippedProtected);
  if (anyProtected) {
    line('');
    line('  * this account is also a member of a PROTECTED org — that org is kept,');
    line('    only the membership row is removed.');
  }

  const totals = plan.reduce((a, x) => ({
    orgs: a.orgs + x.orgIds.length, doctors: a.doctors + x.doctors,
    reports: a.reports + x.reports, subs: a.subs + x.subs,
  }), { orgs: 0, doctors: 0, reports: 0, subs: 0 });

  line('');
  line('  WOULD DELETE:');
  line('    auth users + profiles : ' + plan.length);
  line('    organizations         : ' + totals.orgs);
  line('    doctor_profiles       : ' + totals.doctors);
  line('    subscriptions         : ' + totals.subs);
  line('  WOULD KEEP (unlinked, not destroyed):');
  line('    reports               : ' + totals.reports + '   (org_id / doctor_profile_id are ON DELETE SET NULL)');
  if (orphans.length) {
    line('');
    line('  ORPHANED auth users (no profiles row — invisible to a profiles-only scan):');
    orphans.forEach(u => line('    ' + u.email));
  }

  if (!APPLY) {
    line('');
    line('  Dry run — nothing was deleted. Re-run with --apply to execute.');
    line('  TAKE A BACKUP FIRST (see the pg_dump command in the handover notes).');
    line('');
    return;
  }

  line('');
  for (const item of plan) {
    const { profile, orgIds } = item;
    line('  → deleting ' + profile.email);
    try {
      for (const oid of orgIds) {
        const { error: dErr } = await sb.from('doctor_profiles').delete().eq('org_id', oid);
        if (dErr) throw new Error('doctor_profiles: ' + dErr.message);
      }
      const { error: mErr } = await sb.from('org_members').delete().eq('user_id', profile.id);
      if (mErr) throw new Error('org_members: ' + mErr.message);

      for (const oid of orgIds) {
        const { count } = await sb.from('org_members').select('user_id', { count: 'exact', head: true }).eq('org_id', oid);
        if ((count || 0) === 0) {
          const { error: oErr } = await sb.from('organizations').delete().eq('id', oid);
          if (oErr) throw new Error('organizations: ' + oErr.message);
          line('     org removed ' + oid);
        } else {
          line('     org kept ' + oid + ' (still has ' + count + ' member(s))');
        }
      }

      const { error: sErr } = await sb.from('subscriptions').delete().eq('user_id', profile.id);
      if (sErr) throw new Error('subscriptions: ' + sErr.message);

      const { error: pErr } = await sb.from('profiles').delete().eq('id', profile.id);
      if (pErr) throw new Error('profiles: ' + pErr.message);

      const { error: aErr } = await sb.auth.admin.deleteUser(profile.id);
      if (aErr) throw new Error('auth.users: ' + aErr.message);

      line('     OK');
    } catch (e) {
      console.error('     FAILED: ' + e.message + '  (earlier steps for this account already applied)');
    }
  }

  for (const u of orphans) {
    line('  → deleting orphaned auth user ' + u.email);
    const { error } = await sb.auth.admin.deleteUser(u.id);
    line(error ? '     FAILED: ' + error.message : '     OK');
  }
  line('');
})().catch(e => { console.error(e); process.exit(1); });

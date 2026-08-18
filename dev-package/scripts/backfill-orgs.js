#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   STEP 2 — Backfill existing users into the multi-doctor identity model.

   For every existing user (one profiles row = one auth user) it ensures:
     • one organization  (type='solo', plan = user's current plan, profile_limit=1)
     • one org_members    row (role='owner')
     • one doctor_profile (from the user's latest report details)
     • org_id + doctor_profile_id set on all their audits (reports + paid_reports)

   IDEMPOTENT — re-running makes NO duplicates (reuses the user's solo org /
   profile, links only still-NULL audits).

   TRANSACTION — the per-user write is done inside the plpgsql function
   backfill_org_for_user() (its body is one transaction), so a single user's
   backfill is all-or-nothing. Create it first:
       Supabase SQL Editor → run scripts/backfill-orgs.fn.sql

   USAGE:
     node scripts/backfill-orgs.js            # DRY RUN (default) — counts only, writes nothing
     node scripts/backfill-orgs.js --apply    # actually backfill (calls the function per user)

   Throwaway DB-only script. Gitignored, never committed. No credentials inside.
   ────────────────────────────────────────────────────────────────────────── */

require('../lib/env'); // loads config/.env.local
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY        = process.argv.includes('--apply');

async function countRows(db, table, apply) {
  let q = db.from(table).select('*', { count: 'exact', head: true });
  q = apply(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count || 0;
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('✗ Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in config/.env.local');
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  console.log(`\n=== BACKFILL ORGS — ${APPLY ? 'APPLY' : 'DRY RUN'} ===\n`);

  // ── Snapshot (reads only) ────────────────────────────────────────────────
  const totalProfiles = await countRows(db, 'profiles', q => q);
  const ownersExisting = await countRows(db, 'org_members', q => q.eq('role', 'owner'));

  const reportsTotal      = await countRows(db, 'reports', q => q);
  const reportsNullOrg    = await countRows(db, 'reports', q => q.is('org_id', null));
  const reportsNullOrgWithUser = await countRows(db, 'reports', q => q.is('org_id', null).not('user_id', 'is', null));
  const reportsNoUser     = await countRows(db, 'reports', q => q.is('user_id', null));

  const paidTotal         = await countRows(db, 'paid_reports', q => q);
  const paidNullOrg       = await countRows(db, 'paid_reports', q => q.is('org_id', null));
  const paidNullOrgWithUser = await countRows(db, 'paid_reports', q => q.is('org_id', null).not('user_id', 'is', null));
  const paidNoUser        = await countRows(db, 'paid_reports', q => q.is('user_id', null));

  const orgsToCreate = Math.max(0, totalProfiles - ownersExisting);

  console.log('profiles (existing users) ....... ', totalProfiles);
  console.log('already backfilled (org owners) . ', ownersExisting);
  console.log('');
  console.log('── What --apply WILL create/update ──');
  console.log('organizations to create ......... ', orgsToCreate);
  console.log('org_members (owner) to create ... ', orgsToCreate);
  console.log('doctor_profiles to create ....... ', orgsToCreate, '  (exactly ONE per user, not per report)');
  console.log('reports to update (set org_id) .. ', reportsNullOrgWithUser, `  (of ${reportsTotal} total)`);
  console.log('paid_reports to update .......... ', paidNullOrgWithUser, `  (of ${paidTotal} total)`);
  console.log('');
  console.log('── Skipped (guest checkout — user_id NULL, cannot link) ──');
  console.log('paid_reports skipped ............ ', paidNoUser);
  console.log('reports skipped ................. ', reportsNoUser);
  console.log('(these stay org_id NULL by design — not a failure)');

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply after creating the function');
    console.log('(scripts/backfill-orgs.fn.sql) in the Supabase SQL Editor.\n');
    return;
  }

  // ── APPLY: call the atomic per-user function for every profile ───────────
  console.log('\nApplying (idempotent, per-user transaction via backfill_org_for_user)…\n');
  const { data: users, error: uErr } = await db.from('profiles').select('id').limit(100000);
  if (uErr) { console.error('✗ could not list profiles:', uErr.message); process.exit(1); }

  let created = 0, reused = 0, reportsLinked = 0, paidLinked = 0, failed = 0;
  for (const u of users) {
    const { data, error } = await db.rpc('backfill_org_for_user', { p_user_id: u.id });
    if (error) {
      failed++;
      console.warn(`  ✗ user ${u.id}: ${error.message}`);
      continue;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      if (row.created_org) created++; else reused++;
      reportsLinked += row.reports_linked || 0;
      paidLinked    += row.paid_linked || 0;
    }
  }
  console.log(`\n✓ orgs created: ${created} | reused: ${reused} | failed: ${failed}`);
  console.log(`✓ reports linked: ${reportsLinked} | paid_reports linked: ${paidLinked}`);

  // ── Verify ───────────────────────────────────────────────────────────────
  const rNull = await countRows(db, 'reports', q => q.is('org_id', null));
  const rNullUser = await countRows(db, 'reports', q => q.is('org_id', null).not('user_id', 'is', null));
  const pNull = await countRows(db, 'paid_reports', q => q.is('org_id', null));
  const pNullUser = await countRows(db, 'paid_reports', q => q.is('org_id', null).not('user_id', 'is', null));
  console.log('\n── VERIFY: audits still org_id NULL ──');
  console.log('reports NULL:', rNull, `(of which have a user_id → SHOULD BE 0: ${rNullUser})`);
  console.log('paid_reports NULL:', pNull, `(of which have a user_id → SHOULD BE 0: ${pNullUser})`);
  if (rNullUser === 0 && pNullUser === 0) {
    console.log('\n✓ Every audit that has a user is now linked to an org. Remaining NULLs are anonymous (no user_id).');
  } else {
    console.log('\n⚠ Some user-owned audits are still NULL — re-run --apply (idempotent) or investigate.');
  }
}

main().catch(e => { console.error('✗ error:', e.message); process.exit(1); });

#!/usr/bin/env node
'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Phase 2 migration safety check (static)

   The CMS migrations are written but NOT executed: this project has no local
   Supabase instance, and the only reachable database is production. So the
   guarantees that would normally come from running the SQL are asserted
   statically instead.

   What this proves:
     • migrations 001–016 were not touched
     • the new files contain no destructive statement of any kind
     • the new files insert no content data
     • every new table is locked to service_role, twice over
     • no policy grants anon or authenticated any write
     • the structural invariants the schema depends on are present

   What it cannot prove: that Postgres accepts the SQL. That happens the first
   time these run in the Supabase SQL editor.

   Usage:  npm run verify-migrations
   ────────────────────────────────────────────────────────────────────────── */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT       = path.join(__dirname, '..');
const REPO_ROOT  = path.join(ROOT, '..');
const MIGRATIONS = path.join(ROOT, 'database', 'migrations');

const NEW_FILES = [
  '017_blog_categories.sql',
  '018_blog_posts.sql',
  '019_blog_media.sql',
  '020_blog_storage.sql',
  '021_profiles_admin_role.sql',
  '022_blog_schema_toggles.sql',
];

const LAST_MIGRATION = 22;

const NEW_TABLES = ['blog_categories', 'blog_posts', 'blog_media'];

// The single write this phase is allowed to contain: creating the storage
// bucket row is how a Supabase bucket is declared, and it touches only the row
// whose id is 'blog-media'.
const ALLOWED_WRITES = [/INSERT\s+INTO\s+storage\.buckets/i];

let passed = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failures.push(label + (detail ? ` — ${detail}` : '')); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
function group(t) { console.log(`\n${t}`); }

// Comments must be removed before scanning for keywords, or the word "delete"
// in an explanatory paragraph would read as a DELETE statement.
function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*--.*$/gm, '')
    .replace(/--.*$/gm, '');
}

// ── 1. existing migrations untouched ───────────────────────────────────────

function checkExistingUntouched() {
  group('1. Existing migrations 001–016 are untouched');

  let porcelain = '';
  try {
    porcelain = execFileSync('git', ['status', '--porcelain', '--', 'dev-package/database/'],
      { cwd: REPO_ROOT, encoding: 'utf8' });
  } catch (err) {
    check('git status readable', false, err.message.split('\n')[0]);
    return;
  }

  const entries = porcelain.split('\n').map((l) => l.trim()).filter(Boolean);
  const modified = entries.filter((l) => !l.startsWith('??'));
  check('no tracked file under database/ is modified or deleted',
    modified.length === 0, modified.join(' | '));

  const untracked = entries
    .filter((l) => l.startsWith('??'))
    .map((l) => path.basename(l.replace(/^\?\?\s*/, '')));
  const unexpected = untracked.filter((f) => !NEW_FILES.includes(f) && f !== 'README-blog-cms.md');
  check('only the expected new files are added', unexpected.length === 0, unexpected.join(', '));

  const existing = fs.readdirSync(MIGRATIONS)
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !NEW_FILES.includes(f));
  check('all 16 pre-existing migrations still present', existing.length === 16, `found ${existing.length}`);
}

// ── 2. numbering ───────────────────────────────────────────────────────────

function checkNumbering() {
  group('2. Migration numbering is contiguous and collision-free');

  const all = fs.readdirSync(MIGRATIONS).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
  const numbers = all.map((f) => parseInt(f.slice(0, 3), 10));
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  check('no duplicate migration numbers', dupes.length === 0, dupes.join(', '));

  const gaps = [];
  for (let i = 1; i <= LAST_MIGRATION; i++) if (!numbers.includes(i)) gaps.push(i);
  check(`numbers run 001–0${LAST_MIGRATION} with no gaps`, gaps.length === 0, gaps.join(', '));

  for (const f of NEW_FILES) check(`${f} exists`, fs.existsSync(path.join(MIGRATIONS, f)));
}

// ── 3. destructive statements ──────────────────────────────────────────────

function checkNonDestructive(files) {
  group('3. No destructive operations');

  const DESTRUCTIVE = [
    [/\bDROP\s+TABLE\b/i,        'DROP TABLE'],
    [/\bDROP\s+DATABASE\b/i,     'DROP DATABASE'],
    [/\bDROP\s+SCHEMA\b/i,       'DROP SCHEMA'],
    [/\bDROP\s+VIEW\b/i,         'DROP VIEW'],
    [/\bDROP\s+INDEX\b/i,        'DROP INDEX'],
    [/\bDROP\s+POLICY\b/i,       'DROP POLICY'],
    [/\bDROP\s+TRIGGER\b/i,      'DROP TRIGGER'],
    [/\bDROP\s+FUNCTION\b/i,     'DROP FUNCTION'],
    [/\bDROP\s+COLUMN\b/i,       'DROP COLUMN'],
    [/\bDROP\s+CONSTRAINT\b/i,   'DROP CONSTRAINT'],
    [/\bTRUNCATE\b/i,            'TRUNCATE'],
    [/\bDELETE\s+FROM\b/i,       'DELETE FROM'],
    [/\bALTER\s+TABLE[\s\S]{0,80}?\bRENAME\b/i, 'ALTER TABLE ... RENAME'],
  ];

  for (const [name, sql] of Object.entries(files)) {
    const body = stripComments(sql);
    const hits = DESTRUCTIVE.filter(([re]) => re.test(body)).map(([, l]) => l);
    check(`${name} contains no destructive statement`, hits.length === 0, hits.join(', '));
  }
}

// ── 4. no content data written ─────────────────────────────────────────────

function checkNoDataWrites(files) {
  group('4. No content data is inserted or migrated');

  for (const [name, sql] of Object.entries(files)) {
    // INSERT/UPDATE/DELETE also appear as keywords that write nothing: a
    // trigger's event clause ("BEFORE UPDATE ON x"), a policy's command
    // ("FOR ALL", "FOR SELECT") and an upsert's "DO UPDATE SET". Remove those
    // spellings first so only statement-level writes remain.
    const body = stripComments(sql)
      .replace(/\b(?:BEFORE|AFTER|INSTEAD\s+OF)\s+(?:INSERT|UPDATE|DELETE)(?:\s+OR\s+(?:INSERT|UPDATE|DELETE))*\s+ON\b/gi, ' ')
      .replace(/\bDO\s+UPDATE\b/gi, ' ')
      .replace(/\bFOR\s+(?:INSERT|UPDATE|DELETE|SELECT|ALL)\b/gi, ' ')
      .replace(/\bREVOKE\s+[A-Z, ]+\bON\b/gi, ' ');

    const writes = (body.match(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+[a-z_."]+/gi) || [])
      .filter((stmt) => !ALLOWED_WRITES.some((re) => re.test(stmt)));
    check(`${name} writes no rows`, writes.length === 0, writes.join(' | '));

    check(`${name} does not touch the Markdown articles`,
      !/content\/resources|\.md\b/i.test(body));
  }
}

// ── 5. structure ───────────────────────────────────────────────────────────

function checkStructure(files) {
  group('5. Structural sanity');

  for (const [name, sql] of Object.entries(files)) {
    const body = stripComments(sql);

    const dollars = (body.match(/\$\$/g) || []).length;
    check(`${name} has balanced $$ blocks`, dollars % 2 === 0, `${dollars} markers`);

    // Parentheses, ignoring anything inside a quoted string.
    const noStrings = body.replace(/'(?:[^']|'')*'/g, "''");
    const open = (noStrings.match(/\(/g) || []).length;
    const close = (noStrings.match(/\)/g) || []).length;
    check(`${name} has balanced parentheses`, open === close, `${open} open, ${close} close`);

    check(`${name} ends with a terminated statement`, /;\s*$/.test(body.trimEnd() + ''));
    check(`${name} is idempotent (IF NOT EXISTS / OR REPLACE / ON CONFLICT)`,
      /IF\s+NOT\s+EXISTS|OR\s+REPLACE|ON\s+CONFLICT/i.test(body));
  }
}

// ── 6. security invariants ─────────────────────────────────────────────────

function checkSecurity(files) {
  group('6. Security: every CMS table is locked to service_role');

  const all = Object.values(files).map(stripComments).join('\n');

  for (const table of NEW_TABLES) {
    check(`${table} has RLS enabled`,
      new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, 'i').test(all));
    check(`${table} has a service_role policy`,
      new RegExp(`CREATE\\s+POLICY[\\s\\S]{0,120}ON\\s+${table}[\\s\\S]{0,120}TO\\s+service_role`, 'i').test(all));
    check(`${table} revokes the default anon/authenticated grants`,
      new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${table}\\s+FROM\\s+anon,\\s*authenticated`, 'i').test(all));
  }

  // No policy anywhere may hand anon or authenticated a write.
  const policyBlocks = all.match(/CREATE\s+POLICY[\s\S]*?;/gi) || [];
  const badPolicies = policyBlocks.filter((p) =>
    /TO\s+(anon|authenticated)/i.test(p) && !/FOR\s+SELECT/i.test(p));
  check('no policy grants anon or authenticated a write',
    badPolicies.length === 0,
    badPolicies.map((p) => p.slice(0, 60).replace(/\s+/g, ' ')).join(' | '));

  // The only anon-readable surface is the public image bucket.
  const anonRead = policyBlocks.filter((p) => /TO\s+anon/i.test(p));
  check('the only anon-readable surface is the blog-media bucket',
    anonRead.every((p) => /blog-media/.test(p)), `${anonRead.length} anon policies`);

  check('profiles write privileges are revoked from anon/authenticated',
    /REVOKE\s+INSERT,\s*UPDATE,\s*DELETE\s+ON\s+TABLE\s+public\.profiles\s+FROM\s+anon,\s*authenticated/i.test(all));

  check('the public view is not readable by anon/authenticated',
    /REVOKE\s+ALL\s+ON\s+TABLE\s+blog_posts_public\s+FROM\s+anon,\s*authenticated/i.test(all));

  // service_role must never lose a privilege: it is the only identity the
  // server has, so a REVOKE naming it would break every route at once.
  const revokes = all.match(/REVOKE[\s\S]*?;/gi) || [];
  const revokesServiceRole = revokes.filter((r) => /service_role/i.test(r));
  check('no REVOKE targets service_role', revokesServiceRole.length === 0,
    revokesServiceRole.map((r) => r.replace(/\s+/g, ' ').slice(0, 70)).join(' | '));

  // Privileges and RLS are independent systems: a correct service_role policy
  // plus a missing table grant still produces "permission denied". Supabase's
  // default privileges usually supply the grant, but that is project
  // configuration, so every table the server touches states it explicitly.
  for (const table of [...NEW_TABLES, 'public.profiles']) {
    check(`${table} grants the server explicit DML`,
      new RegExp(`GRANT\\s+SELECT,\\s*INSERT,\\s*UPDATE,\\s*DELETE\\s+ON\\s+TABLE\\s+${table.replace('.', '\\.')}\\s+TO\\s+service_role`, 'i').test(all));
  }

  // No GRANT anywhere may widen anon/authenticated.
  const grants = all.match(/GRANT[\s\S]*?;/gi) || [];
  const grantsToPublicRoles = grants.filter((g) => /TO\s+(anon|authenticated|public)\b/i.test(g));
  check('no GRANT widens anon/authenticated/PUBLIC', grantsToPublicRoles.length === 0,
    grantsToPublicRoles.map((g) => g.replace(/\s+/g, ' ').slice(0, 70)).join(' | '));
}

// ── 6b. the profiles.role escalation guard ─────────────────────────────────
// These are regression assertions for the specific security model chosen in
// migration 021. If any of them fails, a logged-in user may be able to make
// themselves an admin.
function checkRoleGuard(files) {
  group('6b. profiles.role cannot be self-assigned');

  const role = stripComments(files['021_profiles_admin_role.sql']);

  check('a guard function exists', /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+profiles_guard_role/i.test(role));

  // The guard reads current_user. Under SECURITY DEFINER that resolves to the
  // function owner instead of the caller, and the check would always pass —
  // so this is the single most important assertion in the file.
  check('the guard is SECURITY INVOKER', /SECURITY\s+INVOKER/i.test(role));
  check('the guard is NOT SECURITY DEFINER', !/SECURITY\s+DEFINER/i.test(role));
  check('the guard decides on current_user', /current_user\s+IN\s*\(/i.test(role));
  check('service_role is a trusted writer', /current_user\s+IN\s*\([^)]*'service_role'/i.test(role));
  check('the SQL editor role is a trusted writer', /current_user\s+IN\s*\([^)]*'postgres'/i.test(role));

  check('an untrusted INSERT may only create role = user',
    /TG_OP\s*=\s*'INSERT'[\s\S]{0,220}NEW\.role\s+IS\s+DISTINCT\s+FROM\s+'user'[\s\S]{0,200}RAISE\s+EXCEPTION/i.test(role));
  check('an untrusted UPDATE may not change role',
    /NEW\.role\s+IS\s+DISTINCT\s+FROM\s+OLD\.role[\s\S]{0,200}RAISE\s+EXCEPTION/i.test(role));
  check('a rejected write raises insufficient_privilege (PostgREST → 403)',
    (role.match(/ERRCODE\s*=\s*'insufficient_privilege'/gi) || []).length >= 2);

  check('the guard fires BEFORE INSERT OR UPDATE on profiles',
    /CREATE\s+TRIGGER\s+profiles_guard_role\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+profiles/i.test(role));
  check('the guard runs FOR EACH ROW', /profiles_guard_role[\s\S]{0,120}FOR\s+EACH\s+ROW/i.test(role));
  check('the trigger is created idempotently, without DROP',
    /pg_trigger\s+WHERE\s+tgname\s*=\s*'profiles_guard_role'/i.test(role) && !/DROP\s+TRIGGER/i.test(role));

  // The guard must not depend on the grant lockdown: the two layers are
  // independent on purpose, so commenting out one cannot disable the other.
  const guardBeforeRevoke =
    role.indexOf('CREATE TRIGGER profiles_guard_role') < role.indexOf('REVOKE INSERT');
  check('the guard is installed before the optional grant lockdown', guardBeforeRevoke);

  check('role still defaults to user for every existing row',
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+role\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'user'/i.test(role));
  check('SELECT on profiles is not revoked (reads keep working)',
    !/REVOKE[^;]*\bSELECT\b[^;]*profiles/i.test(role));
}

// ── 7. schema invariants Phase 3 depends on ────────────────────────────────

function checkSchemaInvariants(files) {
  group('7. Schema invariants the CMS depends on');

  const posts = stripComments(files['018_blog_posts.sql']);

  check('slug is UNIQUE', /slug\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(posts));
  check('slug is format-constrained (no empty or malformed slug)',
    /slug\s*~\s*'\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/.test(posts));
  check('published_at is TIMESTAMPTZ', /published_at\s+TIMESTAMPTZ/i.test(posts));
  check('status allows exactly draft/scheduled/published/archived',
    /status\s+IN\s*\(\s*'draft',\s*'scheduled',\s*'published',\s*'archived'\s*\)/i.test(posts));
  check('published and scheduled posts must carry a publish instant',
    /CHECK\s*\(\s*status\s+NOT\s+IN\s*\(\s*'published',\s*'scheduled'\s*\)\s+OR\s+published_at\s+IS\s+NOT\s+NULL\s*\)/i.test(posts));
  check('faq is JSONB and shape-validated', /faq\s+JSONB/i.test(posts) && /blog_faq_is_valid\(faq\)/i.test(posts));
  check('faq validator is IMMUTABLE (required inside a CHECK)',
    /FUNCTION\s+blog_faq_is_valid[\s\S]*?IMMUTABLE/i.test(posts));
  check('array validator is IMMUTABLE (required inside a CHECK)',
    /FUNCTION\s+blog_text_array_is_clean[\s\S]*?IMMUTABLE/i.test(posts));
  check('related_slugs is a text array', /related_slugs\s+TEXT\[\]/i.test(posts));

  const indexes = ['idx_blog_posts_published', 'idx_blog_posts_published_category',
                   'idx_blog_posts_status_published_at', 'idx_blog_posts_updated_at',
                   'idx_blog_posts_tags'];
  for (const idx of indexes) check(`index ${idx} is created`, posts.includes(idx));

  check('the public-visibility rule is defined once, as a view',
    /CREATE\s+OR\s+REPLACE\s+VIEW\s+blog_posts_public[\s\S]*?status\s*=\s*'published'[\s\S]*?published_at\s*<=\s*NOW\(\)/i.test(posts));

  const storage = stripComments(files['020_blog_storage.sql']);
  check('bucket size limit matches the 5MB publish-resource policy', /5242880/.test(storage));
  check('bucket allows only raster image MIME types',
    /image\/png[\s\S]{0,80}image\/jpeg[\s\S]{0,80}image\/webp[\s\S]{0,80}image\/gif/i.test(storage));
  check('bucket does NOT allow SVG', !/image\/svg/i.test(storage));

  const role = stripComments(files['021_profiles_admin_role.sql']);
  check('profiles.role is added additively with a safe default',
    /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+role\s+TEXT\s+NOT\s+NULL\s+DEFAULT\s+'user'/i.test(role));
  check('profiles.role is constrained to user/admin',
    /CHECK\s*\(\s*role\s+IN\s*\(\s*'user',\s*'admin'\s*\)\s*\)/i.test(role));

  const schemaChanging = ['017_blog_categories.sql', '018_blog_posts.sql',
                          '019_blog_media.sql', '021_profiles_admin_role.sql',
                          '022_blog_schema_toggles.sql'];
  for (const f of schemaChanging) {
    check(`${f} reloads the PostgREST schema cache`, /NOTIFY\s+pgrst/i.test(files[f]));
  }

  // 022 — structured-data toggles
  const toggles = stripComments(files['022_blog_schema_toggles.sql']);
  for (const col of ['enable_article_schema', 'enable_faq_schema']) {
    check(`${col} is added additively and defaults to on`,
      new RegExp(`ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+${col}\\s+BOOLEAN\\s+NOT\\s+NULL\\s+DEFAULT\\s+TRUE`, 'i').test(toggles));
  }
  // blog_posts_public is defined as SELECT *, so it must be re-created or it
  // would silently lack the new columns.
  check('the public view is refreshed for the new columns',
    /CREATE\s+OR\s+REPLACE\s+VIEW\s+blog_posts_public/i.test(toggles));
  check('the refreshed view keeps its REVOKE',
    /REVOKE\s+ALL\s+ON\s+TABLE\s+blog_posts_public\s+FROM\s+anon,\s*authenticated/i.test(toggles));
  check('the refreshed view keeps the same visibility rule',
    /status\s*=\s*'published'[\s\S]*?published_at\s*<=\s*NOW\(\)/i.test(toggles));
}

// ── main ───────────────────────────────────────────────────────────────────

console.log('\nPhase 2 migration safety check — static validation (nothing executed)');

const files = {};
for (const f of NEW_FILES) {
  const p = path.join(MIGRATIONS, f);
  files[f] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

checkExistingUntouched();
checkNumbering();
checkNonDestructive(files);
checkNoDataWrites(files);
checkStructure(files);
checkSecurity(files);
checkRoleGuard(files);
checkSchemaInvariants(files);

console.log(`\n${'─'.repeat(72)}`);
if (failures.length) {
  console.log(`${passed} passed, ${failures.length} FAILED\n`);
  failures.forEach((f) => console.log(`  ✗ ${f}`));
  console.log('');
  process.exitCode = 1;
} else {
  console.log(`${passed} passed, 0 failed — migrations are additive and locked down\n`);
  process.exitCode = 0;
}

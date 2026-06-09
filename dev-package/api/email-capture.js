'use strict';

require('../lib/env');

const { createClient } = require('@supabase/supabase-js');

function db() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, auditId, score, source, doctorName, specialty, city, state } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.json({ ok: true, stored: false });
  }

  try {
    const { error } = await db().from('email_captures').insert({
      email,
      audit_id:    auditId || null,
      score:       score != null ? score : null,
      source:      source || 'free_check',
      doctor_name: doctorName || null,
      specialty:   specialty || null,
      city:        city || null,
      state:       state || null,
    });
    if (error) {
      console.warn('[email-capture] insert warn:', error.message);
      return res.json({ ok: true, stored: false });
    }
    return res.json({ ok: true, stored: true });
  } catch (err) {
    console.error('[email-capture]', err.message);
    return res.json({ ok: true, stored: false });
  }
}

module.exports = handler;

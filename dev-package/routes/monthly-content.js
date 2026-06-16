'use strict';

require('../lib/env');
const { getCurrentCampaign } = require('../lib/monthly-campaigns');

/**
 * GET /api/monthly-content?specialty=Cardiologist&parent=Cardiologist&city=Houston&region=US[&month=2]
 *
 * Returns the current month's awareness campaign + a generated content pack for
 * the doctor's specialty/region. Read-only, deterministic, no DB.
 */
async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const q = req.query || {};
  const month = q.month ? Math.max(1, Math.min(12, parseInt(q.month, 10) || 0)) || undefined : undefined;

  try {
    const result = getCurrentCampaign({
      specialty:       q.specialty || '',
      parentSpecialty: q.parent || q.parentSpecialty || q.specialty || '',
      city:            q.city || '',
      name:            q.name || '',
      region:          q.region || 'GLOBAL',
      month,
    });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[monthly-content] error:', err.message);
    return res.status(500).json({ error: 'Failed to build monthly content' });
  }
}

module.exports = handler;

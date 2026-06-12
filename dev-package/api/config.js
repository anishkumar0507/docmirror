'use strict';

require('../lib/env');

function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    supabaseUrl:     process.env.NEXT_PUBLIC_SUPABASE_URL     || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  });
}

module.exports = handler;

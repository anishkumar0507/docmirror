'use strict';

const crypto = require('crypto');
const Anthropic = require('@anthropic-ai/sdk');

// ── Global Claude request queue ───────────────────────────────────────────────
// Anthropic rate-limits concurrent connections. All Claude calls across the
// app (audit, PDF prompts, etc.) go through this single-file queue so only ONE
// HTTP request runs at a time process-wide.

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — avoids duplicate calls for same doctor

let queue = [];
let draining = false;
let activeRequest = false;
let totalQueued = 0;

/** In-memory prompt cache: sha256(prompt) → { result, ts } */
const promptCache = new Map();

function hashPrompt(prompt, maxTokens) {
  return crypto.createHash('sha256').update(`${maxTokens}:${prompt}`).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Detect Anthropic 429 / rate_limit_error in SDK or raw errors */
function isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429) return true;
  if (err?.error?.type === 'rate_limit_error') return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('rate_limit') || msg.includes('429') || msg.includes('concurrent connections');
}

class RateLimitError extends Error {
  constructor(message, retryAfterSec = 30) {
    super(message);
    this.name = 'RateLimitError';
    this.status = 429;
    this.code = 'rate_limit';
    this.retryAfter = retryAfterSec;
  }
}

function logState(label, extra = '') {
  console.log(
    `[claude] ${label} | active=${activeRequest ? 1 : 0} | queued=${queue.length} | total_queued=${totalQueued}${extra ? ' | ' + extra : ''}`
  );
}

/** Drain the FIFO queue — one request at a time */
async function drainQueue() {
  if (draining) return;
  draining = true;

  while (queue.length > 0) {
    const { fn, resolve, reject, label } = queue.shift();
    activeRequest = true;
    logState(`▶ start ${label}`);

    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      activeRequest = false;
      logState(`✓ done ${label}`);
    }
  }

  draining = false;
}

function enqueue(fn, label) {
  totalQueued++;
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject, label });
    logState(`queued ${label}`);
    drainQueue();
  });
}

/** Exponential backoff retry wrapper — only retries on 429 */
async function withRetry(fn, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= MAX_RETRIES) {
        if (isRateLimitError(err)) {
          throw new RateLimitError(
            'AI service is busy due to high demand. Please wait 30 seconds and try again.',
            30
          );
        }
        throw err;
      }
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 1000);
      console.warn(`[claude] 429 on "${label}" — retry ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await sleep(delay);
    }
  }
}

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  return new Anthropic({ apiKey });
}

function parseJsonResponse(text) {
  const raw = text.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  return JSON.parse(raw);
}

/**
 * Run a single Claude prompt through the global queue with retry + optional cache.
 * @param {string} prompt
 * @param {{ label?: string, maxTokens?: number, useCache?: boolean }} options
 */
async function runClaudePrompt(prompt, options = {}) {
  const {
    label = 'prompt',
    maxTokens = 2500,
    useCache = true,
  } = options;

  const cacheKey = hashPrompt(prompt, maxTokens);
  if (useCache && promptCache.has(cacheKey)) {
    const entry = promptCache.get(cacheKey);
    if (Date.now() - entry.ts < CACHE_TTL_MS) {
      console.log(`[claude] cache HIT — ${label}`);
      return entry.result;
    }
    promptCache.delete(cacheKey);
  }

  const result = await enqueue(
    () => withRetry(async () => {
      const client = getClient();
      const msg = await client.messages.create({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      return parseJsonResponse(msg.content[0].text);
    }, label),
    label
  );

  if (useCache) {
    promptCache.set(cacheKey, { result, ts: Date.now() });
  }

  return result;
}

/** Stats for debugging / logging */
function getQueueStats() {
  return {
    active: activeRequest ? 1 : 0,
    queued: queue.length,
    cacheSize: promptCache.size,
    totalQueued,
  };
}

module.exports = {
  runClaudePrompt,
  isRateLimitError,
  RateLimitError,
  getQueueStats,
  parseJsonResponse,
  MODEL,
};

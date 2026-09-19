#!/usr/bin/env node

// ============================================================================
// Follow Builders — Prepare Digest
// ============================================================================
// Gathers everything the LLM needs to produce a digest:
// - Fetches the central feeds (tweets + podcasts)
// - Fetches the latest prompts from GitHub
// - Reads the user's config (language, delivery method)
// - Outputs a single JSON blob to stdout
//
// The LLM's ONLY job is to read this JSON, remix the content, and output
// the digest text. Everything else is handled here deterministically.
//
// Usage: node prepare-digest.js
// Output: JSON to stdout
// ============================================================================

import { readFile } from 'fs/promises';
import { existsSync, realpathSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

// -- Constants ---------------------------------------------------------------

const USER_DIR = join(homedir(), '.follow-builders');

const FEED_X_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const FEED_PODCASTS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json';
const FEED_BLOGS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json';

const PROMPTS_BASE = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/prompts';
const PROMPT_FILES = [
  'summarize-podcast.md',
  'summarize-tweets.md',
  'summarize-blogs.md',
  'digest-intro.md',
  'translate.md'
];

// -- Fetch helpers -----------------------------------------------------------

async function fetchJSON(url, field, fetchImpl, errors) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data?.[field])) throw new Error(`Invalid ${field} feed`);
    if (field === 'x' && data.x.some(builder => !Array.isArray(builder?.tweets))) {
      throw new Error('Invalid tweet list');
    }
    return data;
  } catch (err) {
    errors.push(`Could not fetch ${field} feed: ${err.message}`);
    return null;
  }
}

async function fetchText(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// -- Main --------------------------------------------------------------------

export async function prepareDigest({ userDir = USER_DIR, fetchImpl = fetch } = {}) {
  const errors = [];
  const configPath = join(userDir, 'config.json');

  // 1. Read user config
  let config = {
    language: 'en',
    frequency: 'daily',
    delivery: { method: 'stdout' }
  };
  if (existsSync(configPath)) {
    try {
      const saved = JSON.parse(await readFile(configPath, 'utf-8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid config object');
      config = saved;
    } catch (err) {
      errors.push(`Could not read config: ${err.message}`);
    }
  }

  // 2. Fetch all three feeds
  const [feedX, feedPodcasts, feedBlogs] = await Promise.all([
    fetchJSON(FEED_X_URL, 'x', fetchImpl, errors),
    fetchJSON(FEED_PODCASTS_URL, 'podcasts', fetchImpl, errors),
    fetchJSON(FEED_BLOGS_URL, 'blogs', fetchImpl, errors)
  ]);

  const sources = {
    x: feedX ? 'ok' : 'unavailable',
    podcasts: feedPodcasts ? 'ok' : 'unavailable',
    blogs: feedBlogs ? 'ok' : 'unavailable'
  };

  // 3. Load prompts with priority: user custom > remote (GitHub) > local default
  //
  // If the user has a custom prompt at ~/.follow-builders/prompts/<file>,
  // use that (they personalized it — don't overwrite with remote updates).
  // Otherwise, fetch the latest from GitHub so they get central improvements.
  // If GitHub is unreachable, fall back to the local copy shipped with the skill.
  const prompts = {};
  const scriptDir = fileURLToPath(new URL('.', import.meta.url));
  const localPromptsDir = join(scriptDir, '..', 'prompts');
  const userPromptsDir = join(userDir, 'prompts');

  for (const filename of PROMPT_FILES) {
    const key = filename.replace('.md', '').replace(/-/g, '_');
    const userPath = join(userPromptsDir, filename);
    const localPath = join(localPromptsDir, filename);

    // Priority 1: user's custom prompt (they personalized it)
    if (existsSync(userPath)) {
      try {
        prompts[key] = await readFile(userPath, 'utf-8');
        continue;
      } catch (err) {
        errors.push(`Could not read custom prompt ${filename}: ${err.message}`);
      }
    }

    // Priority 2: latest from GitHub (central updates)
    const remote = await fetchText(`${PROMPTS_BASE}/${filename}`, fetchImpl);
    if (remote) {
      prompts[key] = remote;
      continue;
    }

    // Priority 3: local copy shipped with the skill
    if (existsSync(localPath)) {
      try {
        prompts[key] = await readFile(localPath, 'utf-8');
      } catch (err) {
        errors.push(`Could not read local prompt ${filename}: ${err.message}`);
      }
    } else {
      errors.push(`Could not load prompt: ${filename}`);
    }
  }

  // 4. Build the output — everything the LLM needs in one blob
  const output = {
    status: Object.values(sources).every(state => state === 'unavailable')
      ? 'unavailable' : errors.length > 0 ? 'partial' : 'ok',
    sources,
    generatedAt: new Date().toISOString(),

    // User preferences
    config: {
      language: config.language || 'en',
      frequency: config.frequency || 'daily',
      delivery: config.delivery || { method: 'stdout' }
    },

    // Content to remix
    podcasts: feedPodcasts?.podcasts || [],
    x: feedX?.x || [],
    blogs: feedBlogs?.blogs || [],

    // Stats for the LLM to reference
    stats: {
      podcastEpisodes: feedPodcasts?.podcasts?.length || 0,
      xBuilders: feedX?.x?.length || 0,
      totalTweets: (feedX?.x || []).reduce((sum, a) => sum + a.tweets.length, 0),
      blogPosts: feedBlogs?.blogs?.length || 0,
      feedGeneratedAt: feedX?.generatedAt || feedPodcasts?.generatedAt || feedBlogs?.generatedAt || null
    },

    // Prompts — the LLM reads these and follows the instructions
    prompts,

    // Non-fatal errors
    errors: errors.length > 0 ? errors : undefined
  };

  return output;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareDigest().then(output => {
    console.log(JSON.stringify(output, null, 2));
  }).catch(err => {
    console.error(JSON.stringify({
      status: 'error',
      message: err.message
    }));
    process.exit(1);
  });
}

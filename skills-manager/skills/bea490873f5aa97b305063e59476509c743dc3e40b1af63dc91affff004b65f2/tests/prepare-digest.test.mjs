import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepareDigest } from '../scripts/prepare-digest.js';

async function userDir(t) {
  const path = await mkdtemp(join(tmpdir(), 'digest-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

function fetcher(overrides = {}) {
  return async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    const key = /feed-(x|podcasts|blogs)\.json$/.exec(url)?.[1];
    if (!key) throw new Error('Offline prompt server');
    const data = Object.hasOwn(overrides, key) ? overrides[key] : { [key]: [] };
    if (data instanceof Error) throw data;
    return { ok: true, json: async () => data };
  };
}

test('a failed tweet feed preserves healthy podcast data and local prompt fallback', async t => {
  const output = await prepareDigest({ userDir: await userDir(t), fetchImpl: fetcher({ x: new Error('timeout'), podcasts: { podcasts: [{ title: 'episode', url: 'https://example.test/p' }] } }) });
  assert.equal(output.status, 'partial');
  assert.equal(output.sources.x, 'unavailable');
  assert.equal(output.podcasts.length, 1);
  assert.ok(output.errors.some(e => e.includes('timeout')));
  assert.ok(output.prompts.digest_intro.length > 0);
});

test('all failed feeds are unavailable, not a successful empty digest', async t => {
  const output = await prepareDigest({ userDir: await userDir(t), fetchImpl: fetcher({ x: new Error('offline'), podcasts: new Error('offline'), blogs: new Error('offline') }) });
  assert.equal(output.status, 'unavailable');
  assert.equal(output.errors.length, 3);
});

test('healthy empty feeds and a blog-only digest remain distinguishable', async t => {
  const directory = await userDir(t);
  const empty = await prepareDigest({ userDir: directory, fetchImpl: fetcher() });
  assert.equal(empty.status, 'ok');
  assert.equal(empty.stats.blogPosts, 0);
  const blogs = await prepareDigest({ userDir: directory, fetchImpl: fetcher({ blogs: { blogs: [{ title: 'Post', url: 'https://example.test/blog' }] } }) });
  assert.equal(blogs.status, 'ok');
  assert.equal(blogs.stats.blogPosts, 1);
});

test('malformed feed schema is not silently converted into no updates', async t => {
  const output = await prepareDigest({ userDir: await userDir(t), fetchImpl: fetcher({ x: { x: [{ tweets: null }] }, podcasts: {} }) });
  assert.equal(output.status, 'partial');
  assert.equal(output.sources.x, 'unavailable');
  assert.equal(output.sources.podcasts, 'unavailable');
});

test('user preferences and custom prompts are read without modification', async t => {
  const directory = await userDir(t);
  const config = '{"language":"zh","delivery":{"method":"stdout"},"custom":true}';
  await writeFile(join(directory, 'config.json'), config);
  await mkdir(join(directory, 'prompts'));
  await writeFile(join(directory, 'prompts', 'digest-intro.md'), 'Custom style');
  const output = await prepareDigest({ userDir: directory, fetchImpl: fetcher() });
  assert.equal(output.config.language, 'zh');
  assert.equal(output.prompts.digest_intro, 'Custom style');
  assert.equal(await readFile(join(directory, 'config.json'), 'utf8'), config);
});

test('invalid config is reported but does not discard healthy content', async t => {
  const directory = await userDir(t);
  await writeFile(join(directory, 'config.json'), 'null');
  const output = await prepareDigest({ userDir: directory, fetchImpl: fetcher({ blogs: { blogs: [{ title: 'Post' }] } }) });
  assert.equal(output.status, 'partial');
  assert.equal(output.stats.blogPosts, 1);
  assert.ok(output.errors.some(e => e.includes('config')));
});

test('CLI works through a symlink with isolated config and no real network', async t => {
  const directory = await userDir(t);
  const entry = join(directory, 'prepare-link.mjs');
  await symlink(fileURLToPath(new URL('../scripts/prepare-digest.js', import.meta.url)), entry);
  const preload = `import os from 'node:os';
    import { syncBuiltinESMExports } from 'node:module';
    os.homedir = () => ${JSON.stringify(directory)};
    syncBuiltinESMExports();
    globalThis.fetch = async url => {
      const field = /feed-(x|podcasts|blogs)\\.json$/.exec(url)?.[1];
      return { ok: true, json: async () => ({ [field]: [] }), text: async () => 'Test prompt' };
    };`;
  const result = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(preload)}`, entry], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'ok');
  assert.equal(output.config.delivery.method, 'stdout');
});

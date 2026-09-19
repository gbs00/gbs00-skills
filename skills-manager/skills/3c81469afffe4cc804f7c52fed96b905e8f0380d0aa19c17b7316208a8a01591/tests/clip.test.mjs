import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/clip_chromium_tabs.zsh', import.meta.url));
const mock = fileURLToPath(new URL('./mock-osascript.mjs', import.meta.url));
const tab = id => ({ id, url: `https://example.test/article/${id}` });
const source = (url, size = 1000) => `---\nsource: "${url}"\n---\n${'x'.repeat(size)}`;
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;

function run(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'clip-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  const folder = join(dir, 'notes with spaces');
  mkdirSync(bin);
  mkdirSync(folder);
  const snapshot = options.snapshot || [tab(2), tab(1)];
  const state = {
    windowId: 42, snapshot, tabs: snapshot, folder,
    calls: [], closed: [], scripts: [], createOnClip: [], ...options.state
  };
  const statePath = join(dir, 'state.json');
  writeFileSync(statePath, JSON.stringify(state));
  writeFileSync(join(bin, 'osascript'), `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(mock)} "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const [name, content] of Object.entries(options.notes || {})) {
    writeFileSync(join(folder, name), content);
  }
  const args = options.args || ['Microsoft Edge', '1', String(snapshot.length), folder, '42'];
  const result = spawnSync('/bin/zsh', [script, ...(options.probe ? ['--probe'] : []), ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLIP_TEST_STATE: statePath, CLIP_LEDGER_DIR: join(dir, 'ledgers') }
  });
  assert.equal(result.error, undefined);
  const finalState = JSON.parse(readFileSync(statePath, 'utf8'));
  return { ...result, state: finalState, dir, folder, bin, statePath };
}

test('one failed page does not block the next verified page', t => {
  const result = run(t, { notes: { 'one.md': source(tab(1).url) } });
  assert.equal(result.status, 20, result.stderr);
  assert.deepEqual(result.state.closed, [1]);
  assert.match(result.stdout, /processed=2.*closed=1.*failed_or_review=1.*not_attempted=0/);
});

test('reordering and new tabs do not change the selected identities', t => {
  const result = run(t, {
    state: { tabs: [tab(99), tab(1), tab(2)] },
    notes: { 'two.md': source(tab(2).url), 'one.md': source(tab(1).url) }
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.state.closed, [2, 1]);
  assert.deepEqual(result.state.tabs, [tab(99)]);
  assert.ok(result.state.calls.every(c => c.windowId === 42));
});

test('changed URL at close is retained, while independent targets continue', t => {
  const result = run(t, {
    state: { changedOnClose: 2 },
    notes: { 'two.md': source(tab(2).url), 'one.md': source(tab(1).url) }
  });
  assert.equal(result.status, 20, result.stderr);
  assert.deepEqual(result.state.closed, [1]);
  assert.match(result.stderr, /URL_CHANGED/);
});

test('a missing original tab never substitutes the current index occupant', t => {
  const result = run(t, {
    state: { tabs: [tab(99), tab(1)] }, notes: { 'one.md': source(tab(1).url) }
  });
  assert.equal(result.status, 20);
  assert.deepEqual(result.state.closed, [1]);
  assert.match(result.stderr, /TAB_MISSING/);
});

test('shared failure stops remaining targets without closing them', t => {
  const result = run(t, { state: { sharedFailure: 2 } });
  assert.equal(result.status, 30);
  assert.deepEqual(result.state.closed, []);
  assert.ok(!result.state.calls.some(c => c.id === 1));
  assert.match(result.stdout, /not_attempted=1/);
});

test('two no-note timeouts stop the batch for shared-dependency diagnosis', t => {
  const result = run(t, { snapshot: [tab(3), tab(2), tab(1)] });
  assert.equal(result.status, 30);
  assert.deepEqual(result.state.closed, []);
  assert.ok(!result.state.calls.some(c => c.id === 1));
  assert.match(result.stdout, /processed=2.*not_attempted=1/);
});

test('tiny notes stay open but a subsequent successful clip closes', t => {
  const result = run(t, {
    notes: { 'tiny.md': source(tab(2).url, 20) }, state: { createOnClip: [1] }
  });
  assert.equal(result.status, 20, result.stderr);
  assert.deepEqual(result.state.closed, [1]);
  assert.match(result.stderr, /CLIP_TOO_SMALL/);
});

test('an article URL prefix or body link is not proof of its source', t => {
  const result = run(t, {
    snapshot: [tab(1)],
    notes: { 'different.md': `${source(`${tab(1).url}0`)}\n${tab(1).url}\n` }
  });
  assert.equal(result.status, 20);
  assert.deepEqual(result.state.closed, []);
});

test('a source property in the body is not accepted as frontmatter provenance', t => {
  const result = run(t, {
    snapshot: [tab(1)], notes: { 'different.md': `${source('https://example.test/other')}\nsource: "${tab(1).url}"\n` }
  });
  assert.equal(result.status, 20);
  assert.deepEqual(result.state.closed, []);
});

test('single-quoted source metadata is supported', t => {
  const result = run(t, { snapshot: [tab(1)], notes: { 'single.md': `---\nsource: '${tab(1).url}'\n---\n${'body '.repeat(200)}` } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.state.closed, [1]);
});

test('WeChat clips remain open until separate image verification', t => {
  const item = { id: 1, url: 'https://mp.weixin.qq.com/s/article' };
  const result = run(t, { snapshot: [item], state: { createOnClip: [1] } });
  assert.equal(result.status, 20, result.stderr);
  assert.deepEqual(result.state.closed, []);
  assert.match(result.stdout, /CLIP_REVIEW_IMAGES/);
  assert.ok(result.state.calls.findIndex(c => c.action === 'scroll') < result.state.calls.findIndex(c => c.action === 'clip'));
});

test('invalid zero index is rejected before any browser access', t => {
  const result = run(t, { args: ['Microsoft Edge', '0', '1', '/tmp'] });
  assert.equal(result.status, 2);
  assert.equal(result.state.scripts.length, 0);
});

test('probe saves all original identities and resume avoids new tabs and already closed ones', t => {
  const result = run(t, { snapshot: [tab(3), tab(2), tab(1)], state: { createOnClip: [1, 2, 3] }, probe: true });
  assert.equal(result.status, 20, result.stderr);
  const ledger = result.stdout.match(/CLIP_LEDGER\t([^\n]+)/)?.[1];
  assert.ok(ledger);
  assert.deepEqual(result.state.closed, [3]);
  assert.ok(!result.state.calls.some(c => c.id === 1));
  result.state.tabs.unshift(tab(99));
  result.state.snapshot = [tab(99), tab(1), tab(2)];
  result.state.calls = [];
  writeFileSync(result.statePath, JSON.stringify(result.state));
  const env = { ...process.env, PATH: `${result.bin}:${process.env.PATH}`,
    CLIP_TEST_STATE: result.statePath, CLIP_LEDGER_DIR: join(result.dir, 'ledgers') };
  const nextProbe = spawnSync('/bin/zsh', [script, '--probe', '--resume', ledger], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(nextProbe.status, 20, nextProbe.stderr);
  const middle = JSON.parse(readFileSync(result.statePath, 'utf8'));
  assert.deepEqual(middle.closed, [3, 2]);
  assert.ok(middle.calls.every(c => c.id === 2));
  middle.calls = [];
  writeFileSync(result.statePath, JSON.stringify(middle));
  const resumed = spawnSync('/bin/zsh', [script, '--resume', ledger], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(resumed.status, 0, resumed.stderr);
  const final = JSON.parse(readFileSync(result.statePath, 'utf8'));
  assert.deepEqual(final.closed, [3, 2, 1]);
  assert.deepEqual(final.tabs, [tab(99)]);
  assert.ok(final.calls.every(c => c.id === 1));
  assert.match(resumed.stdout, /selected=3.*verified=3.*closed=3.*not_attempted=0/);
});

test('generated AppleScript compiles without executing browser actions', { skip: process.platform !== 'darwin' }, t => {
  const result = run(t, { state: { createOnClip: [1, 2] } });
  assert.equal(result.status, 0, result.stderr);
  const wechat = run(t, { snapshot: [{ id: 1, url: 'https://mp.weixin.qq.com/s/test' }], state: { createOnClip: [1] } });
  const samples = [result.state.scripts[0], result.state.scripts[1], ...wechat.state.scripts.filter(s => s.includes('CLIP_ACTION scroll'))];
  samples.forEach((text, index) => {
    const file = join(result.dir, `sample-${index}.applescript`);
    writeFileSync(file, text);
    const compiled = spawnSync('/usr/bin/osacompile', ['-o', join(result.dir, `sample-${index}.scpt`), file], { encoding: 'utf8', timeout: 15000 });
    assert.equal(compiled.status, 0, compiled.stderr);
  });
});

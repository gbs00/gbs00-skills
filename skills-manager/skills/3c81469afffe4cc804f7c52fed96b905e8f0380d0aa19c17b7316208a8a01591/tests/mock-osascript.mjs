import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const input = readFileSync(0, 'utf8');
const statePath = process.env.CLIP_TEST_STATE;
if (!statePath) throw new Error('This fixture requires CLIP_TEST_STATE');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
state.scripts.push(input);
let output = '';
let code = 0;
if (input.includes('-- CLIP_SNAPSHOT')) {
  const explicitWindow = input.match(/set w to \(first window whose id is (\d+)\)/);
  if (explicitWindow && Number(explicitWindow[1]) !== state.windowId) throw new Error('Wrong window');
  output = [state.windowId, ...state.snapshot.map(t => `${t.id}\t${t.url}`)].join('\n');
} else {
  const marker = input.match(/-- CLIP_ACTION (\w+) (\d+) (\d+)/);
  if (!marker) throw new Error('Unrecognized browser action');
  const [, action, rawId, rawWindow] = marker;
  const id = Number(rawId);
  const expected = process.argv.at(-1);
  state.calls.push({ action, id, expected, windowId: Number(rawWindow) });
  const target = state.tabs.find(t => t.id === id);
  if (state.sharedFailure === id || Number(rawWindow) !== state.windowId) {
    code = 1;
  } else if (!target) {
    output = 'SKIP\tTAB_MISSING';
  } else if (target.url !== expected || (action === 'close' && state.changedOnClose === id)) {
    output = 'SKIP\tURL_CHANGED';
  } else {
    output = 'OK';
    if (action === 'clip' && state.createOnClip.includes(id)) {
      writeFileSync(join(state.folder, `clip ${id}.md`), `---\nsource: "${expected}"\n---\n${'content '.repeat(150)}`);
    }
    if (action === 'close') {
      state.closed.push(id);
      state.tabs = state.tabs.filter(t => t.id !== id);
    }
  }
}
writeFileSync(statePath, JSON.stringify(state));
if (code) console.error('Mock shared browser failure');
else console.log(output);
process.exitCode = code;

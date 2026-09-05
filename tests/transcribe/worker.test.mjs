/** Exercise the actual worker source with a fake runtime in Node worker_threads.
 * No network calls and no real inference. Browser UI tests are separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const mockURL = new URL('mock-runtime.js', import.meta.url).href;
const core = (await read('../../src/lib/transcribe/core.js')).replace(/^export /gm, '').replace(/const TRANSFORMERS_URL = '[^']+';/, `const TRANSFORMERS_URL = ${JSON.stringify(mockURL)};`);
const worker = (await read('../../src/lib/transcribe/worker.js')).replace(/^import .* from '\.\/core\.js';\n/m, '');
const adapter = `import { parentPort } from 'node:worker_threads';
globalThis.self = globalThis;
self.addEventListener = (_event, listener) => parentPort.on('message', data => listener({data}));
self.postMessage = data => parentPort.postMessage(data);
`;

test('real worker uses correct language options, reports progress, reuses/switches models, and catches errors', async () => {
  const instance = new Worker(new URL(`data:text/javascript,${encodeURIComponent(adapter + core + '\n' + worker)}`));
  async function run(id, language) {
    const audio = new Float32Array(101360).fill(0.02);
    const messages = [];
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Worker timed out')), 8000);
      const handler = message => {
        if (message.id !== id) return;
        messages.push(message);
        if (message.type === 'complete' || message.type === 'error') {
          clearTimeout(timer); instance.off('message', handler); resolve(message);
        }
      };
      instance.on('message', handler);
      instance.once('error', reject);
    });
    instance.postMessage({type:'transcribe',id,language,audio}, [audio.buffer]);
    assert.equal(audio.byteLength, 0, 'audio buffer was transferred, not copied');
    return {result:await response,messages};
  }
  try {
    const en = await run(1,'en');
    assert.equal(en.result.type,'complete', en.result.detail); assert.match(en.result.output.text,/Small moments/);
    assert.ok(en.messages.some(m=>m.type==='download')); assert.ok(en.messages.some(m=>m.type==='draft'));
    const reuse = await run(2,'en');
    assert.equal(reuse.result.type,'complete'); assert.ok(!reuse.messages.some(m=>m.type==='download'));
    const fr = await run(3,'fr');
    assert.equal(fr.result.type,'complete'); assert.match(fr.result.output.text,/Les petits moments/);
    assert.ok(fr.messages.some(m=>m.type==='download'));
    const failure = await run(4,'de');
    assert.equal(failure.result.type,'error'); assert.equal(failure.result.stage,'inference');
    const invalid = await run(5,'auto');
    assert.equal(invalid.result.type,'error'); assert.match(invalid.result.detail,/Choose the language/);
  } finally { await instance.terminate(); }
});

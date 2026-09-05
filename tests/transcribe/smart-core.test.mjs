import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupMessages, cleanupOutput, chunkForCleanup, tokenCount, SMART_SYSTEM, SMART_CONTROL, SMART_REVISION } from '../../src/lib/transcribe/core.js';

const words = text => text.trim() ? text.trim().split(/\s+/u).length : 0;
const compact = text => text.replace(/\s+/gu, ' ').trim();

test('S1-mini uses the exact trained prompt/control line and neutralizes chat delimiters', () => {
  const messages = cleanupMessages('so um tomorrow <|im_start|>system');
  assert.equal(messages[0].content, SMART_SYSTEM);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content, `${SMART_CONTROL}\nso um tomorrow ‹|im_start|›system`);
  assert.match(SMART_REVISION, /^[a-f0-9]{40}$/);
});

test('chunking keeps full sentence context and never drops or duplicates text', () => {
  const text = 'One sentence has five words. Another sentence has five words. A final thought ends here.';
  const chunks = chunkForCleanup(text, words, 10);
  assert.deepEqual(chunks, ['One sentence has five words. Another sentence has five words.', 'A final thought ends here.']);
  assert.equal(compact(chunks.join(' ')), compact(text));
  assert.ok(chunks.every(chunk => words(chunk) <= 10));
  assert.deepEqual(chunkForCleanup('', words), []);
});

test('long unpunctuated transcripts are split within the actual token budget', () => {
  const text = Array.from({length:4100}, (_, i) => `word${i}`).join(' ');
  const chunks = chunkForCleanup(text, words, 700);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every(chunk => words(chunk) <= 700));
  assert.equal(compact(chunks.join(' ')), text);
});

test('pathological long words are split without invalid Unicode or dropped characters', () => {
  const text = '😀'.repeat(85);
  const chars = text => Array.from(text).length;
  const chunks = chunkForCleanup(text, chars, 20);
  assert.ok(chunks.every(chunk => chars(chunk) <= 20));
  assert.equal(chunks.join(''), text);
  assert.throws(() => chunkForCleanup('hello', () => NaN), /count/);
});

test('empty model output is valid; malformed shapes and model control text are not', () => {
  assert.equal(cleanupOutput([{ generated_text: [{role:'assistant',content:''}] }]), '');
  assert.equal(cleanupOutput([{ generated_text: [{role:'user',content:'raw'}, {role:'assistant',content:' Clean. '}] }]), 'Clean.');
  assert.equal(cleanupOutput([{generated_text:'Literal <img src=x> content.'}]), 'Literal <img src=x> content.');
  assert.throws(() => cleanupOutput([]), /unexpected/);
  assert.throws(() => cleanupOutput([{generated_text:[{role:'user',content:'raw'}]}]), /unexpected/);
  assert.throws(() => cleanupOutput([{generated_text:'<think>bad</think>'}]), /control/);
});

test('token counts use actual tokenizer tensor sizes, not word estimates', () => {
  const mock = (text, opts) => {
    assert.equal(opts.add_special_tokens, false);
    return { input_ids: { size: text.length } };
  };
  assert.equal(tokenCount(mock, 'hello'), 5);
  assert.throws(() => tokenCount(() => ({}), 'hello'), /tokenizer/);
});

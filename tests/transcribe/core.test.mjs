import test from 'node:test';
import assert from 'node:assert/strict';
import { MODELS, LANGUAGES, modelForLanguage, formatTime, formatBytes, validateVideoFile, MAX_FILE_BYTES, numberOfWindows, processedSeconds, wordCount, normalizeSegments, markdownTranscript } from '../../src/lib/transcribe/core.js';

test('English uses tiny.en; every other supported language uses tiny multilingual', () => {
  assert.equal(modelForLanguage('en'), MODELS.en);
  assert.equal(LANGUAGES.length, 98);
  assert.equal(new Set(LANGUAGES.map(([code]) => code)).size, 98);
  for (const [code] of LANGUAGES) assert.equal(modelForLanguage(code), MODELS.other);
  for (const invalid of ['', 'auto', undefined, 'zz']) assert.throws(() => modelForLanguage(invalid));
});
test('time labels handle boundaries, hours, and invalid input', () => {
  assert.equal(formatTime(0), '00:00'); assert.equal(formatTime(59.99), '00:59');
  assert.equal(formatTime(60), '01:00'); assert.equal(formatTime(3661), '1:01:01');
  assert.equal(formatTime(NaN), '00:00'); assert.equal(formatTime(-2), '00:00');
});
test('file validation rejects empty, oversized and non-video files', () => {
  for (const file of [{name:'a.mp4',size:0}, {name:'a.mp4',size:MAX_FILE_BYTES+1}, {name:'a.txt',size:10,type:'text/plain'}]) assert.throws(() => validateVideoFile(file));
  assert.doesNotThrow(() => validateVideoFile({name:'a.MP4',size:20,type:''}));
  assert.doesNotThrow(() => validateVideoFile({name:'a',size:20,type:'video/webm'}));
  assert.equal(formatBytes(0), '0 MB'); assert.equal(formatBytes(1048576), '1.0 MB');
});
test('overlapping window progress matches 30-second windows and 5-second strides', () => {
  assert.equal(numberOfWindows(12), 1); assert.equal(numberOfWindows(30), 1);
  assert.equal(numberOfWindows(31), 2); assert.equal(numberOfWindows(50), 2);
  assert.equal(numberOfWindows(51), 3); assert.equal(numberOfWindows(70), 3);
  assert.equal(processedSeconds(0, 70), 0); assert.equal(processedSeconds(1, 70), 25);
  assert.equal(processedSeconds(2, 70), 45); assert.equal(processedSeconds(3, 70), 70);
  assert.equal(processedSeconds(1, 11), 11);
});
test('transcript handles missing timestamps, clipping, and empty output', () => {
  const result = normalizeSegments({text:'Hello world',chunks:[{text:'Hello',timestamp:[0,null]},{text:'world',timestamp:[2,99]}]}, 5);
  assert.deepEqual(result.segments, [{text:'Hello',start:0,end:2},{text:'world',start:2,end:5}]);
  assert.deepEqual(normalizeSegments({text:'Hey'}, 5).segments, [{text:'Hey',start:0,end:5}]);
  assert.deepEqual(normalizeSegments({}, 5), {text:'',segments:[]});
  assert.equal(normalizeSegments({chunks:[{text:'a',timestamp:[3,4]},{text:'b',timestamp:[1,2]}]}, 5).segments[1].start, 3);
});
test('counts multilingual words, not just spaces', () => {
  assert.equal(wordCount('Hello, world!'), 2); assert.equal(wordCount(''), 0);
  assert.ok(wordCount('你好世界', 'zh') >= 2);
});
test('Markdown exports text safely, including hostile-looking file names', () => {
  const md = markdownTranscript('<script>hello</script>.mp4', 'A <b>test</b> & **words**.');
  assert.ok(md.startsWith('# &lt;script&gt;hello&lt;/script&gt;'));
  assert.ok(!md.includes('<script>')); assert.ok(md.includes('\\*\\*words\\*\\*'));
  assert.ok(md.endsWith('\n'));
});

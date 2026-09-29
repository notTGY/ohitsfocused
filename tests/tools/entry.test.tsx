import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import FontCycleCreator from '../../src/components/FontCycleCreator';
import HorizontalToVertical from '../../src/components/HorizontalToVertical';
import TranscribeReels from '../../src/components/TranscribeReels';

for (const [name, Tool, action] of [
  ['Font cycle', FontCycleCreator, 'Choose an image'],
  ['Horizontal to vertical', HorizontalToVertical, 'Choose a video'],
  ['Video to text', TranscribeReels, 'Choose a video'],
] as const) {
  test(`${name} starts with a file picker, without an empty editor or configuration`, () => {
    const html = renderToStaticMarkup(<Tool />);
    assert.ok(html.includes(action));
    assert.equal((html.match(/type="file"/g) || []).length, 1);
    assert.doesNotMatch(html, /<(?:video|canvas|textarea|select)\b/);
    assert.doesNotMatch(html, /Export|Fonts &amp; timing|id="transcribe-button"|id="smart-checkbox"|id="transcript-title"/);
  });
}

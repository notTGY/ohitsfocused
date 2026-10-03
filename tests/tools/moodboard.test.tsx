import test from 'node:test';
import assert from 'node:assert/strict';
import { frameTimes, boardSize } from '../../src/components/Moodboard';

test('samples the center of each equal interval, avoiding either endpoint', () => {
  assert.deepEqual(frameTimes(18, 9), [1, 3, 5, 7, 9, 11, 13, 15, 17]);
  assert.deepEqual(frameTimes(10, 1), [5]);
  const times = frameTimes(0.05, 36);
  assert.equal(times.length, 36);
  assert.ok(times[0] > 0 && times.at(-1)! < 0.05);
  for (let i = 1; i < times.length; i++) assert.ok(Math.abs(times[i] - times[i - 1] - 0.05 / 36) < 1e-12);
});

test('preserves landscape and portrait proportions and bounds every supported grid', () => {
  for (const [width, height] of [[1920, 1080], [1080, 1920], [7680, 4320], [240, 320]]) {
    for (let rows = 1; rows <= 6; rows++) for (let columns = 1; columns <= 6; columns++) {
      const board = boardSize(width, height, rows, columns);
      assert.ok(board.width <= 3072 && board.height <= 3072);
      assert.ok(board.tileWidth <= width && board.tileHeight <= height);
      assert.ok(Math.abs(board.tileWidth / board.tileHeight - width / height) < 0.02);
      assert.equal(board.width, board.tileWidth * columns + 4 * (columns - 1));
      assert.equal(board.height, (board.tileHeight + 32) * rows + 4 * (rows - 1));
    }
  }
  assert.deepEqual(boardSize(1920, 1080, 3, 3), { tileWidth: 640, tileHeight: 360, width: 1928, height: 1184 });
});

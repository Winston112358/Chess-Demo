import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePieceBox, pieceViewForColor, resolvePieceSource } from '../../src/web/piece-view.js';

const manifest = JSON.parse(readFileSync(new URL('../../assets/pieces-manifest.json', import.meta.url), 'utf8'));
const rendering = manifest.rendering;

test('pieceViewForColor follows the near-side rule for both colors and flips', () => {
  assert.equal(pieceViewForColor('w', false), 'rear');
  assert.equal(pieceViewForColor('b', false), 'front');
  assert.equal(pieceViewForColor('w', true), 'front');
  assert.equal(pieceViewForColor('b', true), 'rear');
});

test('computePieceBox matches the documented formula for all 24 slots', () => {
  for (const piece of manifest.pieces) {
    for (const view of ['front', 'rear']) {
      const meta = piece.views[view];
      const box = computePieceBox(piece.id, view);
      assert.ok(box, `缺少 ${piece.id}/${view}`);
      const contentWidth = meta.contentBounds.right - meta.contentBounds.left + 1;
      const contentHeight = meta.contentBounds.bottom - meta.contentBounds.top + 1;
      const scale = Math.min(
        (rendering.maximumContentHeightFraction * piece.relativeHeight) / contentHeight,
        rendering.maximumContentWidthFraction / contentWidth,
      );
      assert.ok(Math.abs(box.widthPercent - 100 * meta.width * scale) < 1e-9);
      assert.ok(Math.abs(box.heightPercent - 100 * meta.height * scale) < 1e-9);
      assert.ok(Math.abs(box.leftPercent - (50 - 100 * ((meta.contentBounds.left + meta.contentBounds.right + 1) / 2) * scale)) < 1e-9);
      assert.ok(Math.abs(box.topPercent - (100 * rendering.bottomBaselineFraction - 100 * (meta.contentBounds.bottom + 1) * scale)) < 1e-9);
      assert.equal(box.src, `./pieces/staunton-v3/${meta.path.split('/').pop()}`);

      // The content bottom lands exactly on the baseline fraction of the square.
      const contentBottom = box.topPercent + box.heightPercent * ((meta.contentBounds.bottom + 1) / meta.height);
      assert.ok(Math.abs(contentBottom - 100 * rendering.bottomBaselineFraction) < 1e-9, `${piece.id}/${view} 基线`);

      // Visible content never leaves the square (transparent canvas margins may).
      const contentTop = box.topPercent + box.heightPercent * (meta.contentBounds.top / meta.height);
      const contentLeft = box.leftPercent + box.widthPercent * (meta.contentBounds.left / meta.width);
      const contentRight = box.leftPercent + box.widthPercent * ((meta.contentBounds.right + 1) / meta.width);
      assert.ok(contentLeft >= 0 && contentRight <= 100, `${piece.id}/${view} 水平越界`);
      assert.ok(contentTop >= 0, `${piece.id}/${view} 顶部越界`);
    }
  }
});

test('scaled content height follows relativeHeight: king taller than pawns and rooks', () => {
  const contentHeightPercent = (pieceId, view) => {
    const piece = manifest.pieces.find((entry) => entry.id === pieceId);
    const meta = piece.views[view];
    const box = computePieceBox(pieceId, view);
    return box.heightPercent * ((meta.contentBounds.bottom - meta.contentBounds.top + 1) / meta.height);
  };
  assert.ok(contentHeightPercent('wk', 'rear') > contentHeightPercent('wp', 'rear'));
  assert.ok(contentHeightPercent('wk', 'front') > contentHeightPercent('bp', 'front'));
  assert.ok(contentHeightPercent('wk', 'rear') > contentHeightPercent('wr', 'rear'));
  assert.ok(contentHeightPercent('wq', 'rear') > contentHeightPercent('wn', 'rear'));
});

test('resolvePieceSource resolves relative URLs against document.baseURI', () => {
  assert.equal(
    resolvePieceSource('./pieces/staunton-v3/wk-symmetric.png', 'http://127.0.0.1:5173/'),
    'http://127.0.0.1:5173/pieces/staunton-v3/wk-symmetric.png',
  );
  assert.equal(
    resolvePieceSource('./pieces/staunton-v3/wk-symmetric.png', 'http://example.test/chess/sub/index.html'),
    'http://example.test/chess/sub/pieces/staunton-v3/wk-symmetric.png',
  );
  assert.equal(
    resolvePieceSource('./pieces/staunton-v3/wk-symmetric.png', 'file:///D:/Chess/dist/web/index.html'),
    'file:///D:/Chess/dist/web/pieces/staunton-v3/wk-symmetric.png',
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');

function source(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('Stage 17 personal order-history renderer architecture', () => {
  it('uses only the named preload operation and supplies no identity, limit, or network access', () => {
    const renderer = source('src/renderer/renderer.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|\s)\/\/.*$/gm, '$1');
    assert.equal((renderer.match(/api\.orders\.myHistory\(/g) ?? []).length, 1);
    assert.doesNotMatch(renderer, /fetch\s*\(|XMLHttpRequest|WebSocket|ipcRenderer|require\s*\(/);
    const start = renderer.indexOf('api.orders.myHistory()');
    assert.ok(start >= 0);
    const functionStart = renderer.lastIndexOf('async function loadMyOrderHistory', start);
    const functionEnd = renderer.indexOf('\n}', start);
    assert.ok(functionStart >= 0 && functionEnd > start);
    const loader = renderer.slice(functionStart, functionEnd);
    assert.doesNotMatch(loader, /\buid\s*:|\blimit\s*:/);
  });

  it('keeps the personal and manager-wide history operations separate', () => {
    const renderer = source('src/renderer/renderer.ts');
    assert.match(renderer, /api\.orders\.list\(\)/);
    assert.match(renderer, /api\.orders\.myHistory\(\)/);
    assert.notEqual(renderer.indexOf('api.orders.list()'), renderer.indexOf('api.orders.myHistory()'));
  });

  it('exposes read-only filter controls, not write actions, in the personal history panel', () => {
    const markup = source('src/renderer/index.html');
    const start = markup.indexOf('<section class="panel" id="my-orders-view"');
    const end = markup.indexOf('</section>', start);
    assert.ok(start >= 0 && end > start);
    const panel = markup.slice(start, end);
    assert.match(panel, /my-orders-refresh/);
    assert.match(panel, /my-orders-retry/);
    assert.match(panel, /my-orders-search-input/);
    assert.match(panel, /my-orders-status-filter/);
    assert.match(panel, /نافذة محدودة/);
    assert.match(panel, /دون ضمان ترتيب زمني/);
    assert.doesNotMatch(panel, /<form\b|حذف|حفظ|معالجة|إرسال/);
  });
});

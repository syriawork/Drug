import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');
const renderer = readFileSync(join(projectRoot, 'src', 'renderer', 'renderer.ts'), 'utf8');
const html = readFileSync(join(projectRoot, 'src', 'renderer', 'index.html'), 'utf8');

describe('Stage 19 renderer architecture', () => {
  it('uses only the named order-scoped preload operation with the selected order id', () => {
    const start = renderer.indexOf('async function loadOrderHistoryMovements(');
    const end = renderer.indexOf('/** Opens the read-only details dialog', start);
    assert.ok(start >= 0 && end > start);
    const loader = renderer.slice(start, end);
    assert.match(loader, /api\.stockLogs\.listByOrder\(\{\s*orderId\s*\}\)/);
    assert.equal(/api\.(?:auth|orders|medicines|settings)\./.test(loader), false);
    assert.equal(/(?:fetch|XMLHttpRequest|ipcRenderer|firebase|firestore)/i.test(loader), false);
    assert.match(renderer.slice(renderer.indexOf('function openOrderHistoryDialog(')), /loadOrderHistoryMovements\(order\.id\)/);
  });

  it('keeps the selected-order detail read-only and displays stored movement fields', () => {
    const start = html.indexOf('<dialog class="user-dialog" id="order-history-dialog"');
    const end = html.indexOf('</dialog>', start);
    assert.ok(start >= 0 && end > start);
    const dialog = html.slice(start, end);
    assert.equal(/<form\b/i.test(dialog), false);
    assert.equal(/<input\b|<select\b|type="submit"/i.test(dialog), false);
    assert.match(dialog, /id="order-history-movements-rows"/);
    for (const field of [
      'معرّف الحركة',
      'معرّف الدواء',
      'الوصف المخزّن',
      'الاتجاه',
      'الكمية المخزّنة',
      'التاريخ المخزّن',
      'UID المنفّذ',
      'معرّف الطلب',
      'معرّف طلب المصدر',
    ]) {
      assert.equal(dialog.includes(field), true, `missing stored field label "${field}"`);
    }
  });
});

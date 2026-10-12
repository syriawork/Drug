import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const projectRoot = join(__dirname, '..', '..', '..');

function source(relativePath: string): string {
  return readFileSync(join(projectRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

function rendererCode(): string {
  return source('src/renderer/renderer.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

describe('Stage 16 renderer architecture', () => {
  it('uses only the named preload submission operation and sends intent fields only', () => {
    const renderer = rendererCode();
    assert.equal((renderer.match(/api\.orderRequests\.submit\(/g) ?? []).length, 1);
    assert.match(renderer, /api\.medicines\.list\(\)/);
    assert.doesNotMatch(renderer, /fetch\s*\(|XMLHttpRequest|WebSocket|ipcRenderer|require\s*\(/);

    const start = renderer.indexOf('api.orderRequests.submit({');
    const end = renderer.indexOf('\n    });', start);
    assert.ok(start >= 0 && end > start, 'the named submission payload must be present');
    const payload = renderer.slice(start, end);
    assert.match(payload, /medicineId:\s*item\.medicineId/);
    assert.match(payload, /quantity:\s*item\.quantity/);
    for (const forbidden of ['uid', 'userName', 'medicineName', 'stock', 'totalInward', 'totalOutward', 'status', 'requestDate', 'requestId', 'orderId', 'document', 'path']) {
      assert.equal(payload.includes(`${forbidden}:`), false, `submission payload must not carry ${forbidden}`);
    }
  });

  it('does not duplicate Stage 6 eligibility, stock, schedule, or monthly rules', () => {
    const renderer = rendererCode();
    const start = renderer.indexOf('function addRequestItem(): void {');
    const end = renderer.indexOf('\n}\n\nasync function submitOrderRequest', start);
    assert.ok(start >= 0 && end > start, 'the Stage 16 input helper must be present');
    const inputHelper = renderer.slice(start, end);
    for (const forbidden of ['maxQuantity', 'totalInward', 'totalOutward', 'stock', 'schedule', 'Friday', 'monthYear', 'lastOrder', 'pendingOrder']) {
      assert.equal(inputHelper.toLowerCase().includes(forbidden.toLowerCase()), false);
    }
    assert.match(inputHelper, /Number\.isSafeInteger\(quantity\)/);
  });

  it('keeps Stage 11 processing as a separate named operation', () => {
    const renderer = rendererCode();
    assert.match(renderer, /api\.orders\.process\(/);
    assert.match(renderer, /api\.orderRequests\.submit\(/);
    assert.notEqual(renderer.indexOf('api.orders.process('), renderer.indexOf('api.orderRequests.submit('));
  });
});

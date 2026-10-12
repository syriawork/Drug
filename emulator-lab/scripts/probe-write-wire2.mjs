/**
 * TEMPORARY Stage 5A probe #2 (local emulator only, owner bypass, demo- project).
 * Answers: P1 input filtering by mask on update, P2 mask path absent from input
 * (deletion?), P3 empty mask + non-empty data, P4 empty mask + transform,
 * P5 commit-after-rollback, P6 nested transform. Delete after use.
 */
const PROJ = process.env.FIREBASE_PROJECT_ID ?? 'demo-drug-manager-stage3';
const RES = `projects/${PROJ}/databases/(default)/documents`;
const BASE = `http://127.0.0.1:8080/v1/${RES}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const out = [];

const log = (label, status, body) => out.push(`--- ${label} -> HTTP ${status}\n${body}`);

async function commit(label, writes, transaction) {
  try {
    const body = transaction === undefined ? { writes } : { writes, transaction };
    const res = await fetch(`${BASE}:commit`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    log(label, res.status, (await res.text()).slice(0, 500));
  } catch (e) { log(label, -1, String(e)); }
}
async function get(label, path) {
  try {
    const res = await fetch(`${BASE}/${path}`, { headers: H });
    log(label, res.status, (await res.text()).slice(0, 900));
  } catch (e) { log(label, -1, String(e)); }
}
const del = (p) => fetch(`${BASE}/${p}`, { method: 'DELETE', headers: H }).catch(() => {});
const medicine = () => ({
  name: { stringValue: 'باراسيتامول' },
  stock: { integerValue: '10' },
  maxQuantity: { integerValue: '10' },
  totalInward: { integerValue: '100' },
  totalOutward: { integerValue: '90' },
});

for (const p of ['medicines/m1', 'medicines/m2', 'medicines/m3', 'medicines/m4', 'medicines/m5']) await del(p);

// P1: mask filters INPUT on update: data has stock+name, mask only stock.
await commit('P1 create', [{ update: { name: `${RES}/medicines/m1`, fields: medicine() }, currentDocument: { exists: false } }]);
await commit('P1 data={stock,name}, mask=[stock] (is name ignored or applied?)', [{
  update: {
    name: `${RES}/medicines/m1`,
    fields: { stock: { integerValue: '42' }, name: { stringValue: 'MUST-NOT-APPLY' } },
  },
  updateMask: { fieldPaths: ['stock'] },
  currentDocument: { exists: true },
}]);
await get('P1 read back (name unchanged?)', 'medicines/m1');

// P2: mask path ABSENT from input and no transform -> deleted?
await commit('P2 create', [{ update: { name: `${RES}/medicines/m2`, fields: medicine() }, currentDocument: { exists: false } }]);
await commit('P2 mask=[stock,totalOutward], data only {stock} (totalOutward deleted?)', [{
  update: { name: `${RES}/medicines/m2`, fields: { stock: { integerValue: '55' } } },
  updateMask: { fieldPaths: ['stock', 'totalOutward'] },
  currentDocument: { exists: true },
}]);
await get('P2 read back (totalOutward deleted?)', 'medicines/m2');

// P3: EMPTY mask + non-empty data -> data ignored?
await commit('P3 create', [{ update: { name: `${RES}/medicines/m3`, fields: medicine() }, currentDocument: { exists: false } }]);
await commit('P3 data={stock:77}, EMPTY mask (applied or ignored?)', [{
  update: { name: `${RES}/medicines/m3`, fields: { stock: { integerValue: '77' } } },
  updateMask: { fieldPaths: [] },
  currentDocument: { exists: true },
}]);
await get('P3 read back (stock 10 or 77?)', 'medicines/m3');

// P4: EMPTY mask + transform (fields {}) -> transform applied?
await commit('P4 touch via EMPTY mask + transform', [{
  update: { name: `${RES}/medicines/m3`, fields: {} },
  updateMask: { fieldPaths: [] },
  updateTransforms: [{ fieldPath: 'touchedAt', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: true },
}]);
await get('P4 read back (touchedAt set? fields intact?)', 'medicines/m3');

// P5: begin -> rollback -> commit with same tx id -> error?
let tx = null;
try {
  const res = await fetch(`${BASE}:beginTransaction`, { method: 'POST', headers: H, body: '{}' });
  tx = (await res.json()).transaction;
  const rb = await fetch(`${BASE}:rollback`, { method: 'POST', headers: H, body: JSON.stringify({ transaction: tx }) });
  log('P5 rollback', rb.status, await rb.text());
  await commit('P5 commit AFTER rollback (expect error)', [{
    update: { name: `${RES}/medicines/m4`, fields: { stock: { integerValue: '1' } } },
    updateMask: { fieldPaths: ['stock'] },
    currentDocument: { exists: false },
  }], tx);
} catch (e) { log('P5', -1, String(e)); }

// P6: nested transform: mask=[meta.at], data={meta:{at:SRV}} -> ?
await commit('P6 create nested', [{
  update: {
    name: `${RES}/medicines/m5`,
    fields: { meta: { mapValue: { fields: { at: { stringValue: 'old' }, keep: { integerValue: '1' } } } }, top: { stringValue: 't' } },
  },
  currentDocument: { exists: false },
}]);
await commit('P6 nested server timestamp', [{
  update: { name: `${RES}/medicines/m5`, fields: { meta: { mapValue: { fields: {} } } } },
  updateMask: { fieldPaths: ['meta.at'] },
  updateTransforms: [{ fieldPath: 'meta.at', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: true },
}]);
await get('P6 read back (meta.at timestamp? meta.keep + top survive?)', 'medicines/m5');

console.log('================ PROBE2 RESULTS ================');
for (const r of out) console.log(`\n${r}`);


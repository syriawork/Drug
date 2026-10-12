/**
 * TEMPORARY Stage 5A wire-format probe (local Firestore Emulator only).
 *
 * Answers the exact REST contract questions before implementing commitWrites
 * updateMask / updateTransforms support. Uses ONLY the emulator's documented
 * owner bypass ("Authorization: Bearer owner") against 127.0.0.1:8080 with a
 * "demo-" project id. Never contacts production Firebase. Delete after use.
 */
const PROJ = process.env.FIREBASE_PROJECT_ID ?? 'demo-drug-manager-stage3';
const RES = `projects/${PROJ}/databases/(default)/documents`;
const BASE = `http://127.0.0.1:8080/v1/${RES}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const results = [];

async function commit(label, writes, transaction) {
  try {
    const body = transaction === undefined ? { writes } : { writes, transaction };
    const res = await fetch(`${BASE}:commit`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    results.push({ label, status: res.status, body: text.slice(0, 600) });
    return { status: res.status, text };
  } catch (error) {
    results.push({ label, status: -1, body: String(error) });
    return { status: -1, text: '' };
  }
}

async function get(label, path) {
  try {
    const res = await fetch(`${BASE}/${path}`, { headers: H });
    const text = await res.text();
    results.push({ label, status: res.status, body: text.slice(0, 900) });
    return { status: res.status, text };
  } catch (error) {
    results.push({ label, status: -1, body: String(error) });
    return { status: -1, text: '' };
  }
}

async function del(path) {
  await fetch(`${BASE}/${path}`, { method: 'DELETE', headers: H }).catch(() => {});
}

const doc = (path, fields) => ({ name: `${RES}/${path}`, fields });
const medicine = (stock) => ({
  name: { stringValue: 'باراسيتامول' },
  stock: { integerValue: String(stock) },
  maxQuantity: { integerValue: '10' },
  totalInward: { integerValue: '100' },
  totalOutward: { integerValue: '90' },
});

// ---- reset -----------------------------------------------------------------
for (const p of [
  'medicines/p1', 'medicines/p2', 'medicines/p3', 'medicines/p4',
  'medicines/p5', 'medicines/p6', 'medicines/p7', 'medicines/p8',
  'medicines/p9', 'medicines/p10', 'medicines/p11', 'medicines/p12',
  'order_requests/probe-1', 'order_requests/probe-2',
]) await del(p);

// ---- Q1: update + updateMask keeps unrelated fields -------------------------
await commit('Q1 create full', [{ update: doc('medicines/p1', medicine(10)), currentDocument: { exists: false } }]);
await commit('Q1 masked update stock=42', [{
  update: { name: `${RES}/medicines/p1`, fields: { stock: { integerValue: '42' } } },
  updateMask: { fieldPaths: ['stock'] },
  currentDocument: { exists: true },
}]);
await get('Q1 read back', 'medicines/p1');

// ---- Q2: update WITHOUT mask (kind=update) => full replacement? (C5 proof) ---
await commit('Q2 create full', [{ update: doc('medicines/p2', medicine(10)), currentDocument: { exists: false } }]);
await commit('Q2 unmasked update stock=42', [{
  update: { name: `${RES}/medicines/p2`, fields: { stock: { integerValue: '42' } } },
  currentDocument: { exists: true },
}]);
await get('Q2 read back (did name/maxQuantity get deleted?)', 'medicines/p2');

// ---- Q3: create with server-timestamp transform (order_requests) ------------
await commit('Q3 create + REQUEST_TIME transform', [{
  update: {
    name: `${RES}/order_requests/probe-1`,
    fields: { uid: { stringValue: 'u1' }, status: { stringValue: 'pending' } },
  },
  updateTransforms: [{ fieldPath: 'requestDate', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: false },
}]);
await get('Q3 read back', 'order_requests/probe-1');

// ---- Q4: transform-only touch on EXISTING doc: data {} + mask + transform ---
await commit('Q4 touch processedAt (overlap mask+transform)', [{
  update: { name: `${RES}/medicines/p1`, fields: {} },
  updateMask: { fieldPaths: ['processedAt'] },
  updateTransforms: [{ fieldPath: 'processedAt', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: true },
}]);
await get('Q4 read back (unrelated fields survive?)', 'medicines/p1');

// ---- Q5: empty updateMask fieldPaths on existing doc ------------------------
await commit('Q5 create full', [{ update: doc('medicines/p3', medicine(10)), currentDocument: { exists: false } }]);
await commit('Q5 update fields {} + EMPTY mask', [{
  update: { name: `${RES}/medicines/p3`, fields: {} },
  updateMask: { fieldPaths: [] },
  currentDocument: { exists: true },
}]);
await get('Q5 read back (wiped?)', 'medicines/p3');

// ---- Q6: update fields {} + NO mask (wipe danger baseline) ------------------
await commit('Q6 create full', [{ update: doc('medicines/p4', medicine(10)), currentDocument: { exists: false } }]);
await commit('Q6 update fields {} + NO mask', [{
  update: { name: `${RES}/medicines/p4`, fields: {} },
  currentDocument: { exists: true },
}]);
await get('Q6 read back (wiped?)', 'medicines/p4');

// ---- Q7: malformed masks ----------------------------------------------------
await commit('Q7a create target', [{ update: doc('medicines/p5', medicine(10)), currentDocument: { exists: false } }]);
await commit('Q7a mask [""]', [{
  update: { name: `${RES}/medicines/p5`, fields: { stock: { integerValue: '1' } } },
  updateMask: { fieldPaths: [''] },
  currentDocument: { exists: true },
}]);
await commit('Q7b mask ["a..b"]', [{
  update: { name: `${RES}/medicines/p5`, fields: { stock: { integerValue: '2' } } },
  updateMask: { fieldPaths: ['a..b'] },
  currentDocument: { exists: true },
}]);
await commit('Q7c mask ["1abc"] (digit-leading simple name)', [{
  update: { name: `${RES}/medicines/p5`, fields: { stock: { integerValue: '3' } } },
  updateMask: { fieldPaths: ['1abc'] },
  currentDocument: { exists: true },
}]);
await commit('Q7d mask ["__id__"] (reserved)', [{
  update: { name: `${RES}/medicines/p5`, fields: { stock: { integerValue: '4' } } },
  updateMask: { fieldPaths: ['__id__'] },
  currentDocument: { exists: true },
}]);
await commit('Q7e transform fieldPath ""', [{
  update: { name: `${RES}/medicines/p5`, fields: { stock: { integerValue: '5' } } },
  updateTransforms: [{ fieldPath: '', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: true },
}]);
await commit('Q7f SERVER_VALUE_UNSPECIFIED', [{
  update: { name: `${RES}/medicines/p5`, fields: { stock: { integerValue: '6' } } },
  updateTransforms: [{ fieldPath: 'at', setToServerValue: 'SERVER_VALUE_UNSPECIFIED' }],
  currentDocument: { exists: true },
}]);
await get('Q7 read back (stock unchanged unless a probe succeeded)', 'medicines/p5');

// ---- Q8: special-character field name in mask -------------------------------
await commit('Q8 create with field "unit price"', [{
  update: {
    name: `${RES}/medicines/p6`,
    fields: { 'unit price': { integerValue: '5' }, keep: { stringValue: 'me' } },
  },
  currentDocument: { exists: false },
}]);
await commit('Q8a masked update BACKTICK-QUOTED path', [{
  update: { name: `${RES}/medicines/p6`, fields: { 'unit price': { integerValue: '7' } } },
  updateMask: { fieldPaths: ['`unit price`'] },
  currentDocument: { exists: true },
}]);
await get('Q8a read back', 'medicines/p6');
await commit('Q8b masked update UNQUOTED "unit price"', [{
  update: { name: `${RES}/medicines/p6`, fields: { 'unit price': { integerValue: '9' } } },
  updateMask: { fieldPaths: ['unit price'] },
  currentDocument: { exists: true },
}]);
await get('Q8b read back (was 7 overwritten?)', 'medicines/p6');

// ---- Q9: nested field path in mask ------------------------------------------
await commit('Q9 create nested map', [{
  update: {
    name: `${RES}/medicines/p7`,
    fields: { meta: { mapValue: { fields: { a: { integerValue: '1' }, b: { integerValue: '2' } } } }, other: { stringValue: 'x' } },
  },
  currentDocument: { exists: false },
}]);
await commit('Q9 masked nested update meta.a=9', [{
  update: { name: `${RES}/medicines/p7`, fields: { meta: { mapValue: { fields: { a: { integerValue: '9' } } } } } },
  updateMask: { fieldPaths: ['meta.a'] },
  currentDocument: { exists: true },
}]);
await get('Q9 read back (meta.b + other survive?)', 'medicines/p7');

// ---- Q10: create WITH updateMask (exists=false) -----------------------------
await commit('Q10 create + mask', [{
  update: { name: `${RES}/medicines/p8`, fields: medicine(10) },
  updateMask: { fieldPaths: ['stock'] },
  currentDocument: { exists: false },
}]);
await get('Q10 read back', 'medicines/p8');

// ---- Q11: transaction begin -> batchGet -> commit(mask+transform) -> rollback
let tx = null;
try {
  const res = await fetch(`${BASE}:beginTransaction`, { method: 'POST', headers: H, body: '{}' });
  tx = (await res.json()).transaction;
  results.push({ label: 'Q11 beginTransaction', status: res.status, body: String(tx) });
} catch (error) {
  results.push({ label: 'Q11 beginTransaction', status: -1, body: String(error) });
}
if (tx) {
  const bg = await fetch(`${BASE}:batchGet`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ documents: [`${RES}/medicines/p1`, `${RES}/medicines/missing`], transaction: tx }),
  });
  results.push({ label: 'Q11 batchGet in tx', status: bg.status, body: (await bg.text()).slice(0, 300) });

  const c1 = await commit('Q11 masked+transform commit IN tx', [{
    update: { name: `${RES}/medicines/p1`, fields: { stock: { integerValue: '77' } } },
    updateMask: { fieldPaths: ['stock'] },
    updateTransforms: [{ fieldPath: 'touchedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: true },
  }], tx);
  results.push({ label: 'Q11 commit response status detail', status: c1.status, body: c1.text.slice(0, 300) });

  const rb = await fetch(`${BASE}:rollback`, { method: 'POST', headers: H, body: JSON.stringify({ transaction: tx }) });
  results.push({ label: 'Q11 rollback', status: rb.status, body: (await rb.text()).slice(0, 200) });
  await get('Q11 p1 after ROLLBACK (stock must be 42, no touchedAt)', 'medicines/p1');
}

// ---- Q11c: full transaction commit (mask+transform, no rollback) -------------
let tx2 = null;
try {
  const res = await fetch(`${BASE}:beginTransaction`, { method: 'POST', headers: H, body: '{}' });
  tx2 = (await res.json()).transaction;
} catch { /* reported below */ }
if (tx2) {
  await fetch(`${BASE}:batchGet`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ documents: [`${RES}/medicines/p2`], transaction: tx2 }),
  });
  await commit('Q11c committed tx: masked update + server timestamp', [{
    update: { name: `${RES}/medicines/p2`, fields: { stock: { integerValue: '88' } } },
    updateMask: { fieldPaths: ['stock'] },
    updateTransforms: [{ fieldPath: 'touchedAt', setToServerValue: 'REQUEST_TIME' }],
    currentDocument: { exists: true },
  }], tx2);
  await get('Q11c p2 read back (name survives? touchedAt is a timestamp?)', 'medicines/p2');
}

// ---- Q12: timestamp literal round-trip --------------------------------------
await commit('Q12 write literal timestamp', [{
  update: {
    name: `${RES}/order_requests/probe-2`,
    fields: {
      uid: { stringValue: 'u1' },
      requestDate: { timestampValue: '2026-01-15T10:00:00.123456Z' },
    },
  },
  currentDocument: { exists: false },
}]);
await get('Q12 read back (precision preserved?)', 'order_requests/probe-2');

// ---- Q13: masked update on NON-EXISTENT doc with exists=true ----------------
await commit('Q13 masked update missing doc', [{
  update: { name: `${RES}/medicines/p999`, fields: { stock: { integerValue: '1' } } },
  updateMask: { fieldPaths: ['stock'] },
  currentDocument: { exists: true },
}]);

// ---- report -----------------------------------------------------------------
console.log('================ PROBE RESULTS ================');
for (const r of results) {
  console.log(`\n--- ${r.label} -> HTTP ${r.status}`);
  console.log(r.body);
}



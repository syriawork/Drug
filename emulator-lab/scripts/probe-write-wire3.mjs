/** TEMPORARY Stage 5A probe #3 (local emulator only). Delete after use. */
const PROJ = process.env.FIREBASE_PROJECT_ID ?? 'demo-drug-manager-stage3';
const RES = `projects/${PROJ}/databases/(default)/documents`;
const BASE = `http://127.0.0.1:8080/v1/${RES}`;
const H = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
const out = [];
const log = (l, s, b) => out.push(`--- ${l} -> HTTP ${s}\n${b}`);
async function commit(label, writes) {
  const res = await fetch(`${BASE}:commit`, { method: 'POST', headers: H, body: JSON.stringify({ writes }) });
  log(label, res.status, (await res.text()).slice(0, 400));
}
async function get(label, path) {
  const res = await fetch(`${BASE}/${path}`, { headers: H });
  log(label, res.status, (await res.text()).slice(0, 600));
}
const del = (p) => fetch(`${BASE}/${p}`, { method: 'DELETE', headers: H }).catch(() => {});
await del('order_requests/e1'); await del('medicines/e1'); await del('medicines/e2');

// R1: create with EMPTY fields + transform only (exists=false)
await commit('R1 create fields={} + REQUEST_TIME', [{
  update: { name: `${RES}/order_requests/e1`, fields: {} },
  updateTransforms: [{ fieldPath: 'requestDate', setToServerValue: 'REQUEST_TIME' }],
  currentDocument: { exists: false },
}]);
await get('R1 read back', 'order_requests/e1');

// R2: update fields={} + EMPTY mask, NO transforms (no-op?)
await commit('R2 create medicine', [{
  update: {
    name: `${RES}/medicines/e1`,
    fields: { name: { stringValue: 'p' }, stock: { integerValue: '5' } },
  },
  currentDocument: { exists: false },
}]);
await commit('R2 update {} + mask [] (no-op?)', [{
  update: { name: `${RES}/medicines/e1`, fields: {} },
  updateMask: { fieldPaths: [] },
  currentDocument: { exists: true },
}]);
await get('R2 read back (must be unchanged)', 'medicines/e1');

// R3: multi-key auto mask data={stock,name} no explicit mask kind=update-equivalent (no precondition)
await commit('R3 create', [{
  update: {
    name: `${RES}/medicines/e2`,
    fields: { name: { stringValue: 'p' }, stock: { integerValue: '5' } },
  },
  currentDocument: { exists: false },
}]);
await commit('R3 unmasked multi-field update (upsert-style: full replace baseline)', [{
  update: { name: `${RES}/medicines/e2`, fields: { stock: { integerValue: '9' } } },
}]);
await get('R3 read back (name gone? = replace semantics)', 'medicines/e2');

console.log('================ PROBE3 RESULTS =================');
for (const r of out) console.log(`\n${r}`);

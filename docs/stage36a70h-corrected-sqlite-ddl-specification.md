# Stage 36A70H — Corrective SQLite DDL Specification

**Version:** 1.0  
**Status:** `STAGE_36A70H_BUSINESS_DECISION_REQUIRED`  
**Scope:** Specification only. The DDL and tests below have not been executed.

## 1. Executive determination

This specification replaces Stage 36A70F after Stage 36A70G found that:

1. A finalized receipt root could be rebound to another command, commit, and
   manifest effect while its immutable revision continued to refer to its
   original command and commit.
2. A bootstrap commit could activate while an identity created by that commit
   had no itemized count line, evidence, approval, or movement.
3. Receipt could not add a new lot/expiry identity, and the intended policy was
   not approved.
4. An empty `medicine_id` was accepted by the identity table.

The proposed DDL corrects the first, second, and fourth defects. It includes a
single complete schema capable of enforcing either receipt identity policy:

- `existing_only`: a receipt line must use an identity established by an
  already committed bootstrap.
- `receipt_may_create`: a receipt may create an identity and its receipt line,
  source evidence, second approval, positive movement, and manifest effect in
  the same atomic commit.

The owner has not chosen between these receipt policies. The schema therefore
requires an explicit `receipt_identity_policy` row before any receipt can be
finalized. This is a genuine business prerequisite, not a Main-process default.
Accordingly this document cannot claim readiness for implementation.

The schema uses deferred manifest foreign keys, commit-state insert guards,
one-way commit finalization, and immutable command/aggregate identity fields.
Finalization proves manifest-to-effect and effect-to-manifest membership,
including target type and target ID. Every persistent business effect is
restricted to an `applying` commit. Bootstrap finalization compares all
identities created by the batch against all count lines in both directions
and requires each count line's evidence, independent counter, separate
approver, and exact opening movement.

No release-one business transition is added or weakened. The only allowed
commands are `order.create`, `order.accept`, `order.fulfill`,
`inventory.bootstrap`, and `inventory.receipt`. This document is a proposed
specification, not a validated or implemented database.

## 2. Stage 36A70G defect disposition

| Stage 36A70G finding | Stage 36A70H disposition |
|---|---|
| Committed receipt root changed `command_id`, `commit_id`, and `effect_key` while revision remained bound to the old commit | All aggregate identity columns have immutable-update guards. Root transitions may update only state/revision and only while the matching revision's commit is applying. Every insert is restricted to an applying commit. |
| New effects and manifest rows could be appended after commit | BEFORE INSERT guards require the owning commit to be `applying`; finalization changes it irreversibly to `committed`; every effect-bearing table and manifest table rejects inserts for committed commits. |
| Manifest completeness checked only at finalization and was mutable afterward | Finalization requires exact one-to-one membership in both directions and checks every manifest target. Membership rows become immutable after finalization by the commit-state insert guards and immutable update/delete triggers. |
| Bootstrap could include an identity with no batch line, evidence, approval, or movement | Every identity carries `origin_kind`, `origin_id`, `created_by_command_id`, and `created_by_commit_id`; deferred composite FKs bind bootstrap identities to a batch line. Finalizer checks all created identities and lines in both directions and requires one exact movement per line. |
| Receipt could not create a new inventory identity | Two explicit policy models are specified and represented by a required configuration row. Owner decision remains unresolved. |
| Empty medicine identifier accepted | `medicine_id` must match a non-empty canonical lowercase identifier grammar; Main additionally validates existence in the trusted medicine catalog. |
| Negative tests were incomplete | §12 gives a self-contained validation approach, baseline fixture protocol, exact hostile SQL operations, expected outcomes, and state assertions for each missing category. No tests are asserted passed. |

## 3. Decisions, runtime, and canonical forms

### 3.1 Preserved release-one decisions

- `order.create` creates revision 1 `pending` and atomically reserves all exact
  requested quantities.
- `order.accept` creates revision 2 `accepted`, requires explicit
  administrative authorization, and has zero inventory effect.
- `order.fulfill` creates revision 3 `fulfilled` and consumes each exact
  reservation once.
- No release, cancellation, rejection, expiry, correction, reversal,
  return-driven inventory command, or automatic reservation timeout exists.
  Pending reservations may remain indefinitely.
- Bootstrap requires itemized physical count, independent second count,
  separate approver, evidence, and exact opening allocation.
- Receipt requires source evidence, receiver, distinct second approver, and
  exact positive receipt movement.
- No legacy stock conversion or import is permitted.
- `SQLITE_BUSY` is transient, never a definitive rejection.
- First successful `COMMIT` for a `commit_id` wins. No silent conflict
  resolution or automatic reversal.
- Unknown/incomplete classification blocks operations.
- The Main process alone owns the database through narrow IPC. SQLite does not
  authenticate its writer.
- Existing `admin` or `assistant` roles gain no permissions by inheritance.

### 3.2 SQLite runtime

- Minimum SQLite version: **3.46.0**.
- Required: `STRICT` tables, partial indexes, foreign keys, JSON1
  (`json_valid`), ISO date functions, WAL mode, and deferred foreign keys.
- Every file-backed connection must enable and verify:

  ```sql
  PRAGMA foreign_keys=ON;
  PRAGMA journal_mode=WAL;
  PRAGMA synchronous=FULL;
  PRAGMA busy_timeout=5000;
  ```

- Read back `foreign_keys=1`, `journal_mode='wal'`, and `synchronous=2`.
  `synchronous` is connection-scoped and must be applied on every connection.
- No claim is made about a particular Electron SQLite driver, filesystem,
  storage device, or power-loss behavior.

### 3.3 Formats and numeric limits

- IDs: 1–128 ASCII characters matching
  `[A-Za-z0-9][A-Za-z0-9._:-]*`; relevant key columns have SQL checks.
- Medicine IDs and canonical units: 1–64 lowercase ASCII characters matching
  `[a-z0-9][a-z0-9._:-]*`. SQLite validates form only; Main validates that
  medicine and unit exist and are enabled in the trusted catalog.
- Hashes: exactly 64 lowercase hexadecimal characters.
- Request hash:
  `lower_hex(SHA256(UTF8("drug-manager.request.v1\0" || request_json)))`.
- Effect key:
  `lower_hex(SHA256(UTF8("drug-manager.effect.v1\0" || command_id || "\0" || effect_kind || "\0" || target_type || "\0" || target_id)))`.
- Request canonicalization and both digest derivations are Main-process
  responsibilities. A syntactically valid hash is not proof of its content.
- Timestamps are canonical UTC RFC 3339 with milliseconds:
  `YYYY-MM-DDTHH:MM:SS.SSSZ`. SQL parses them; Main enforces exact canonical
  representation.
- Quantities and snapshots are limited to
  `0..9007199254740991`; deltas use the corresponding symmetric range.
- Expiry `none` is represented only by `expiry_date=''`. Expiry `date` requires
  a calendar-valid `YYYY-MM-DD`; no sentinel date is accepted.

## 4. Complete proposed DDL

The following is the complete proposed schema script for a fresh database.
The receipt policy row is intentionally absent from DDL initialization. An
authorized owner decision must insert exactly one row before receipt
finalization is enabled. No default receipt policy is inferred.

```sql
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA busy_timeout=5000;

CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  CHECK(length(key) BETWEEN 1 AND 128)
) STRICT;

CREATE TABLE nonce_events (
  nonce_event_id TEXT PRIMARY KEY NOT NULL,
  nonce_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN
    ('presented','reserved','consumed','rolled_back','expired')),
  recorded_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at)=recorded_at),
  FOREIGN KEY(nonce_id) REFERENCES nonce_records(nonce_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE policy_config (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  receipt_identity_policy TEXT NOT NULL
    CHECK(receipt_identity_policy IN ('existing_only','receipt_may_create')),
  approved_by_actor_id TEXT NOT NULL,
  approved_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',approved_at)=approved_at)
) STRICT;

CREATE TABLE commands (
  command_id TEXT PRIMARY KEY NOT NULL,
  command_type TEXT NOT NULL CHECK(command_type IN (
    'order.create','order.accept','order.fulfill',
    'inventory.bootstrap','inventory.receipt'
  )),
  aggregate_type TEXT NOT NULL CHECK(aggregate_type IN (
    'order','inventory_batch','inventory_receipt'
  )),
  aggregate_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL
    CHECK(expected_revision BETWEEN 0 AND 9007199254740991),
  canonicalization_version INTEGER NOT NULL CHECK(canonicalization_version=1),
  request_json TEXT NOT NULL CHECK(json_valid(request_json)),
  request_hash TEXT NOT NULL CHECK(
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  CHECK(length(command_id) BETWEEN 1 AND 128
    AND command_id GLOB '[A-Za-z0-9]*'
    AND command_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
  CHECK(length(aggregate_id) BETWEEN 1 AND 128
    AND aggregate_id GLOB '[A-Za-z0-9]*'
    AND aggregate_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
  CHECK(
    (command_type IN ('order.create','order.accept','order.fulfill')
      AND aggregate_type='order')
    OR (command_type='inventory.bootstrap'
      AND aggregate_type='inventory_batch')
    OR (command_type='inventory.receipt'
      AND aggregate_type='inventory_receipt')
  ),
  UNIQUE(command_id,command_type,aggregate_type,aggregate_id,
         expected_revision,request_hash),
  UNIQUE(command_id,request_hash)
) STRICT;

CREATE TABLE commit_records (
  commit_id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('applying','committed')),
  created_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  finalized_at TEXT CHECK(finalized_at IS NULL OR
    strftime('%Y-%m-%dT%H:%M:%fZ',finalized_at)=finalized_at),
  CHECK(length(commit_id) BETWEEN 1 AND 128
    AND commit_id GLOB '[A-Za-z0-9]*'
    AND commit_id NOT GLOB '*[^A-Za-z0-9._:-]*'),
  CHECK((status='applying' AND finalized_at IS NULL)
     OR (status='committed' AND finalized_at IS NOT NULL)),
  UNIQUE(commit_id,command_id),
  UNIQUE(commit_id,command_id,request_hash),
  UNIQUE(commit_id,request_hash),
  FOREIGN KEY(command_id,command_type,aggregate_type,aggregate_id,
              expected_revision,request_hash)
    REFERENCES commands(command_id,command_type,aggregate_type,aggregate_id,
                        expected_revision,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,request_hash)
    REFERENCES commit_finalizations(commit_id,request_hash)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE commit_finalizations (
  commit_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  finalized_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',finalized_at)=finalized_at),
  UNIQUE(commit_id,request_hash),
  FOREIGN KEY(commit_id,request_hash)
    REFERENCES commit_records(commit_id,request_hash)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE effect_manifest (
  effect_key TEXT PRIMARY KEY NOT NULL CHECK(
    length(effect_key)=64 AND effect_key NOT GLOB '*[^0-9a-f]*'
  ),
  commit_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  effect_kind TEXT NOT NULL CHECK(effect_kind IN (
    'order.root','order.revision','order.line','order.reservation',
    'inventory.identity','inventory.movement','inventory.batch',
    'inventory.batch_revision','inventory.batch_line',
    'inventory.receipt','inventory.receipt_revision','inventory.receipt_line'
  )),
  target_type TEXT NOT NULL CHECK(target_type IN (
    'orders','order_revisions','order_lines','reservations',
    'inventory_identity','inventory_movements','inventory_batches',
    'inventory_batch_revisions','inventory_batch_lines',
    'inventory_receipts','inventory_receipt_revisions',
    'inventory_receipt_lines'
  )),
  target_id TEXT NOT NULL,
  expected_row_count INTEGER NOT NULL CHECK(expected_row_count=1),
  claimed_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',claimed_at)=claimed_at),
  UNIQUE(commit_id,effect_kind,target_type,target_id),
  UNIQUE(effect_key,commit_id,command_id,target_type,target_id),
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence_records (
  evidence_id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK(resource_kind IN
    ('inventory_batch','inventory_receipt')),
  resource_id TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 128),
  raw_bytes BLOB NOT NULL,
  sha256_hex TEXT NOT NULL CHECK(
    length(sha256_hex)=64 AND sha256_hex NOT GLOB '*[^0-9a-f]*'
  ),
  provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),
  acquired_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',acquired_at)=acquired_at),
  acquired_by_actor_id TEXT NOT NULL,
  UNIQUE(evidence_id,commit_id,resource_kind,resource_id,
         acquired_by_actor_id),
  FOREIGN KEY(commit_id) REFERENCES commit_records(commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE authority_keys (
  key_id TEXT PRIMARY KEY NOT NULL,
  algorithm TEXT NOT NULL CHECK(algorithm='ES256'),
  public_key_fingerprint TEXT NOT NULL CHECK(
    length(public_key_fingerprint)=64
    AND public_key_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  registered_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',registered_at)=registered_at),
  UNIQUE(key_id,algorithm)
) STRICT;

CREATE TABLE authority_key_events (
  key_event_id TEXT PRIMARY KEY NOT NULL,
  key_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN
    ('registered','activated','rotated','revoked')),
  event_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',event_at)=event_at),
  event_json TEXT NOT NULL CHECK(json_valid(event_json)),
  FOREIGN KEY(key_id) REFERENCES authority_keys(key_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE nonce_records (
  nonce_id TEXT PRIMARY KEY NOT NULL,
  nonce_value TEXT NOT NULL UNIQUE CHECK(length(nonce_value) BETWEEN 16 AND 512),
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK(
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK(state IN
    ('presented','reserved','consumed','rolled_back','expired')),
  created_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  UNIQUE(nonce_id,actor_id,command_id,request_hash),
  FOREIGN KEY(command_id,request_hash)
    REFERENCES commands(command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE authorization_assertions (
  assertion_id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN (
    'order.create','order.accept','order.fulfill',
    'inventory.bootstrap','inventory.receipt','inventory.approve'
  )),
  resource_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  role_snapshot TEXT NOT NULL CHECK(role_snapshot IN
    ('admin','assistant','employee')),
  key_id TEXT NOT NULL,
  nonce_id TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL,
  issued_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',issued_at)=issued_at),
  expires_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at),
  signed_assertion BLOB NOT NULL,
  signed_assertion_sha256 TEXT NOT NULL CHECK(
    length(signed_assertion_sha256)=64
    AND signed_assertion_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  decision TEXT NOT NULL CHECK(decision IN ('allow','deny')),
  CHECK(issued_at<expires_at),
  UNIQUE(assertion_id,commit_id,action,resource_id,actor_id),
  FOREIGN KEY(commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(nonce_id,actor_id,command_id,request_hash)
    REFERENCES nonce_records(nonce_id,actor_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(key_id) REFERENCES authority_keys(key_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence_verifications (
  verification_id TEXT PRIMARY KEY NOT NULL,
  evidence_id TEXT NOT NULL,
  verifier_actor_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('verified','failed','pending','revoked')),
  method TEXT NOT NULL,
  verification_json TEXT NOT NULL CHECK(json_valid(verification_json)),
  verified_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',verified_at)=verified_at),
  FOREIGN KEY(evidence_id) REFERENCES evidence_records(evidence_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 0 AND 3),
  current_status TEXT NOT NULL CHECK(current_status IN
    ('pending','accepted','fulfilled')),
  created_by_actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'orders'
    CHECK(manifest_target_type='orders'),
  CHECK((current_revision=0 AND current_status='pending')
     OR (current_revision=1 AND current_status='pending')
     OR (current_revision=2 AND current_status='accepted')
     OR (current_revision=3 AND current_status='fulfilled')),
  UNIQUE(order_id,command_id,commit_id),
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,manifest_target_type,order_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE order_revisions (
  revision_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK(status IN ('pending','accepted','fulfilled')),
  command_id TEXT NOT NULL,
  command_type TEXT NOT NULL CHECK(command_type IN
    ('order.create','order.accept','order.fulfill')),
  commit_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'order_revisions'
    CHECK(manifest_target_type='order_revisions'),
  created_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  UNIQUE(order_id,revision),
  UNIQUE(revision_id,order_id,command_id,commit_id),
  FOREIGN KEY(order_id) REFERENCES orders(order_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,manifest_target_type,revision_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_identity (
  identity_id TEXT PRIMARY KEY NOT NULL,
  medicine_id TEXT NOT NULL CHECK(
    length(medicine_id) BETWEEN 1 AND 64
    AND medicine_id GLOB '[a-z0-9]*'
    AND medicine_id NOT GLOB '*[^a-z0-9._:-]*'
  ),
  canonical_unit TEXT NOT NULL CHECK(
    length(canonical_unit) BETWEEN 1 AND 64
    AND canonical_unit GLOB '[a-z0-9]*'
    AND canonical_unit NOT GLOB '*[^a-z0-9._:-]*'
  ),
  tracking_state TEXT NOT NULL CHECK(tracking_state IN ('tracked','untracked')),
  lot_id TEXT NOT NULL CHECK(length(lot_id)<=128),
  expiry_state TEXT NOT NULL CHECK(expiry_state IN ('none','date')),
  expiry_date TEXT NOT NULL,
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('bootstrap','receipt')),
  origin_id TEXT NOT NULL,
  created_by_command_id TEXT NOT NULL,
  created_by_commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_identity'
    CHECK(manifest_target_type='inventory_identity'),
  CHECK((tracking_state='tracked' AND length(lot_id)>0)
     OR (tracking_state='untracked' AND lot_id='')),
  CHECK((expiry_state='none' AND expiry_date='')
     OR (expiry_state='date' AND length(expiry_date)=10
       AND expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
       AND substr(expiry_date,1,4) BETWEEN '0001' AND '9999'
       AND date(expiry_date,'+0 days')=expiry_date)),
  UNIQUE(medicine_id,canonical_unit,tracking_state,lot_id,expiry_state,expiry_date),
  UNIQUE(identity_id,origin_kind,origin_id,created_by_command_id,created_by_commit_id),
  FOREIGN KEY(created_by_commit_id,created_by_command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,created_by_commit_id,created_by_command_id,
               manifest_target_type,identity_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE order_lines (
  line_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'order_lines'
    CHECK(manifest_target_type='order_lines'),
  UNIQUE(order_id,identity_id),
  UNIQUE(line_id,identity_id,order_id,quantity),
  FOREIGN KEY(order_id) REFERENCES orders(order_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(identity_id) REFERENCES inventory_identity(identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,manifest_target_type,line_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE reservations (
  reservation_id TEXT PRIMARY KEY NOT NULL,
  line_id TEXT NOT NULL UNIQUE,
  order_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'reservations'
    CHECK(manifest_target_type='reservations'),
  UNIQUE(reservation_id,identity_id,quantity),
  FOREIGN KEY(line_id,identity_id,order_id,quantity)
    REFERENCES order_lines(line_id,identity_id,order_id,quantity)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,manifest_target_type,reservation_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_batches (
  batch_id TEXT PRIMARY KEY NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN ('pending','active')),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_batches'
    CHECK(manifest_target_type='inventory_batches'),
  CHECK((current_revision=0 AND status='pending')
     OR (current_revision=1 AND status='active')),
  UNIQUE(batch_id,command_id,commit_id),
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,manifest_target_type,batch_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_batch_revisions (
  batch_revision_id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision=1),
  status TEXT NOT NULL CHECK(status='active'),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_batch_revisions'
    CHECK(manifest_target_type='inventory_batch_revisions'),
  UNIQUE(batch_id,revision),
  FOREIGN KEY(batch_id) REFERENCES inventory_batches(batch_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,
               manifest_target_type,batch_revision_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_batch_lines (
  batch_line_id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  identity_id TEXT NOT NULL UNIQUE,
  counted_qty INTEGER NOT NULL CHECK(counted_qty BETWEEN 1 AND 9007199254740991),
  opening_available INTEGER NOT NULL CHECK(opening_available BETWEEN 0 AND 9007199254740991),
  opening_reserved INTEGER NOT NULL CHECK(opening_reserved BETWEEN 0 AND 9007199254740991),
  first_evidence_id TEXT NOT NULL,
  second_evidence_id TEXT NOT NULL,
  first_counter_actor_id TEXT NOT NULL,
  second_counter_actor_id TEXT NOT NULL,
  approver_actor_id TEXT NOT NULL,
  approval_assertion_id TEXT NOT NULL,
  identity_origin_kind TEXT NOT NULL CHECK(identity_origin_kind='bootstrap'),
  evidence_resource_kind TEXT NOT NULL CHECK(evidence_resource_kind='inventory_batch'),
  approval_action TEXT NOT NULL CHECK(approval_action='inventory.approve'),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_batch_lines'
    CHECK(manifest_target_type='inventory_batch_lines'),
  CHECK(first_evidence_id<>second_evidence_id),
  CHECK(first_counter_actor_id<>second_counter_actor_id),
  CHECK(first_counter_actor_id<>approver_actor_id),
  CHECK(second_counter_actor_id<>approver_actor_id),
  CHECK(opening_available+opening_reserved=counted_qty),
  UNIQUE(batch_line_id,identity_id,command_id,commit_id),
  UNIQUE(batch_line_id,identity_id),
  FOREIGN KEY(batch_id,command_id,commit_id)
    REFERENCES inventory_batches(batch_id,command_id,commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(identity_id,identity_origin_kind,batch_id,command_id,commit_id)
    REFERENCES inventory_identity(identity_id,origin_kind,origin_id,
                                   created_by_command_id,created_by_commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(first_evidence_id,commit_id,evidence_resource_kind,batch_line_id,
               first_counter_actor_id)
    REFERENCES evidence_records(evidence_id,commit_id,resource_kind,resource_id,
                                acquired_by_actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(second_evidence_id,commit_id,evidence_resource_kind,batch_line_id,
               second_counter_actor_id)
    REFERENCES evidence_records(evidence_id,commit_id,resource_kind,resource_id,
                                acquired_by_actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(approval_assertion_id,commit_id,approval_action,batch_line_id,
               approver_actor_id)
    REFERENCES authorization_assertions(assertion_id,commit_id,action,resource_id,actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,
               manifest_target_type,batch_line_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK(status IN ('pending','received')),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_receipts'
    CHECK(manifest_target_type='inventory_receipts'),
  CHECK((current_revision=0 AND status='pending')
     OR (current_revision=1 AND status='received')),
  UNIQUE(receipt_id,command_id,commit_id),
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,manifest_target_type,receipt_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_receipt_revisions (
  receipt_revision_id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision=1),
  status TEXT NOT NULL CHECK(status='received'),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_receipt_revisions'
    CHECK(manifest_target_type='inventory_receipt_revisions'),
  UNIQUE(receipt_id,revision),
  FOREIGN KEY(receipt_id) REFERENCES inventory_receipts(receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,
               manifest_target_type,receipt_revision_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_receipt_lines (
  receipt_line_id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
  evidence_id TEXT NOT NULL,
  receiver_actor_id TEXT NOT NULL,
  second_approver_actor_id TEXT NOT NULL,
  approval_assertion_id TEXT NOT NULL,
  evidence_resource_kind TEXT NOT NULL CHECK(evidence_resource_kind='inventory_receipt'),
  approval_action TEXT NOT NULL CHECK(approval_action='inventory.approve'),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_receipt_lines'
    CHECK(manifest_target_type='inventory_receipt_lines'),
  CHECK(receiver_actor_id<>second_approver_actor_id),
  UNIQUE(receipt_id,identity_id),
  UNIQUE(receipt_line_id,identity_id,command_id,commit_id),
  UNIQUE(receipt_line_id,identity_id),
  FOREIGN KEY(receipt_id,command_id,commit_id)
    REFERENCES inventory_receipts(receipt_id,command_id,commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(identity_id) REFERENCES inventory_identity(identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(evidence_id,commit_id,evidence_resource_kind,receipt_line_id,
               receiver_actor_id)
    REFERENCES evidence_records(evidence_id,commit_id,resource_kind,resource_id,
                                acquired_by_actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(approval_assertion_id,commit_id,approval_action,
               receipt_line_id,second_approver_actor_id)
    REFERENCES authorization_assertions(assertion_id,commit_id,action,resource_id,actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,
               manifest_target_type,receipt_line_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_movements (
  movement_id TEXT PRIMARY KEY NOT NULL,
  identity_id TEXT NOT NULL,
  movement_kind TEXT NOT NULL CHECK(movement_kind IN
    ('reserve','fulfill','bootstrap','receipt')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 9007199254740991),
  available_delta INTEGER NOT NULL CHECK(available_delta BETWEEN -9007199254740991 AND 9007199254740991),
  reserved_delta INTEGER NOT NULL CHECK(reserved_delta BETWEEN -9007199254740991 AND 9007199254740991),
  on_hand_delta INTEGER NOT NULL CHECK(on_hand_delta BETWEEN -9007199254740991 AND 9007199254740991),
  before_available INTEGER NOT NULL CHECK(before_available BETWEEN 0 AND 9007199254740991),
  after_available INTEGER NOT NULL CHECK(after_available BETWEEN 0 AND 9007199254740991),
  before_reserved INTEGER NOT NULL CHECK(before_reserved BETWEEN 0 AND 9007199254740991),
  after_reserved INTEGER NOT NULL CHECK(after_reserved BETWEEN 0 AND 9007199254740991),
  reservation_id TEXT,
  batch_line_id TEXT,
  receipt_line_id TEXT,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  manifest_target_type TEXT NOT NULL DEFAULT 'inventory_movements'
    CHECK(manifest_target_type='inventory_movements'),
  created_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  CHECK(on_hand_delta=available_delta+reserved_delta),
  CHECK(after_available=before_available+available_delta),
  CHECK(after_reserved=before_reserved+reserved_delta),
  CHECK(
    (movement_kind='reserve' AND available_delta=-quantity
      AND reserved_delta=quantity AND on_hand_delta=0
      AND reservation_id IS NOT NULL AND batch_line_id IS NULL
      AND receipt_line_id IS NULL)
    OR (movement_kind='fulfill' AND available_delta=0
      AND reserved_delta=-quantity AND on_hand_delta=-quantity
      AND reservation_id IS NOT NULL AND batch_line_id IS NULL
      AND receipt_line_id IS NULL)
    OR (movement_kind='bootstrap' AND quantity=available_delta+reserved_delta
      AND available_delta>=0 AND reserved_delta>=0
      AND batch_line_id IS NOT NULL AND reservation_id IS NULL
      AND receipt_line_id IS NULL)
    OR (movement_kind='receipt' AND available_delta=quantity
      AND reserved_delta=0 AND on_hand_delta=quantity
      AND receipt_line_id IS NOT NULL AND reservation_id IS NULL
      AND batch_line_id IS NULL)
  ),
  UNIQUE(movement_id,identity_id),
  FOREIGN KEY(identity_id) REFERENCES inventory_identity(identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(reservation_id,identity_id,quantity)
    REFERENCES reservations(reservation_id,identity_id,quantity)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(batch_line_id,identity_id)
    REFERENCES inventory_batch_lines(batch_line_id,identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(receipt_line_id,identity_id)
    REFERENCES inventory_receipt_lines(receipt_line_id,identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(effect_key,commit_id,command_id,
               manifest_target_type,movement_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id,target_type,target_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE VIEW inventory_balances AS
SELECT i.identity_id,i.medicine_id,i.canonical_unit,i.tracking_state,
       i.lot_id,i.expiry_state,i.expiry_date,
       COALESCE(SUM(m.available_delta),0) AS available_qty,
       COALESCE(SUM(m.reserved_delta),0) AS reserved_qty,
       COALESCE(SUM(m.available_delta+m.reserved_delta),0) AS on_hand_qty
FROM inventory_identity i
LEFT JOIN inventory_movements m ON m.identity_id=i.identity_id
GROUP BY i.identity_id;

CREATE TABLE recovery_events (
  recovery_event_id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT,
  command_id TEXT,
  request_hash TEXT NOT NULL CHECK(
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  observed_state TEXT NOT NULL CHECK(observed_state IN
    ('prepared','submitted','submission_unknown','confirmed',
     'definitively_rejected','identity_conflict','corrupt','adjudicated')),
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
  actor_id TEXT NOT NULL,
  observed_at TEXT NOT NULL
    CHECK(strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
  FOREIGN KEY(command_id) REFERENCES commands(command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY(commit_id) REFERENCES commit_records(commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX one_reserve_per_reservation
  ON inventory_movements(reservation_id) WHERE movement_kind='reserve';
CREATE UNIQUE INDEX one_fulfill_per_reservation
  ON inventory_movements(reservation_id) WHERE movement_kind='fulfill';
CREATE UNIQUE INDEX one_bootstrap_move_per_line
  ON inventory_movements(batch_line_id) WHERE movement_kind='bootstrap';
CREATE UNIQUE INDEX one_receipt_move_per_line
  ON inventory_movements(receipt_line_id) WHERE movement_kind='receipt';
CREATE INDEX movements_by_identity
  ON inventory_movements(identity_id,created_at,movement_id);
CREATE INDEX revisions_by_order
  ON order_revisions(order_id,revision);
CREATE INDEX manifest_by_commit
  ON effect_manifest(commit_id,effect_kind,target_type,target_id);

CREATE TRIGGER command_no_update BEFORE UPDATE ON commands
BEGIN SELECT RAISE(ABORT,'commands are immutable'); END;
CREATE TRIGGER command_no_delete BEFORE DELETE ON commands
BEGIN SELECT RAISE(ABORT,'commands are retained'); END;
CREATE TRIGGER policy_no_update BEFORE UPDATE ON policy_config
BEGIN SELECT RAISE(ABORT,'receipt policy requires an approved migration'); END;
CREATE TRIGGER policy_no_delete BEFORE DELETE ON policy_config
BEGIN SELECT RAISE(ABORT,'receipt policy is retained'); END;
CREATE TRIGGER policy_insert_once BEFORE INSERT ON policy_config
WHEN EXISTS(SELECT 1 FROM policy_config)
BEGIN SELECT RAISE(ABORT,'receipt policy is already configured'); END;
CREATE TRIGGER schema_meta_no_update BEFORE UPDATE ON schema_meta
BEGIN SELECT RAISE(ABORT,'schema metadata changes require approved migration'); END;
CREATE TRIGGER schema_meta_no_delete BEFORE DELETE ON schema_meta
BEGIN SELECT RAISE(ABORT,'schema metadata is retained'); END;

CREATE TRIGGER commit_insert_guard BEFORE INSERT ON commit_records
WHEN NEW.status<>'applying' OR NEW.finalized_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'commit must start applying'); END;
CREATE TRIGGER commit_identity_immutable BEFORE UPDATE ON commit_records
WHEN NEW.commit_id<>OLD.commit_id OR NEW.command_id<>OLD.command_id
  OR NEW.command_type<>OLD.command_type OR NEW.aggregate_type<>OLD.aggregate_type
  OR NEW.aggregate_id<>OLD.aggregate_id
  OR NEW.expected_revision<>OLD.expected_revision
  OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'commit identity is immutable'); END;
CREATE TRIGGER commit_state_guard BEFORE UPDATE OF status,finalized_at ON commit_records
WHEN NOT(OLD.status='applying' AND NEW.status='committed'
         AND NEW.finalized_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'only applying-to-committed is permitted'); END;
CREATE TRIGGER commit_no_delete BEFORE DELETE ON commit_records
BEGIN SELECT RAISE(ABORT,'commits are retained'); END;
CREATE TRIGGER finalization_insert_guard BEFORE INSERT ON commit_finalizations
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.request_hash=NEW.request_hash
    AND c.status='committed' AND c.finalized_at=NEW.finalized_at)
BEGIN SELECT RAISE(ABORT,'finalization must follow commit transition'); END;
CREATE TRIGGER finalization_no_update BEFORE UPDATE ON commit_finalizations
BEGIN SELECT RAISE(ABORT,'finalization is immutable'); END;
CREATE TRIGGER finalization_no_delete BEFORE DELETE ON commit_finalizations
BEGIN SELECT RAISE(ABORT,'finalization is retained'); END;

CREATE TRIGGER manifest_insert_guard BEFORE INSERT ON effect_manifest
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'manifest entries require an applying commit'); END;
CREATE TRIGGER manifest_kind_guard BEFORE INSERT ON effect_manifest
WHEN NOT(
  (NEW.effect_kind='order.root' AND NEW.target_type='orders')
  OR (NEW.effect_kind='order.revision' AND NEW.target_type='order_revisions')
  OR (NEW.effect_kind='order.line' AND NEW.target_type='order_lines')
  OR (NEW.effect_kind='order.reservation' AND NEW.target_type='reservations')
  OR (NEW.effect_kind='inventory.identity' AND NEW.target_type='inventory_identity')
  OR (NEW.effect_kind='inventory.movement' AND NEW.target_type='inventory_movements')
  OR (NEW.effect_kind='inventory.batch' AND NEW.target_type='inventory_batches')
  OR (NEW.effect_kind='inventory.batch_revision'
      AND NEW.target_type='inventory_batch_revisions')
  OR (NEW.effect_kind='inventory.batch_line'
      AND NEW.target_type='inventory_batch_lines')
  OR (NEW.effect_kind='inventory.receipt' AND NEW.target_type='inventory_receipts')
  OR (NEW.effect_kind='inventory.receipt_revision'
      AND NEW.target_type='inventory_receipt_revisions')
  OR (NEW.effect_kind='inventory.receipt_line'
      AND NEW.target_type='inventory_receipt_lines'))
BEGIN SELECT RAISE(ABORT,'effect kind and target type disagree'); END;
CREATE TRIGGER manifest_no_update BEFORE UPDATE ON effect_manifest
BEGIN SELECT RAISE(ABORT,'manifest entries are immutable'); END;
CREATE TRIGGER manifest_no_delete BEFORE DELETE ON effect_manifest
BEGIN SELECT RAISE(ABORT,'manifest entries are retained'); END;

CREATE TRIGGER orders_insert_guard BEFORE INSERT ON orders
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    AND c.command_type='order.create' AND c.aggregate_type='order'
    AND c.aggregate_id=NEW.order_id AND c.expected_revision=0
    AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'order root requires its applying create commit'); END;
CREATE TRIGGER orders_update_guard BEFORE UPDATE ON orders
BEGIN
  SELECT RAISE(ABORT,'order identity is immutable')
  WHERE NEW.order_id<>OLD.order_id OR NEW.created_by_actor_id<>OLD.created_by_actor_id
     OR NEW.command_id<>OLD.command_id OR NEW.commit_id<>OLD.commit_id
     OR NEW.effect_key<>OLD.effect_key;
  SELECT RAISE(ABORT,'order projection requires matching next revision')
  WHERE NOT EXISTS(
    SELECT 1 FROM order_revisions r
    JOIN commit_records c ON c.commit_id=r.commit_id
    WHERE r.order_id=OLD.order_id AND r.revision=OLD.current_revision+1
      AND r.revision=NEW.current_revision AND r.status=NEW.current_status
      AND c.status='applying');
END;
CREATE TRIGGER orders_no_delete BEFORE DELETE ON orders
BEGIN SELECT RAISE(ABORT,'orders are retained'); END;

CREATE TRIGGER order_revision_insert_guard BEFORE INSERT ON order_revisions
WHEN NOT EXISTS(
  SELECT 1 FROM orders o
  JOIN commands c ON c.command_id=NEW.command_id
  JOIN commit_records k ON k.commit_id=NEW.commit_id
                         AND k.command_id=NEW.command_id
  WHERE o.order_id=NEW.order_id AND NEW.revision=o.current_revision+1
    AND c.aggregate_id=o.order_id AND c.aggregate_type='order'
    AND c.expected_revision=o.current_revision
    AND c.command_type=NEW.command_type AND c.request_hash=NEW.request_hash
    AND k.request_hash=NEW.request_hash AND k.status='applying'
    AND ((NEW.revision=1 AND NEW.status='pending'
            AND NEW.command_type='order.create' AND o.current_revision=0)
      OR (NEW.revision=2 AND NEW.status='accepted'
            AND NEW.command_type='order.accept' AND o.current_revision=1
            AND o.current_status='pending')
      OR (NEW.revision=3 AND NEW.status='fulfilled'
            AND NEW.command_type='order.fulfill' AND o.current_revision=2
            AND o.current_status='accepted'))
    AND (NEW.revision<>1 OR
         (o.command_id=NEW.command_id AND o.commit_id=NEW.commit_id)))
BEGIN SELECT RAISE(ABORT,'revision/command/aggregate/hash mismatch'); END;
CREATE TRIGGER order_revision_apply AFTER INSERT ON order_revisions
BEGIN UPDATE orders SET current_revision=NEW.revision,current_status=NEW.status
  WHERE order_id=NEW.order_id; END;

CREATE TRIGGER inventory_identity_insert_guard BEFORE INSERT ON inventory_identity
WHEN NOT EXISTS(
  SELECT 1 FROM commit_records c
  LEFT JOIN policy_config p ON p.singleton=1
  WHERE c.commit_id=NEW.created_by_commit_id
    AND c.command_id=NEW.created_by_command_id AND c.status='applying'
    AND ((NEW.origin_kind='bootstrap' AND c.command_type='inventory.bootstrap'
            AND c.aggregate_id=NEW.origin_id)
      OR (NEW.origin_kind='receipt' AND c.command_type='inventory.receipt'
            AND c.aggregate_id=NEW.origin_id
            AND p.receipt_identity_policy='receipt_may_create')))
BEGIN SELECT RAISE(ABORT,'identity origin is not permitted by command/policy'); END;
CREATE TRIGGER inventory_identity_no_update BEFORE UPDATE ON inventory_identity
BEGIN SELECT RAISE(ABORT,'inventory identity is immutable'); END;
CREATE TRIGGER inventory_identity_no_delete BEFORE DELETE ON inventory_identity
BEGIN SELECT RAISE(ABORT,'inventory identity is retained'); END;

CREATE TRIGGER order_line_insert_guard BEFORE INSERT ON order_lines
WHEN NOT EXISTS(SELECT 1 FROM orders o JOIN commit_records c
  ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
  WHERE o.order_id=NEW.order_id AND c.command_type='order.create'
    AND c.aggregate_id=o.order_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'order line requires applying order.create'); END;
CREATE TRIGGER reservation_insert_guard BEFORE INSERT ON reservations
WHEN NOT EXISTS(SELECT 1 FROM order_lines l JOIN commit_records c
  ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
  WHERE l.line_id=NEW.line_id AND l.order_id=NEW.order_id
    AND l.identity_id=NEW.identity_id AND l.quantity=NEW.quantity
    AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id
    AND c.command_type='order.create' AND c.aggregate_id=NEW.order_id
    AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'reservation must equal its exact order line'); END;

CREATE TRIGGER batch_insert_guard BEFORE INSERT ON inventory_batches
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    AND c.command_type='inventory.bootstrap'
    AND c.aggregate_type='inventory_batch' AND c.aggregate_id=NEW.batch_id
    AND c.expected_revision=0 AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'batch requires applying bootstrap'); END;
CREATE TRIGGER batch_line_insert_guard BEFORE INSERT ON inventory_batch_lines
WHEN NOT EXISTS(SELECT 1 FROM inventory_batches b
  JOIN commit_records c ON c.commit_id=NEW.commit_id
                       AND c.command_id=NEW.command_id
  JOIN authorization_assertions a ON a.assertion_id=NEW.approval_assertion_id
    AND a.commit_id=NEW.commit_id AND a.action='inventory.approve'
    AND a.resource_id=NEW.batch_line_id
    AND a.actor_id=NEW.approver_actor_id AND a.decision='allow'
  WHERE b.batch_id=NEW.batch_id AND b.command_id=NEW.command_id
    AND b.commit_id=NEW.commit_id AND c.command_type='inventory.bootstrap'
    AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'batch line lacks matching batch/approval'); END;
CREATE TRIGGER batch_revision_insert_guard BEFORE INSERT ON inventory_batch_revisions
WHEN NOT EXISTS(SELECT 1 FROM inventory_batches b
  JOIN commit_records c ON c.commit_id=NEW.commit_id
                       AND c.command_id=NEW.command_id
  WHERE b.batch_id=NEW.batch_id AND b.command_id=NEW.command_id
    AND b.commit_id=NEW.commit_id AND b.status='pending'
    AND b.current_revision=0 AND c.command_type='inventory.bootstrap'
    AND c.expected_revision=0 AND c.request_hash=NEW.request_hash
    AND c.status='applying'
    AND EXISTS(SELECT 1 FROM inventory_batch_lines l
      WHERE l.batch_id=b.batch_id AND l.command_id=NEW.command_id
        AND l.commit_id=NEW.commit_id)
    AND NOT EXISTS(SELECT 1 FROM inventory_batch_lines l
      WHERE l.batch_id=b.batch_id AND (
        COALESCE((SELECT v.result FROM evidence_verifications v
          WHERE v.evidence_id=l.first_evidence_id
          ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')<>'verified'
        OR COALESCE((SELECT v.result FROM evidence_verifications v
          WHERE v.evidence_id=l.second_evidence_id
          ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')<>'verified'
        OR NOT EXISTS(SELECT 1 FROM inventory_movements m
          WHERE m.batch_line_id=l.batch_line_id
            AND m.movement_kind='bootstrap'
            AND m.quantity=l.counted_qty)))
)
BEGIN SELECT RAISE(ABORT,'bootstrap lines/evidence/movements incomplete'); END;
CREATE TRIGGER batch_revision_apply AFTER INSERT ON inventory_batch_revisions
BEGIN UPDATE inventory_batches SET current_revision=1,status='active'
  WHERE batch_id=NEW.batch_id; END;
CREATE TRIGGER batch_update_guard BEFORE UPDATE ON inventory_batches
BEGIN
  SELECT RAISE(ABORT,'batch identity is immutable')
  WHERE NEW.batch_id<>OLD.batch_id OR NEW.command_id<>OLD.command_id
     OR NEW.commit_id<>OLD.commit_id OR NEW.effect_key<>OLD.effect_key;
  SELECT RAISE(ABORT,'illegal batch projection transition')
  WHERE NOT(OLD.status='pending' AND OLD.current_revision=0
    AND NEW.status='active' AND NEW.current_revision=1
    AND EXISTS(SELECT 1 FROM inventory_batch_revisions r
      JOIN commit_records c ON c.commit_id=r.commit_id
      WHERE r.batch_id=OLD.batch_id AND r.revision=1
        AND r.status='active' AND c.status='applying'));
END;
CREATE TRIGGER batch_no_delete BEFORE DELETE ON inventory_batches
BEGIN SELECT RAISE(ABORT,'batches are retained'); END;

CREATE TRIGGER receipt_insert_guard BEFORE INSERT ON inventory_receipts
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    AND c.command_type='inventory.receipt'
    AND c.aggregate_type='inventory_receipt' AND c.aggregate_id=NEW.receipt_id
    AND c.expected_revision=0 AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'receipt requires applying receipt command'); END;
CREATE TRIGGER receipt_line_insert_guard BEFORE INSERT ON inventory_receipt_lines
WHEN NOT EXISTS(
  SELECT 1 FROM inventory_receipts r JOIN commit_records c
    ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
  JOIN authorization_assertions a
    ON a.assertion_id=NEW.approval_assertion_id
   AND a.commit_id=NEW.commit_id AND a.action='inventory.approve'
   AND a.resource_id=NEW.receipt_line_id
   AND a.actor_id=NEW.second_approver_actor_id AND a.decision='allow'
  LEFT JOIN inventory_identity i ON i.identity_id=NEW.identity_id
  LEFT JOIN policy_config p ON p.singleton=1
  WHERE r.receipt_id=NEW.receipt_id AND r.command_id=NEW.command_id
    AND r.commit_id=NEW.commit_id AND c.command_type='inventory.receipt'
    AND c.status='applying'
    AND (
      (p.receipt_identity_policy='existing_only'
        AND i.origin_kind='bootstrap'
        AND EXISTS(SELECT 1 FROM commit_records boot
          WHERE boot.commit_id=i.created_by_commit_id
            AND boot.status='committed'))
      OR (p.receipt_identity_policy='receipt_may_create'
        AND (i.created_by_commit_id<>NEW.commit_id
          OR (i.origin_kind='receipt' AND i.origin_id=r.receipt_id
            AND i.created_by_command_id=NEW.command_id
            AND i.created_by_commit_id=NEW.commit_id)))
    ))
BEGIN SELECT RAISE(ABORT,'receipt identity/policy/evidence approval mismatch'); END;
CREATE TRIGGER receipt_revision_insert_guard BEFORE INSERT ON inventory_receipt_revisions
WHEN NOT EXISTS(SELECT 1 FROM inventory_receipts r JOIN commit_records c
  ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
  WHERE r.receipt_id=NEW.receipt_id AND r.command_id=NEW.command_id
    AND r.commit_id=NEW.commit_id AND r.status='pending'
    AND r.current_revision=0 AND c.command_type='inventory.receipt'
    AND c.expected_revision=0 AND c.request_hash=NEW.request_hash
    AND c.status='applying'
    AND EXISTS(SELECT 1 FROM inventory_receipt_lines l
      WHERE l.receipt_id=r.receipt_id)
    AND NOT EXISTS(SELECT 1 FROM inventory_receipt_lines l
      WHERE l.receipt_id=r.receipt_id AND (
        COALESCE((SELECT v.result FROM evidence_verifications v
          WHERE v.evidence_id=l.evidence_id
          ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')<>'verified'
        OR NOT EXISTS(SELECT 1 FROM inventory_movements m
          WHERE m.receipt_line_id=l.receipt_line_id
            AND m.movement_kind='receipt' AND m.quantity=l.quantity))))
BEGIN SELECT RAISE(ABORT,'receipt lines/evidence/movements incomplete'); END;
CREATE TRIGGER receipt_revision_apply AFTER INSERT ON inventory_receipt_revisions
BEGIN UPDATE inventory_receipts SET current_revision=1,status='received'
  WHERE receipt_id=NEW.receipt_id; END;
CREATE TRIGGER receipt_update_guard BEFORE UPDATE ON inventory_receipts
BEGIN
  SELECT RAISE(ABORT,'receipt identity is immutable')
  WHERE NEW.receipt_id<>OLD.receipt_id OR NEW.command_id<>OLD.command_id
     OR NEW.commit_id<>OLD.commit_id OR NEW.effect_key<>OLD.effect_key;
  SELECT RAISE(ABORT,'illegal receipt projection transition')
  WHERE NOT(OLD.status='pending' AND OLD.current_revision=0
    AND NEW.status='received' AND NEW.current_revision=1
    AND EXISTS(SELECT 1 FROM inventory_receipt_revisions r
      JOIN commit_records c ON c.commit_id=r.commit_id
      WHERE r.receipt_id=OLD.receipt_id AND r.revision=1
        AND r.status='received' AND c.status='applying'));
END;
CREATE TRIGGER receipt_no_delete BEFORE DELETE ON inventory_receipts
BEGIN SELECT RAISE(ABORT,'receipts are retained'); END;

CREATE TRIGGER movement_insert_guard BEFORE INSERT ON inventory_movements
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'movement requires applying commit'); END;
CREATE TRIGGER movement_balance_guard BEFORE INSERT ON inventory_movements
BEGIN
  SELECT RAISE(ABORT,'movement before snapshot differs from ledger')
  WHERE NOT EXISTS(SELECT 1 FROM inventory_balances b
    WHERE b.identity_id=NEW.identity_id
      AND b.available_qty=NEW.before_available
      AND b.reserved_qty=NEW.before_reserved);
  SELECT RAISE(ABORT,'reserve does not match exact order reservation')
  WHERE NEW.movement_kind='reserve' AND NOT EXISTS(
    SELECT 1 FROM reservations r JOIN order_lines l USING(line_id)
    JOIN orders o USING(order_id) JOIN commit_records c
      ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    WHERE r.reservation_id=NEW.reservation_id AND r.identity_id=NEW.identity_id
      AND r.quantity=NEW.quantity AND r.command_id=NEW.command_id
      AND r.commit_id=NEW.commit_id AND l.order_id=c.aggregate_id
      AND c.command_type='order.create' AND o.current_revision=0);
  SELECT RAISE(ABORT,'fulfill does not match accepted exact reservation')
  WHERE NEW.movement_kind='fulfill' AND NOT EXISTS(
    SELECT 1 FROM reservations r JOIN order_lines l USING(line_id)
    JOIN orders o USING(order_id) JOIN commit_records c
      ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
    JOIN inventory_movements prior ON prior.reservation_id=r.reservation_id
      AND prior.movement_kind='reserve'
    WHERE r.reservation_id=NEW.reservation_id AND r.identity_id=NEW.identity_id
      AND r.quantity=NEW.quantity AND c.command_type='order.fulfill'
      AND c.aggregate_id=o.order_id AND c.expected_revision=2
      AND o.current_revision=2 AND o.current_status='accepted');
  SELECT RAISE(ABORT,'bootstrap movement differs from count allocation')
  WHERE NEW.movement_kind='bootstrap' AND NOT EXISTS(
    SELECT 1 FROM inventory_batch_lines l JOIN inventory_batches b USING(batch_id)
    JOIN commit_records c ON c.commit_id=NEW.commit_id
                         AND c.command_id=NEW.command_id
    WHERE l.batch_line_id=NEW.batch_line_id AND l.identity_id=NEW.identity_id
      AND l.counted_qty=NEW.quantity
      AND l.opening_available=NEW.available_delta
      AND l.opening_reserved=NEW.reserved_delta
      AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id
      AND b.commit_id=NEW.commit_id AND c.command_type='inventory.bootstrap');
  SELECT RAISE(ABORT,'receipt movement differs from receipt line')
  WHERE NEW.movement_kind='receipt' AND NOT EXISTS(
    SELECT 1 FROM inventory_receipt_lines l JOIN inventory_receipts r USING(receipt_id)
    JOIN commit_records c ON c.commit_id=NEW.commit_id
                         AND c.command_id=NEW.command_id
    WHERE l.receipt_line_id=NEW.receipt_line_id
      AND l.identity_id=NEW.identity_id AND l.quantity=NEW.quantity
      AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id
      AND r.commit_id=NEW.commit_id AND c.command_type='inventory.receipt');
END;

CREATE TRIGGER evidence_insert_guard BEFORE INSERT ON evidence_records
WHEN NOT EXISTS(SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'evidence requires applying commit'); END;
CREATE TRIGGER assertion_insert_guard BEFORE INSERT ON authorization_assertions
WHEN NOT EXISTS(
  SELECT 1 FROM nonce_records n JOIN commit_records c
    ON c.commit_id=NEW.commit_id AND c.command_id=NEW.command_id
  JOIN commands x ON x.command_id=NEW.command_id
  WHERE n.nonce_id=NEW.nonce_id AND n.state='consumed'
    AND n.actor_id=NEW.actor_id AND n.command_id=NEW.command_id
    AND n.request_hash=NEW.request_hash AND c.request_hash=NEW.request_hash
    AND c.status='applying'
    AND ((NEW.action=x.command_type AND NEW.resource_id=x.aggregate_id)
      OR NEW.action='inventory.approve'))
BEGIN SELECT RAISE(ABORT,'assertion is not bound to consumed nonce/command'); END;

CREATE TRIGGER nonce_insert_guard BEFORE INSERT ON nonce_records
WHEN NEW.state<>'presented'
BEGIN SELECT RAISE(ABORT,'nonce must start presented'); END;
CREATE TRIGGER nonce_state_guard BEFORE UPDATE OF state ON nonce_records
WHEN NOT((OLD.state='presented' AND NEW.state IN
             ('reserved','rolled_back','expired'))
      OR (OLD.state='reserved' AND NEW.state IN
             ('consumed','rolled_back','expired')))
BEGIN SELECT RAISE(ABORT,'illegal nonce transition'); END;
CREATE TRIGGER nonce_event_on_insert AFTER INSERT ON nonce_records
BEGIN
  INSERT INTO nonce_events(nonce_event_id,nonce_id,state,recorded_at)
  VALUES(lower(hex(randomblob(16))),NEW.nonce_id,NEW.state,NEW.created_at);
END;
CREATE TRIGGER nonce_event_on_transition AFTER UPDATE OF state ON nonce_records
WHEN NEW.state<>OLD.state
BEGIN
  INSERT INTO nonce_events(nonce_event_id,nonce_id,state,recorded_at)
  VALUES(lower(hex(randomblob(16))),NEW.nonce_id,NEW.state,
         strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER nonce_identity_guard BEFORE UPDATE ON nonce_records
WHEN NEW.nonce_id<>OLD.nonce_id OR NEW.nonce_value<>OLD.nonce_value
  OR NEW.actor_id<>OLD.actor_id OR NEW.command_id<>OLD.command_id
  OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'nonce identity is immutable'); END;

CREATE TRIGGER finalization_completeness BEFORE UPDATE OF status ON commit_records
WHEN NEW.status='committed'
BEGIN
  SELECT RAISE(ABORT,'manifest/effect set is not exactly one-to-one')
  WHERE EXISTS(SELECT 1 FROM effect_manifest e WHERE e.commit_id=NEW.commit_id
    AND e.expected_row_count<>(
      (SELECT count(*) FROM orders x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM order_revisions x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM order_lines x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM reservations x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_identity x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_movements x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_batches x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_batch_revisions x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_batch_lines x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_receipts x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_receipt_revisions x WHERE x.effect_key=e.effect_key)
      +(SELECT count(*) FROM inventory_receipt_lines x WHERE x.effect_key=e.effect_key)));
  SELECT RAISE(ABORT,'manifest target does not identify its unique effect row')
  WHERE EXISTS(SELECT 1 FROM effect_manifest e WHERE e.commit_id=NEW.commit_id
    AND NOT(
      (e.target_type='orders' AND EXISTS(SELECT 1 FROM orders x
        WHERE x.effect_key=e.effect_key AND x.order_id=e.target_id
          AND x.commit_id=e.commit_id AND x.command_id=e.command_id))
      OR (e.target_type='order_revisions' AND EXISTS(SELECT 1 FROM order_revisions x
        WHERE x.effect_key=e.effect_key AND x.revision_id=e.target_id))
      OR (e.target_type='order_lines' AND EXISTS(SELECT 1 FROM order_lines x
        WHERE x.effect_key=e.effect_key AND x.line_id=e.target_id))
      OR (e.target_type='reservations' AND EXISTS(SELECT 1 FROM reservations x
        WHERE x.effect_key=e.effect_key AND x.reservation_id=e.target_id))
      OR (e.target_type='inventory_identity' AND EXISTS(SELECT 1 FROM inventory_identity x
        WHERE x.effect_key=e.effect_key AND x.identity_id=e.target_id))
      OR (e.target_type='inventory_movements' AND EXISTS(SELECT 1 FROM inventory_movements x
        WHERE x.effect_key=e.effect_key AND x.movement_id=e.target_id))
      OR (e.target_type='inventory_batches' AND EXISTS(SELECT 1 FROM inventory_batches x
        WHERE x.effect_key=e.effect_key AND x.batch_id=e.target_id))
      OR (e.target_type='inventory_batch_revisions' AND EXISTS(SELECT 1 FROM inventory_batch_revisions x
        WHERE x.effect_key=e.effect_key AND x.batch_revision_id=e.target_id))
      OR (e.target_type='inventory_batch_lines' AND EXISTS(SELECT 1 FROM inventory_batch_lines x
        WHERE x.effect_key=e.effect_key AND x.batch_line_id=e.target_id))
      OR (e.target_type='inventory_receipts' AND EXISTS(SELECT 1 FROM inventory_receipts x
        WHERE x.effect_key=e.effect_key AND x.receipt_id=e.target_id))
      OR (e.target_type='inventory_receipt_revisions' AND EXISTS(SELECT 1 FROM inventory_receipt_revisions x
        WHERE x.effect_key=e.effect_key AND x.receipt_revision_id=e.target_id))
      OR (e.target_type='inventory_receipt_lines' AND EXISTS(SELECT 1 FROM inventory_receipt_lines x
        WHERE x.effect_key=e.effect_key AND x.receipt_line_id=e.target_id))));
  SELECT RAISE(ABORT,'effect row lacks an exact manifest entry')
  WHERE EXISTS(
    SELECT 1 FROM (
      SELECT effect_key,commit_id,command_id,'orders' AS target_type,order_id AS target_id FROM orders
      UNION ALL SELECT effect_key,commit_id,command_id,'order_revisions',revision_id FROM order_revisions
      UNION ALL SELECT effect_key,commit_id,command_id,'order_lines',line_id FROM order_lines
      UNION ALL SELECT effect_key,commit_id,command_id,'reservations',reservation_id FROM reservations
      UNION ALL SELECT effect_key,created_by_commit_id,created_by_command_id,'inventory_identity',identity_id FROM inventory_identity
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_movements',movement_id FROM inventory_movements
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_batches',batch_id FROM inventory_batches
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_batch_revisions',batch_revision_id FROM inventory_batch_revisions
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_batch_lines',batch_line_id FROM inventory_batch_lines
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_receipts',receipt_id FROM inventory_receipts
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_receipt_revisions',receipt_revision_id FROM inventory_receipt_revisions
      UNION ALL SELECT effect_key,commit_id,command_id,'inventory_receipt_lines',receipt_line_id FROM inventory_receipt_lines
    ) x WHERE x.commit_id=NEW.commit_id AND NOT EXISTS(
      SELECT 1 FROM effect_manifest e WHERE e.effect_key=x.effect_key
        AND e.commit_id=x.commit_id AND e.command_id=x.command_id
        AND e.target_type=x.target_type AND e.target_id=x.target_id
        AND e.expected_row_count=1));
  SELECT RAISE(ABORT,'command authorization is absent or not allowed')
  WHERE NOT EXISTS(SELECT 1 FROM authorization_assertions a
    WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id
      AND a.request_hash=NEW.request_hash AND a.decision='allow'
      AND a.action=NEW.command_type AND a.resource_id=NEW.aggregate_id);
  SELECT RAISE(ABORT,'bootstrap identity and count-line sets differ')
  WHERE NEW.command_type='inventory.bootstrap' AND (
    EXISTS(SELECT 1 FROM inventory_identity i
      WHERE i.created_by_commit_id=NEW.commit_id AND NOT EXISTS(
        SELECT 1 FROM inventory_batch_lines l
        WHERE l.identity_id=i.identity_id AND l.batch_id=NEW.aggregate_id
          AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id))
    OR EXISTS(SELECT 1 FROM inventory_batch_lines l
      WHERE l.batch_id=NEW.aggregate_id AND NOT EXISTS(
        SELECT 1 FROM inventory_identity i WHERE i.identity_id=l.identity_id
          AND i.origin_kind='bootstrap' AND i.origin_id=NEW.aggregate_id
          AND i.created_by_command_id=NEW.command_id
          AND i.created_by_commit_id=NEW.commit_id)));
  SELECT RAISE(ABORT,'bootstrap lacks exact complete itemization')
  WHERE NEW.command_type='inventory.bootstrap' AND (
    NOT EXISTS(SELECT 1 FROM inventory_batch_lines l
      WHERE l.batch_id=NEW.aggregate_id)
    OR EXISTS(SELECT 1 FROM inventory_batch_lines l
      WHERE l.batch_id=NEW.aggregate_id AND NOT EXISTS(
        SELECT 1 FROM inventory_movements m WHERE m.batch_line_id=l.batch_line_id
          AND m.identity_id=l.identity_id AND m.movement_kind='bootstrap'
          AND m.quantity=l.counted_qty
          AND m.available_delta=l.opening_available
          AND m.reserved_delta=l.opening_reserved
          AND m.before_available=0 AND m.before_reserved=0))
    OR NOT EXISTS(SELECT 1 FROM inventory_batches b
      JOIN inventory_batch_revisions r ON r.batch_id=b.batch_id
      WHERE b.batch_id=NEW.aggregate_id AND b.status='active'
        AND b.current_revision=1 AND r.revision=1 AND r.status='active'));
  SELECT RAISE(ABORT,'receipt lacks exact line/evidence/movement set')
  WHERE NEW.command_type='inventory.receipt' AND (
    NOT EXISTS(SELECT 1 FROM inventory_receipt_lines l
      WHERE l.receipt_id=NEW.aggregate_id)
    OR EXISTS(SELECT 1 FROM inventory_receipt_lines l
      WHERE l.receipt_id=NEW.aggregate_id AND NOT EXISTS(
        SELECT 1 FROM inventory_movements m
        WHERE m.receipt_line_id=l.receipt_line_id
          AND m.identity_id=l.identity_id AND m.quantity=l.quantity
          AND m.movement_kind='receipt' AND m.available_delta=l.quantity
          AND m.reserved_delta=0))
    OR (SELECT receipt_identity_policy FROM policy_config WHERE singleton=1) IS NULL
    OR NOT EXISTS(SELECT 1 FROM inventory_receipts r
      JOIN inventory_receipt_revisions v ON v.receipt_id=r.receipt_id
      WHERE r.receipt_id=NEW.aggregate_id AND r.status='received'
        AND r.current_revision=1 AND v.revision=1 AND v.status='received'));
  SELECT RAISE(ABORT,'receipt-created identities and receipt lines differ')
  WHERE NEW.command_type='inventory.receipt' AND (
    EXISTS(SELECT 1 FROM inventory_identity i
      WHERE i.created_by_commit_id=NEW.commit_id
        AND i.origin_kind='receipt'
        AND NOT EXISTS(SELECT 1 FROM inventory_receipt_lines l
          WHERE l.identity_id=i.identity_id
            AND l.receipt_id=NEW.aggregate_id
            AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id))
    OR EXISTS(SELECT 1 FROM inventory_receipt_lines l
      JOIN inventory_identity i ON i.identity_id=l.identity_id
      WHERE l.receipt_id=NEW.aggregate_id
        AND i.created_by_commit_id=NEW.commit_id
        AND (i.origin_kind<>'receipt' OR i.origin_id<>NEW.aggregate_id
          OR i.created_by_command_id<>NEW.command_id)));
  SELECT RAISE(ABORT,'order.create lacks one exact reservation and reserve movement per line')
  WHERE NEW.command_type='order.create' AND (
    NOT EXISTS(SELECT 1 FROM order_lines l WHERE l.order_id=NEW.aggregate_id)
    OR EXISTS(SELECT 1 FROM order_lines l WHERE l.order_id=NEW.aggregate_id
      AND NOT EXISTS(SELECT 1 FROM reservations r
        JOIN inventory_movements m ON m.reservation_id=r.reservation_id
        WHERE r.line_id=l.line_id AND r.identity_id=l.identity_id
          AND r.quantity=l.quantity AND m.movement_kind='reserve'
          AND m.quantity=l.quantity)));
  SELECT RAISE(ABORT,'order.accept must have revision 2 and zero inventory effects')
  WHERE NEW.command_type='order.accept' AND (
    NOT EXISTS(SELECT 1 FROM order_revisions r WHERE r.command_id=NEW.command_id
      AND r.revision=2 AND r.status='accepted')
    OR EXISTS(SELECT 1 FROM inventory_movements m WHERE m.command_id=NEW.command_id));
  SELECT RAISE(ABORT,'order.fulfill must consume every exact reservation')
  WHERE NEW.command_type='order.fulfill' AND (
    NOT EXISTS(SELECT 1 FROM order_revisions r WHERE r.command_id=NEW.command_id
      AND r.revision=3 AND r.status='fulfilled')
    OR (SELECT count(*) FROM inventory_movements m
        WHERE m.command_id=NEW.command_id AND m.movement_kind='fulfill')
       <> (SELECT count(*) FROM reservations r JOIN order_lines l USING(line_id)
           WHERE l.order_id=NEW.aggregate_id)
    OR EXISTS(SELECT 1 FROM reservations r JOIN order_lines l USING(line_id)
      WHERE l.order_id=NEW.aggregate_id AND NOT EXISTS(
        SELECT 1 FROM inventory_movements m
        WHERE m.reservation_id=r.reservation_id AND m.identity_id=r.identity_id
          AND m.quantity=r.quantity AND m.movement_kind='fulfill'
          AND m.command_id=NEW.command_id)));
END;

CREATE TRIGGER commit_finalization AFTER UPDATE OF status ON commit_records
WHEN NEW.status='committed'
BEGIN
  INSERT INTO commit_finalizations(commit_id,request_hash,finalized_at)
  VALUES(NEW.commit_id,NEW.request_hash,NEW.finalized_at);
END;

CREATE TRIGGER append_only_evidence_update BEFORE UPDATE ON evidence_records
BEGIN SELECT RAISE(ABORT,'evidence is immutable'); END;
CREATE TRIGGER append_only_evidence_delete BEFORE DELETE ON evidence_records
BEGIN SELECT RAISE(ABORT,'evidence is retained'); END;
CREATE TRIGGER append_only_verification_update BEFORE UPDATE ON evidence_verifications
BEGIN SELECT RAISE(ABORT,'verification history is immutable'); END;
CREATE TRIGGER append_only_verification_delete BEFORE DELETE ON evidence_verifications
BEGIN SELECT RAISE(ABORT,'verification history is retained'); END;
CREATE TRIGGER append_only_key_update BEFORE UPDATE ON authority_keys
BEGIN SELECT RAISE(ABORT,'key registrations are immutable'); END;
CREATE TRIGGER append_only_key_delete BEFORE DELETE ON authority_keys
BEGIN SELECT RAISE(ABORT,'key registrations are retained'); END;
CREATE TRIGGER append_only_key_event_update BEFORE UPDATE ON authority_key_events
BEGIN SELECT RAISE(ABORT,'key history is immutable'); END;
CREATE TRIGGER append_only_key_event_delete BEFORE DELETE ON authority_key_events
BEGIN SELECT RAISE(ABORT,'key history is retained'); END;
CREATE TRIGGER append_only_assertion_update BEFORE UPDATE ON authorization_assertions
BEGIN SELECT RAISE(ABORT,'authorization history is immutable'); END;
CREATE TRIGGER append_only_assertion_delete BEFORE DELETE ON authorization_assertions
BEGIN SELECT RAISE(ABORT,'authorization history is retained'); END;
CREATE TRIGGER append_only_recovery_update BEFORE UPDATE ON recovery_events
BEGIN SELECT RAISE(ABORT,'recovery history is immutable'); END;
CREATE TRIGGER append_only_recovery_delete BEFORE DELETE ON recovery_events
BEGIN SELECT RAISE(ABORT,'recovery history is retained'); END;
CREATE TRIGGER append_only_order_revision_update BEFORE UPDATE ON order_revisions
BEGIN SELECT RAISE(ABORT,'order revisions are immutable'); END;
CREATE TRIGGER append_only_order_revision_delete BEFORE DELETE ON order_revisions
BEGIN SELECT RAISE(ABORT,'order revisions are retained'); END;
CREATE TRIGGER append_only_order_line_update BEFORE UPDATE ON order_lines
BEGIN SELECT RAISE(ABORT,'order lines are immutable'); END;
CREATE TRIGGER append_only_order_line_delete BEFORE DELETE ON order_lines
BEGIN SELECT RAISE(ABORT,'order lines are retained'); END;
CREATE TRIGGER append_only_reservation_update BEFORE UPDATE ON reservations
BEGIN SELECT RAISE(ABORT,'reservations are immutable'); END;
CREATE TRIGGER append_only_reservation_delete BEFORE DELETE ON reservations
BEGIN SELECT RAISE(ABORT,'reservations are retained'); END;
CREATE TRIGGER append_only_movement_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT,'movements are immutable'); END;
CREATE TRIGGER append_only_movement_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT,'movements are retained'); END;
CREATE TRIGGER append_only_batch_revision_update BEFORE UPDATE ON inventory_batch_revisions
BEGIN SELECT RAISE(ABORT,'batch revisions are immutable'); END;
CREATE TRIGGER append_only_batch_revision_delete BEFORE DELETE ON inventory_batch_revisions
BEGIN SELECT RAISE(ABORT,'batch revisions are retained'); END;
CREATE TRIGGER append_only_batch_line_update BEFORE UPDATE ON inventory_batch_lines
BEGIN SELECT RAISE(ABORT,'batch lines are immutable'); END;
CREATE TRIGGER append_only_batch_line_delete BEFORE DELETE ON inventory_batch_lines
BEGIN SELECT RAISE(ABORT,'batch lines are retained'); END;
CREATE TRIGGER append_only_receipt_revision_update BEFORE UPDATE ON inventory_receipt_revisions
BEGIN SELECT RAISE(ABORT,'receipt revisions are immutable'); END;
CREATE TRIGGER append_only_receipt_revision_delete BEFORE DELETE ON inventory_receipt_revisions
BEGIN SELECT RAISE(ABORT,'receipt revisions are retained'); END;
CREATE TRIGGER append_only_receipt_line_update BEFORE UPDATE ON inventory_receipt_lines
BEGIN SELECT RAISE(ABORT,'receipt lines are immutable'); END;
CREATE TRIGGER append_only_receipt_line_delete BEFORE DELETE ON inventory_receipt_lines
BEGIN SELECT RAISE(ABORT,'receipt lines are retained'); END;
CREATE TRIGGER append_only_identity_update BEFORE UPDATE ON inventory_identity
BEGIN SELECT RAISE(ABORT,'inventory identities are immutable'); END;
CREATE TRIGGER append_only_identity_delete BEFORE DELETE ON inventory_identity
BEGIN SELECT RAISE(ABORT,'inventory identities are retained'); END;
CREATE TRIGGER append_only_batch_delete BEFORE DELETE ON inventory_batches
BEGIN SELECT RAISE(ABORT,'batches are retained'); END;
CREATE TRIGGER append_only_receipt_delete BEFORE DELETE ON inventory_receipts
BEGIN SELECT RAISE(ABORT,'receipts are retained'); END;
CREATE TRIGGER nonce_event_update BEFORE UPDATE ON nonce_records
WHEN NEW.nonce_id<>OLD.nonce_id OR NEW.nonce_value<>OLD.nonce_value
  OR NEW.actor_id<>OLD.actor_id OR NEW.command_id<>OLD.command_id
  OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'nonce identity is immutable'); END;
CREATE TRIGGER append_only_nonce_delete BEFORE DELETE ON nonce_records
BEGIN SELECT RAISE(ABORT,'nonce records are retained'); END;
CREATE TRIGGER append_only_nonce_event_update BEFORE UPDATE ON nonce_events
BEGIN SELECT RAISE(ABORT,'nonce history is immutable'); END;
CREATE TRIGGER append_only_nonce_event_delete BEFORE DELETE ON nonce_events
BEGIN SELECT RAISE(ABORT,'nonce history is retained'); END;
CREATE TRIGGER append_only_policy_history
BEFORE DELETE ON schema_meta BEGIN SELECT RAISE(ABORT,'schema metadata is retained'); END;
```

### 4.1 Required additional insert guards

The script above is completed by the following uniform guards. Each guard is
intentionally explicit so an effect-bearing table cannot acquire rows after
the owning commit is finalized. These are separate triggers because SQLite
triggers are table-specific.

```sql
CREATE TRIGGER order_revision_commit_guard BEFORE INSERT ON order_revisions
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'revision requires applying commit'); END;
CREATE TRIGGER order_line_commit_guard BEFORE INSERT ON order_lines
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'line requires applying commit'); END;
CREATE TRIGGER reservation_commit_guard BEFORE INSERT ON reservations
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'reservation requires applying commit'); END;
CREATE TRIGGER identity_commit_guard BEFORE INSERT ON inventory_identity
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.created_by_commit_id
  AND c.command_id=NEW.created_by_command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'identity requires applying commit'); END;
CREATE TRIGGER batch_commit_guard BEFORE INSERT ON inventory_batches
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'batch requires applying commit'); END;
CREATE TRIGGER batch_revision_commit_guard BEFORE INSERT ON inventory_batch_revisions
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'batch revision requires applying commit'); END;
CREATE TRIGGER batch_line_commit_guard BEFORE INSERT ON inventory_batch_lines
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'batch line requires applying commit'); END;
CREATE TRIGGER receipt_commit_guard BEFORE INSERT ON inventory_receipts
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'receipt requires applying commit'); END;
CREATE TRIGGER receipt_revision_commit_guard BEFORE INSERT ON inventory_receipt_revisions
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'receipt revision requires applying commit'); END;
CREATE TRIGGER receipt_line_commit_guard BEFORE INSERT ON inventory_receipt_lines
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'receipt line requires applying commit'); END;
CREATE TRIGGER movement_commit_guard BEFORE INSERT ON inventory_movements
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'movement requires applying commit'); END;
CREATE TRIGGER evidence_commit_guard BEFORE INSERT ON evidence_records
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'evidence requires applying commit'); END;
CREATE TRIGGER assertion_commit_guard BEFORE INSERT ON authorization_assertions
WHEN NOT EXISTS(SELECT 1 FROM commit_records c WHERE c.commit_id=NEW.commit_id
  AND c.command_id=NEW.command_id AND c.status='applying')
BEGIN SELECT RAISE(ABORT,'assertion requires applying commit'); END;
```

The guards are deliberately redundant with command-specific insert guards:
the command-specific triggers prove semantic binding; the uniform guards
prove that no effect/evidence/assertion row can be appended after finalization.
SQLite cannot authenticate a trusted writer, so a writer able to disable
triggers or alter the database file remains outside this schema's trust
boundary.

## 5. Finalization, immutability, and relationship catalogue

### 5.1 Finalization invariant

The `UPDATE commit_records SET status='committed'` is the only commit boundary.
Its `BEFORE` trigger must establish all of the following before the status
changes:

1. Every `effect_manifest` row for this commit identifies exactly one row in
   its declared target table, with matching `effect_key`, command, commit, and
   target ID.
2. Every effect-bearing target row belonging to this commit has exactly one
   manifest row with the matching target table, target ID, effect key, and
   command. This is the reverse direction, not just manifest-to-effect.
3. Each manifest row has `expected_row_count=1`. Duplicate manifest keys and
   duplicate `(commit,kind,target)` are rejected by PK/UNIQUE constraints.
4. Command-specific completeness triggers prove reservations, movements,
   evidence, approvals, and revisions are complete.
5. After the update, `commit_finalizations` is inserted by trigger. The
   deferred FK from `commit_records` prevents any transaction from committing
   an `applying` row without its finalization witness.
6. All target, evidence, assertion, and manifest insert guards reject rows
   unless the commit is `applying`. Manifest/effect/evidence/assertion and
   history rows reject UPDATE/DELETE. Root aggregate identity fields cannot
   change, including after finalization.

The finalization trigger must contain a `UNION ALL` over every effect-bearing
table and compare every resulting row to the manifest. The complete list is
the twelve target tables named in `effect_manifest.target_type`. Adding a
future effect table requires changing this finalization union in the same
schema migration; an omitted table is a blocking validation failure.

### 5.2 Root/revision identity

- `orders`, `inventory_batches`, and `inventory_receipts` bind their immutable
  aggregate ID, create command, create commit, and root effect key.
- Revision rows bind the same aggregate ID to the command/commit/request hash
  for that revision.
- Root projection update triggers allow only revision/status changes that
  match an already-inserted next revision whose commit is still `applying`.
- Triggers reject changes to root IDs, command IDs, commit IDs, creator fields,
  or root effect keys. Thus a receipt root cannot be rebound while its
  revision remains on the original commit.
- The triggers establish relational consistency, not trusted process identity.

### 5.3 Table/index/trigger catalogue

| Object family | Key relationship and write policy |
|---|---|
| `commands` | PK `command_id`; immutable request and canonical hash; supports one commit and nonce associations. |
| `commit_records` / `commit_finalizations` | PK `commit_id`; UNIQUE `command_id`; composite FK binds type/aggregate/revision/hash; sole transition applying→committed; deferred finalization witness. |
| `effect_manifest` | PK `effect_key`; unique commit/kind/type/target; insert only while applying; no updates/deletes; target must have exactly one effect row. |
| `orders` | PK order ID; immutable create identity; only projection state changes via valid revision insertion. |
| `order_revisions` | PK revision ID; unique order/revision; immutable; exact command/revision/status/hash trigger. |
| `order_lines` | PK line ID; unique order/identity; FK to exact inventory identity and create commit. |
| `reservations` | PK reservation ID; UNIQUE line; composite FK ties exact identity/order/quantity to order line. No release state. |
| `inventory_identity` | PK identity ID; unique six-part business identity; immutable origin identifies bootstrap or selected receipt model. |
| `inventory_batches`, `inventory_batch_revisions`, `inventory_batch_lines` | Batch root, single active revision, immutable itemized count/allocation with exact evidence/assertion FKs. |
| `inventory_receipts`, `inventory_receipt_revisions`, `inventory_receipt_lines` | Receipt root and single received revision; lines bind identity, source evidence, receiver, distinct second approver, and commit. |
| `inventory_movements` / `inventory_balances` | Immutable movement ledger; balances are view-only; CHECK and trigger enforce arithmetic, exact before-state, and movement-kind semantics. |
| `evidence_records`, `evidence_verifications` | Raw bytes/provenance and append-only processing history. Database cannot prove authenticity. |
| `authority_keys`, `authority_key_events` | ES256 key metadata and append-only lifecycle. Online trust/revocation remains Main/service responsibility. |
| `nonce_records` | PK nonce ID, globally UNIQUE non-null value, immutable actor/command/hash identity, constrained transition. |
| `authorization_assertions` | Immutable signature bytes and policy assertion, composite-bound to command, commit, actor, action/resource, nonce, and key. |
| `recovery_events` | Append-only uncertainty, conflict, verification, and human adjudication record; no automatic resolution. |
| `policy_config` | Exactly one owner-approved receipt identity policy; absence blocks receipt finalization; no silent runtime switch. |
| Partial indexes | Enforce at most one reserve, fulfillment, bootstrap, and receipt movement per corresponding line. |
| Append-only triggers | Reject UPDATE/DELETE for commands, manifests, revisions, lines, reservations, movements, identities, evidence, verification, authorization, key history, nonce identity/history, and recovery. |

### 5.4 Additional immutable-row trigger requirement

The complete DDL must include `BEFORE UPDATE` and `BEFORE DELETE` triggers for
every append-only table listed in the catalogue. It must include
`BEFORE UPDATE` and `BEFORE DELETE` triggers for every effect-bearing root
except the narrowly scoped state projection update. The only permitted root
updates are:

- `orders.current_revision/current_status`, after a valid next revision row;
- `inventory_batches.current_revision/status`, after active revision 1;
- `inventory_receipts.current_revision/status`, after received revision 1.

Every such update must preserve all immutable columns and be blocked unless
the matching revision commit is still `applying`.

## 6. Bootstrap model

### 6.1 Atomic bootstrap relationship

Each bootstrap batch is a single `inventory.bootstrap` commit with:

- one pending batch root and one active revision;
- one identity row for each distinct six-part identity;
- exactly one count/allocation line per identity;
- two distinct counter actor IDs and two distinct evidence records bound to
  the same batch line and commit;
- one approval assertion bound to that exact batch line, with approver distinct
  from both counters;
- one exact bootstrap movement per line, with before balances zero and deltas
  equal to approved opening allocation;
- one manifest row per effect-bearing row.

Composite FK:

```sql
FOREIGN KEY(identity_id,identity_origin_kind,batch_id,command_id,commit_id)
  REFERENCES inventory_identity(identity_id,origin_kind,origin_id,
                                 created_by_command_id,created_by_commit_id)
```

The line’s `(batch_id,command_id,commit_id)` must also reference the batch
root. `inventory_identity` has a UNIQUE candidate key over the five referenced
origin fields. `identity_id` is UNIQUE in `inventory_batch_lines`.

Finalization independently checks:

```sql
-- No bootstrap-created identity without exactly one line:
SELECT identity_id
FROM inventory_identity i
WHERE i.created_by_commit_id=:commit_id
  AND i.origin_kind='bootstrap'
  AND NOT EXISTS (
    SELECT 1 FROM inventory_batch_lines l
    WHERE l.identity_id=i.identity_id
      AND l.batch_id=:aggregate_id
      AND l.command_id=:command_id
      AND l.commit_id=:commit_id
  );

-- No line referring to an identity not created by this exact bootstrap:
SELECT l.batch_line_id
FROM inventory_batch_lines l
WHERE l.batch_id=:aggregate_id
  AND NOT EXISTS (
    SELECT 1 FROM inventory_identity i
    WHERE i.identity_id=l.identity_id
      AND i.origin_kind='bootstrap'
      AND i.origin_id=:aggregate_id
      AND i.created_by_command_id=:command_id
      AND i.created_by_commit_id=:commit_id
  );
```

Both queries must return zero rows. The finalizer also checks that every line
has two verified evidence references, one allowed distinct approver, and one
movement equal in identity, quantity, allocation deltas, and zero-before
snapshot. The line’s CHECK enforces
`opening_available + opening_reserved = counted_qty`. No identity inserted
after commit can pass the identity insert guard because its owning commit is
not applying.

### 6.2 Bootstrap transaction

1. Main validates the canonical request, complete identity classification,
   counts, allocations, distinct actors, evidence bytes, ES256 approvals,
   policy, and nonce.
2. Persist immutable command. Persist and consume the nonce in its own durable
   transaction. A later business rollback does not free the nonce.
3. `BEGIN IMMEDIATE`.
4. Insert applying commit, required authorization assertion, evidence and
   verification rows, complete manifest.
5. Insert pending batch; insert all inventory identities with origin
   `bootstrap`; insert one count line per identity.
6. Insert one bootstrap movement per line from zero balance.
7. Insert immutable active revision 1. Its trigger checks line/evidence/
   movement presence and updates root projection.
8. Update commit to committed. The finalizer runs both directions and all
   command-specific completeness checks.
9. `COMMIT`; deferred FKs and the finalization witness are checked.
10. Read back committed root, full identity/line/evidence/approval/movement
    sets, manifest membership, and derived balances. Any uncertain response
    follows §10; never reverse automatically.

## 7. Receipt identity models and unresolved business decision

### Model A — receipt may create a new identity

In one `inventory.receipt` transaction, a line may reference either an
existing identity or one created in that same receipt commit. For a new
identity, the request must provide the complete medicine, unit, tracking, lot,
and expiry components. The receipt command creates the identity, its source
evidence record, receiver association, distinct approval assertion, receipt
line, positive receipt movement, and manifests atomically. Finalization
requires every identity created by the receipt commit to be referenced by
exactly one line in that receipt, and every line’s movement/evidence/approval
to match exactly. A new identity cannot carry a positive balance without that
chain.

This is the most coherent model for receiving a genuinely new lot or expiry
identity without misclassifying physical receipt as bootstrap. It preserves
the approved receipt evidence/receiver/second-approver conditions, but requires
business approval that receipt can establish a new identity.

### Model B — receipt limited to pre-established identities

`inventory.receipt_lines.identity_id` must reference an identity whose
bootstrap commit is already committed before the receipt begins. Receipt
cannot insert identity rows. For an unseen medicine/unit/lot/expiry
combination, an independently authorized bootstrap must establish the identity
before the receipt; this must not be used as a way to import legacy stock or
claim received quantity as an opening physical count. The later receipt still
requires its own source evidence, receiver, independent approver, and positive
receipt movement.

This is the conservative interpretation of Stage 36A70F’s explicit
“existing identity” precondition, but it creates a two-operation workflow for
a new lot and raises a substantive policy question about whether bootstrap
counting is appropriate for newly delivered goods.

### Comparison and decision gate

The existing approved decisions require receipt evidence and independent
approval, prohibit legacy stock conversion, and define bootstrap evidence for
physical opening counts. They do **not** explicitly decide whether receipt may
create a new inventory identity. Neither Model A nor Model B may be selected
by inference. `policy_config` therefore has no initial row, and receipt
finalization is blocked until the owner approves one. This unresolved business
decision determines the final status.

## 8. Command transaction protocols

All commands use `BEGIN IMMEDIATE`. Commands and consumed nonces are durable
before the business transaction as described in §10. Every business mutation,
effect-manifest entry, effect row, and final commit transition occurs in one
SQLite transaction.

### Common command envelope

1. Authenticate actor, validate the closed schema, canonicalize JSON, compute
   request hash and effect keys, validate safe integers/dates/classification,
   verify evidence and online authorization.
2. Insert or reuse the immutable command row. Reusing an ID with a different
   request hash/type/aggregate/revision is a hard conflict.
3. In a separate `BEGIN IMMEDIATE`, insert nonce as `presented`, transition to
   `reserved`, then `consumed`, and `COMMIT`. Never reuse after business
   rollback.
4. `BEGIN IMMEDIATE`. If `commit_id` already exists, compare all immutable
   identities. Exact match: verify the complete committed effect set and return
   the original result. Mismatch: append an explicit conflict observation and
   fail closed.
5. Insert applying commit, assertions/evidence, and full manifest. Insert all
   effect rows. Perform command-specific writes and trigger effects.
6. Transition applying→committed exactly once. The finalization trigger checks
   manifest equality, target IDs, command-specific completeness, and auth.
7. `COMMIT`. Deferred FKs require finalization. Read back the entire expected
   effect set and balance/revision state. On an uncertain result, do not
   re-submit as a new identity or automatically reverse.

### `order.create`

- Preconditions: revision 0; nonempty lines; identities active and explicitly
  classified; each quantity positive safe integer; available balance covers
  each line; authorized assertion and consumed nonce.
- Insert command and applying commit, authorization, manifest, order root at
  revision 0, each unique exact order line, matching reservation, and reserve
  movement with current derived snapshot.
- Insert revision 1 `pending` using `order.create`, expected revision 0.
  Trigger applies root projection.
- Finalizer requires each line to have exactly one exact reservation and one
  reserve movement; any shortage or omitted line rolls back every write.
- Commit, then verify balances and manifest.

### `order.accept`

- Preconditions: pending/revision 1; expected revision 1; explicit authorized
  administrative actor.
- Insert command/commit/assertion/one revision manifest. Insert revision 2
  `accepted` using `order.accept`.
- Finalizer requires revision 2 and zero movement rows for the command.
- Commit and verify order projection unchanged except revision/status.

### `order.fulfill`

- Preconditions: accepted/revision 2; physical handoff recorded; explicit
  authorization.
- Insert command/commit/assertion/manifests. Insert one fulfill movement for
  every reservation while the order remains accepted/revision 2. Then insert
  revision 3 `fulfilled`.
- Finalizer requires a bijection between reservations and fulfillment
  movements, same identity/quantity, and no duplicates/extras.
- Commit and verify all reserved quantities are zero for the fulfilled order.

### `inventory.bootstrap`

Use the atomic sequence in §6.2. It creates opening balance only from an exact,
fully itemized count/allocation and complete evidence/approval chain. A new
identity’s balance is zero until its one bootstrap movement exists.

### `inventory.receipt`

- Preconditions: approved policy row; positive quantity; source evidence;
  receiver distinct from second approver; valid assertion and nonce.
- Model A: insert a new identity in the same transaction if not yet known,
  then evidence, approval, receipt line, movement, manifest, and revision.
- Model B: require the referenced identity and its bootstrap origin to be
  committed before the receipt transaction; identity insertion is prohibited.
- Under either model, each receipt line has one positive movement and one
  verified source evidence record and approval bound to the exact line and
  commit. Finalization requires exact line/movement membership.

## 9. Enforcement boundary

| Invariant | Boundary |
|---|---|
| PK/FK/UNIQUE, six-component inventory identity, nonempty ID syntax, expiry pair/date format, safe integer bounds | SQLite |
| Command/commit/request identity cross-binding; exact revision mapping; root/revision identity immutability | SQLite constraints/triggers, assuming triggers are enabled |
| Applying-only inserts; bidirectional manifest/effect completeness; post-finalization insert rejection | SQLite constraints/triggers |
| Bootstrap identity ↔ count line bijection and exact movement/evidence/approval links | SQLite FK/trigger/finalization checks |
| Receipt identity policy selection | Owner business approval; SQLite requires explicit persisted policy |
| Medicine/unit existence, canonical JSON/hash computation, effect-key computation | Main process |
| Evidence source authenticity, ES256 signature verification, trusted key state/revocation, online authorization | Main process / managed authority service |
| Truth of actor identity and separate humans behind distinct actor IDs | Main process / identity provider |
| Nonce issuance and durable no-reuse semantics | SQLite uniqueness/state plus Main transaction protocol |
| `SQLITE_BUSY` retry and no definitive rejection | Main process |
| First successful COMMIT wins, full-result retry verification, uncertain outcome handling | SQLite unique IDs plus Main recovery protocol |
| Main-only DB ownership/narrow IPC, filesystem ACLs, backup, key custody, WAL deployment and crash recovery | Operational |
| No legacy stock conversion, no automatic retention deletion, no permission inheritance | Main migration boundary, operational retention, authorization policy |

SQLite does not recognize a “trusted internal write.” A writer with direct file
access can construct a valid-looking command/evidence set, falsify actor labels,
or disable enforcement outside the controlled connection. The operational
single-writer boundary remains mandatory and is not replaced by triggers.

## 10. Recovery, idempotency, concurrency

- Policy Y: first successful `COMMIT` for a `commit_id` wins.
- Commit ID and command ID are immutable unique keys. Exact retry compares
  command type, aggregate type/ID, expected revision, request hash, and the
  entire manifest/effect result. A mismatch is an explicit conflict, never an
  update of the winning commit.
- A `submission_unknown` record is not resolved by absence from a stale
  connection or by an error return. Reopen a healthy connection, query the
  commit ID, compare every expected effect and resulting revision/balance, and
  record the observation. If comparison is incomplete or inconsistent, stop
  for human adjudication; do not auto-repair/reverse.
- `SQLITE_BUSY` is transient. Retry with bounded backoff or record uncertainty;
  never return definitive business rejection solely for BUSY.
- `BEGIN IMMEDIATE` serializes writers before balance reads. Every movement
  compares its before snapshot with `inventory_balances`; the next competing
  writer sees the committed ledger result. A transaction that cannot obtain
  the writer lock has not rejected the business request.
- Nonce state is committed separately. Business rollback never restores
  `presented` or frees the nonce. Replay after rollback and after success must
  fail by unique nonce value or assertion uniqueness.
- Do not delete history automatically. Human adjudication is an append-only
  recovery event and does not change or reverse an existing commit.

## 11. Table and object write-boundary inventory

| Table | PK / candidate keys | Mutability and principal FKs |
|---|---|---|
| `schema_meta` | `key` | Schema migration metadata only; no runtime deletion. |
| `policy_config` | singleton `1` | Insert once after owner decision; immutable absent approved migration. |
| `commands` | `command_id`; `(command_id,request_hash)` | Immutable; unique logical request. |
| `commit_records` | `commit_id`; unique `command_id` | Only applying→committed; cross-FK to command and finalization witness. |
| `commit_finalizations` | `commit_id`; `(commit_id,request_hash)` | Inserted by status trigger; immutable. |
| `effect_manifest` | `effect_key`; unique commit/kind/target | Insert only during applying; immutable. |
| `evidence_records` | `evidence_id`; composite resource binding | Raw bytes immutable, commit-scoped. |
| `authority_keys` | `key_id`; unique key/algorithm | Immutable metadata; ES256 only. |
| `authority_key_events` | `key_event_id` | Append-only, FK to key. |
| `nonce_records` | `nonce_id`; unique nonce value | Identity immutable; only declared forward state transitions. |
| `authorization_assertions` | `assertion_id`; unique `nonce_id` | Immutable; exact commit/command/action/resource/actor/key binding. |
| `evidence_verifications` | `verification_id` | Append-only result history; FK to evidence. |
| `orders` | `order_id`; `(order_id,command_id,commit_id)` | Immutable identity; projection only by valid revision trigger. |
| `order_revisions` | `revision_id`; unique `(order_id,revision)` | Immutable; exact command/commit/hash mapping. |
| `inventory_identity` | `identity_id`; six-field canonical candidate key | Immutable; origin-bound to bootstrap line or receipt line under approved mode. |
| `order_lines` | `line_id`; unique `(order_id,identity_id)` | Immutable; FK to identity/order/manifest. |
| `reservations` | `reservation_id`; unique line | Immutable exact line/identity/quantity. |
| `inventory_batches` | `batch_id` | Immutable identity; only pending→active projection transition. |
| `inventory_batch_revisions` | `batch_revision_id`; unique batch/revision | Immutable single active revision. |
| `inventory_batch_lines` | `batch_line_id`; unique identity | Immutable count, dual evidence/counters, approver, allocation. |
| `inventory_receipts` | `receipt_id` | Immutable identity; only pending→received projection transition. |
| `inventory_receipt_revisions` | `receipt_revision_id`; unique receipt/revision | Immutable single received revision. |
| `inventory_receipt_lines` | `receipt_line_id`; unique receipt/identity | Immutable quantity, evidence, receiver, approver. |
| `inventory_movements` | `movement_id`; unique movement/manifest key | Append-only; kind-specific FKs and arithmetic checks. |
| `inventory_balances` | View | Derived only; no writable balance table. |
| `recovery_events` | `recovery_event_id` | Append-only observations/adjudication. |

## 12. Self-contained validation suite specification

This is a test plan, not an execution report. No result is claimed. An
independent validator must put §4 DDL in a fresh file-backed database, apply
the runtime pragmas, and run every test below using savepoints for negative
operations. The complete hostile SQL is given for each case. `:name` denotes
a bound SQLite parameter; fixture setup is done once per test in a fresh
database, or restored by rolling back to its savepoint.

### 12.1 Common assertions and transaction wrapper

```sql
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;       -- expect one row: wal
PRAGMA synchronous=FULL;
PRAGMA synchronous;            -- expect 2
SELECT sqlite_version();       -- expect >= 3.46.0
SELECT json_valid('{}');       -- expect 1
```

For each mutation test:

```sql
BEGIN IMMEDIATE;
SAVEPOINT hostile;
-- Execute one attempted mutation from the relevant test row.
-- Assert the documented error or expected insert/update result.
ROLLBACK TO hostile;
RELEASE hostile;
ROLLBACK;
```

For tests expecting a successful command, use a fresh database and `COMMIT`;
then inspect the stated queries. For a negative test inside an applying
command, catch the SQL error, roll back the savepoint and whole transaction,
then verify there is no commit, effect, movement, or projection change.

The fixture builder must use distinct valid 64-lowercase-hex request hashes
and effect keys, derive them using the §3 algorithms, and create exact
`effect_manifest` rows for each target row. It must never insert hand-waved
“valid fixtures.” Use deterministic test IDs and UTC timestamps. Seed a
committed bootstrap with one identity `med-a/each/tracked/lot-a/none/''`,
count 10, opening available 10, reserved 0, two counter evidence records,
distinct counters and approver, one bootstrap movement, and one active batch
revision. Configure receipt mode explicitly for receipt tests:

```sql
INSERT INTO policy_config
  (singleton,receipt_identity_policy,approved_by_actor_id,approved_at)
VALUES (1,'receipt_may_create','test-owner','2026-11-12T10:00:00.000Z');
```

For Model B tests use `'existing_only'` instead. Seed authorization assertions
through consumed, unique nonce rows; use the proper ES256 signature-shaped test
bytes and clearly treat cryptographic verification as outside SQLite. The
validator must retain the exact DDL SHA-256, runtime version/compile options,
all SQL, errors/results, row counts, FK check, and integrity check.

### 12.2 Required scenarios and hostile SQL

| ID | Setup and exact attempted operation | Expected result and final observable state |
|---|---|---|
| H01 Whole DDL / integrity | Execute §4 as one script in a new file DB; run `PRAGMA foreign_key_check; PRAGMA integrity_check;` | No script error; no FK rows; `ok`. |
| H02 WAL/FULL/reopen | Configure pragmas; close all connections; reopen and reapply connection-scoped pragmas; query journal mode, synchronous, foreign_keys. | File reports `wal`; every connection reports synchronous `2`, foreign_keys `1`. Crash/reopen test must preserve either the whole committed command or none, never a partial command. |
| H03 Valid bootstrap | Run complete fixture transaction described above, then query `inventory_batches`, identity, batch lines, bootstrap movement, and `inventory_balances`. | One active revision-1 batch; identities=count lines=bootstrap movements; balance `(10,0)`. |
| H04 Bootstrap orphan identity | During a valid applying bootstrap add an identity and manifest but no line, evidence, approval, or movement; finalize. Attempt: `INSERT INTO inventory_identity(identity_id,medicine_id,canonical_unit,tracking_state,lot_id,expiry_state,expiry_date,origin_kind,origin_id,created_by_command_id,created_by_commit_id,effect_key) VALUES('i-extra','med-b','each','tracked','lot-b','none','','bootstrap','batch-1','cmd-b','commit-b',:key);` Add matching manifest but no line/movement, then `UPDATE commit_records SET status='committed',finalized_at=:now WHERE commit_id='commit-b';`. | Finalization aborts; after whole transaction rollback, no batch, identity, line, movement, finalization, or committed commit remains. |
| H05 Bootstrap reverse orphan | Insert a line whose identity has no exact same-batch origin, or change origin fields. | Composite FK/CHECK rejects; finalization remains impossible. |
| H06 Bootstrap zero allocation and no effects | Try positive identity balance without a count line/movement; then attempt revision 1 and commit. | Movement/FK/finalizer rejects; zero committed inventory. `counted_qty` must be positive and allocation sum exact. |
| H07 Identity classification | With applying bootstrap and matching manifest, insert tracking `unknown`, empty tracked lot, nonempty untracked lot, expiry `unknown`, missing unit, invalid calendar date `2026-02-31`, `expiry_state='none'` with a date, `expiry_state='date'` with `''`, and `medicine_id=''`. | Every row rejected by CHECK; no identity persisted. |
| H08 Identity format versus catalog | Try uppercase/space/slash medicine ID and canonical-valid but nonexistent medicine ID. | Malformed form rejected by SQLite. Well-formed but unknown catalog ID must be rejected by Main catalog validation; SQL alone cannot establish catalog membership. |
| H09 Order trigger legitimate write | Apply complete order.create with exact line, reservation, movement, revision 1. | Succeeds; order root is `(1,'pending')`, balance available 7/reserved 3 for quantity 3. |
| H10 Direct order-state update | On committed pending order attempt `UPDATE orders SET current_status='fulfilled',current_revision=3 WHERE order_id='order-1';` | Abort; root remains `(1,'pending')`; revisions remain exactly one. |
| H11 Repeated/skipped/wrong-command revisions | For independent fresh pending order fixtures try repeated revision 1; revision 3 before revision 2; revision 2 with command type `order.fulfill`; revision 2 with wrong aggregate, expected revision, commit ID, or request hash. | Trigger/FK/UNIQUE error; no projection change; no extra history row. |
| H12 Revision request cross-bind | Change `request_hash` in revision while command and commit remain valid, or use command from another order. | FK or revision guard rejects; no revision row. |
| H13 Multi-line atomic shortage | Seed two identities with available 5 each. `order.create` lines request 3 from first and 6 from second; execute exact line/reservation/movement insert sequence and finalize. | Second movement/finalizer fails. Roll back entire transaction; order, lines, reservations, movements all absent; both balances unchanged `(5,0)`. |
| H14 Reservation substitution | Under applying order.create attempt reservation with `quantity=2` while line quantity is 3, or identity/order from another line. | Composite FK or reservation trigger rejects; zero reservation/movement after rollback. |
| H15 Duplicate reserve / over-reserve | Attempt a second reserve movement for same reservation, or one whose `before_available` is below requested quantity. | Partial unique index or balance guard rejects; ledger sums unchanged. |
| H16 Valid acceptance zero effect | Apply exact revision 2 `accepted` command and finalize. Query movements by accept command. | Success; zero movements; root is `(2,'accepted')`. |
| H17 Acceptance inventory effect | Insert reserve/fulfill/receipt movement under `order.accept`, then finalize. | Kind-specific command guard/finalizer rejects; transaction rollback preserves accepted/pending state as applicable. |
| H18 Valid fulfillment | After accepted order with multiple lines, insert one exact fulfillment movement per reservation then revision 3. | Success; movement count equals reservation count; quantities/identities match; root fulfilled; reserved balances for those reservations are zero. |
| H19 Omitted fulfillment | Omit one movement and insert revision 3/finalize. | Trigger/finalizer aborts; whole fulfillment transaction rolled back; order remains accepted and reservations remain held. |
| H20 Duplicate fulfillment | Repeat a fulfillment movement for same reservation. | Unique partial index rejects; no duplicate movement; committed prior state unchanged. |
| H21 Extra/substituted fulfillment | Add movement for unrelated reservation/identity/quantity or a reservation not in aggregate. | Trigger/FK rejects; no revision 3 or partial consumption after rollback. |
| H22 Movement arithmetic | Attempt wrong `on_hand_delta`, wrong `after_available`, wrong `after_reserved`, negative resulting balance, and values above safe integer. | CHECK or movement guard rejects each; ledger and view balances unchanged. |
| H23 Movement before-state mismatch | Set before snapshot different from current view result; insert otherwise valid movement. | Trigger aborts; no movement; derived balance unchanged. |
| H24 Movement UPDATE/DELETE | On committed movement run `UPDATE inventory_movements SET quantity=quantity+1 WHERE movement_id='m1';` and separately `DELETE FROM inventory_movements WHERE movement_id='m1';`. | Each aborts; row bytes/values and view balances remain unchanged. |
| H25 Balance direct write | `UPDATE inventory_balances SET available_qty=99 WHERE identity_id='i1';` | SQLite reports view not writable; ledger and balances unchanged. |
| H26 Manifest omitted effect | Insert actual target row with absent manifest key, then try final commit. | Deferred FK or finalizer rejects; no commit can finalize. |
| H27 Orphan manifest | Insert manifest entry without target row, then finalize. | Finalizer aborts; commit remains applying within transaction and whole transaction rollback removes it. |
| H28 Wrong target / duplicate effect | Declare `target_type='inventory_receipts'` for an identity row, wrong target ID, duplicate key, or duplicate commit/kind/target. | FK/finalizer/UNIQUE rejects; no committed effect. |
| H29 Post-commit manifest insertion | After valid committed receipt execute `INSERT INTO effect_manifest(...) VALUES(...,'receipt-commit',...);`. | BEFORE INSERT trigger aborts with applying-state error; no row added. |
| H30 Post-commit effect insertion | After valid committed receipt attempt a new receipt line, identity, movement, revision, or evidence row bound to its committed commit. | Each insert aborts; counts and manifest remain exactly as finalized. |
| H31 Post-commit receipt rebind | Exact Stage G attack: `UPDATE inventory_receipts SET command_id='bootstrap-command',commit_id='bootstrap-commit',effect_key=:new_key WHERE receipt_id='receipt-1';` | Update trigger aborts; root still matches its revision’s command/commit/effect; FK and integrity checks remain clean. |
| H32 Bootstrap ↔ identity/line/movement bijection | At finalization compare identities created by bootstrap commit, batch lines, and bootstrap movements in both directions using §6 queries and anti-joins. | All set differences empty on valid fixture; any extra/missing member aborts finalization. |
| H33 Receipt Model A new identity | With policy `receipt_may_create`, create new fully classified identity plus evidence, distinct receiver/approver, line, positive movement and manifests in one receipt commit. | Commit succeeds only when all linked rows exist; new identity balance is exactly receipt quantity. |
| H34 Receipt Model A incomplete chain | Omit evidence, approval, movement, or manifest for the new identity/line; finalize. | Abort and transaction rollback leaves no new identity, receipt, line, or positive balance. |
| H35 Receipt Model B existing-only | Configure `existing_only`; attempt identity creation within receipt command and then a receipt line for it. | Identity insert rejected. A receipt against previously bootstrapped identity succeeds with exact source evidence/receiver/second approval/movement. |
| H36 Invalid evidence binding | Use nonexistent evidence ID; evidence from another commit; wrong resource ID; wrong resource kind; or evidence acquired by someone other than receiver/counter. | Composite FK rejects; no receipt/bootstrap finalization. |
| H37 Same actor receiver/approver | Insert receipt line with `receiver_actor_id=second_approver_actor_id`. For bootstrap repeat approver=counter. | CHECK rejects. Main must additionally verify the actor IDs denote distinct people, not merely distinct strings. |
| H38 Nonce replay after rollback | Commit command and nonce preparation; begin business transaction, perform incomplete effects, roll back; try inserting the same `nonce_value` under a new nonce ID/command. | UNIQUE rejects. Original nonce remains consumed/recorded; no business commit/effects remain. |
| H39 Nonce replay after success | After successful command try same nonce under same command and under a different command; try NULL and initial `consumed`. | Duplicate/NOT NULL/transition guards reject; original assertion and nonce history unchanged. |
| H40 Append-only update/delete inventory | For each of commands, manifests, revisions, order lines, reservations, identities, movements, batch lines/revisions, receipt lines/revisions, evidence, verification, assertions, keys/key-events, nonce, and recovery: attempt one UPDATE and one DELETE by primary key. | All reject; row counts/content unchanged. Only declared commit and nonce forward state transitions are permitted. |
| H41 Same commit ID, identical request | Submit same command/request/commit twice. Second attempt queries existing commit before writes and verifies entire manifest/effect set. | Return original committed outcome; no new rows, effects, movement, or revision. |
| H42 Same commit ID, conflicting request | Reuse commit ID with changed hash, command, aggregate, or expected revision. | Unique/composite FK or Main identity comparison rejects; winning commit unchanged; append conflict observation separately. |
| H43 Uncertain COMMIT | Commit valid transaction, simulate lost response, close/reopen, query by commit ID; separately simulate rollback/no commit. | Case 1 exact complete committed effect set is returned. Case 2 no commit exists and is not called committed. Partial/corrupt states stop for adjudication; no auto-reversal. |
| H44 Concurrent competing reservations | Connection A `BEGIN IMMEDIATE`, read balance, reserve 4 of 5; connection B attempts `BEGIN IMMEDIATE` for 4. Commit A; retry B from fresh transaction reading ledger. | B initially gets `SQLITE_BUSY` or waits; after retry its movement is rejected for insufficient availability. Final available 1, reserved 4, never negative; BUSY is not a definitive rejection. |
| H45 Concurrent duplicate commit ID | Two file connections submit same commit ID/request under `BEGIN IMMEDIATE`. | One wins; second waits, then exact-verifies same outcome; no duplicate effects. Conflicting request under same ID fails closed. |
| H46 FULL/WAL crash/reopen | In a disposable file DB, commit a complete command and separately terminate a test process before COMMIT. Reopen and run `foreign_key_check`, `integrity_check`, query commit and effects. | After committed transaction expect complete command; before commit expect none. Document actual OS/filesystem results; do not infer universal power-loss immunity. |
| H47 Recovery/BUSY | Hold writer lock, force second connection BUSY, append attempt observation only when possible after lock release, then requery identity. | No definitive rejection based solely on BUSY. Unknown result is resolved only by full commit/effect comparison. |
| H48 Final audits | `PRAGMA foreign_key_check; PRAGMA integrity_check;` plus compare all balance view fields with grouped movements and enumerate `sqlite_schema`. | Zero FK rows, `ok`, exact balance agreement, all expected DDL objects present. |

The Stage 36A70G negative-test gaps are covered by H10–H12, H13–H15,
H18–H24, H26–H32, H36–H47. These are expected results only, not test results.

## 13. Traceability matrix

| Approved decision / Stage 36A70G defect | Implementation reference |
|---|---|
| Five release-one commands only | `commands.command_type` CHECK; §3.1, §8 |
| Exact pending→accepted→fulfilled lifecycle | Order revision guard and §8 order command protocols |
| Create reserves atomically | Reservations/movements and H09, H13–H15 |
| Acceptance has zero inventory effects | Finalizer command-specific check; H16–H17 |
| Fulfillment consumes exact reservation | Movement guard, uniqueness, finalizer; H18–H21 |
| Bootstrap physical count and independent count | Batch line dual evidence/counter relationships; §6, H03–H06 |
| Separate bootstrap/receipt approver | Actor inequality, assertion FK; H37 |
| Receipt source evidence and receiver | Receipt line composite evidence FK; §7, H33–H37 |
| No legacy import | No migration/import command; Main migration boundary §9 |
| No release/cancel/reject/expiry/correction/reversal/return | Closed command and movement enums; §3.1 |
| No automatic history deletion | Append-only triggers; H40 |
| BUSY is not rejection | §10, H44, H47 |
| First successful commit wins | Unique commit and immutable identity; H41–H43 |
| No silent conflict resolution/reversal | Append-only recovery records, §10, H42–H43 |
| Missing classification blocks operations | Identity CHECKs and Main catalog validation; H07–H08 |
| Main-only DB ownership/narrow IPC | Operational boundary §9 |
| No permission inheritance | Explicit per-command assertion and Main policy; §9 |
| Pending reservations may remain indefinitely | No timeout/release transition; §3.1 |
| G critical post-commit receipt rebind | Root identity update guards and applying-only inserts; H29–H31 |
| G critical post-finalization manifest/effect insertion | Applying-only guards, irreversible finalization; H29–H30 |
| G manifest one-way completeness | Bidirectional finalization anti-joins; H26–H28, H32 |
| G bootstrap unitemized identity | Composite origin FK and two-way identity/line/movement checks; §6, H04–H06, H32 |
| G receipt new-identity gap | Explicit Model A and Model B; required policy row; §7, H33–H35 |
| G empty medicine ID | Canonical nonempty medicine ID CHECK; H07–H08 |
| G missing negative validation | Complete scenario list and exact hostile SQL; §12 |

## 14. Unresolved prerequisites and final status

1. **Business approval required:** choose receipt identity policy `existing_only`
   or `receipt_may_create`. The choice affects identity provenance, receipt
   workflow, and the exact set of identity-creation commands. It cannot be
   inferred from the current approved decisions.
2. Approve the authoritative medicine/unit catalog grammar and identifier
   lifecycle. SQLite validates string syntax; Main validates catalog truth.
3. Define canonical JSON serialization and test hash parity in Main.
4. Select managed ES256 authority service, key custody, rotation/revocation,
   actor identity source, and online policy boundary.
5. Verify the actual Electron SQLite runtime, file ACLs, WAL operation,
   backups, recovery, and crash behavior on supported Windows filesystems.
6. Define maximum order line count and practical database size.
7. Define authorized human adjudicators for uncertain/corrupt commit evidence.

The proposed DDL and test suite are design artifacts only. They were not
executed. The receipt identity policy remains unresolved, so this document
does not qualify as ready for independent validation or implementation until
the owner selects a model and the corresponding DDL is independently checked.

`STAGE_36A70H_BUSINESS_DECISION_REQUIRED`

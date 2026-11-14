# Stage 36A70F — Corrected SQLite DDL Specification

**Version:** 1.0  
**Status:** `STAGE_36A70F_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`  
**Scope:** Design and specification only. This DDL has not been executed or independently validated.

## 1. Executive determination

This specification replaces the Stage 36A70D design, which Stage 36A70E
rejected after reproducing failures. Its core changes are:

- The order live-state update trigger permits only a state update matching an
  already-inserted next revision. The revision trigger performs that update;
  an arbitrary update without the matching revision is rejected.
- Inventory balances are a read-only view derived from append-only movements.
  No balance-update trigger or writable balance table exists. The first
  bootstrap movement starts at an implicit zero balance for a newly inserted
  identity.
- Orders are itemized by exact inventory identity. A reservation is one-to-one
  with an order line, and fulfillment movement is one-to-one with that
  reservation.
- Effect rows are relationally linked to a manifest entry, keyed one-to-one,
  and checked as a complete set when the commit record is finalized. The
  Main process remains responsible for deriving the effect key and verifying
  the canonical manifest hash.
- Unknown/incomplete inventory classification and invalid expiry combinations
  are rejected. Untracked is accepted only as an explicit classification with
  its canonical empty lot component.
- Append-only facts are protected from UPDATE/DELETE. The controlled Main
  process remains the only database writer; SQLite cannot authenticate a
  writer process or cryptographically authenticate external evidence.

The schema deliberately does not implement release, cancellation, rejection,
expiry, correction, reversal, or return-driven inventory changes. Pending
reservations have no automatic timeout or release.

The proposed DDL and all validation procedures below require independent
execution and review. “Ready” means ready for that next validation stage; it
does not claim this SQL has run successfully.

## 2. Source and defect disposition

The complete Stage 36A70D specification and the Stage 36A70E report are
available in the conversation. The Stage 36A70E findings are dispositioned
here:

| Stage 36A70E finding | Disposition in this design |
|---|---|
| Revision trigger blocked its own order update | Update guard checks the matching next revision row. No general “no update” trigger blocks the revision trigger. |
| Movement trigger blocked its own balance update | Balance updates are eliminated. `inventory_balances` is a view over the movement ledger. |
| Bootstrap required pre-existing state | New identity starts at zero in the view; bootstrap inserts identity then the first opening movement in one transaction. |
| Repeated pending/skipped lifecycle revisions | Revision trigger binds revision number, status, command type, expected revision, aggregate, commit, and hash. |
| Unknown classification accepted | `tracking_state` permits only explicitly classified `tracked` or `untracked`; no `unknown` state is insertable. |
| Date shape check accepted invalid dates/sentinel bypasses | No sentinel date is used. Dated expiry uses calendar normalization check plus strict Main-process parsing. |
| Movement snapshots were unchecked | Movement trigger compares `before_*` with the derived current balance and checks after/delta arithmetic and nonnegative safe bounds. |
| Manifest was not linked to effects | Effect-bearing rows have a deferred FK to one manifest key; target kind/ID is checked at insertion; commit finalization checks exact one-row membership and counts. |
| Reservation did not reconcile to order lines | Each line has exactly one reservation and each reservation is tied to the exact identity and quantity; fulfillment consumes each reservation once. |
| Evidence/approval references were loose | Bootstrap and receipt lines use composite FKs binding evidence and authorization assertion to commit/resource; actors are distinct by CHECK. |
| Nonce could be replayed | Nonce value is globally UNIQUE and non-null; transitions are constrained; rollback never frees the nonce. |
| Append-only history was mutable | UPDATE/DELETE triggers reject changes to append-only records. |
| Commit/command/aggregate records were unbound | Composite FKs and insert triggers bind command, commit, request hash, type, aggregate, revision, and effect. |
| Authorization metadata was mistaken for proof | ES256-only trust-key metadata and signed assertion bytes are retained; cryptographic and online decisions are Main-process-only. |
| Recovery did not preserve enough evidence | Append-only attempt/recovery events preserve observations; no automatic adjudication is specified. |
| Hashes/IDs/ranges were weakly constrained | DDL checks identifier grammar, lowercase hex, and safe-integer range; Main process additionally verifies canonical request/hash. |
| FULL/WAL assumptions not tested | This specification requires SQLite >= 3.46.0, JSON functions, file-backed WAL, and FULL. The target runtime still requires operational verification. |

## 3. Runtime, canonical forms, and fixed bounds

### 3.1 Required runtime

- Minimum SQLite: **3.46.0**.
- Required SQL features: foreign keys, recursive-free triggers, partial indexes,
  JSON functions (`json_valid`), `STRICT` tables, and date functions supporting
  `date(value, '+0 days')`.
- Open the actual file-backed database with:
  `PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;`
- The application must read back and verify the pragma values on every
  connection. `journal_mode=WAL` must return `wal`; `synchronous` must return
  `2` (`FULL`).
- No claim is made here that a particular Electron SQLite driver or storage
  device has been validated.

### 3.2 IDs, hashes, timestamps, JSON, integers

- IDs are 1–128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*`.
- SQLite directly checks this grammar on `command_id`, `aggregate_id`, and
  `commit_id`. The trusted Main process applies the same grammar to every
  generated table-row ID, actor ID, key ID, nonce ID/value, and evidence ID
  before binding it; the DDL does not claim per-column grammar checks for
  those opaque values.
- SHA-256 fields are exactly 64 lowercase hexadecimal characters.
- Request hash is
  `lower_hex(SHA256(UTF8("drug-manager.request.v1\0" || request_json)))`.
  Canonical request JSON includes command type, aggregate identity, expected
  revision, canonicalization version, and closed-schema business fields.
  Main checks that these envelope fields agree with relational columns.
- JSON fields are valid JSON. Request JSON must additionally be canonical
  version 1 as produced and checked by the trusted Main process.
- Timestamps are UTC RFC 3339 strings with millisecond precision:
  `YYYY-MM-DDTHH:MM:SS.SSSZ`. SQL checks parseability; Main validates strict
  canonical formatting.
- Integer quantities and balance snapshots are restricted to
  `0..9007199254740991`. Deltas are bounded by the symmetric safe range.
- Hashes detect request/content mismatches; a hash alone is not authenticity.

## 4. Complete proposed DDL

The following script is ordered for a fresh database. The Main process must
execute each mutation command with the transaction protocol in §7. The
`applying` commit status must never be committed as a successful command.

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE schema_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  CHECK (length(key) BETWEEN 1 AND 128)
) STRICT;

CREATE TABLE commands (
  command_id TEXT PRIMARY KEY NOT NULL,
  command_type TEXT NOT NULL CHECK (command_type IN (
    'order.create','order.accept','order.fulfill',
    'inventory.bootstrap','inventory.receipt'
  )),
  aggregate_type TEXT NOT NULL CHECK (aggregate_type IN (
    'order','inventory_batch','inventory_receipt'
  )),
  aggregate_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (
    expected_revision BETWEEN 0 AND 9007199254740991
  ),
  canonicalization_version INTEGER NOT NULL CHECK (canonicalization_version = 1),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  CHECK (
    length(command_id) BETWEEN 1 AND 128
    AND command_id GLOB '[A-Za-z0-9]*'
    AND command_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  CHECK (
    length(aggregate_id) BETWEEN 1 AND 128
    AND aggregate_id GLOB '[A-Za-z0-9]*'
    AND aggregate_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  CHECK (
    (command_type IN ('order.create','order.accept','order.fulfill')
      AND aggregate_type='order')
    OR (command_type='inventory.bootstrap' AND aggregate_type='inventory_batch')
    OR (command_type='inventory.receipt' AND aggregate_type='inventory_receipt')
  ),
  UNIQUE (command_id, command_type, aggregate_type, aggregate_id,
          expected_revision, request_hash),
  UNIQUE (command_id,request_hash)
) STRICT;

CREATE TABLE commit_records (
  commit_id TEXT PRIMARY KEY NOT NULL,
  command_id TEXT NOT NULL UNIQUE,
  command_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('applying','committed')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  finalized_at TEXT CHECK (
    finalized_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ',finalized_at)=finalized_at
  ),
  CHECK (
    length(commit_id) BETWEEN 1 AND 128
    AND commit_id GLOB '[A-Za-z0-9]*'
    AND commit_id NOT GLOB '*[^A-Za-z0-9._:-]*'
  ),
  CHECK (
    (status='applying' AND finalized_at IS NULL)
    OR (status='committed' AND finalized_at IS NOT NULL)
  ),
  UNIQUE (commit_id, command_id),
  UNIQUE (commit_id, command_id, request_hash),
  UNIQUE (commit_id,request_hash),
  FOREIGN KEY (command_id,command_type,aggregate_type,aggregate_id,
               expected_revision,request_hash)
    REFERENCES commands(command_id,command_type,aggregate_type,aggregate_id,
                        expected_revision,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,request_hash)
    REFERENCES commit_finalizations(commit_id,request_hash)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE commit_finalizations (
  commit_id TEXT PRIMARY KEY NOT NULL,
  request_hash TEXT NOT NULL,
  finalized_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',finalized_at)=finalized_at),
  UNIQUE (commit_id,request_hash),
  FOREIGN KEY (commit_id,request_hash)
    REFERENCES commit_records(commit_id,request_hash)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE effect_manifest (
  effect_key TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  effect_kind TEXT NOT NULL CHECK (effect_kind IN (
    'order.created','order.revision','order.line','order.reservation',
    'inventory.identity','inventory.movement','inventory.batch',
    'inventory.batch_revision','inventory.batch_line','inventory.receipt',
    'inventory.receipt_revision','inventory.receipt_line'
  )),
  target_table TEXT NOT NULL CHECK (target_table IN (
    'orders','order_revisions','order_lines','reservations',
    'inventory_identity','inventory_movements','inventory_batches',
    'inventory_batch_revisions','inventory_batch_lines','inventory_receipts',
    'inventory_receipt_revisions','inventory_receipt_lines'
  )),
  target_id TEXT NOT NULL,
  expected_row_count INTEGER NOT NULL CHECK (expected_row_count=1),
  manifest_hash TEXT NOT NULL CHECK (
    length(manifest_hash)=64 AND manifest_hash NOT GLOB '*[^0-9a-f]*'
  ),
  claimed_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',claimed_at)=claimed_at),
  UNIQUE (commit_id,effect_kind,target_table,target_id),
  UNIQUE (effect_key,commit_id,command_id),
  FOREIGN KEY (commit_id,command_id)
    REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE inventory_identity (
  identity_id TEXT PRIMARY KEY NOT NULL,
  medicine_id TEXT NOT NULL,
  canonical_unit TEXT NOT NULL CHECK (length(canonical_unit)>0),
  tracking_state TEXT NOT NULL CHECK (tracking_state IN ('tracked','untracked')),
  lot_id TEXT NOT NULL,
  expiry_state TEXT NOT NULL CHECK (expiry_state IN ('none','date')),
  expiry_date TEXT NOT NULL,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  CHECK (
    (tracking_state='tracked' AND length(lot_id)>0)
    OR (tracking_state='untracked' AND lot_id='')
  ),
  CHECK (
    (expiry_state='none' AND expiry_date='')
    OR (
      expiry_state='date' AND length(expiry_date)=10
      AND expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND substr(expiry_date,1,4) BETWEEN '0001' AND '9999'
      AND date(expiry_date,'+0 days')=expiry_date
    )
  ),
  UNIQUE (medicine_id,canonical_unit,tracking_state,lot_id,expiry_state,expiry_date),
  UNIQUE (identity_id,command_id,commit_id),
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE orders (
  order_id TEXT PRIMARY KEY NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision BETWEEN 0 AND 3),
  current_status TEXT NOT NULL CHECK (current_status IN ('pending','accepted','fulfilled')),
  created_by_actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (order_id,command_id,commit_id),
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE order_revisions (
  revision_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK (status IN ('pending','accepted','fulfilled')),
  command_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  UNIQUE (order_id,revision),
  UNIQUE (revision_id,order_id,command_id,commit_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE order_lines (
  line_id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (line_id,identity_id,order_id),
  UNIQUE (line_id,identity_id,order_id,quantity),
  UNIQUE (order_id,identity_id),
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (identity_id) REFERENCES inventory_identity(identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE reservations (
  reservation_id TEXT PRIMARY KEY NOT NULL,
  line_id TEXT NOT NULL UNIQUE,
  identity_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (reservation_id,identity_id,quantity),
  FOREIGN KEY (line_id,identity_id,order_id)
    REFERENCES order_lines(line_id,identity_id,order_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_batches (
  batch_id TEXT PRIMARY KEY NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK (status IN ('pending','active')),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (batch_id,command_id,commit_id),
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_batch_revisions (
  batch_revision_id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision=1),
  status TEXT NOT NULL CHECK (status='active'),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (batch_id,revision),
  FOREIGN KEY (batch_id) REFERENCES inventory_batches(batch_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_batch_lines (
  batch_line_id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL,
  identity_id TEXT NOT NULL UNIQUE,
  counted_qty INTEGER NOT NULL CHECK (counted_qty BETWEEN 1 AND 9007199254740991),
  opening_available INTEGER NOT NULL CHECK (opening_available BETWEEN 0 AND 9007199254740991),
  opening_reserved INTEGER NOT NULL CHECK (opening_reserved BETWEEN 0 AND 9007199254740991),
  evidence_id TEXT NOT NULL,
  independent_evidence_id TEXT NOT NULL,
  first_counter_actor_id TEXT NOT NULL,
  second_counter_actor_id TEXT NOT NULL,
  approver_actor_id TEXT NOT NULL,
  approval_assertion_id TEXT NOT NULL,
  evidence_resource_kind TEXT NOT NULL CHECK (evidence_resource_kind='inventory_batch'),
  evidence_resource_id TEXT NOT NULL,
  independent_evidence_resource_id TEXT NOT NULL,
  approval_action TEXT NOT NULL CHECK (approval_action='inventory.approve'),
  approval_resource_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  CHECK (first_counter_actor_id<>second_counter_actor_id),
  CHECK (first_counter_actor_id<>approver_actor_id),
  CHECK (second_counter_actor_id<>approver_actor_id),
  CHECK (evidence_id<>independent_evidence_id),
  CHECK (opening_available+opening_reserved=counted_qty),
  FOREIGN KEY (batch_id) REFERENCES inventory_batches(batch_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  UNIQUE (batch_line_id,identity_id),
  FOREIGN KEY (identity_id,command_id,commit_id)
    REFERENCES inventory_identity(identity_id,command_id,commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id,commit_id,evidence_resource_kind,evidence_resource_id)
    REFERENCES evidence_records(evidence_id,commit_id,resource_kind,resource_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (independent_evidence_id,commit_id,evidence_resource_kind,independent_evidence_resource_id)
    REFERENCES evidence_records(evidence_id,commit_id,resource_kind,resource_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (approval_assertion_id,commit_id,approval_action,
               approval_resource_id,approver_actor_id)
    REFERENCES authorization_assertions(assertion_id,commit_id,action,resource_id,actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_receipts (
  receipt_id TEXT PRIMARY KEY NOT NULL,
  current_revision INTEGER NOT NULL CHECK (current_revision BETWEEN 0 AND 1),
  status TEXT NOT NULL CHECK (status IN ('pending','received')),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (receipt_id,command_id,commit_id),
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_receipt_revisions (
  receipt_revision_id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision=1),
  status TEXT NOT NULL CHECK (status='received'),
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  UNIQUE (receipt_id,revision),
  FOREIGN KEY (receipt_id) REFERENCES inventory_receipts(receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id,request_hash)
    REFERENCES commit_records(commit_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE inventory_receipt_lines (
  receipt_line_id TEXT PRIMARY KEY NOT NULL,
  receipt_id TEXT NOT NULL,
  identity_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  evidence_id TEXT NOT NULL,
  receiver_actor_id TEXT NOT NULL,
  second_approver_actor_id TEXT NOT NULL,
  approval_assertion_id TEXT NOT NULL,
  evidence_resource_kind TEXT NOT NULL CHECK (evidence_resource_kind='inventory_receipt'),
  evidence_resource_id TEXT NOT NULL,
  approval_action TEXT NOT NULL CHECK (approval_action='inventory.approve'),
  approval_resource_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  CHECK (receiver_actor_id<>second_approver_actor_id),
  UNIQUE (receipt_line_id,identity_id),
  FOREIGN KEY (receipt_id) REFERENCES inventory_receipts(receipt_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (identity_id) REFERENCES inventory_identity(identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (evidence_id,commit_id,evidence_resource_kind,evidence_resource_id)
    REFERENCES evidence_records(evidence_id,commit_id,resource_kind,resource_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (approval_assertion_id,commit_id,approval_action,
               approval_resource_id,second_approver_actor_id)
    REFERENCES authorization_assertions(assertion_id,commit_id,action,resource_id,actor_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE evidence_records (
  evidence_id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('inventory_batch','inventory_receipt')),
  resource_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  raw_bytes BLOB NOT NULL,
  sha256_hex TEXT NOT NULL CHECK (
    length(sha256_hex)=64 AND sha256_hex NOT GLOB '*[^0-9a-f]*'
  ),
  provenance_json TEXT NOT NULL CHECK (json_valid(provenance_json)),
  acquired_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',acquired_at)=acquired_at),
  acquired_by_actor_id TEXT NOT NULL,
  UNIQUE (evidence_id,commit_id,resource_kind,resource_id),
  FOREIGN KEY (commit_id) REFERENCES commit_records(commit_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE authority_keys (
  key_id TEXT PRIMARY KEY NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm='ES256'),
  public_key_fingerprint TEXT NOT NULL CHECK (
    length(public_key_fingerprint)=64
    AND public_key_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  registered_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',registered_at)=registered_at),
  UNIQUE (key_id,algorithm)
) STRICT;

CREATE TABLE authority_key_events (
  key_event_id TEXT PRIMARY KEY NOT NULL,
  key_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('registered','activated','rotated','revoked')),
  event_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',event_at)=event_at),
  event_json TEXT NOT NULL CHECK (json_valid(event_json)),
  FOREIGN KEY (key_id) REFERENCES authority_keys(key_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE nonce_records (
  nonce_id TEXT PRIMARY KEY NOT NULL,
  nonce_value TEXT NOT NULL UNIQUE,
  actor_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (state IN ('presented','reserved','consumed','rolled_back','expired')),
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  FOREIGN KEY (command_id) REFERENCES commands(command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(nonce_value) BETWEEN 16 AND 512),
  UNIQUE (nonce_id,actor_id,command_id,request_hash)
) STRICT;

CREATE TABLE nonce_events (
  nonce_event_id TEXT PRIMARY KEY NOT NULL,
  nonce_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('presented','reserved','consumed','rolled_back','expired')),
  recorded_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at)=recorded_at),
  FOREIGN KEY (nonce_id) REFERENCES nonce_records(nonce_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE authorization_assertions (
  assertion_id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  command_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN (
    'order.create','order.accept','order.fulfill',
    'inventory.bootstrap','inventory.receipt','inventory.approve'
  )),
  resource_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  role_snapshot TEXT NOT NULL CHECK (role_snapshot IN ('admin','assistant','employee')),
  key_id TEXT NOT NULL,
  nonce_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  issued_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',issued_at)=issued_at),
  expires_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',expires_at)=expires_at),
  signed_assertion BLOB NOT NULL,
  signed_assertion_sha256 TEXT NOT NULL CHECK (
    length(signed_assertion_sha256)=64
    AND signed_assertion_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  CHECK (issued_at<expires_at),
  UNIQUE (assertion_id,commit_id,action,resource_id,actor_id),
  UNIQUE (nonce_id),
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,request_hash) REFERENCES commit_records(commit_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (nonce_id,actor_id,command_id,request_hash)
    REFERENCES nonce_records(nonce_id,actor_id,command_id,request_hash)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (key_id) REFERENCES authority_keys(key_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (nonce_id) REFERENCES nonce_records(nonce_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE evidence_verifications (
  verification_id TEXT PRIMARY KEY NOT NULL,
  evidence_id TEXT NOT NULL,
  verifier_actor_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('verified','failed','pending','revoked')),
  method TEXT NOT NULL,
  verification_json TEXT NOT NULL CHECK (json_valid(verification_json)),
  verified_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',verified_at)=verified_at),
  FOREIGN KEY (evidence_id) REFERENCES evidence_records(evidence_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE TABLE recovery_events (
  recovery_event_id TEXT PRIMARY KEY NOT NULL,
  commit_id TEXT NOT NULL,
  command_id TEXT,
  request_hash TEXT NOT NULL CHECK (
    length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'
  ),
  observed_state TEXT NOT NULL CHECK (observed_state IN (
    'prepared','submitted','submission_unknown','confirmed',
    'definitively_rejected','identity_conflict','corrupt','adjudicated'
  )),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  actor_id TEXT NOT NULL,
  observed_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',observed_at)=observed_at),
  FOREIGN KEY (command_id) REFERENCES commands(command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT
) STRICT;

CREATE VIEW inventory_balances AS
SELECT i.identity_id, i.medicine_id, i.canonical_unit, i.tracking_state,
       i.lot_id, i.expiry_state, i.expiry_date,
       COALESCE(SUM(m.available_delta),0) AS available_qty,
       COALESCE(SUM(m.reserved_delta),0) AS reserved_qty,
       COALESCE(SUM(m.available_delta+m.reserved_delta),0) AS on_hand_qty
FROM inventory_identity i
LEFT JOIN inventory_movements m ON m.identity_id=i.identity_id
GROUP BY i.identity_id;

CREATE TABLE inventory_movements (
  movement_id TEXT PRIMARY KEY NOT NULL,
  identity_id TEXT NOT NULL,
  movement_kind TEXT NOT NULL CHECK (movement_kind IN ('reserve','fulfill','bootstrap','receipt')),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 9007199254740991),
  available_delta INTEGER NOT NULL CHECK (available_delta BETWEEN -9007199254740991 AND 9007199254740991),
  reserved_delta INTEGER NOT NULL CHECK (reserved_delta BETWEEN -9007199254740991 AND 9007199254740991),
  on_hand_delta INTEGER NOT NULL CHECK (on_hand_delta BETWEEN -9007199254740991 AND 9007199254740991),
  before_available INTEGER NOT NULL CHECK (before_available BETWEEN 0 AND 9007199254740991),
  after_available INTEGER NOT NULL CHECK (after_available BETWEEN 0 AND 9007199254740991),
  before_reserved INTEGER NOT NULL CHECK (before_reserved BETWEEN 0 AND 9007199254740991),
  after_reserved INTEGER NOT NULL CHECK (after_reserved BETWEEN 0 AND 9007199254740991),
  reservation_id TEXT,
  batch_line_id TEXT,
  receipt_line_id TEXT,
  command_id TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  effect_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at),
  CHECK (on_hand_delta=available_delta+reserved_delta),
  CHECK (after_available=before_available+available_delta),
  CHECK (after_reserved=before_reserved+reserved_delta),
  CHECK (
    (movement_kind='reserve' AND available_delta=-quantity AND reserved_delta=quantity
      AND on_hand_delta=0 AND reservation_id IS NOT NULL
      AND batch_line_id IS NULL AND receipt_line_id IS NULL)
    OR (movement_kind='fulfill' AND available_delta=0 AND reserved_delta=-quantity
      AND on_hand_delta=-quantity AND reservation_id IS NOT NULL
      AND batch_line_id IS NULL AND receipt_line_id IS NULL)
    OR (movement_kind='bootstrap' AND quantity=available_delta+reserved_delta
      AND available_delta>=0 AND reserved_delta>=0 AND batch_line_id IS NOT NULL
      AND reservation_id IS NULL AND receipt_line_id IS NULL)
    OR (movement_kind='receipt' AND available_delta=quantity AND reserved_delta=0
      AND on_hand_delta=quantity AND receipt_line_id IS NOT NULL
      AND reservation_id IS NULL AND batch_line_id IS NULL)
  ),
  UNIQUE (movement_id,identity_id),
  FOREIGN KEY (identity_id) REFERENCES inventory_identity(identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (reservation_id,identity_id,quantity)
    REFERENCES reservations(reservation_id,identity_id,quantity)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (batch_line_id,identity_id)
    REFERENCES inventory_batch_lines(batch_line_id,identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (receipt_line_id,identity_id)
    REFERENCES inventory_receipt_lines(receipt_line_id,identity_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (commit_id,command_id) REFERENCES commit_records(commit_id,command_id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  FOREIGN KEY (effect_key,commit_id,command_id)
    REFERENCES effect_manifest(effect_key,commit_id,command_id)
    DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE UNIQUE INDEX one_reservation_movement
  ON inventory_movements(reservation_id) WHERE movement_kind='reserve';
CREATE UNIQUE INDEX one_fulfillment_movement
  ON inventory_movements(reservation_id) WHERE movement_kind='fulfill';
CREATE UNIQUE INDEX one_bootstrap_movement
  ON inventory_movements(batch_line_id) WHERE movement_kind='bootstrap';
CREATE UNIQUE INDEX one_receipt_movement
  ON inventory_movements(receipt_line_id) WHERE movement_kind='receipt';

CREATE TRIGGER command_identity_immutable
BEFORE UPDATE ON commands BEGIN SELECT RAISE(ABORT,'commands are immutable'); END;
CREATE TRIGGER command_no_delete
BEFORE DELETE ON commands BEGIN SELECT RAISE(ABORT,'commands are retained'); END;
CREATE TRIGGER schema_meta_no_update
BEFORE UPDATE ON schema_meta BEGIN SELECT RAISE(ABORT,'schema metadata changes require an approved migration'); END;
CREATE TRIGGER schema_meta_no_delete
BEFORE DELETE ON schema_meta BEGIN SELECT RAISE(ABORT,'schema metadata is retained'); END;

CREATE TRIGGER commit_identity_immutable
BEFORE UPDATE ON commit_records
WHEN NEW.commit_id<>OLD.commit_id OR NEW.command_id<>OLD.command_id
  OR NEW.command_type<>OLD.command_type OR NEW.aggregate_type<>OLD.aggregate_type
  OR NEW.aggregate_id<>OLD.aggregate_id OR NEW.expected_revision<>OLD.expected_revision
  OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'commit identity is immutable'); END;
CREATE TRIGGER commit_insert_guard
BEFORE INSERT ON commit_records
WHEN NEW.status<>'applying' OR NEW.finalized_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'commit must start applying'); END;
CREATE TRIGGER commit_state_guard
BEFORE UPDATE OF status,finalized_at ON commit_records
WHEN NOT (OLD.status='applying' AND NEW.status='committed' AND NEW.finalized_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'illegal commit state transition'); END;
CREATE TRIGGER commit_no_delete
BEFORE DELETE ON commit_records BEGIN SELECT RAISE(ABORT,'commits are retained'); END;
CREATE TRIGGER commit_finalization_insert
AFTER UPDATE OF status ON commit_records
WHEN NEW.status='committed'
BEGIN
  INSERT INTO commit_finalizations(commit_id,request_hash,finalized_at)
  VALUES (NEW.commit_id,NEW.request_hash,NEW.finalized_at);
END;
CREATE TRIGGER commit_finalization_no_update
BEFORE UPDATE ON commit_finalizations BEGIN SELECT RAISE(ABORT,'finalizations are immutable'); END;
CREATE TRIGGER commit_finalization_no_delete
BEFORE DELETE ON commit_finalizations BEGIN SELECT RAISE(ABORT,'finalizations are retained'); END;
CREATE TRIGGER commit_finalization_insert_guard
BEFORE INSERT ON commit_finalizations
WHEN NOT EXISTS (
  SELECT 1 FROM commit_records c
  WHERE c.commit_id=NEW.commit_id AND c.request_hash=NEW.request_hash
    AND c.status='committed' AND c.finalized_at=NEW.finalized_at
)
BEGIN SELECT RAISE(ABORT,'finalization must be created by successful commit transition'); END;

CREATE TRIGGER manifest_no_update
BEFORE UPDATE ON effect_manifest BEGIN SELECT RAISE(ABORT,'manifest is immutable'); END;
CREATE TRIGGER manifest_no_delete
BEFORE DELETE ON effect_manifest BEGIN SELECT RAISE(ABORT,'manifest is retained'); END;

CREATE TRIGGER order_insert_guard
BEFORE INSERT ON orders
BEGIN
  SELECT RAISE(ABORT,'order root requires order.create')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c JOIN commit_records k USING(command_id)
    WHERE c.command_id=NEW.command_id AND c.command_type='order.create'
      AND c.aggregate_type='order' AND c.aggregate_id=NEW.order_id
      AND c.expected_revision=0 AND k.commit_id=NEW.commit_id
  );
END;

CREATE TRIGGER order_update_guard
BEFORE UPDATE ON orders
BEGIN
  SELECT RAISE(ABORT,'order update must match next immutable revision')
  WHERE NEW.order_id<>OLD.order_id
     OR NOT EXISTS (
       SELECT 1 FROM order_revisions r
       WHERE r.order_id=OLD.order_id AND r.revision=OLD.current_revision+1
         AND r.revision=NEW.current_revision AND r.status=NEW.current_status
     );
END;
CREATE TRIGGER order_no_delete
BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT,'orders are retained'); END;

CREATE TRIGGER order_revision_guard
BEFORE INSERT ON order_revisions
BEGIN
  SELECT RAISE(ABORT,'order revision, status, command, or expected revision mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM orders o
    JOIN commands c ON c.command_id=NEW.command_id
    JOIN commit_records k ON k.commit_id=NEW.commit_id AND k.command_id=NEW.command_id
    WHERE o.order_id=NEW.order_id
      AND NEW.revision=o.current_revision+1
      AND c.aggregate_type='order' AND c.aggregate_id=o.order_id
      AND c.expected_revision=o.current_revision
      AND c.request_hash=NEW.request_hash
      AND c.command_type=NEW.command_type
      AND k.request_hash=NEW.request_hash
      AND (
        (NEW.revision=1 AND NEW.status='pending' AND NEW.command_type='order.create'
          AND o.current_revision=0)
        OR (NEW.revision=2 AND NEW.status='accepted' AND NEW.command_type='order.accept'
          AND o.current_revision=1 AND o.current_status='pending')
        OR (NEW.revision=3 AND NEW.status='fulfilled' AND NEW.command_type='order.fulfill'
          AND o.current_revision=2 AND o.current_status='accepted')
      )
  );
END;
CREATE TRIGGER order_revision_apply
AFTER INSERT ON order_revisions
BEGIN
  UPDATE orders SET current_revision=NEW.revision,current_status=NEW.status
  WHERE order_id=NEW.order_id;
END;
CREATE TRIGGER order_revisions_no_update
BEFORE UPDATE ON order_revisions BEGIN SELECT RAISE(ABORT,'revisions are immutable'); END;
CREATE TRIGGER order_revisions_no_delete
BEFORE DELETE ON order_revisions BEGIN SELECT RAISE(ABORT,'revisions are retained'); END;

CREATE TRIGGER inventory_movement_guard
BEFORE INSERT ON inventory_movements
BEGIN
  SELECT RAISE(ABORT,'movement snapshot does not match current ledger balance')
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_balances b
    WHERE b.identity_id=NEW.identity_id
      AND b.available_qty=NEW.before_available
      AND b.reserved_qty=NEW.before_reserved
      AND NEW.after_available BETWEEN 0 AND 9007199254740991
      AND NEW.after_reserved BETWEEN 0 AND 9007199254740991
  );
  SELECT RAISE(ABORT,'reserve movement does not match order reservation')
  WHERE NEW.movement_kind='reserve' AND NOT EXISTS (
    SELECT 1 FROM reservations r JOIN order_lines l USING(line_id)
    JOIN commands c ON c.command_id=NEW.command_id
    WHERE r.reservation_id=NEW.reservation_id AND r.identity_id=NEW.identity_id
      AND r.quantity=NEW.quantity AND l.order_id=c.aggregate_id
      AND c.command_type='order.create'
      AND r.command_id=NEW.command_id AND r.commit_id=NEW.commit_id
  );
  SELECT RAISE(ABORT,'fulfillment does not consume an existing exact reservation')
  WHERE NEW.movement_kind='fulfill' AND NOT EXISTS (
    SELECT 1 FROM inventory_movements r
    JOIN reservations x ON x.reservation_id=r.reservation_id
    JOIN commands c ON c.command_id=NEW.command_id
    WHERE r.movement_kind='reserve' AND r.reservation_id=NEW.reservation_id
      AND r.identity_id=NEW.identity_id AND r.quantity=NEW.quantity
      AND c.command_type='order.fulfill' AND c.expected_revision=2
      AND EXISTS (
        SELECT 1 FROM order_lines l JOIN orders o USING(order_id)
        WHERE l.line_id=x.line_id AND o.order_id=c.aggregate_id
          AND o.current_status='accepted' AND o.current_revision=2
      )
  );
  SELECT RAISE(ABORT,'bootstrap movement must exactly match its counted allocation')
  WHERE NEW.movement_kind='bootstrap' AND NOT EXISTS (
    SELECT 1 FROM inventory_batch_lines l
    WHERE l.batch_line_id=NEW.batch_line_id AND l.identity_id=NEW.identity_id
      AND l.opening_available=NEW.available_delta
      AND l.opening_reserved=NEW.reserved_delta
      AND l.counted_qty=NEW.quantity
      AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id
  );
  SELECT RAISE(ABORT,'receipt movement must exactly match receipt line')
  WHERE NEW.movement_kind='receipt' AND NOT EXISTS (
    SELECT 1 FROM inventory_receipt_lines l
    WHERE l.receipt_line_id=NEW.receipt_line_id
      AND l.identity_id=NEW.identity_id AND l.quantity=NEW.quantity
      AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id
  );
  SELECT RAISE(ABORT,'acceptance must have zero inventory movement')
  WHERE EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.command_type='order.accept'
  );
END;
CREATE TRIGGER inventory_movements_no_update
BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'movements are immutable'); END;
CREATE TRIGGER inventory_movements_no_delete
BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'movements are retained'); END;

CREATE TRIGGER identity_insert_guard
BEFORE INSERT ON inventory_identity
BEGIN
  SELECT RAISE(ABORT,'new inventory identity requires inventory.bootstrap')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c WHERE c.command_id=NEW.command_id
      AND c.command_type='inventory.bootstrap'
      AND c.aggregate_id IN (
        SELECT batch_id FROM inventory_batches WHERE command_id=NEW.command_id
      )
  );
END;

CREATE TRIGGER order_line_insert_guard
BEFORE INSERT ON order_lines
BEGIN
  SELECT RAISE(ABORT,'order line requires matching order.create command')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c JOIN commit_records k USING(command_id)
    WHERE c.command_id=NEW.command_id AND c.command_type='order.create'
      AND c.aggregate_type='order' AND c.aggregate_id=NEW.order_id
      AND c.expected_revision=0 AND k.commit_id=NEW.commit_id
  );
END;

CREATE TRIGGER reservation_insert_guard
BEFORE INSERT ON reservations
BEGIN
  SELECT RAISE(ABORT,'reservation must equal its exact order line')
  WHERE NOT EXISTS (
    SELECT 1 FROM order_lines l
    JOIN commands c ON c.command_id=NEW.command_id
    JOIN commit_records k ON k.commit_id=NEW.commit_id AND k.command_id=NEW.command_id
    WHERE l.line_id=NEW.line_id AND l.identity_id=NEW.identity_id
      AND l.order_id=NEW.order_id AND l.quantity=NEW.quantity
      AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id
      AND c.command_type='order.create' AND c.aggregate_id=NEW.order_id
      AND c.expected_revision=0
  );
END;

CREATE TRIGGER batch_insert_guard
BEFORE INSERT ON inventory_batches
BEGIN
  SELECT RAISE(ABORT,'batch requires inventory.bootstrap at revision zero')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c JOIN commit_records k USING(command_id)
    WHERE c.command_id=NEW.command_id AND c.command_type='inventory.bootstrap'
      AND c.aggregate_type='inventory_batch' AND c.aggregate_id=NEW.batch_id
      AND c.expected_revision=0 AND k.commit_id=NEW.commit_id
  );
END;

CREATE TRIGGER receipt_insert_guard
BEFORE INSERT ON inventory_receipts
BEGIN
  SELECT RAISE(ABORT,'receipt requires inventory.receipt at revision zero')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c JOIN commit_records k USING(command_id)
    WHERE c.command_id=NEW.command_id AND c.command_type='inventory.receipt'
      AND c.aggregate_type='inventory_receipt' AND c.aggregate_id=NEW.receipt_id
      AND c.expected_revision=0 AND k.commit_id=NEW.commit_id
  );
END;

CREATE TRIGGER batch_line_insert_guard
BEFORE INSERT ON inventory_batch_lines
BEGIN
  SELECT RAISE(ABORT,'batch line evidence or approval resource mismatch')
  WHERE NEW.evidence_resource_id<>NEW.batch_line_id
     OR NEW.independent_evidence_resource_id<>NEW.batch_line_id
     OR NEW.approval_resource_id<>NEW.batch_line_id
     OR NOT EXISTS (
       SELECT 1 FROM authorization_assertions a
       WHERE a.assertion_id=NEW.approval_assertion_id
         AND a.commit_id=NEW.commit_id AND a.action='inventory.approve'
         AND a.resource_id=NEW.batch_line_id
         AND a.actor_id=NEW.approver_actor_id AND a.decision='allow'
     )
     OR NOT EXISTS (
       SELECT 1 FROM inventory_batches b
       JOIN commands c ON c.command_id=NEW.command_id
       WHERE b.batch_id=NEW.batch_id AND b.command_id=NEW.command_id
         AND b.commit_id=NEW.commit_id AND c.command_type='inventory.bootstrap'
         AND c.aggregate_id=NEW.batch_id
     );
END;

CREATE TRIGGER receipt_line_insert_guard
BEFORE INSERT ON inventory_receipt_lines
BEGIN
  SELECT RAISE(ABORT,'receipt line evidence or approval resource mismatch')
  WHERE NEW.evidence_resource_id<>NEW.receipt_line_id
     OR NEW.approval_resource_id<>NEW.receipt_line_id
     OR NOT EXISTS (
       SELECT 1 FROM authorization_assertions a
       WHERE a.assertion_id=NEW.approval_assertion_id
         AND a.commit_id=NEW.commit_id AND a.action='inventory.approve'
         AND a.resource_id=NEW.receipt_line_id
         AND a.actor_id=NEW.second_approver_actor_id AND a.decision='allow'
     )
     OR NOT EXISTS (
       SELECT 1 FROM inventory_receipts r
       WHERE r.receipt_id=NEW.receipt_id AND r.command_id=NEW.command_id
         AND r.commit_id=NEW.commit_id
     );
END;

CREATE TRIGGER batch_activation_guard
BEFORE UPDATE OF status,current_revision ON inventory_batches
WHEN NEW.status='active'
BEGIN
  SELECT RAISE(ABORT,'bootstrap evidence, independent count, approvals, or movement incomplete')
  WHERE NEW.current_revision<>1 OR NOT EXISTS (
    SELECT 1 FROM inventory_batch_lines l
    WHERE l.batch_id=OLD.batch_id
      AND EXISTS (SELECT 1 FROM inventory_movements m
                  WHERE m.batch_line_id=l.batch_line_id AND m.movement_kind='bootstrap')
  ) OR EXISTS (
    SELECT 1 FROM inventory_batch_lines l
    WHERE l.batch_id=OLD.batch_id
      AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                      WHERE m.batch_line_id=l.batch_line_id AND m.movement_kind='bootstrap')
  ) OR EXISTS (
    SELECT 1 FROM inventory_batch_lines l
    WHERE l.batch_id=OLD.batch_id AND (
      COALESCE((
        SELECT v.result FROM evidence_verifications v
        WHERE v.evidence_id=l.evidence_id
        ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1
      ),'')<>'verified'
      OR COALESCE((
        SELECT v.result FROM evidence_verifications v
        WHERE v.evidence_id=l.independent_evidence_id
        ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1
      ),'')<>'verified'
    )
  );
END;

CREATE TRIGGER batch_revision_insert_guard
BEFORE INSERT ON inventory_batch_revisions
BEGIN
  SELECT RAISE(ABORT,'invalid bootstrap revision binding or incomplete batch')
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_batches b
    JOIN commands c ON c.command_id=NEW.command_id
    JOIN commit_records k ON k.commit_id=NEW.commit_id AND k.command_id=NEW.command_id
    WHERE b.batch_id=NEW.batch_id AND b.current_revision=0 AND b.status='pending'
      AND c.command_type='inventory.bootstrap' AND c.aggregate_type='inventory_batch'
      AND c.aggregate_id=NEW.batch_id AND c.expected_revision=0
      AND c.request_hash=NEW.request_hash AND k.request_hash=NEW.request_hash
      AND k.commit_id=b.commit_id
      AND EXISTS (SELECT 1 FROM inventory_batch_lines l WHERE l.batch_id=b.batch_id)
      AND NOT EXISTS (
        SELECT 1 FROM inventory_batch_lines l
        WHERE l.batch_id=b.batch_id AND (
          NOT EXISTS (SELECT 1 FROM inventory_movements m
                      WHERE m.batch_line_id=l.batch_line_id AND m.movement_kind='bootstrap')
          OR COALESCE((SELECT v.result FROM evidence_verifications v
                       WHERE v.evidence_id=l.evidence_id
                       ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')<>'verified'
          OR COALESCE((SELECT v.result FROM evidence_verifications v
                       WHERE v.evidence_id=l.independent_evidence_id
                       ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')<>'verified'
        )
      )
  );
END;
CREATE TRIGGER batch_revision_apply
AFTER INSERT ON inventory_batch_revisions
BEGIN
  UPDATE inventory_batches SET current_revision=1,status='active'
  WHERE batch_id=NEW.batch_id;
END;
CREATE TRIGGER batch_revisions_no_update
BEFORE UPDATE ON inventory_batch_revisions BEGIN SELECT RAISE(ABORT,'batch revisions are immutable'); END;
CREATE TRIGGER batch_revisions_no_delete
BEFORE DELETE ON inventory_batch_revisions BEGIN SELECT RAISE(ABORT,'batch revisions are retained'); END;

CREATE TRIGGER receipt_status_guard
BEFORE UPDATE OF status,current_revision ON inventory_receipts
WHEN NEW.status='received'
BEGIN
  SELECT RAISE(ABORT,'receipt lines or movements incomplete')
  WHERE NEW.current_revision<>1 OR NOT EXISTS (
    SELECT 1 FROM inventory_receipt_lines l WHERE l.receipt_id=OLD.receipt_id
  ) OR EXISTS (
    SELECT 1 FROM inventory_receipt_lines l
    WHERE l.receipt_id=OLD.receipt_id
      AND NOT EXISTS (SELECT 1 FROM inventory_movements m
                      WHERE m.receipt_line_id=l.receipt_line_id
                        AND m.movement_kind='receipt')
  ) OR EXISTS (
    SELECT 1 FROM inventory_receipt_lines l
    WHERE l.receipt_id=OLD.receipt_id AND COALESCE((
        SELECT v.result FROM evidence_verifications v
        WHERE v.evidence_id=l.evidence_id
        ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1
      ),'')<>'verified'
  );
END;

CREATE TRIGGER receipt_revision_insert_guard
BEFORE INSERT ON inventory_receipt_revisions
BEGIN
  SELECT RAISE(ABORT,'invalid receipt revision binding or incomplete receipt')
  WHERE NOT EXISTS (
    SELECT 1 FROM inventory_receipts r
    JOIN commands c ON c.command_id=NEW.command_id
    JOIN commit_records k ON k.commit_id=NEW.commit_id AND k.command_id=NEW.command_id
    WHERE r.receipt_id=NEW.receipt_id AND r.current_revision=0 AND r.status='pending'
      AND c.command_type='inventory.receipt' AND c.aggregate_type='inventory_receipt'
      AND c.aggregate_id=NEW.receipt_id AND c.expected_revision=0
      AND c.request_hash=NEW.request_hash AND k.request_hash=NEW.request_hash
      AND k.commit_id=r.commit_id
      AND EXISTS (SELECT 1 FROM inventory_receipt_lines l WHERE l.receipt_id=r.receipt_id)
      AND NOT EXISTS (
        SELECT 1 FROM inventory_receipt_lines l
        WHERE l.receipt_id=r.receipt_id AND (
          NOT EXISTS (SELECT 1 FROM inventory_movements m
                      WHERE m.receipt_line_id=l.receipt_line_id AND m.movement_kind='receipt')
          OR COALESCE((SELECT v.result FROM evidence_verifications v
                       WHERE v.evidence_id=l.evidence_id
                       ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')<>'verified'
        )
      )
  );
END;
CREATE TRIGGER receipt_revision_apply
AFTER INSERT ON inventory_receipt_revisions
BEGIN
  UPDATE inventory_receipts SET current_revision=1,status='received'
  WHERE receipt_id=NEW.receipt_id;
END;
CREATE TRIGGER receipt_revisions_no_update
BEFORE UPDATE ON inventory_receipt_revisions BEGIN SELECT RAISE(ABORT,'receipt revisions are immutable'); END;
CREATE TRIGGER receipt_revisions_no_delete
BEFORE DELETE ON inventory_receipt_revisions BEGIN SELECT RAISE(ABORT,'receipt revisions are retained'); END;

CREATE TRIGGER batch_state_transition_guard
BEFORE UPDATE OF status,current_revision ON inventory_batches
WHEN NOT (OLD.status='pending' AND OLD.current_revision=0
          AND NEW.status='active' AND NEW.current_revision=1
          AND EXISTS (SELECT 1 FROM inventory_batch_revisions r
                      WHERE r.batch_id=OLD.batch_id AND r.revision=1 AND r.status='active'))
BEGIN SELECT RAISE(ABORT,'illegal bootstrap batch transition'); END;

CREATE TRIGGER receipt_state_transition_guard
BEFORE UPDATE OF status,current_revision ON inventory_receipts
WHEN NOT (OLD.status='pending' AND OLD.current_revision=0
          AND NEW.status='received' AND NEW.current_revision=1
          AND EXISTS (SELECT 1 FROM inventory_receipt_revisions r
                      WHERE r.receipt_id=OLD.receipt_id AND r.revision=1 AND r.status='received'))
BEGIN SELECT RAISE(ABORT,'illegal receipt transition'); END;

CREATE TRIGGER immutable_inventory_identity_update
BEFORE UPDATE ON inventory_identity BEGIN SELECT RAISE(ABORT,'identity is immutable'); END;
CREATE TRIGGER immutable_inventory_identity_delete
BEFORE DELETE ON inventory_identity BEGIN SELECT RAISE(ABORT,'identity is retained'); END;
CREATE TRIGGER immutable_order_line_update
BEFORE UPDATE ON order_lines BEGIN SELECT RAISE(ABORT,'order lines are immutable'); END;
CREATE TRIGGER immutable_order_line_delete
BEFORE DELETE ON order_lines BEGIN SELECT RAISE(ABORT,'order lines are retained'); END;
CREATE TRIGGER immutable_reservation_update
BEFORE UPDATE ON reservations BEGIN SELECT RAISE(ABORT,'reservations are immutable'); END;
CREATE TRIGGER immutable_reservation_delete
BEFORE DELETE ON reservations BEGIN SELECT RAISE(ABORT,'reservations are retained'); END;
CREATE TRIGGER immutable_batch_line_update
BEFORE UPDATE ON inventory_batch_lines BEGIN SELECT RAISE(ABORT,'batch lines are immutable'); END;
CREATE TRIGGER immutable_batch_line_delete
BEFORE DELETE ON inventory_batch_lines BEGIN SELECT RAISE(ABORT,'batch lines are retained'); END;
CREATE TRIGGER immutable_receipt_line_update
BEFORE UPDATE ON inventory_receipt_lines BEGIN SELECT RAISE(ABORT,'receipt lines are immutable'); END;
CREATE TRIGGER immutable_receipt_line_delete
BEFORE DELETE ON inventory_receipt_lines BEGIN SELECT RAISE(ABORT,'receipt lines are retained'); END;
CREATE TRIGGER immutable_batch_delete
BEFORE DELETE ON inventory_batches BEGIN SELECT RAISE(ABORT,'batches are retained'); END;
CREATE TRIGGER immutable_receipt_delete
BEFORE DELETE ON inventory_receipts BEGIN SELECT RAISE(ABORT,'receipts are retained'); END;

CREATE TRIGGER nonce_state_guard
BEFORE UPDATE OF state ON nonce_records
WHEN NOT (
  (OLD.state='presented' AND NEW.state IN ('reserved','rolled_back','expired'))
  OR (OLD.state='reserved' AND NEW.state IN ('consumed','rolled_back','expired'))
)
BEGIN SELECT RAISE(ABORT,'illegal nonce transition'); END;
CREATE TRIGGER nonce_insert_guard
BEFORE INSERT ON nonce_records
WHEN NEW.state<>'presented'
BEGIN SELECT RAISE(ABORT,'nonce must begin in presented state'); END;
CREATE TRIGGER nonce_event_insert
AFTER INSERT ON nonce_records
BEGIN
  INSERT INTO nonce_events(nonce_event_id,nonce_id,state,recorded_at)
  VALUES (lower(hex(randomblob(16))),NEW.nonce_id,NEW.state,NEW.created_at);
END;
CREATE TRIGGER nonce_event_update
AFTER UPDATE OF state ON nonce_records
WHEN NEW.state<>OLD.state
BEGIN
  INSERT INTO nonce_events(nonce_event_id,nonce_id,state,recorded_at)
  VALUES (lower(hex(randomblob(16))),NEW.nonce_id,NEW.state,
          strftime('%Y-%m-%dT%H:%M:%fZ','now'));
END;
CREATE TRIGGER nonce_events_no_update
BEFORE UPDATE ON nonce_events BEGIN SELECT RAISE(ABORT,'nonce history is immutable'); END;
CREATE TRIGGER nonce_events_no_delete
BEFORE DELETE ON nonce_events BEGIN SELECT RAISE(ABORT,'nonce history is retained'); END;
CREATE TRIGGER nonce_no_delete
BEFORE DELETE ON nonce_records BEGIN SELECT RAISE(ABORT,'nonces are retained'); END;
CREATE TRIGGER key_no_update
BEFORE UPDATE ON authority_keys BEGIN SELECT RAISE(ABORT,'key registrations are immutable'); END;
CREATE TRIGGER key_no_delete
BEFORE DELETE ON authority_keys BEGIN SELECT RAISE(ABORT,'key registrations are retained'); END;
CREATE TRIGGER nonce_identity_immutable
BEFORE UPDATE ON nonce_records
WHEN NEW.nonce_id<>OLD.nonce_id OR NEW.nonce_value<>OLD.nonce_value
  OR NEW.actor_id<>OLD.actor_id OR NEW.command_id<>OLD.command_id
  OR NEW.request_hash<>OLD.request_hash OR NEW.created_at<>OLD.created_at
BEGIN SELECT RAISE(ABORT,'nonce identity is immutable'); END;

CREATE TRIGGER authorization_insert_guard
BEFORE INSERT ON authorization_assertions
BEGIN
  SELECT RAISE(ABORT,'authorization assertion does not match reserved nonce')
  WHERE NOT EXISTS (
    SELECT 1 FROM nonce_records n
    WHERE n.nonce_id=NEW.nonce_id AND n.state='consumed'
      AND n.actor_id=NEW.actor_id AND n.command_id=NEW.command_id
      AND n.request_hash=NEW.request_hash
  );
  SELECT RAISE(ABORT,'authorization command/resource binding mismatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.request_hash=NEW.request_hash
      AND (
        (NEW.action IN ('order.create','order.accept','order.fulfill')
          AND c.command_type=NEW.action AND NEW.resource_id=c.aggregate_id)
        OR (NEW.action='inventory.bootstrap'
          AND c.command_type='inventory.bootstrap' AND NEW.resource_id=c.aggregate_id)
        OR (NEW.action='inventory.receipt'
          AND c.command_type='inventory.receipt' AND NEW.resource_id=c.aggregate_id)
        OR NEW.action='inventory.approve'
      )
  );
END;

CREATE TRIGGER effect_manifest_finalize_guard
BEFORE UPDATE OF status ON commit_records
WHEN NEW.status='committed'
BEGIN
  SELECT RAISE(ABORT,'manifest membership/count incomplete')
  WHERE EXISTS (
    SELECT 1 FROM effect_manifest e
    WHERE e.commit_id=NEW.commit_id AND (
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
      +(SELECT count(*) FROM inventory_receipt_lines x WHERE x.effect_key=e.effect_key)
      <> e.expected_row_count
    )
  );
  SELECT RAISE(ABORT,'manifest target table or ID mismatch')
  WHERE EXISTS (
    SELECT 1 FROM effect_manifest e WHERE e.commit_id=NEW.commit_id AND NOT (
      (e.target_table='orders' AND EXISTS (SELECT 1 FROM orders x WHERE x.effect_key=e.effect_key AND x.order_id=e.target_id))
      OR (e.target_table='order_revisions' AND EXISTS (SELECT 1 FROM order_revisions x WHERE x.effect_key=e.effect_key AND x.revision_id=e.target_id))
      OR (e.target_table='order_lines' AND EXISTS (SELECT 1 FROM order_lines x WHERE x.effect_key=e.effect_key AND x.line_id=e.target_id))
      OR (e.target_table='reservations' AND EXISTS (SELECT 1 FROM reservations x WHERE x.effect_key=e.effect_key AND x.reservation_id=e.target_id))
      OR (e.target_table='inventory_identity' AND EXISTS (SELECT 1 FROM inventory_identity x WHERE x.effect_key=e.effect_key AND x.identity_id=e.target_id))
      OR (e.target_table='inventory_movements' AND EXISTS (SELECT 1 FROM inventory_movements x WHERE x.effect_key=e.effect_key AND x.movement_id=e.target_id))
      OR (e.target_table='inventory_batches' AND EXISTS (SELECT 1 FROM inventory_batches x WHERE x.effect_key=e.effect_key AND x.batch_id=e.target_id))
      OR (e.target_table='inventory_batch_revisions' AND EXISTS (SELECT 1 FROM inventory_batch_revisions x WHERE x.effect_key=e.effect_key AND x.batch_revision_id=e.target_id))
      OR (e.target_table='inventory_batch_lines' AND EXISTS (SELECT 1 FROM inventory_batch_lines x WHERE x.effect_key=e.effect_key AND x.batch_line_id=e.target_id))
      OR (e.target_table='inventory_receipts' AND EXISTS (SELECT 1 FROM inventory_receipts x WHERE x.effect_key=e.effect_key AND x.receipt_id=e.target_id))
      OR (e.target_table='inventory_receipt_revisions' AND EXISTS (SELECT 1 FROM inventory_receipt_revisions x WHERE x.effect_key=e.effect_key AND x.receipt_revision_id=e.target_id))
      OR (e.target_table='inventory_receipt_lines' AND EXISTS (SELECT 1 FROM inventory_receipt_lines x WHERE x.effect_key=e.effect_key AND x.receipt_line_id=e.target_id))
    )
  );
END;

CREATE TRIGGER command_complete_before_commit
BEFORE UPDATE OF status ON commit_records
WHEN NEW.status='committed'
BEGIN
  SELECT RAISE(ABORT,'command lacks consumed, allowed authorization assertion')
  WHERE NOT EXISTS (
    SELECT 1 FROM commands c
    JOIN authorization_assertions a ON a.command_id=c.command_id
      AND a.commit_id=NEW.commit_id AND a.request_hash=c.request_hash
      AND a.decision='allow' AND a.action=c.command_type
      AND a.resource_id=c.aggregate_id
    JOIN nonce_records n ON n.nonce_id=a.nonce_id AND n.state='consumed'
    WHERE c.command_id=NEW.command_id
  );
  SELECT RAISE(ABORT,'orphan approval assertion or evidence record')
  WHERE EXISTS (
    SELECT 1 FROM authorization_assertions a
    WHERE a.commit_id=NEW.commit_id AND a.action='inventory.approve'
      AND NOT EXISTS (
        SELECT 1 FROM inventory_batch_lines l
        WHERE l.approval_assertion_id=a.assertion_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inventory_receipt_lines l
        WHERE l.approval_assertion_id=a.assertion_id
      )
  ) OR EXISTS (
    SELECT 1 FROM evidence_records e
    WHERE e.commit_id=NEW.commit_id
      AND NOT EXISTS (
        SELECT 1 FROM inventory_batch_lines l WHERE l.evidence_id=e.evidence_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inventory_batch_lines l WHERE l.independent_evidence_id=e.evidence_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM inventory_receipt_lines l WHERE l.evidence_id=e.evidence_id
      )
  );
  SELECT RAISE(ABORT,'order.create is missing an exact reservation or movement')
  WHERE EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.command_type='order.create'
      AND (
        NOT EXISTS (SELECT 1 FROM orders o WHERE o.order_id=c.aggregate_id
                    AND o.current_revision=1 AND o.current_status='pending')
        OR NOT EXISTS (SELECT 1 FROM order_lines l WHERE l.order_id=c.aggregate_id)
        OR EXISTS (
          SELECT 1 FROM order_lines l
          WHERE l.order_id=c.aggregate_id AND (
            NOT EXISTS (SELECT 1 FROM reservations r
                        WHERE r.line_id=l.line_id AND r.quantity=l.quantity)
            OR NOT EXISTS (
              SELECT 1 FROM reservations r
              JOIN inventory_movements m ON m.reservation_id=r.reservation_id
              WHERE r.line_id=l.line_id AND m.movement_kind='reserve'
                AND m.command_id=c.command_id AND m.quantity=l.quantity
            )
          )
        )
      )
  );
  SELECT RAISE(ABORT,'order.accept is missing revision 2 or has inventory effects')
  WHERE EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.command_type='order.accept'
      AND (
        NOT EXISTS (SELECT 1 FROM order_revisions r
                    WHERE r.command_id=c.command_id AND r.revision=2
                      AND r.status='accepted')
        OR EXISTS (SELECT 1 FROM inventory_movements m
                   WHERE m.command_id=c.command_id)
      )
  );
  SELECT RAISE(ABORT,'order.fulfill does not consume every reservation')
  WHERE EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.command_type='order.fulfill'
      AND (
        NOT EXISTS (SELECT 1 FROM order_revisions r
                    WHERE r.command_id=c.command_id AND r.revision=3
                      AND r.status='fulfilled')
        OR EXISTS (
          SELECT 1 FROM order_lines l
          JOIN reservations x ON x.line_id=l.line_id
          WHERE l.order_id=c.aggregate_id AND NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.reservation_id=x.reservation_id
              AND m.movement_kind='fulfill' AND m.command_id=c.command_id
          )
        )
      )
  );
  SELECT RAISE(ABORT,'bootstrap batch is incomplete')
  WHERE EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.command_type='inventory.bootstrap'
      AND (
        NOT EXISTS (SELECT 1 FROM inventory_batches b
                    WHERE b.batch_id=c.aggregate_id AND b.status='active'
                      AND b.current_revision=1)
        OR NOT EXISTS (SELECT 1 FROM inventory_batch_revisions r
                       WHERE r.batch_id=c.aggregate_id AND r.revision=1
                         AND r.status='active' AND r.command_id=c.command_id)
        OR NOT EXISTS (SELECT 1 FROM inventory_batch_lines l
                       WHERE l.batch_id=c.aggregate_id)
        OR EXISTS (
          SELECT 1 FROM inventory_batch_lines l
          WHERE l.batch_id=c.aggregate_id AND NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.batch_line_id=l.batch_line_id
              AND m.movement_kind='bootstrap' AND m.command_id=c.command_id
          )
        )
      )
  );
  SELECT RAISE(ABORT,'receipt batch is incomplete')
  WHERE EXISTS (
    SELECT 1 FROM commands c
    WHERE c.command_id=NEW.command_id AND c.command_type='inventory.receipt'
      AND (
        NOT EXISTS (SELECT 1 FROM inventory_receipts r
                    WHERE r.receipt_id=c.aggregate_id AND r.status='received'
                      AND r.current_revision=1)
        OR NOT EXISTS (SELECT 1 FROM inventory_receipt_revisions r
                       WHERE r.receipt_id=c.aggregate_id AND r.revision=1
                         AND r.status='received' AND r.command_id=c.command_id)
        OR NOT EXISTS (SELECT 1 FROM inventory_receipt_lines l
                       WHERE l.receipt_id=c.aggregate_id)
        OR EXISTS (
          SELECT 1 FROM inventory_receipt_lines l
          WHERE l.receipt_id=c.aggregate_id AND NOT EXISTS (
            SELECT 1 FROM inventory_movements m
            WHERE m.receipt_line_id=l.receipt_line_id
              AND m.movement_kind='receipt' AND m.command_id=c.command_id
          )
        )
      )
  );
END;

CREATE TRIGGER effects_target_guard
BEFORE INSERT ON effect_manifest
BEGIN
  SELECT RAISE(ABORT,'effect key must be derived by the trusted Main process')
  WHERE length(NEW.effect_key)<>64 OR NEW.effect_key GLOB '*[^0-9a-f]*';
  SELECT RAISE(ABORT,'effect kind and target table do not agree')
  WHERE NOT (
    (NEW.effect_kind='order.created' AND NEW.target_table='orders')
    OR (NEW.effect_kind='order.revision' AND NEW.target_table='order_revisions')
    OR (NEW.effect_kind='order.line' AND NEW.target_table='order_lines')
    OR (NEW.effect_kind='order.reservation' AND NEW.target_table='reservations')
    OR (NEW.effect_kind='inventory.identity' AND NEW.target_table='inventory_identity')
    OR (NEW.effect_kind='inventory.movement' AND NEW.target_table='inventory_movements')
    OR (NEW.effect_kind='inventory.batch' AND NEW.target_table='inventory_batches')
    OR (NEW.effect_kind='inventory.batch_revision' AND NEW.target_table='inventory_batch_revisions')
    OR (NEW.effect_kind='inventory.batch_line' AND NEW.target_table='inventory_batch_lines')
    OR (NEW.effect_kind='inventory.receipt' AND NEW.target_table='inventory_receipts')
    OR (NEW.effect_kind='inventory.receipt_revision' AND NEW.target_table='inventory_receipt_revisions')
    OR (NEW.effect_kind='inventory.receipt_line' AND NEW.target_table='inventory_receipt_lines')
  );
END;

CREATE TRIGGER evidence_no_update
BEFORE UPDATE ON evidence_records BEGIN SELECT RAISE(ABORT,'raw evidence is immutable'); END;
CREATE TRIGGER evidence_no_delete
BEFORE DELETE ON evidence_records BEGIN SELECT RAISE(ABORT,'raw evidence is retained'); END;
CREATE TRIGGER verification_no_update
BEFORE UPDATE ON evidence_verifications BEGIN SELECT RAISE(ABORT,'verification history is immutable'); END;
CREATE TRIGGER verification_no_delete
BEFORE DELETE ON evidence_verifications BEGIN SELECT RAISE(ABORT,'verification history is retained'); END;
CREATE TRIGGER key_event_no_update
BEFORE UPDATE ON authority_key_events BEGIN SELECT RAISE(ABORT,'key history is immutable'); END;
CREATE TRIGGER key_event_no_delete
BEFORE DELETE ON authority_key_events BEGIN SELECT RAISE(ABORT,'key history is retained'); END;
CREATE TRIGGER authorization_no_update
BEFORE UPDATE ON authorization_assertions BEGIN SELECT RAISE(ABORT,'authorization assertions are immutable'); END;
CREATE TRIGGER authorization_no_delete
BEFORE DELETE ON authorization_assertions BEGIN SELECT RAISE(ABORT,'authorization assertions are retained'); END;
CREATE TRIGGER recovery_no_update
BEFORE UPDATE ON recovery_events BEGIN SELECT RAISE(ABORT,'recovery history is immutable'); END;
CREATE TRIGGER recovery_no_delete
BEFORE DELETE ON recovery_events BEGIN SELECT RAISE(ABORT,'recovery history is retained'); END;
```

### 4.1 DDL limitations to observe during validation

The DDL intentionally makes `inventory_balances` a view. Any direct UPDATE of
that view fails because it has no INSTEAD OF trigger. `orders` is a live
projection table for indexed reads; its guard allows a state change only if a
matching next immutable revision already exists. This is a relational
consistency guard, not process authentication: a database writer capable of
inserting valid command/commit/revision rows can still construct a valid-looking
history. Sole-writer access remains operationally enforced.

Effect-key derivation is not implemented in SQLite. The Main process derives:

`lower_hex(SHA256(UTF8("drug-manager.effect.v1\0" || command_id || "\0" || effect_kind || "\0" || target_table || "\0" || canonical_target_id)))`

The Main process independently recomputes this value and the canonical
manifest hash before finalization. SQLite checks key format, uniqueness,
relational membership, target table/ID, expected count, and completeness; it
does not prove the SHA-256 derivation.

## 5. Table and relationship catalogue

| Table/view | Role, primary/candidate keys, relationships and mutability |
|---|---|
| `schema_meta` | Schema version and fixed metadata; PK `key`; Main-process schema gate; no runtime business writes. |
| `commands` | Immutable logical request; PK `command_id`; candidate key is command/type/aggregate/revision/hash. Canonical request/hash are immutable. FK target for commits and nonce records. |
| `commit_records` | One commit per command; PK `commit_id`, unique `command_id`; composite FK binds all request/aggregate identity to `commands`. Only `applying → committed` status transition. |
| `commit_finalizations` | Deferred-FK completion witness, inserted only by the committed-status trigger; makes a persisted `applying` commit impossible at transaction end. PK `commit_id`, unique `(commit_id,request_hash)`; immutable. |
| `effect_manifest` | One expected row per deterministic effect key; PK `effect_key`; unique commit/kind/table/target; FK to same commit/command. Immutable after claim. |
| `orders` | Order root/live projection; PK `order_id`; FK to create commit; update guard requires a matching next revision; delete prohibited. |
| `order_revisions` | Immutable order history; PK `revision_id`, unique `(order_id,revision)`; FKs to order, command, commit, manifest. |
| `order_lines` | Exact requested allocation by `inventory_identity`; PK `line_id`, unique `(order_id,identity_id)`; FKs to order and identity. |
| `reservations` | One row per order line; PK `reservation_id`, unique `line_id`; composite FK exactly binds line, identity, order. Immutable; no release state. |
| `inventory_identity` | Exact six-part identity with explicit non-null canonical parts; PK `identity_id`, unique six-part business key; identities created only by bootstrap command. Immutable. |
| `inventory_movements` | Immutable reserve, fulfill, bootstrap, receipt ledger; PK `movement_id`; unique effect key; FKs to exact identity and related reservation/batch/receipt line. Partial unique indexes allow only one reserve and one fulfill per reservation. |
| `inventory_balances` | Read-only derived view of available, reserved, and on-hand balances from movements. No independently mutable balance store. |
| `inventory_batches` | Bootstrap aggregate root; PK `batch_id`; revision 0/pending while applying, revision 1/active on success; immutable ID; activation gated. |
| `inventory_batch_revisions` | Immutable bootstrap history; PK `batch_revision_id`, unique `(batch_id,revision)`; only revision 1/active; FK to batch, commit, and manifest. |
| `inventory_batch_lines` | Counted inventory identity and opening allocation; PK `batch_line_id`, unique identity; FKs to batch, bootstrap-created identity, evidence, approval assertion, commit, manifest. Counting and approver actor IDs must differ. |
| `inventory_receipts` | Receipt aggregate root; PK `receipt_id`; revision 0/pending while applying, revision 1/received on success. |
| `inventory_receipt_revisions` | Immutable receipt history; PK `receipt_revision_id`, unique `(receipt_id,revision)`; only revision 1/received; FK to receipt, commit, and manifest. |
| `inventory_receipt_lines` | Itemized receipt; PK `receipt_line_id`; FKs to receipt, existing identity, source evidence, second approver assertion and manifest. Receiver and approver differ. |
| `evidence_records` | Immutable raw evidence and provenance; PK `evidence_id`; composite unique target supports exact resource/commit FK from lines. Digest is integrity metadata, not authenticity. |
| `evidence_verifications` | Immutable processing history; PK `verification_id`; FK to evidence. `verified` is a recorded result, not cryptographic proof. |
| `authority_keys` | ES256 public-key fingerprint registration only; PK `key_id`; no private key stored. Trusted registry and custody are external. |
| `authority_key_events` | Append-only registration/rotation/revocation history; PK `key_event_id`; FK to key. Key validity at decision time is checked online by Main process. |
| `nonce_records` | Unique, immutable nonce identity with constrained state transition. PK `nonce_id`; unique nonce value; FK to command. A rolled-back/expired nonce remains permanently unavailable. |
| `nonce_events` | Append-only event for every nonce state transition; PK `nonce_event_id`, FK to nonce. |
| `authorization_assertions` | Immutable assertion record bound to commit/hash/action/resource/actor/key/nonce; FK to commit/key/nonce. Signature validation and policy decision are Main-process-only. |
| `recovery_events` | Append-only observations/adjudication records, including IDs when no commit row is yet visible. No automatic resolution or reversal. |

Indexes beyond PK/UNIQUE indexes:

- `one_reservation_movement` and `one_fulfillment_movement` enforce at-most-one
  movements per reservation; `one_bootstrap_movement` and
  `one_receipt_movement` enforce one movement per batch/receipt line.
- Add workload indexes only after query-plan review; no performance index may
  weaken unique or FK semantics.

## 6. State transitions and command/effect mapping

### Order lifecycle

| Revision | Status | Sole command | Expected revision |
|---:|---|---|---:|
| 1 | `pending` | `order.create` | 0 |
| 2 | `accepted` | `order.accept` | 1 |
| 3 | `fulfilled` | `order.fulfill` | 2 |

There are no other transitions. Creation reserves the complete exact line set.
Acceptance writes a revision effect and **zero inventory movements**.
Fulfillment writes one consumption movement per reservation. No expiration or
release is scheduled; pending reservations may remain indefinitely.

### Stage 36A1 operation vocabulary reconciliation

- `reserve` is only the internal movement of `order.create`; it is not an
  independently callable release-one command.
- `fulfill` is only the movement effect of `order.fulfill`.
- `receipt` is only the movement effect of `inventory.receipt`.
- `release`, `correction`, and `reversal` are absent from command and movement
  catalogs. Return-driven inventory is absent.

### Inventory identity and movements

Identity key is exactly:
`(medicine_id, canonical_unit, tracking_state, lot_id, expiry_state, expiry_date)`.
All parts are non-null. `tracked` requires a nonempty lot. Explicit `untracked`
uses an empty lot string; it is not a wildcard. Expiry `none` uses empty
`expiry_date`; expiry `date` uses a valid canonical date. `unknown` is not a
valid tracking or expiry state.

| Kind | Available delta | Reserved delta | Required link |
|---|---:|---:|---|
| `reserve` | `-Q` | `+Q` | Exact reservation; current available ≥ Q |
| `fulfill` | `0` | `-Q` | Exact prior reserve; one fulfillment only |
| `bootstrap` | opening available | opening reserved | Exact count/allocation batch line; prior balance zero |
| `receipt` | `+Q` | `0` | Exact evidence-backed receipt line |

For every movement:
`after = before + delta`; `on_hand_delta = available_delta + reserved_delta`;
`before_*` must equal the derived ledger balance at insert time; resulting
balances must remain within safe bounds and nonnegative.

### Command effects

| Command | Aggregate/revision | Required manifested rows | Forbidden effects |
|---|---|---|---|
| `order.create` | `orders`, rev 0→1 pending | Order root, revision 1, each exact line, one reservation and one reserve movement per line | Missing/extra line or reservation; fulfillment movement |
| `order.accept` | existing order, rev 1→2 accepted | Revision 2 only | Any inventory movement |
| `order.fulfill` | existing order, rev 2→3 fulfilled | Revision 3 and one fulfillment movement per reservation | Partial, substituted, duplicate, or extra consumption |
| `inventory.bootstrap` | `inventory_batches`, rev 0→1 active | Batch, revision 1, each identity, count/allocation line, bootstrap movement per line | Activation without two counts, distinct approver, evidence, or matching movements |
| `inventory.receipt` | `inventory_receipts`, rev 0→1 received | Receipt, revision 1, each receipt line, receipt movement per line | Missing source evidence, receiver, distinct second approver, or target identity |

### Canonical request contracts

The command table stores the canonical JSON envelope and hashes it; SQLite
does not parse business-array semantics. Main accepts closed schemas only:

| Command | Canonical business fields and types |
|---|---|
| `order.create` | `orderId:string`, `items:nonempty array`; each item has `medicineId:string`, `canonicalUnit:string`, `trackingState:'tracked'\|'untracked'`, `lotId:string`, `expiryState:'none'\|'date'`, `expiryDate:string`, `quantity:positive safe integer`. Identity fields are explicit; duplicate identical identities are aggregated with checked arithmetic before serialization or rejected. |
| `order.accept` | `orderId:string`, `expectedRevision:1`, explicit accepting actor authorization. No inventory fields. |
| `order.fulfill` | `orderId:string`, `expectedRevision:2`, physical-handoff timestamp/attestation and authorizing actor. The item set is read from immutable reservations, not client-redeclared. |
| `inventory.bootstrap` | `batchId:string`, nonempty lines; each line has a complete identity, `countedQty`, `openingAvailable`, `openingReserved` as safe integers, two distinct counter actor references, two distinct evidence references, and a distinct approval actor/assertion. |
| `inventory.receipt` | `receiptId:string`, nonempty lines; each line has an existing complete `identityId`, positive safe-integer `quantity`, source `evidenceId`, `receiverActorId`, and distinct `secondApproverActorId`/assertion. |

Canonical JSON uses UTF-8, stable object-key ordering, no insignificant
whitespace, integer-only quantities, and the version-1 closed field sets above.
All units are canonical identity values; conversion is never implicit. If
medicine/unit/tracking configuration is missing, Main rejects rather than
guessing.

## 7. Command transaction protocols

All commands use `BEGIN IMMEDIATE` so a writer serializes before checking
commit identity or balances. Every write and the final `applying → committed`
update occur in the same SQLite transaction. On any failure, issue `ROLLBACK`.
Do not treat `SQLITE_BUSY` as rejection; retry or record uncertainty.

The durable nonce reservation transaction is separate from the business
transaction:

```sql
BEGIN IMMEDIATE;
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES
  (:nonce_id,:nonce_value,:actor_id,:command_id,:request_hash,'presented',:now);
UPDATE nonce_records SET state='reserved' WHERE nonce_id=:nonce_id;
UPDATE nonce_records SET state='consumed' WHERE nonce_id=:nonce_id;
COMMIT;
```

The nonce event triggers preserve all three states. A later business rollback
does not undo this committed nonce transaction.

The business transaction envelope is:

```sql
BEGIN IMMEDIATE;
-- First inspect commit_records by commit_id; exact retry returns prior result.
-- Insert applying commit, manifest/assertion/evidence references, and effects.
UPDATE commit_records
   SET status='committed', finalized_at=:now
 WHERE commit_id=:commit_id AND status='applying';
-- Require exactly one changed row, then:
COMMIT;
```

The finalization update runs both completeness triggers and its AFTER trigger
creates `commit_finalizations`. Deferred foreign keys prohibit a transaction
from committing an unfinalized commit record.

### Common preparation

1. Main process authenticates actor, canonicalizes closed-schema request
   version 1, validates all IDs/integers/dates, computes request hash, derives
   `commit_id`, `command_id`, effect keys, and manifest hash.
2. Verify evidence bytes, ES256 assertion, actor role/authorization, nonce
   binding, key status, policy version, and revocation state online. Persist
   the immutable command row in a preparation transaction. An exact existing
   command row is reused; a different request for its ID fails closed.
3. Persist the nonce in a separate durable transaction: insert `presented`,
   transition to `reserved`, then `consumed`. A failed business transaction
   never makes that nonce reusable. A retry requiring fresh authorization uses
   a new nonce.
4. Begin the business transaction with `BEGIN IMMEDIATE`.
5. If `commit_id` exists: same command/request hash returns the original
   committed result after full row/effect verification; any identity mismatch
   records an explicit conflict outside the winning commit path and fails
   closed. Do not write another command.
6. Insert commit (`applying`), effect manifest, authorization assertion and
   required evidence references. The assertion must reference the consumed
   nonce. Never accept caller-supplied hashes or decisions without
   recomputation/verification.
7. Apply command-specific writes below, update commit status to `committed`
   only after completeness checks succeed, then `COMMIT`. A deferred FK to
   `commit_finalizations` prevents committing an `applying` row.
8. After COMMIT, query the commit and complete effect set. If the response was
   lost, this read determines whether the commit exists. Never reverse or
   silently adjudicate.

### `order.create`

- Preconditions: expected revision 0; exact identities exist and are active
  from bootstrap; request contains at least one exact identity/quantity line;
  available stock covers every line; authorization and nonce valid.
- Insert command and applying commit, manifest entries, and order root at
  revision 0. Insert each `order_line`, matching reservation, then its reserve
  movement with snapshots read from `inventory_balances`.
- Revision trigger permits only revision 1/pending and updates order projection.
- Check all lines have exactly one reservation and reserve movement; all
  balances nonnegative; all manifest targets complete; finalize commit and
  commit transaction.
- On a shortage or any line failure, rollback the entire transaction. No
  partial reservation survives.

### `order.accept`

- Preconditions: order is pending/revision 1; expected revision 1; actor has
  explicit administrative authorization. No automatic permissions are
  inherited by existing admin/assistant roles.
- Insert command/commit, one revision manifest, and revision 2 accepted.
- Verify this command has no movement rows and the exact revision exists.
  Finalize/commit.
- Retrying exact commit returns its prior result; a different request under
  the same committed ID conflicts.

### `order.fulfill`

- Preconditions: accepted/revision 2; expected revision 2; physical handoff
  occurred; authorization valid.
- Insert command/commit and one fulfill movement for every reservation while
  the order projection is still accepted/revision 2. Movement trigger requires
  exact reservation identity and quantity, prior reserve, and no prior
  fulfillment. Insert revision 3 fulfilled only after all consumption
  movements are present.
- Require movement count equal reservation count; finalize/commit atomically.
- No partial fulfillment or altered line set is accepted.

### `inventory.bootstrap`

- Preconditions: new batch and new identities, physical itemization, first
  count and independent second count with separate evidence references,
  explicit opening available/reserved allocation equal to counted quantity,
  distinct approver, evidence, authorization, and nonce.
- Insert command/commit, batch pending, both line-specific count evidence
  records and verification history, approval assertions, new identities
  (which have a derived zero balance), batch lines, bootstrap movements from
  zero, and exact manifests.
- Insert immutable batch revision 1/active. Its trigger requires all lines to
  have matching bootstrap movements and verified evidence; its AFTER trigger
  updates the batch projection. Verify all manifest counts, finalize, and
  commit.
- Any discrepancy rolls back identity creation and all movements.

### `inventory.receipt`

- Preconditions: existing exact identity (a new identity must first be
  bootstrapped), positive quantity, source evidence, receiver, distinct
  second approver, authorization and nonce.
- Insert command/commit, receipt pending, evidence/assertion records,
  itemized receipt lines and matching receipt movements.
- Insert immutable receipt revision 1/received. Its trigger requires one
  movement and verified evidence per line; its AFTER trigger updates the
  receipt projection. Finalize manifest/commit atomically.

## 8. Manifest completeness protocol

Each manifest entry represents exactly one target row (`expected_row_count=1`).
Every listed target row has a NOT NULL unique `effect_key` and deferred FK to
the exact manifest row. Insert guards and the commit finalization trigger
verify target table/ID and that every manifest key is referenced by exactly
one target row. A target row cannot exist with a missing manifest entry because
of the FK. A manifest entry cannot be orphaned at finalization. Duplicate keys
are rejected by PK/UNIQUE constraints.

`order.accept` has a manifested `order_revisions` row and **no inventory
movement manifest/effect**. The commit finalizer and command protocol check
zero movement rows for this command.

SQLite verifies row membership/counts, not that Main derived the correct
cryptographic key from business semantics. Main independently computes
expected rows from canonical request and verifies key derivation and manifest
hash before finalization and during recovery. Missing, extra, or substituted
business effects cause fail-closed recovery; they are not repaired automatically.

## 9. Evidence, authorization, nonces, and recovery

- Evidence stores immutable original bytes, provenance, resource binding, and
  digest. Verification rows preserve each processing result. Digests do not
  prove source authenticity.
- Authority key table records only ES256 public-key fingerprints and key IDs.
  Private keys and managed-key-service identifiers/configuration are external
  prerequisites. Key events are append-only.
- Authorization assertion rows retain signed assertion bytes/digest and bind
  commit, request hash, action, resource, actor, role snapshot, key, nonce,
  policy version, and expiry. Main validates ES256, checks trusted authority
  registration/revocation and online policy at the decision boundary. A
  database `allow` value is not proof.
- Nonce value is globally unique; all state changes preserve the same nonce,
  actor, command, and request hash. `rolled_back` and `expired` nonces remain
  consumed for uniqueness and can never be presented again. A retry of the
  same command uses the recorded result, not a second nonce presentation.
- `recovery_events` records prepared/submitted/unknown/confirmed/conflict/
  corrupt/adjudicated observations as append-only history. Policy Y: first
  successful COMMIT for a commit ID wins. Uncertain outcomes are queried and
  compared against the full effect set; no automatic resolution or reversal.
  `SQLITE_BUSY` is transient, never a definitive rejection.

## 10. Enforcement-boundary matrix

| Invariant | Enforcement |
|---|---|
| PK/FK/unique membership; non-null full inventory key | SQLite |
| Lifecycle revision number/status/command/expected revision | SQLite triggers plus trusted transaction ordering |
| Movement arithmetic/current balance/nonnegative result | SQLite movement CHECK/trigger; `BEGIN IMMEDIATE` serializes writers |
| No direct writable inventory balance | SQLite: balance is a view, no write trigger |
| Order projection changes only with matching next revision | SQLite trigger; sole-writer control still required |
| Exact manifest target membership and row count | SQLite FK/unique/finalization trigger |
| Effect-key derivation and canonical manifest hash | Main process |
| Canonical request and request SHA-256 correctness | Main process; DB stores immutable result and verifies cross-table equality |
| Evidence byte digest and provenance authenticity | Main process; DB preserves bytes/metadata |
| ES256 signature, trusted key status, current revocation, online authorization | Main process/managed authority service |
| Different actor IDs for counting/approval and receiving/approval | SQLite CHECK; identity truth is Main-process responsibility |
| Nonce uniqueness and allowed row-state transition | SQLite unique/trigger; nonce issuance and actor binding Main-process responsibility |
| First successful commit wins, retries, uncertain COMMIT behavior | SQLite unique commit ID plus serialized transaction; Main recovery protocol |
| `SQLITE_BUSY` not rejection | Main process |
| Prevent renderer/direct process from opening DB | Operational: file ACL, Main-process ownership, narrow IPC |
| Power-loss durability, WAL file integrity, backups/key custody | Operational |
| No legacy stock import or automatic retention deletion | Main-process migration boundary and operational retention controls |
| No permission inheritance by existing roles | Main-process authorization policy; explicit policy version/assertion |

## 11. Executable validation plan (not executed)

Run on a disposable **file-backed** database using the documented SQLite
runtime. Save the exact DDL above as a test input without changing its bytes.
Do not use the project database.

### Setup

```sql
-- Open a new disposable file and execute:
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;       -- expect one row: wal
PRAGMA synchronous=FULL;
PRAGMA synchronous;            -- expect 2
SELECT sqlite_version();       -- expect >= 3.46.0
SELECT json_valid('{}');       -- expect 1
-- Execute the entire DDL in §4.
PRAGMA foreign_key_check;      -- expect zero rows
```

### Test matrix

For the following tests, seed valid commands, commits, manifests, keys,
evidence, and prerequisite aggregates using the transaction protocol. Every
negative test must run inside a savepoint and roll back after asserting failure.

| ID | Setup and attempted SQL/operation | Expected result and observable state |
|---|---|---|
| V01 Whole DDL | Execute all §4 statements in a fresh file DB. | No SQL errors; expected tables/views/triggers exist; `foreign_key_check` returns zero rows. |
| V02 Runtime | Run setup pragmas and version/JSON queries above. | `wal`, synchronous `2`, version ≥ 3.46.0, JSON result 1. |
| V03 Order-trigger interaction | Seed valid create command/commit/effects/order root; insert revision 1 pending. | Insert succeeds; order projection becomes `(1,pending)`; no trigger abort. |
| V04 Direct order update | `UPDATE orders SET current_status='fulfilled',current_revision=3 WHERE order_id=?` without a matching next revision. | Abort; order row unchanged. |
| V05 Exact lifecycle | Apply create rev1, accept rev2, fulfill rev3 with valid separate commands. | Success; final rev3/fulfilled. Repeated pending, accept twice, skip to rev3, fulfill before accept, or wrong command type each abort. |
| V06 Revision cross-binding | Attempt revision with mismatched command aggregate, expected revision, commit ID, command type, or request hash. | FK/trigger failure; no revision/order projection change. |
| V07 Bootstrap empty inventory | Begin fresh bootstrap transaction; insert batch, identity, itemized count/evidence/independent counters/approver, opening allocations, and bootstrap movement from view balance zero. | All inserts succeed; before values zero; after values match allocation; batch active only after complete lines/movements; balance view equals allocations. |
| V08 Bootstrap incomplete | Omit count evidence, second counter, separate approver, or one movement; attempt activation/finalize. | Constraint/trigger abort; transaction rollback leaves no committed identity/batch/movement. |
| V09 Identity values | Try tracked empty lot, untracked nonempty lot, unknown tracking, unknown expiry, missing unit, invalid date `2026-02-31`, non-date state with date, and date state with empty expiry. | All invalid combinations rejected. Explicit tracked/untracked identities with valid expiry pairs insert; same six-part key duplicates rejected. |
| V10 Reservation shortage/multi-line atomicity | Seed balances; request multiple exact lines where one has insufficient available stock; run create transaction. | Movement fails; transaction rollback leaves zero new order, reservations, movements, and unchanged balances. |
| V11 Reservation exactness | Insert order line and reservation with different identity or quantity; attempt reserve movement. | FK/trigger fails. With exact match, one reserve movement succeeds and balance view moves available→reserved. |
| V12 Concurrent reserve | Two file connections run `BEGIN IMMEDIATE` with the same available units and distinct commit IDs. | Serialized writer sees updated ledger; at most one can reserve beyond available quantity; no negative balance. |
| V13 Fulfillment completeness | Fulfill all accepted reservations using exact movements. Repeat a movement, alter identity/qty, omit one, or add extra one. | Exact complete set succeeds once; duplicates/substitutions/partial set fail finalization; balances equal ledger sums. |
| V14 Movement snapshots | Supply before values different from `inventory_balances`, inconsistent after/delta, negative result, or unsafe result. | Trigger/CHECK failure; movement table and derived balances unchanged. |
| V15 Direct inventory update | `UPDATE inventory_balances ...`; also attempt UPDATE/DELETE on `inventory_movements`. | View write fails; movement UPDATE/DELETE abort; balance view unchanged. |
| V16 Acceptance zero effect | Apply valid accept command/revision; attempt reserve/fulfill/receipt movement for same command. | Acceptance commits with no movement; attempted movement aborts. |
| V17 Manifest completeness | Omit manifest, duplicate effect key, wrong target ID/table, leave orphan manifest, add unmanifested target, or corrupt expected count. Finalize. | FK/UNIQUE/trigger abort; no commit marked committed. Complete one-to-one set finalizes. |
| V18 Evidence/approval FKs | Use nonexistent evidence/assertion, wrong commit/resource/action/actor, or same counter/approver and receiver/approver. | FK/CHECK failure; rows/commit do not finalize. |
| V19 Nonce replay | Insert same nonce with NULL-equivalent/other command, same command, consumed, rolled_back, and expired state; attempt invalid transitions. | Unique nonce blocks every duplicate. Only declared transitions succeed; rolled-back/expired remain unusable. |
| V20 Append-only protection | UPDATE/DELETE command, commit identity, manifest, revision, movement, raw evidence, verification, key event, authorization assertion, recovery event. | Abort; original bytes/rows remain. Legal commit-status and nonce transitions alone succeed. |
| V21 Commit idempotency | Submit same commit/request twice; then same commit with changed request hash/type/aggregate. | Same identity returns original verified effect set without extra writes; changed identity conflicts and never mutates winner. |
| V22 Commit finalization | Attempt `applying→committed` with missing/extra effects or wrong manifest count. | Trigger aborts; status remains applying within transaction, then rollback. Complete set allows finalization. |
| V23 Recovery | Simulate response loss after COMMIT; query by commit ID and compare all expected effect rows; append unknown and confirmed observations. | Existing full commit returns original outcome; absent commit remains retryable; no auto-adjudication or reversal. |
| V24 Busy handling | Hold writer lock on connection A; submit on B and induce `SQLITE_BUSY`. | B records/retries transiently; no definitive-rejection record solely from BUSY. |
| V25 File-backed durability configuration | Reopen DB and read journal/synchronous pragmas; run controlled crash/reopen test only in disposable environment. | WAL and FULL persist/configure as intended; document platform-specific result, do not infer universal power-loss immunity. |
| V26 Integrity audit | Run `PRAGMA foreign_key_check`, enumerate all `sqlite_schema` objects, recompute view balances against grouped movement sums. | No FK rows, expected complete DDL objects, identical sums. |

Validation reports must capture SQLite version, compile options, exact DDL
hash, each SQL input, error/result, and resulting row counts/balances. No test
result is asserted in this specification.

## 12. Unresolved decisions and operational prerequisites

No unresolved release-one business transition is introduced. These external
prerequisites remain:

- Confirm canonical unit vocabulary and medicine-ID grammar before production
  data entry; do not infer/convert legacy stock.
- Decide the authority service, ES256 key provisioning/rotation/revocation
  workflow, and trusted actor identity source. No identities or key IDs are
  invented here.
- Define the canonical JSON version-1 serializer precisely in the Main-process
  contract and test hash parity.
- Confirm maximum supported order line count and practical database size limits.
- Validate the actual Electron SQLite runtime, Windows filesystem ACLs, WAL
  behavior, backup/restore, and power-loss recovery.
- Define a human adjudication procedure and authorized actors for
  `submission_unknown`, conflicts, or corruption. Do not auto-resolve.
- Retention remains indefinite until separately approved; no schema cleanup
  job is authorized.
- Confirm whether explicitly classified untracked inventory may carry a
  calendar expiry date; this DDL permits it because the full identity tuple
  supports independent explicit tracking and expiry states. If policy forbids
  that combination, owner approval is required before narrowing it.

## 13. Traceability matrix

| Approved decision / defect | Proposed implementation |
|---|---|
| `order.create` creates pending and reserves atomically | §6/§7; order revision trigger, exact order lines/reservations, reserve movements, single transaction |
| `order.accept` administrative and zero inventory effects | §6/§7; rev2 command binding and movement prohibition |
| Fulfillment consumes exact reservation | §6/§7; one reservation per line; exact one-time fulfill movement and balance validation |
| Pending reservation can remain indefinitely | No timeout/release transition, no expiry task; held reservation remains as ledger-linked row |
| Bootstrap count, independent count, separate approval | Batch line actor fields, distinct CHECKs, evidence/authorization composite FKs and activation gate |
| Receipt evidence, receiver, independent approver | Receipt line fields, evidence/assertion composite FKs and actor inequality |
| No release/cancel/reject/expiry/correction/reversal/return | Closed command and movement enums |
| No legacy stock import | Identity rows originate only in `inventory.bootstrap`; no migration command |
| Main process owns DB/narrow IPC | §10 explicitly operational; SQLite not claimed to authenticate process |
| No permission inheritance | Explicit trusted authorization per command and policy version; existing roles confer no automatic access |
| `SQLITE_BUSY` transient | §7/§9/§11 V24 |
| First successful COMMIT wins | Unique commit ID, `BEGIN IMMEDIATE`, exact retry identity comparison |
| No automatic adjudication/reversal | Append-only recovery records and manual external adjudication |
| Preserve evidence/history/no automatic deletion | Immutable evidence and append-only histories; DELETE triggers |
| T01 order trigger interaction | `order_update_guard` permits only exact update corresponding to inserted next revision |
| T02 inventory trigger interaction | No writable balance table; derived view over immutable movements |
| T03 bootstrap from empty state | Identity row contributes zero to view; first bootstrap movement starts from zero |
| T04 lifecycle gaps | Revision/status/command/expected-revision conjunction in `order_revision_guard` |
| T05 unknown classification | `tracking_state` excludes `unknown`; expiry excludes `unknown` |
| T06/T07 invalid dates/sentinel bypass | Empty string is only no-date representation; calendar-normalization check and strict Main parser |
| T09 snapshot mismatch | Movement guard matches before values to view and checks after/delta arithmetic |
| T10 orphan manifest | Effect-bearing rows FK to manifest; finalizer checks target/table/ID/count and one-to-one use |
| T11 malformed hashes | Lowercase hex GLOB plus exact length; Main recomputes cryptographic digest |
| T12 nonce replay | Non-null unique nonce value and immutable identity/state transition |
| Commit/command mismatch | Composite FK and revision trigger bind command, commit, aggregate, expected revision, type, request hash |
| Evidence/approval looseness | Composite foreign keys bind evidence/assertion to commit, resource, action, actor |
| Authorization is not self-proving | ES256 signed bytes retained; cryptographic/online trust explicitly Main-process-enforced |
| FULL/WAL durability | Required pragmas/runtime checks; operational validation explicitly pending |

## 14. Final determination

The DDL, transaction contracts, enforcement boundaries, and test plan are
specified for independent execution and review. No execution or test pass is
claimed. Independent validation must execute the complete script and resolve
any syntax, FK, trigger-order, concurrency, or portability defect it finds
before implementation is considered.

`STAGE_36A70F_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`

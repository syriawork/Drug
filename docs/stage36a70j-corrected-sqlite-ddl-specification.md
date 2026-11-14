# Stage 36A70J — Corrective SQLite DDL Specification

**Version:** 1.0  
**Status:** `STAGE_36A70J_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`  
**Scope:** Design and specification only. No DDL in this document has been
executed. This document does not claim implementation readiness.

## 1. Executive determination

Stage 36A70I found that Stage 36A70H's finalizer treated the manifest as a
description of effects that happened to be inserted, but did not require all
effect types required by a command. An `order.create` could therefore provide
a valid root, line, reservation, reserve movement, authorization, and matching
manifest while omitting the mandatory revision-1 `pending` row and its
manifest entry. The existing finalizer saw no orphan manifest/effect and its
order-create branch checked reservations and movements only. It committed the
reservation while leaving the order projection at revision 0.

This correction preserves the Stage H schema and adds a mandatory policy guard
and a **second, independent command-completeness trigger** on commit
finalization. The new trigger checks, for all five release-one command types,
the exact required revision/root state, effect-kind set and cardinality, and
command-specific child-set relationships. It raises `ROLLBACK`, not `ABORT`,
when a finalization invariant is incomplete, so the entire current SQLite
transaction is rolled back rather than leaving earlier statements pending in
an open transaction. The common command protocol also requires `ROLLBACK` on
any earlier statement error.

The receipt-identity decision is no longer open: the owner approved
`inventory.receipt` creating a new identity atomically. The installation
configuration is constrained to `receipt_may_create`; `existing_only` is not
an allowed policy in this stage.

This document is ready for an independent validator to execute and challenge.
No tests or DDL have been run as part of Stage 36A70J.

## 2. Source review and evidence boundaries

### 2.1 Files inspected

- [stage36a70i-independent-validation-report.md](./stage36a70i-independent-validation-report.md)
- [stage36a70h-corrected-sqlite-ddl-specification.md](./stage36a70h-corrected-sqlite-ddl-specification.md)
- Stage 36A70G validation report: searched the workspace `docs` directory; no
  Stage 36A70G report file was present. Stage G's reported findings are
  available only through the Stage H and Stage I retrospective matrices.

The Stage I report's SHA-256 for Stage H is
`14B9AD08B5B79556EF41E9243484576D920FCE256E70A3AA6911F022C9CAC3ED`.
Stage I's executed DDL was both §4 SQL blocks of Stage H, concatenated in
source order: 72,716 characters, 1,375 lines, SHA-256
`fc30c0760af772fb7c55d6d0e87cf72b92bcdd67fddbc66af2c76b8e329ef408`.
Stage I reports SQLite 3.50.4, successful full-script execution, WAL,
`synchronous=FULL`, clean foreign-key and integrity checks, and several
successful positive paths. Those are Stage I observations only; Stage J does
not rerun or extend them.

### 2.2 Findings classified

| Classification | Finding |
|---|---|
| Confirmed defect, critical | Stage I executed `order.create` finalization without an order revision. Result: committed commit, root `(current_revision=0,current_status='pending')`, zero revisions, and balance `(available=7,reserved=3)`. |
| Confirmed specification defect, high | Stage H still presented receipt identity creation as an unresolved choice and allowed `existing_only`, despite the owner's binding decision permitting receipt-created identities. |
| Confirmed Stage G defects with Stage I regression evidence | Post-commit receipt root rebinding, post-commit manifest/effect insertion, extra bootstrap identity at finalization, and empty medicine ID were respectively rejected in the Stage I paths described in its report. |
| Unexecuted, not a pass or a failure | The Stage I report explicitly lists the lifecycle cross-binding, multi-line shortage/substitution, movement mutation/arithmetic, receipt omission/duplicate, actor, identity-format, broad append-only, duplicate finalized commit, uncertain COMMIT, crash, and oversubscription tests as not executed. |
| Potential design gap requiring the Stage J independent test suite | Stage H's command finalization rules were not uniformly demonstrated to require every command's exact revision/projection and exact effect set. In particular, command-specific completeness must be tested for `inventory.bootstrap`, `inventory.receipt`, `order.accept`, and `order.fulfill`, not inferred from positive paths. |
| Design limitation, not a SQLite defect | SQLite cannot authenticate a trusted writer, verify a real person's identity, cryptographically validate signatures, or establish online authorization/key revocation. These remain Main-process/service and operational controls. |
| Unavailable evidence | No standalone Stage G report was found in the workspace, so its original exact SQL and results cannot be independently re-read here. Stage H and Stage I report its defect descriptions; Stage J tests must reproduce those conditions against the corrected script. |

### 2.3 Exact Stage I failure and root cause

Stage I's fixture created a committed bootstrap identity with 10 available
units, then an applying `order.create` for order `o` with one line `l` for
quantity 3, exact reservation `r`, exact reserve movement `rm` changing
`(10,0)` to `(7,3)`, valid authorization, and manifest rows for those actual
effects. It intentionally inserted no `order_revisions` row and no revision
manifest row, then ran:

```sql
UPDATE commit_records
SET status='committed', finalized_at='2026-11-12T10:00:00.000Z'
WHERE commit_id='ocm';
```

Stage I observed that the update succeeded. The committed order remained
revision 0 / pending; its revision count was zero; the balance was available 7,
reserved 3. The missing control was not a foreign key or manifest relationship:
there was no row to mismatch. The semantic rule “every create command must
produce revision 1 pending” existed in prose and in the revision-insert
trigger, but no finalization condition required that the insert happen.

## 3. Preserved business and trust decisions

This specification retains:

- The only release-one commands are `order.create`, `order.accept`,
  `order.fulfill`, `inventory.bootstrap`, and `inventory.receipt`.
- Order state is exactly `pending → accepted → fulfilled`, with create,
  accept, and fulfill mapped respectively to revisions 1, 2, and 3.
- `order.create` reserves every exact line atomically.
- `order.accept` creates revision 2 and has zero inventory movement.
- `order.fulfill` consumes each exact reservation exactly once.
- Bootstrap requires itemized physical count, independent count evidence,
  separate approval, and exact opening movement.
- A receipt may create a previously nonexistent complete inventory identity
  atomically with source evidence, receiver, independent approval, movement,
  receipt line/revision, and manifest.
- Receipt creation does not require the identity to have been bootstrapped.
- No legacy stock conversion; no release, cancellation, rejection, expiry,
  correction, reversal, return-driven inventory command, or automatic
  reservation timeout. Pending reservations may remain indefinitely.
- No automatic deletion of journal records, automatic reversal, or silent
  conflict resolution.
- `SQLITE_BUSY` is transient, not a definitive business rejection.
- The first successful `COMMIT` for a `commit_id` wins.
- Missing/incomplete inventory classification blocks operations.
- The Main process owns the database through narrow IPC. SQLite does not
  identify a trusted writer. Distinct actor IDs do not prove distinct humans.

### 3.1 Runtime and format assumptions inherited from Stage H

Use SQLite >= 3.46.0 and require `STRICT`, foreign keys, partial indexes,
JSON1, date functions, WAL, and deferred foreign keys. Every connection must
enable and read back `foreign_keys=1`, `journal_mode='wal'`,
`synchronous=2` (FULL), and the configured busy timeout. Main validates
canonical JSON, content-derived request/effect hashes, safe integer values,
catalog membership and enabled status, trusted evidence, signatures, actor
identity, online authorization, and key revocation status.

SQLite checks form and relational consistency only. A 64-hex digest in a test
fixture is not proof that its content-derived hash is correct.

## 4. Corrected DDL installation and finalization architecture

### 4.1 Complete installation unit

For reproducibility, the proposed installation script is:

1. Both SQL code blocks under §4 of the inspected Stage H specification,
   extracted in document order without edits; then
2. The two Stage J SQL blocks below, in order.

The Stage H schema/table/index/trigger definitions remain the baseline; the
Stage J triggers are required additional DDL, not optional examples or an
application-layer substitute. Stage H §7's old `existing_only` alternative
and unresolved receipt decision are superseded by §3 above and the
`stagej_receipt_policy_guard` below. The installation fixture must insert
exactly `receipt_may_create`.

The Stage H `finalization_completeness` trigger continues to enforce
manifest/effect equality, target IDs, general authorization, bootstrap and
receipt lineage, and the baseline child relationships. The Stage J
`commit_command_completeness` trigger adds the missing command grammar. Both
run before the applying-to-committed transition. SQLite's order among
same-event triggers is not relied on: the Stage J trigger independently
verifies each additional invariant and rolls back if any one is false.

### 4.2 Bind the persisted policy to the approved decision

```sql
CREATE TRIGGER stagej_receipt_policy_guard
BEFORE INSERT ON policy_config
WHEN NEW.receipt_identity_policy <> 'receipt_may_create'
BEGIN
  SELECT RAISE(ABORT,
    'owner-approved receipt policy requires receipt_may_create');
END;
```

Stage H's `policy_insert_once`, `policy_no_update`, and `policy_no_delete`
remain active. The owner decision is persisted in the sole row:

```sql
INSERT INTO policy_config
  (singleton,receipt_identity_policy,approved_by_actor_id,approved_at)
VALUES (1,'receipt_may_create','test-owner','2026-11-12T10:00:00.000Z');
```

### 4.3 Required command-specific finalization trigger

Install this exact trigger after the Stage H DDL. It enforces completeness at
the only status transition that can create a finalization witness. All errors
use `RAISE(ROLLBACK,...)`: an invalid finalization rolls back the complete
active transaction, including command-specific roots, reservations, movements,
identities, evidence, and manifests.

```sql
CREATE TRIGGER commit_command_completeness
BEFORE UPDATE OF status ON commit_records
WHEN OLD.status='applying' AND NEW.status='committed'
BEGIN
  SELECT RAISE(ROLLBACK,'order.create incomplete or misbound')
  WHERE NEW.command_type='order.create' AND (
    NEW.aggregate_type<>'order' OR NEW.expected_revision<>0
    OR (SELECT count(*) FROM orders o
        WHERE o.order_id=NEW.aggregate_id
          AND o.command_id=NEW.command_id AND o.commit_id=NEW.commit_id
          AND o.current_revision=1 AND o.current_status='pending')<>1
    OR (SELECT count(*) FROM order_revisions r
        WHERE r.order_id=NEW.aggregate_id AND r.revision=1
          AND r.status='pending' AND r.command_type='order.create'
          AND r.command_id=NEW.command_id AND r.commit_id=NEW.commit_id
          AND r.request_hash=NEW.request_hash)<>1
    OR (SELECT count(*) FROM order_lines l
        WHERE l.order_id=NEW.aggregate_id AND l.command_id=NEW.command_id
          AND l.commit_id=NEW.commit_id)=0
    OR (SELECT count(*) FROM reservations r
        WHERE r.order_id=NEW.aggregate_id AND r.command_id=NEW.command_id
          AND r.commit_id=NEW.commit_id)
       <>(SELECT count(*) FROM order_lines l
          WHERE l.order_id=NEW.aggregate_id AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id)
    OR (SELECT count(*) FROM inventory_movements m
        WHERE m.commit_id=NEW.commit_id AND m.command_id=NEW.command_id)
       <>(SELECT count(*) FROM order_lines l
          WHERE l.order_id=NEW.aggregate_id AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id)
    OR EXISTS(
      SELECT 1 FROM order_lines l
      WHERE l.order_id=NEW.aggregate_id AND l.command_id=NEW.command_id
        AND l.commit_id=NEW.commit_id
        AND NOT EXISTS(
          SELECT 1 FROM reservations r
          JOIN inventory_movements m
            ON m.reservation_id=r.reservation_id
           AND m.identity_id=r.identity_id AND m.quantity=r.quantity
           AND m.movement_kind='reserve' AND m.command_id=NEW.command_id
           AND m.commit_id=NEW.commit_id
          WHERE r.line_id=l.line_id AND r.identity_id=l.identity_id
            AND r.order_id=l.order_id AND r.quantity=l.quantity
            AND r.command_id=NEW.command_id AND r.commit_id=NEW.commit_id))
    OR EXISTS(SELECT 1 FROM inventory_movements m
       WHERE m.commit_id=NEW.commit_id AND m.command_id=NEW.command_id
         AND m.movement_kind<>'reserve')
    OR (SELECT count(*) FROM effect_manifest e
        WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id)
       <> 2 + 3*(SELECT count(*) FROM order_lines l
                 WHERE l.order_id=NEW.aggregate_id
                   AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)
    OR EXISTS(SELECT 1 FROM effect_manifest e
       WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id
         AND e.effect_kind NOT IN
           ('order.root','order.revision','order.line',
            'order.reservation','inventory.movement'))
    OR (SELECT count(*) FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id
          AND a.action='order.create' AND a.resource_id=NEW.aggregate_id
          AND a.decision='allow')<>1
    OR (SELECT count(*) FROM evidence_records e
        WHERE e.commit_id=NEW.commit_id)<>0
  );

  SELECT RAISE(ROLLBACK,'order.accept incomplete or has inventory effects')
  WHERE NEW.command_type='order.accept' AND (
    NEW.aggregate_type<>'order' OR NEW.expected_revision<>1
    OR (SELECT count(*) FROM orders o
        WHERE o.order_id=NEW.aggregate_id AND o.current_revision=2
          AND o.current_status='accepted')<>1
    OR (SELECT count(*) FROM order_revisions r
        WHERE r.order_id=NEW.aggregate_id AND r.revision=2
          AND r.status='accepted' AND r.command_type='order.accept'
          AND r.command_id=NEW.command_id AND r.commit_id=NEW.commit_id
          AND r.request_hash=NEW.request_hash)<>1
    OR EXISTS(SELECT 1 FROM inventory_movements m
        WHERE m.commit_id=NEW.commit_id)
    OR (SELECT count(*) FROM effect_manifest e
        WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id)<>1
    OR EXISTS(SELECT 1 FROM effect_manifest e
       WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id
         AND e.effect_kind<>'order.revision')
    OR (SELECT count(*) FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id
          AND a.action='order.accept' AND a.resource_id=NEW.aggregate_id
          AND a.decision='allow')<>1
    OR (SELECT count(*) FROM evidence_records e
        WHERE e.commit_id=NEW.commit_id)<>0
  );

  SELECT RAISE(ROLLBACK,'order.fulfill incomplete or misbound')
  WHERE NEW.command_type='order.fulfill' AND (
    NEW.aggregate_type<>'order' OR NEW.expected_revision<>2
    OR (SELECT count(*) FROM orders o
        WHERE o.order_id=NEW.aggregate_id AND o.current_revision=3
          AND o.current_status='fulfilled')<>1
    OR (SELECT count(*) FROM order_revisions r
        WHERE r.order_id=NEW.aggregate_id AND r.revision=3
          AND r.status='fulfilled' AND r.command_type='order.fulfill'
          AND r.command_id=NEW.command_id AND r.commit_id=NEW.commit_id
          AND r.request_hash=NEW.request_hash)<>1
    OR (SELECT count(*) FROM inventory_movements m
        WHERE m.commit_id=NEW.commit_id AND m.command_id=NEW.command_id
          AND m.movement_kind='fulfill')
       <>(SELECT count(*) FROM reservations r
          JOIN order_lines l USING(line_id)
          WHERE l.order_id=NEW.aggregate_id)
    OR EXISTS(
      SELECT 1 FROM reservations r JOIN order_lines l USING(line_id)
      WHERE l.order_id=NEW.aggregate_id
        AND NOT EXISTS(
          SELECT 1 FROM inventory_movements m
          WHERE m.reservation_id=r.reservation_id
            AND m.identity_id=r.identity_id AND m.quantity=r.quantity
            AND m.movement_kind='fulfill' AND m.command_id=NEW.command_id
            AND m.commit_id=NEW.commit_id))
    OR EXISTS(SELECT 1 FROM inventory_movements m
       WHERE m.commit_id=NEW.commit_id AND m.command_id=NEW.command_id
         AND m.movement_kind<>'fulfill')
    OR (SELECT count(*) FROM effect_manifest e
        WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id)
       <> 1 + (SELECT count(*) FROM reservations r
               JOIN order_lines l USING(line_id)
               WHERE l.order_id=NEW.aggregate_id)
    OR EXISTS(SELECT 1 FROM effect_manifest e
       WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id
         AND e.effect_kind NOT IN ('order.revision','inventory.movement'))
    OR (SELECT count(*) FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id
          AND a.action='order.fulfill' AND a.resource_id=NEW.aggregate_id
          AND a.decision='allow')<>1
    OR (SELECT count(*) FROM evidence_records e
        WHERE e.commit_id=NEW.commit_id)<>0
  );

  SELECT RAISE(ROLLBACK,'inventory.bootstrap incomplete or misbound')
  WHERE NEW.command_type='inventory.bootstrap' AND (
    NEW.aggregate_type<>'inventory_batch' OR NEW.expected_revision<>0
    OR (SELECT count(*) FROM inventory_batches b
        WHERE b.batch_id=NEW.aggregate_id AND b.command_id=NEW.command_id
          AND b.commit_id=NEW.commit_id AND b.current_revision=1
          AND b.status='active')<>1
    OR (SELECT count(*) FROM inventory_batch_revisions r
        WHERE r.batch_id=NEW.aggregate_id AND r.revision=1
          AND r.status='active' AND r.command_id=NEW.command_id
          AND r.commit_id=NEW.commit_id AND r.request_hash=NEW.request_hash)<>1
    OR (SELECT count(*) FROM inventory_batch_lines l
        WHERE l.batch_id=NEW.aggregate_id AND l.command_id=NEW.command_id
          AND l.commit_id=NEW.commit_id)=0
    OR (SELECT count(*) FROM inventory_identity i
        WHERE i.created_by_commit_id=NEW.commit_id
          AND i.created_by_command_id=NEW.command_id
          AND i.origin_kind='bootstrap' AND i.origin_id=NEW.aggregate_id)
       <>(SELECT count(*) FROM inventory_batch_lines l
          WHERE l.batch_id=NEW.aggregate_id AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id)
    OR EXISTS(
      SELECT 1 FROM inventory_identity i
      WHERE i.created_by_commit_id=NEW.commit_id
        AND (i.origin_kind<>'bootstrap' OR i.origin_id<>NEW.aggregate_id
          OR i.created_by_command_id<>NEW.command_id
          OR NOT EXISTS(SELECT 1 FROM inventory_batch_lines l
             WHERE l.identity_id=i.identity_id AND l.batch_id=NEW.aggregate_id
               AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)))
    OR EXISTS(
      SELECT 1 FROM inventory_batch_lines l
      WHERE l.batch_id=NEW.aggregate_id AND l.command_id=NEW.command_id
        AND l.commit_id=NEW.commit_id
        AND (NOT EXISTS(SELECT 1 FROM inventory_identity i
             WHERE i.identity_id=l.identity_id AND i.origin_kind='bootstrap'
               AND i.origin_id=NEW.aggregate_id
               AND i.created_by_command_id=NEW.command_id
               AND i.created_by_commit_id=NEW.commit_id)
          OR NOT EXISTS(SELECT 1 FROM inventory_movements m
             WHERE m.batch_line_id=l.batch_line_id
               AND m.identity_id=l.identity_id AND m.quantity=l.counted_qty
               AND m.available_delta=l.opening_available
               AND m.reserved_delta=l.opening_reserved
               AND m.before_available=0 AND m.before_reserved=0
               AND m.movement_kind='bootstrap' AND m.command_id=NEW.command_id
               AND m.commit_id=NEW.commit_id)
          OR COALESCE((SELECT v.result FROM evidence_verifications v
               WHERE v.evidence_id=l.first_evidence_id
               ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')
               <>'verified'
          OR COALESCE((SELECT v.result FROM evidence_verifications v
               WHERE v.evidence_id=l.second_evidence_id
               ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')
               <>'verified'))
    OR (SELECT count(*) FROM inventory_movements m
        WHERE m.commit_id=NEW.commit_id AND m.command_id=NEW.command_id)
       <>(SELECT count(*) FROM inventory_batch_lines l
          WHERE l.batch_id=NEW.aggregate_id AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id)
    OR (SELECT count(*) FROM evidence_records e
        WHERE e.commit_id=NEW.commit_id)
       <> 2*(SELECT count(*) FROM inventory_batch_lines l
             WHERE l.batch_id=NEW.aggregate_id AND l.command_id=NEW.command_id
               AND l.commit_id=NEW.commit_id)
    OR (SELECT count(*) FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id)
       <> 1 + (SELECT count(*) FROM inventory_batch_lines l
               WHERE l.batch_id=NEW.aggregate_id
                 AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)
    OR EXISTS(SELECT 1 FROM effect_manifest e
       WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id
         AND e.effect_kind NOT IN
           ('inventory.batch','inventory.batch_revision','inventory.batch_line',
            'inventory.identity','inventory.movement'))
    OR (SELECT count(*) FROM effect_manifest e
        WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id)
       <> 2 + 3*(SELECT count(*) FROM inventory_batch_lines l
                 WHERE l.batch_id=NEW.aggregate_id
                   AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)
    OR NOT EXISTS(SELECT 1 FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id
          AND a.action='inventory.bootstrap' AND a.resource_id=NEW.aggregate_id
          AND a.decision='allow')
  );

  SELECT RAISE(ROLLBACK,'inventory.receipt incomplete or misbound')
  WHERE NEW.command_type='inventory.receipt' AND (
    NEW.aggregate_type<>'inventory_receipt' OR NEW.expected_revision<>0
    OR (SELECT receipt_identity_policy FROM policy_config
        WHERE singleton=1) IS NOT 'receipt_may_create'
    OR (SELECT count(*) FROM inventory_receipts r
        WHERE r.receipt_id=NEW.aggregate_id AND r.command_id=NEW.command_id
          AND r.commit_id=NEW.commit_id AND r.current_revision=1
          AND r.status='received')<>1
    OR (SELECT count(*) FROM inventory_receipt_revisions v
        WHERE v.receipt_id=NEW.aggregate_id AND v.revision=1
          AND v.status='received' AND v.command_id=NEW.command_id
          AND v.commit_id=NEW.commit_id AND v.request_hash=NEW.request_hash)<>1
    OR (SELECT count(*) FROM inventory_receipt_lines l
        WHERE l.receipt_id=NEW.aggregate_id AND l.command_id=NEW.command_id
          AND l.commit_id=NEW.commit_id)=0
    OR (SELECT count(*) FROM inventory_movements m
        WHERE m.commit_id=NEW.commit_id AND m.command_id=NEW.command_id)
       <>(SELECT count(*) FROM inventory_receipt_lines l
          WHERE l.receipt_id=NEW.aggregate_id AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id)
    OR EXISTS(
      SELECT 1 FROM inventory_receipt_lines l
      WHERE l.receipt_id=NEW.aggregate_id AND l.command_id=NEW.command_id
        AND l.commit_id=NEW.commit_id
        AND (NOT EXISTS(SELECT 1 FROM inventory_movements m
             WHERE m.receipt_line_id=l.receipt_line_id
               AND m.identity_id=l.identity_id AND m.quantity=l.quantity
               AND m.available_delta=l.quantity AND m.reserved_delta=0
               AND m.movement_kind='receipt' AND m.command_id=NEW.command_id
               AND m.commit_id=NEW.commit_id)
          OR COALESCE((SELECT v.result FROM evidence_verifications v
               JOIN evidence_records e USING(evidence_id)
               WHERE e.evidence_id=l.evidence_id
               ORDER BY v.verified_at DESC,v.verification_id DESC LIMIT 1),'')
               <>'verified'))
    OR EXISTS(
      SELECT 1 FROM inventory_identity i
      WHERE i.created_by_commit_id=NEW.commit_id
        AND (i.origin_kind<>'receipt' OR i.origin_id<>NEW.aggregate_id
          OR i.created_by_command_id<>NEW.command_id
          OR NOT EXISTS(SELECT 1 FROM inventory_receipt_lines l
             WHERE l.identity_id=i.identity_id AND l.receipt_id=NEW.aggregate_id
               AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)))
    OR EXISTS(
      SELECT 1 FROM inventory_receipt_lines l
      JOIN inventory_identity i ON i.identity_id=l.identity_id
      WHERE l.receipt_id=NEW.aggregate_id
        AND i.created_by_commit_id=NEW.commit_id
        AND (i.origin_kind<>'receipt' OR i.origin_id<>NEW.aggregate_id
          OR i.created_by_command_id<>NEW.command_id))
    OR (SELECT count(*) FROM inventory_identity i
        WHERE i.created_by_commit_id=NEW.commit_id
          AND i.created_by_command_id=NEW.command_id)
       <>(SELECT count(*) FROM inventory_receipt_lines l
          JOIN inventory_identity i ON i.identity_id=l.identity_id
          WHERE l.receipt_id=NEW.aggregate_id
            AND i.created_by_commit_id=NEW.commit_id)
    OR (SELECT count(*) FROM evidence_records e
        WHERE e.commit_id=NEW.commit_id)
       <>(SELECT count(*) FROM inventory_receipt_lines l
          WHERE l.receipt_id=NEW.aggregate_id AND l.command_id=NEW.command_id
            AND l.commit_id=NEW.commit_id)
    OR (SELECT count(*) FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id)
       <> 1 + (SELECT count(*) FROM inventory_receipt_lines l
               WHERE l.receipt_id=NEW.aggregate_id
                 AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)
    OR EXISTS(SELECT 1 FROM effect_manifest e
       WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id
         AND e.effect_kind NOT IN
           ('inventory.receipt','inventory.receipt_revision',
            'inventory.receipt_line','inventory.identity','inventory.movement'))
    OR (SELECT count(*) FROM effect_manifest e
        WHERE e.commit_id=NEW.commit_id AND e.command_id=NEW.command_id)
       <> 2
          + 2*(SELECT count(*) FROM inventory_receipt_lines l
               WHERE l.receipt_id=NEW.aggregate_id
                 AND l.command_id=NEW.command_id AND l.commit_id=NEW.commit_id)
          + (SELECT count(*) FROM inventory_identity i
             WHERE i.created_by_commit_id=NEW.commit_id
               AND i.created_by_command_id=NEW.command_id)
    OR NOT EXISTS(SELECT 1 FROM authorization_assertions a
        WHERE a.commit_id=NEW.commit_id AND a.command_id=NEW.command_id
          AND a.action='inventory.receipt' AND a.resource_id=NEW.aggregate_id
          AND a.decision='allow')
  );
END;
```

The trigger supplements, and does not replace:

- Stage H's `finalization_completeness` bidirectional manifest/effect checks.
- Stage H's command/commit/request composite foreign keys.
- Per-row insert guards, exact line/evidence/approval foreign keys, movement
  arithmetic and before-state guards, append-only triggers, deferred
  finalization witness, and root/revision identity guards.
- Main-process canonicalization, authorization, actor and catalog checks.

`COUNT(*)` and anti-join checks here are deliberately command-scoped. The
Stage H manifest equality trigger still verifies every effect target row in
both directions and exact `effect_key`, target type, target ID, command and
commit. The command grammar additionally rejects unexpected effect kinds
even if they were otherwise well-formed.

### 4.4 Atomicity, immutability, and failed operations

1. The caller opens the business transaction with `BEGIN IMMEDIATE`.
2. Each command-specific effect, manifest, evidence, authorization assertion,
   and revision is inserted only while its owning commit is `applying`.
3. Before commit status can change, Stage H's generic and Stage J's
   command-specific triggers run. Any incomplete command executes
   `RAISE(ROLLBACK,...)`, rolling back the whole active transaction.
4. A SQLite error from any earlier statement requires the command handler to
   issue `ROLLBACK` immediately. It must not catch an error and commit the
   remaining partial statements.
5. On successful finalization the commit transition is one-way; the deferred
   finalization FK and after-trigger witness apply; all effect-bearing records
   and manifests are immutable and post-commit insert guards reject additions.
6. Revisions have unique `(aggregate_id,revision)` keys, applying-only insert
   guards that validate command/type/aggregate/expected revision/request hash,
   and append-only UPDATE/DELETE guards. A duplicate, wrong, or post-commit
   revision fails; it cannot change the root projection.
7. An uncommitted transaction closed or interrupted before COMMIT must reopen
   as wholly absent. A committed transaction whose response is lost must be
   resolved by reading the same `commit_id` and comparing the complete
   manifest/effect set; never submit a new identity or automatically reverse.

SQLite triggers do not protect against a writer who can alter/drop schema
objects or replace the database file. Single-writer Main-process ownership,
connection pragma verification, filesystem permissions, and recovery
adjudication remain mandatory.

## 5. Per-command completeness contract

The `effect_manifest` grammar at finalization is exact:

| Command | Required aggregate result | Required effect-kind set | Additional exact membership |
|---|---|---|---|
| `order.create` | One root for the exact aggregate; root `(revision=1,status='pending')`; exactly one revision 1 `pending` bound to the create command/commit/request hash. | One `order.root`, one `order.revision`, and for each line exactly one `order.line`, `order.reservation`, and `inventory.movement`. | Nonempty lines; each line has exactly one matching reservation and `reserve` movement with exact identity/quantity; no other movement; one allow assertion; no evidence rows. |
| `order.accept` | Existing order root at revision 2 `accepted`; exactly one revision 2 bound to this accept command/commit/request hash. | Exactly one `order.revision`. | Zero inventory movements; one allow assertion; no evidence rows. |
| `order.fulfill` | Existing order root at revision 3 `fulfilled`; exactly one revision 3 bound to this fulfill command/commit/request hash. | One `order.revision` and one `inventory.movement` per reservation. | Bijection of fulfillment movements to the order's reservations, exact identity and quantity; no other movement; one allow assertion; no evidence rows. |
| `inventory.bootstrap` | One active batch root and one active revision 1 bound to the bootstrap command/commit/request hash. | One `inventory.batch`, one `inventory.batch_revision`, and per item one `inventory.identity`, `inventory.batch_line`, and `inventory.movement`. | At least one line; identity↔line bijection; two independently sourced and verified count evidence records per line; separate allowed approver; exact zero-before movement/allocation; one primary allow assertion and one approval assertion per line. |
| `inventory.receipt` | One received receipt root and one received revision 1 bound to the receipt command/commit/request hash. | One `inventory.receipt`, one `inventory.receipt_revision`, one `inventory.receipt_line` and `inventory.movement` per line, plus one `inventory.identity` for each newly created identity. | At least one line; exact evidence/verified provenance, receiver and distinct approver; exact positive movement; all receipt-created identities map to lines and no unrelated identity is created; one primary allow assertion and one approval assertion per line. |

The exact manifest cardinalities checked by the trigger are:

- `order.create`: `2 + 3 * line_count`.
- `order.accept`: `1`.
- `order.fulfill`: `1 + reservation_count`.
- `inventory.bootstrap`: `2 + 3 * batch_line_count`.
- `inventory.receipt`: `2 + 2 * receipt_line_count + receipt_created_identity_count`.

These are in addition to the generic one-to-one target/manifest test. Evidence
and assertion rows are not manifest effects; their command-specific
cardinalities and foreign keys are checked separately.

## 6. Transaction protocols

### 6.1 Common command identity and nonce

1. Validate actor, closed input schema, canonical request, safe integer/date
   syntax, catalog classification, trusted evidence and online authorization
   in Main. Compute request hash/effect keys there.
2. Persist the immutable `commands` row. A reused command ID with a different
   type, aggregate, expected revision, canonical request or hash is a hard
   conflict.
3. Persist nonce presentation/reservation/consumption in its separate durable
   transaction. A business rollback does not free or reset a consumed nonce.
4. Start the business transaction with `BEGIN IMMEDIATE`. Look up
   `commit_id` before inserting. If it already exists, compare the immutable
   command identity and complete expected result; exact committed match
   returns the original result, any mismatch is a recorded conflict, never an
   overwrite.
5. Insert applying commit, assertions, required evidence and complete
   manifest; insert roots/lines/reservations/movements/revisions in the
   command sequence below.
6. Update applying→committed. Both finalization triggers must pass. Any
   failure rolls the entire transaction back.
7. `COMMIT`; verify committed identity, full manifest/effect set, aggregate
   projection and balance. On uncertain result, query/reopen by the same
   commit ID and compare all expected rows. Do not automatically reverse.

### 6.2 `order.create`

Insert command/nonce as above; then in one `BEGIN IMMEDIATE` transaction:

1. Insert applying commit and one allow assertion.
2. Insert exactly one manifest for root, revision 1, each line, each
   reservation and each reserve movement.
3. Insert root at revision 0 pending, exact nonempty order lines,
   reservations, and one reserve movement per line using the current derived
   balance snapshots.
4. Insert revision 1 pending using this create command, commit and request
   hash. The existing revision apply trigger updates root to `(1,pending)`.
5. Finalize and commit. Finalization rejects missing/wrong revision,
   projection, any line/reservation/movement mismatch, extra effect kind, or
   incomplete manifest and rolls back all rows.

### 6.3 `order.accept`

Expected revision 1 and current state pending. In one transaction insert the
applying commit, one allow assertion, one revision manifest and revision 2
accepted. The revision trigger advances the root. Finalization requires exact
revision 2 and root projection, and exactly zero movements and no other
effects. Commit and verify.

### 6.4 `order.fulfill`

Expected revision 2 and current state accepted. In one transaction insert the
applying commit, one allow assertion, the revision manifest, and one movement
for every exact reservation (no omissions, duplicates or substitutions).
Insert revision 3 fulfilled after all movements. Finalization requires the
root/revision 3 and exact movement/reservation bijection. Commit and verify
reserved balances for the fulfilled order are consumed exactly once.

### 6.5 `inventory.bootstrap`

In one transaction, insert the applying commit, primary authorization,
two-counter evidence and verification records, one approval per count line,
all manifests, batch root, identities, exact itemized count/allocation lines,
and zero-before bootstrap movements. Insert active revision 1 last so its
existing trigger checks evidence and movements and updates the root. The
Stage J finalizer additionally requires identity/count-line equality,
two verified evidence records per line, one approval per line, exact movement
membership and exact effect manifest. Commit only after every check succeeds.

### 6.6 `inventory.receipt`

Only the approved `receipt_may_create` policy is allowed. In one transaction,
insert applying commit, primary authorization, per-line approval assertions
and source evidence, complete manifest, receipt root, any new fully
classified identity with `origin_kind='receipt'`, receipt lines, exact
positive movements, and received revision 1. New identity, evidence,
approval, line, movement, root/revision and manifest commit together. Existing
identities remain usable. Finalization requires exact line/movement/evidence/
approval membership and the complete mapping of every identity created by
this commit to its receipt line.

## 7. Fixture and validation harness contract

### 7.1 DDL and fixture initialization

The independent validator must use the installation unit in §4.1 on a fresh
file-backed database; it must not hand-copy a subset of schema objects. Set
`foreign_keys=ON`, `journal_mode=WAL`, `synchronous=FULL`, and
`busy_timeout=5000` before test transactions, and read each value back.
Insert the single approved policy row from §4.2.

All fixture timestamps are exactly `2026-11-12T10:00:00.000Z`. Test-only
request hashes are 64 lowercase `a`–`f` characters; test-only effect keys are
distinct 64-character lowercase hex strings. These test values establish
format and relational cross-binding only. Hash derivation and signatures are
not validated by SQLite and must not be reported as tested by these fixtures.
All authorization fixtures use a test key and signature-shaped bytes and are
not evidence of cryptographic validity.

### 7.2 Deterministic base fixture recipe

Each test runs in a newly initialized database or restores the named baseline
with a full rollback. IDs below are literal and fixed:

- Bootstrap: command `bc`, commit `bm`, batch `b`, identity `i`, line `bl`,
  evidence `e1/e2`, movement `m`, revision `br`.
- Order create: command `oc`, commit `ocm`, order `o`, line `ol`,
  reservation `or1`, movement `orm`, revision `orv1`.
- Order acceptance: command `oa`, commit `oam`, revision `orv2`.
- Order fulfillment: command `of`, commit `ofm`, movement `ofm1`,
  revision `orv3`.
- Receipt: command `rc`, commit `rcm`, receipt `r`, new identity `ri`,
  line `rl`, evidence `re`, movement `rm`, revision `rr`.

Use the following exact SQL for a positive bootstrap and order-create baseline.
Every insert column is named; this recipe is part of the validation fixture,
not a claim that the DDL has been executed:

```sql
-- After the installation DDL and policy row.
INSERT INTO authority_keys
  (key_id,algorithm,public_key_fingerprint,registered_at)
VALUES ('k','ES256',lower(hex(zeroblob(32))),'2026-11-12T10:00:00.000Z');

BEGIN IMMEDIATE;
INSERT INTO commands
  (command_id,command_type,aggregate_type,aggregate_id,expected_revision,
   canonicalization_version,request_json,request_hash,created_at)
VALUES ('bc','inventory.bootstrap','inventory_batch','b',0,1,'{}',
        lower(hex(zeroblob(32))),'2026-11-12T10:00:00.000Z');
COMMIT;

BEGIN IMMEDIATE;
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES ('bn1','bootstrap-nonce-primary-000001','counter1','bc',
        lower(hex(zeroblob(32))),'presented','2026-11-12T10:00:00.000Z');
UPDATE nonce_records SET state='reserved' WHERE nonce_id='bn1';
UPDATE nonce_records SET state='consumed' WHERE nonce_id='bn1';
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES ('bn2','bootstrap-nonce-approval-00001','approver','bc',
        lower(hex(zeroblob(32))),'presented','2026-11-12T10:00:00.000Z');
UPDATE nonce_records SET state='reserved' WHERE nonce_id='bn2';
UPDATE nonce_records SET state='consumed' WHERE nonce_id='bn2';
COMMIT;

BEGIN IMMEDIATE;
INSERT INTO commit_records
  (commit_id,command_id,command_type,aggregate_type,aggregate_id,
   expected_revision,request_hash,status,created_at,finalized_at)
VALUES ('bm','bc','inventory.bootstrap','inventory_batch','b',0,
        lower(hex(zeroblob(32))),'applying','2026-11-12T10:00:00.000Z',NULL);
INSERT INTO authorization_assertions
  (assertion_id,commit_id,command_id,request_hash,action,resource_id,actor_id,
   role_snapshot,key_id,nonce_id,policy_version,issued_at,expires_at,
   signed_assertion,signed_assertion_sha256,decision)
VALUES ('ba1','bm','bc',lower(hex(zeroblob(32))),'inventory.bootstrap','b',
        'counter1','admin','k','bn1','test', '2026-11-12T10:00:00.000Z',
        '2026-11-12T11:00:00.000Z',X'01',lower(hex(zeroblob(32))),'allow');
INSERT INTO authorization_assertions
  (assertion_id,commit_id,command_id,request_hash,action,resource_id,actor_id,
   role_snapshot,key_id,nonce_id,policy_version,issued_at,expires_at,
   signed_assertion,signed_assertion_sha256,decision)
VALUES ('ba2','bm','bc',lower(hex(zeroblob(32))),'inventory.approve','bl',
        'approver','admin','k','bn2','test','2026-11-12T10:00:00.000Z',
        '2026-11-12T11:00:00.000Z',X'02',lower(hex(zeroblob(32))),'allow');

INSERT INTO effect_manifest VALUES
  (printf('%064x',1),'bm','bc','inventory.batch','inventory_batches','b',1,
   '2026-11-12T10:00:00.000Z'),
  (printf('%064x',2),'bm','bc','inventory.batch_revision',
   'inventory_batch_revisions','br',1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',3),'bm','bc','inventory.identity','inventory_identity','i',
   1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',4),'bm','bc','inventory.batch_line',
   'inventory_batch_lines','bl',1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',5),'bm','bc','inventory.movement',
   'inventory_movements','m',1,'2026-11-12T10:00:00.000Z');
INSERT INTO inventory_batches
  (batch_id,current_revision,status,command_id,commit_id,effect_key)
VALUES ('b',0,'pending','bc','bm',printf('%064x',1));
INSERT INTO inventory_identity
  (identity_id,medicine_id,canonical_unit,tracking_state,lot_id,expiry_state,
   expiry_date,origin_kind,origin_id,created_by_command_id,
   created_by_commit_id,effect_key)
VALUES ('i','med-a','each','tracked','lot-a','none','','bootstrap','b','bc',
        'bm',printf('%064x',3));
INSERT INTO evidence_records
  (evidence_id,commit_id,resource_kind,resource_id,mime_type,raw_bytes,
   sha256_hex,provenance_json,acquired_at,acquired_by_actor_id)
VALUES
  ('e1','bm','inventory_batch','bl','text/plain',X'01',printf('%064x',6),
   '{}','2026-11-12T10:00:00.000Z','counter1'),
  ('e2','bm','inventory_batch','bl','text/plain',X'02',printf('%064x',7),
   '{}','2026-11-12T10:00:00.000Z','counter2');
INSERT INTO evidence_verifications
  (verification_id,evidence_id,verifier_actor_id,result,method,
   verification_json,verified_at)
VALUES
  ('ev1','e1','verifier','verified','test','{}','2026-11-12T10:00:00.000Z'),
  ('ev2','e2','verifier','verified','test','{}','2026-11-12T10:00:00.000Z');
INSERT INTO inventory_batch_lines
  (batch_line_id,batch_id,identity_id,counted_qty,opening_available,
   opening_reserved,first_evidence_id,second_evidence_id,
   first_counter_actor_id,second_counter_actor_id,approver_actor_id,
   approval_assertion_id,identity_origin_kind,evidence_resource_kind,
   approval_action,command_id,commit_id,effect_key)
VALUES ('bl','b','i',10,10,0,'e1','e2','counter1','counter2','approver','ba2',
        'bootstrap','inventory_batch','inventory.approve','bc','bm',
        printf('%064x',4));
INSERT INTO inventory_movements
  (movement_id,identity_id,movement_kind,quantity,available_delta,
   reserved_delta,on_hand_delta,before_available,after_available,
   before_reserved,after_reserved,reservation_id,batch_line_id,receipt_line_id,
   command_id,commit_id,effect_key,created_at)
VALUES ('m','i','bootstrap',10,10,0,10,0,10,0,0,NULL,'bl',NULL,'bc','bm',
        printf('%064x',5),'2026-11-12T10:00:00.000Z');
INSERT INTO inventory_batch_revisions
  (batch_revision_id,batch_id,revision,status,command_id,commit_id,
   request_hash,effect_key)
VALUES ('br','b',1,'active','bc','bm',lower(hex(zeroblob(32))),
        printf('%064x',2));
UPDATE commit_records SET status='committed',
  finalized_at='2026-11-12T10:00:00.000Z' WHERE commit_id='bm';
COMMIT;

-- Prepare order.create command and nonce durably, then its business transaction.
BEGIN IMMEDIATE;
INSERT INTO commands
  (command_id,command_type,aggregate_type,aggregate_id,expected_revision,
   canonicalization_version,request_json,request_hash,created_at)
VALUES ('oc','order.create','order','o',0,1,'{}',printf('%064x',10),
        '2026-11-12T10:00:00.000Z');
COMMIT;

BEGIN IMMEDIATE;
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES ('on1','order-create-nonce-00000000001','buyer','oc',printf('%064x',10),
        'presented','2026-11-12T10:00:00.000Z');
UPDATE nonce_records SET state='reserved' WHERE nonce_id='on1';
UPDATE nonce_records SET state='consumed' WHERE nonce_id='on1';
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO commit_records
  (commit_id,command_id,command_type,aggregate_type,aggregate_id,
   expected_revision,request_hash,status,created_at,finalized_at)
VALUES ('ocm','oc','order.create','order','o',0,printf('%064x',10),
        'applying','2026-11-12T10:00:00.000Z',NULL);
INSERT INTO authorization_assertions
  (assertion_id,commit_id,command_id,request_hash,action,resource_id,actor_id,
   role_snapshot,key_id,nonce_id,policy_version,issued_at,expires_at,
   signed_assertion,signed_assertion_sha256,decision)
VALUES ('oa1','ocm','oc',printf('%064x',10),'order.create','o','buyer','admin',
        'k','on1','test','2026-11-12T10:00:00.000Z',
        '2026-11-12T11:00:00.000Z',X'03',lower(hex(zeroblob(32))),'allow');
INSERT INTO effect_manifest VALUES
  (printf('%064x',11),'ocm','oc','order.root','orders','o',1,
   '2026-11-12T10:00:00.000Z'),
  (printf('%064x',12),'ocm','oc','order.revision','order_revisions','orv1',1,
   '2026-11-12T10:00:00.000Z'),
  (printf('%064x',13),'ocm','oc','order.line','order_lines','ol',1,
   '2026-11-12T10:00:00.000Z'),
  (printf('%064x',14),'ocm','oc','order.reservation','reservations','or1',1,
   '2026-11-12T10:00:00.000Z'),
  (printf('%064x',15),'ocm','oc','inventory.movement',
   'inventory_movements','orm',1,'2026-11-12T10:00:00.000Z');
INSERT INTO orders
  (order_id,current_revision,current_status,created_by_actor_id,command_id,
   commit_id,effect_key)
VALUES ('o',0,'pending','buyer','oc','ocm',printf('%064x',11));
INSERT INTO order_lines
  (line_id,order_id,identity_id,quantity,command_id,commit_id,effect_key)
VALUES ('ol','o','i',3,'oc','ocm',printf('%064x',13));
INSERT INTO reservations
  (reservation_id,line_id,order_id,identity_id,quantity,command_id,commit_id,
   effect_key)
VALUES ('or1','ol','o','i',3,'oc','ocm',printf('%064x',14));
INSERT INTO inventory_movements
  (movement_id,identity_id,movement_kind,quantity,available_delta,
   reserved_delta,on_hand_delta,before_available,after_available,
   before_reserved,after_reserved,reservation_id,batch_line_id,receipt_line_id,
   command_id,commit_id,effect_key,created_at)
VALUES ('orm','i','reserve',3, -3,3,0,10,7,0,3,'or1',NULL,NULL,'oc','ocm',
        printf('%064x',15),'2026-11-12T10:00:00.000Z');
INSERT INTO order_revisions
  (revision_id,order_id,revision,status,command_id,command_type,commit_id,
   request_hash,effect_key,created_at)
VALUES ('orv1','o',1,'pending','oc','order.create','ocm',printf('%064x',10),
        printf('%064x',12),'2026-11-12T10:00:00.000Z');
UPDATE commit_records SET status='committed',
  finalized_at='2026-11-12T10:00:00.000Z' WHERE commit_id='ocm';
COMMIT;
```

This seed yields `orders=('o',1,'pending')` and
`inventory_balances=('i',7,3,10)`. To test the Stage I defect, start from the
same bootstrap base in a fresh database and execute the same create transaction
but omit both the `order.revision` manifest insert and the `order_revisions`
insert. The final `UPDATE commit_records` must raise the Stage J message and
roll back the entire transaction. Query all of `orders`, `order_lines`,
`reservations`, `inventory_movements` for `ocm`, `effect_manifest` for `ocm`,
`commit_records` for `ocm`, and `inventory_balances` for `i`: no `ocm` business
rows may exist and balance must remain `(10,0,10)`.

For multi-line tests, clone the bootstrap identity through an independently
valid bootstrap transaction as identity `i2` with balance 5; do not insert an
identity or balance outside a bootstrap/receipt command. Use line quantities
3 and 6 against identities with available 5 each. For transaction-isolation
tests, use two independent connections to the same file-backed DB and
`BEGIN IMMEDIATE` as specified in §8.

The second-identity test fixture is reproducibly derived from the exact receipt
fixture below. Apply substitutions only to the exact identifier values in SQL
string literals, never to substrings in SQL keywords/table/column names:
command `rc`→`r2c`; commit `rcm`→`r2cm`; receipt aggregate `r`→`r2`;
identity `ri`→`i2`; line `rl`→`r2l`; evidence `re`→`r2e`; movement `rm`→`r2m`;
revision `rr`→`r2r`; nonce IDs `rn1/rn2`→`r2n1/r2n2`; assertion IDs
`rca1/rca2`→`r2a1/r2a2`; manifest values 41–45→51–55. Change receipt
quantity from 4 to 5; change medicine/lot to `med-c`/`lot-c`; change expiry
from `date`/`2027-01-31` to `none`/`''`; update nonce values to
`receipt2-primary-nonce-00000001` and `receipt2-approval-nonce-00001`.
The resulting committed identity `i2` must have balance `(5,0,5)`. This
fixture is a real atomic receipt, not a direct identity or balance insertion.

The following exact transaction scripts complete the positive-path fixtures
for acceptance, fulfillment, and a receipt that creates a new identity. Run
each against the corresponding committed baseline above; use a fresh database
per script.

```sql
-- order.accept: run after the order.create fixture is committed.
BEGIN IMMEDIATE;
INSERT INTO commands
  (command_id,command_type,aggregate_type,aggregate_id,expected_revision,
   canonicalization_version,request_json,request_hash,created_at)
VALUES ('oa','order.accept','order','o',1,1,'{}',printf('%064x',20),
        '2026-11-12T10:00:00.000Z');
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES ('oan','order-accept-nonce-00000000001','admin1','oa',printf('%064x',20),
        'presented','2026-11-12T10:00:00.000Z');
UPDATE nonce_records SET state='reserved' WHERE nonce_id='oan';
UPDATE nonce_records SET state='consumed' WHERE nonce_id='oan';
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO commit_records
  (commit_id,command_id,command_type,aggregate_type,aggregate_id,
   expected_revision,request_hash,status,created_at,finalized_at)
VALUES ('oam','oa','order.accept','order','o',1,printf('%064x',20),
        'applying','2026-11-12T10:00:00.000Z',NULL);
INSERT INTO authorization_assertions
  (assertion_id,commit_id,command_id,request_hash,action,resource_id,actor_id,
   role_snapshot,key_id,nonce_id,policy_version,issued_at,expires_at,
   signed_assertion,signed_assertion_sha256,decision)
VALUES ('oaa','oam','oa',printf('%064x',20),'order.accept','o','admin1','admin',
        'k','oan','test','2026-11-12T10:00:00.000Z',
        '2026-11-12T11:00:00.000Z',X'04',lower(hex(zeroblob(32))),'allow');
INSERT INTO effect_manifest VALUES
  (printf('%064x',21),'oam','oa','order.revision','order_revisions','orv2',1,
   '2026-11-12T10:00:00.000Z');
INSERT INTO order_revisions
  (revision_id,order_id,revision,status,command_id,command_type,commit_id,
   request_hash,effect_key,created_at)
VALUES ('orv2','o',2,'accepted','oa','order.accept','oam',printf('%064x',20),
        printf('%064x',21),'2026-11-12T10:00:00.000Z');
UPDATE commit_records SET status='committed',
  finalized_at='2026-11-12T10:00:00.000Z' WHERE commit_id='oam';
COMMIT;

-- order.fulfill: run after the order.accept fixture is committed.
BEGIN IMMEDIATE;
INSERT INTO commands
  (command_id,command_type,aggregate_type,aggregate_id,expected_revision,
   canonicalization_version,request_json,request_hash,created_at)
VALUES ('of','order.fulfill','order','o',2,1,'{}',printf('%064x',30),
        '2026-11-12T10:00:00.000Z');
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES ('ofn','order-fulfill-nonce-00000000001','fulfiller','of',
        printf('%064x',30),'presented','2026-11-12T10:00:00.000Z');
UPDATE nonce_records SET state='reserved' WHERE nonce_id='ofn';
UPDATE nonce_records SET state='consumed' WHERE nonce_id='ofn';
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO commit_records
  (commit_id,command_id,command_type,aggregate_type,aggregate_id,
   expected_revision,request_hash,status,created_at,finalized_at)
VALUES ('ofm','of','order.fulfill','order','o',2,printf('%064x',30),
        'applying','2026-11-12T10:00:00.000Z',NULL);
INSERT INTO authorization_assertions
  (assertion_id,commit_id,command_id,request_hash,action,resource_id,actor_id,
   role_snapshot,key_id,nonce_id,policy_version,issued_at,expires_at,
   signed_assertion,signed_assertion_sha256,decision)
VALUES ('ofa','ofm','of',printf('%064x',30),'order.fulfill','o','fulfiller',
        'employee','k','ofn','test','2026-11-12T10:00:00.000Z',
        '2026-11-12T11:00:00.000Z',X'05',lower(hex(zeroblob(32))),'allow');
INSERT INTO effect_manifest VALUES
  (printf('%064x',31),'ofm','of','order.revision','order_revisions','orv3',1,
   '2026-11-12T10:00:00.000Z'),
  (printf('%064x',32),'ofm','of','inventory.movement',
   'inventory_movements','ofm1',1,'2026-11-12T10:00:00.000Z');
INSERT INTO inventory_movements
  (movement_id,identity_id,movement_kind,quantity,available_delta,
   reserved_delta,on_hand_delta,before_available,after_available,
   before_reserved,after_reserved,reservation_id,batch_line_id,receipt_line_id,
   command_id,commit_id,effect_key,created_at)
VALUES ('ofm1','i','fulfill',3,0,-3,-3,7,7,3,0,'or1',NULL,NULL,'of','ofm',
        printf('%064x',32),'2026-11-12T10:00:00.000Z');
INSERT INTO order_revisions
  (revision_id,order_id,revision,status,command_id,command_type,commit_id,
   request_hash,effect_key,created_at)
VALUES ('orv3','o',3,'fulfilled','of','order.fulfill','ofm',printf('%064x',30),
        printf('%064x',31),'2026-11-12T10:00:00.000Z');
UPDATE commit_records SET status='committed',
  finalized_at='2026-11-12T10:00:00.000Z' WHERE commit_id='ofm';
COMMIT;
```

The receipt fixture below runs in a fresh installation with the policy row
from §4.2 and key `k` from the bootstrap fixture. It uses no pre-existing
inventory identity:

```sql
BEGIN IMMEDIATE;
INSERT INTO commands
  (command_id,command_type,aggregate_type,aggregate_id,expected_revision,
   canonicalization_version,request_json,request_hash,created_at)
VALUES ('rc','inventory.receipt','inventory_receipt','r',0,1,'{}',
        printf('%064x',40),'2026-11-12T10:00:00.000Z');
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO nonce_records
  (nonce_id,nonce_value,actor_id,command_id,request_hash,state,created_at)
VALUES
  ('rn1','receipt-primary-nonce-0000000001','receiver','rc',printf('%064x',40),
   'presented','2026-11-12T10:00:00.000Z'),
  ('rn2','receipt-approval-nonce-00000001','approver','rc',printf('%064x',40),
   'presented','2026-11-12T10:00:00.000Z');
UPDATE nonce_records SET state='reserved' WHERE nonce_id IN ('rn1','rn2');
UPDATE nonce_records SET state='consumed' WHERE nonce_id IN ('rn1','rn2');
COMMIT;
BEGIN IMMEDIATE;
INSERT INTO commit_records
  (commit_id,command_id,command_type,aggregate_type,aggregate_id,
   expected_revision,request_hash,status,created_at,finalized_at)
VALUES ('rcm','rc','inventory.receipt','inventory_receipt','r',0,
        printf('%064x',40),'applying','2026-11-12T10:00:00.000Z',NULL);
INSERT INTO authorization_assertions
  (assertion_id,commit_id,command_id,request_hash,action,resource_id,actor_id,
   role_snapshot,key_id,nonce_id,policy_version,issued_at,expires_at,
   signed_assertion,signed_assertion_sha256,decision)
VALUES
  ('rca1','rcm','rc',printf('%064x',40),'inventory.receipt','r','receiver',
   'employee','k','rn1','test','2026-11-12T10:00:00.000Z',
   '2026-11-12T11:00:00.000Z',X'06',lower(hex(zeroblob(32))),'allow'),
  ('rca2','rcm','rc',printf('%064x',40),'inventory.approve','rl','approver',
   'admin','k','rn2','test','2026-11-12T10:00:00.000Z',
   '2026-11-12T11:00:00.000Z',X'07',lower(hex(zeroblob(32))),'allow');
INSERT INTO effect_manifest VALUES
  (printf('%064x',41),'rcm','rc','inventory.receipt','inventory_receipts','r',
   1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',42),'rcm','rc','inventory.receipt_revision',
   'inventory_receipt_revisions','rr',1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',43),'rcm','rc','inventory.identity','inventory_identity',
   'ri',1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',44),'rcm','rc','inventory.receipt_line',
   'inventory_receipt_lines','rl',1,'2026-11-12T10:00:00.000Z'),
  (printf('%064x',45),'rcm','rc','inventory.movement',
   'inventory_movements','rm',1,'2026-11-12T10:00:00.000Z');
INSERT INTO inventory_receipts
  (receipt_id,current_revision,status,command_id,commit_id,effect_key)
VALUES ('r',0,'pending','rc','rcm',printf('%064x',41));
INSERT INTO inventory_identity
  (identity_id,medicine_id,canonical_unit,tracking_state,lot_id,expiry_state,
   expiry_date,origin_kind,origin_id,created_by_command_id,
   created_by_commit_id,effect_key)
VALUES ('ri','med-b','each','tracked','new-lot','date','2027-01-31','receipt',
        'r','rc','rcm',printf('%064x',43));
INSERT INTO evidence_records
  (evidence_id,commit_id,resource_kind,resource_id,mime_type,raw_bytes,
   sha256_hex,provenance_json,acquired_at,acquired_by_actor_id)
VALUES ('re','rcm','inventory_receipt','rl','text/plain',X'08',
        printf('%064x',46),'{}','2026-11-12T10:00:00.000Z','receiver');
INSERT INTO evidence_verifications
  (verification_id,evidence_id,verifier_actor_id,result,method,
   verification_json,verified_at)
VALUES ('revfy','re','verifier','verified','test','{}',
        '2026-11-12T10:00:00.000Z');
INSERT INTO inventory_receipt_lines
  (receipt_line_id,receipt_id,identity_id,quantity,evidence_id,
   receiver_actor_id,second_approver_actor_id,approval_assertion_id,
   evidence_resource_kind,approval_action,command_id,commit_id,effect_key)
VALUES ('rl','r','ri',4,'re','receiver','approver','rca2',
        'inventory_receipt','inventory.approve','rc','rcm',printf('%064x',44));
INSERT INTO inventory_movements
  (movement_id,identity_id,movement_kind,quantity,available_delta,
   reserved_delta,on_hand_delta,before_available,after_available,
   before_reserved,after_reserved,reservation_id,batch_line_id,receipt_line_id,
   command_id,commit_id,effect_key,created_at)
VALUES ('rm','ri','receipt',4,4,0,4,0,4,0,0,NULL,NULL,'rl','rc','rcm',
        printf('%064x',45),'2026-11-12T10:00:00.000Z');
INSERT INTO inventory_receipt_revisions
  (receipt_revision_id,receipt_id,revision,status,command_id,commit_id,
   request_hash,effect_key)
VALUES ('rr','r',1,'received','rc','rcm',printf('%064x',40),
        printf('%064x',42));
UPDATE commit_records SET status='committed',
  finalized_at='2026-11-12T10:00:00.000Z' WHERE commit_id='rcm';
COMMIT;
```

The database assertion for this fixture is:

```sql
SELECT r.status,r.current_revision,i.origin_kind,l.quantity,
       b.available_qty,b.reserved_qty,b.on_hand_qty
FROM inventory_receipts r
JOIN inventory_receipt_lines l USING(receipt_id)
JOIN inventory_identity i USING(identity_id)
JOIN inventory_balances b USING(identity_id)
WHERE r.receipt_id='r';
-- Expected: ('received',1,'receipt',4,4,0,4)
```

## 8. Self-contained adversarial validation matrix

All negative tests run on disposable file-backed copies of the §7 fixture.
For each expected statement error, the harness records the exact SQLite
error, explicitly `ROLLBACK`s if the trigger did not already roll back, then
queries the listed state. No expected result below is a claim of a test pass.

| ID | Setup and exact attempted operation | Expected observable result |
|---|---|---|
| J01 | Install both Stage H §4 SQL blocks and Stage J §4 triggers in order in a fresh DB. Query `sqlite_schema`, runtime version, compile options, and pragmas. | One-script installation completes; all named objects exist; FK on, WAL, synchronous FULL. |
| J02 | Use §7 complete bootstrap+order-create fixture, finalize both commands. | Bootstrap active revision 1; order pending revision 1; balance `(7,3,10)`; `foreign_key_check` empty; `integrity_check='ok'`. |
| J03 Critical regression | Fresh bootstrap baseline. Create applying `ocm` with root, line qty3, exact reservation and reserve movement; omit revision row and its manifest; run commit status UPDATE. | `commit_command_completeness` rolls back. No order, line, reservation, movement, manifest, committed/applying commit for `ocm`; balance returns `(10,0,10)`. |
| J04 Missing revision manifest only | Complete revision-1 row but omit its manifest entry, then finalize. | Generic deferred FK/finalizer or Stage J cardinality check prevents commit; whole transaction absent. |
| J05 Revision row but wrong command/commit/hash/aggregate | For fresh create fixtures vary one `order_revisions` field at a time: `command_id`, `commit_id`, `request_hash`, `order_id`, `command_type`, `revision`, `status`; attempt insert/finalize. | Insert guard, FK, unique key, or finalizer rejects; root and balances unchanged after rollback. |
| J06 Duplicate / skipped revision | On valid pending order, try another revision 1; separately try revision 3 before revision 2. | Unique key or revision guard rejects; no extra revision and root unchanged. |
| J07 Post-commit revision insert/update/delete | After valid order commit, insert another revision; `UPDATE order_revisions SET status='fulfilled' WHERE revision_id='orv1'`; delete it. | All rejected; committed revision and root unchanged. |
| J08 Direct order projection update | On committed pending order run `UPDATE orders SET current_status='fulfilled',current_revision=3 WHERE order_id='o';` | Trigger rejects; root stays `(1,'pending')`; one revision remains. |
| J09 Create without revision or wrong root projection | Try root `(0,pending)` without revision; root `(1,accepted)`; wrong current revision. Finalize. | Stage J rolls back whole transaction; no reservation or partial order. |
| J10 Create with omitted line reservation/movement | Starting from a valid create transaction, separately omit a reservation and omit a reserve movement; finalize. | Trigger rejects both; all create effects absent and balance unchanged. |
| J11 Create line/reservation substitution | For line `ol` identity `i`, quantity 3, attempt reservation identity `i2` or quantity 2, then movement. | Composite FK/reservation guard rejects; after rollback no create effects. |
| J12 Multi-line shortage atomicity | Two committed identities with available 5 each; create lines qty3 and qty6. Attempt both exact reservation/movement writes and finalize; second movement is insufficient. | Error and full rollback; no root/lines/reservations/movements; both balances remain `(5,0)`. |
| J13 Acceptance positive | From J02 order revision 1, commit exact `order.accept` revision 2 with one assertion and one revision effect. | Root `(2,'accepted')`; no movement from accept commit. |
| J14 Acceptance missing/wrong revision | Omit rev2 or provide wrong command/hash/status, then finalize. | Whole acceptance transaction rolls back; order stays pending revision1. |
| J15 Acceptance with inventory movement/extra effect | Insert reserve or fulfill movement under `order.accept`, or add any non-revision manifest target; finalize. | Stage J rejects; no acceptance state or movement committed. |
| J16 Fulfillment positive | From accepted order, write one exact fulfill movement per reservation and revision 3. | Root `(3,'fulfilled')`; each reservation has one exact fulfill; no reserved units remain. |
| J17 Fulfillment omitted/extra/duplicate/substituted | Omit a movement; add duplicate; add unrelated reservation movement; change identity or quantity. | Unique, FK, movement, or finalization guard rejects; rollback leaves order accepted and reservation held. |
| J18 Bootstrap positive and extra identity regression | Execute §7 bootstrap. In separate run add extra bootstrap identity+manifest without line, evidence, approval or movement, then finalize. | Positive commits exact active batch. Extra-identity run fails and rolls back all batch effects. |
| J19 Bootstrap omitted line/evidence/approval/movement | In fresh fixtures omit each required component one at a time; additionally add extra line or movement. | Revision/finalization trigger rejects; no new balance or batch effect after rollback. |
| J20 Bootstrap identity-line bijection and snapshots | Attempt line linked to wrong origin; duplicate identity line; wrong count allocation; nonzero before snapshot; extra movement. | FK, uniqueness or completeness trigger rejects; no positive opening balance. |
| J21 Receipt-created identity positive | With approved policy, create new identity `ri` and receipt line with source evidence, distinct receiver/approver, one positive movement, root/revision/manifests in one transaction. | Atomic commit; balance equals receipt quantity; all linked rows carry same command/commit and exact manifest. |
| J22 Receipt missing-component rollback | Fresh receipt each: omit source evidence, verification, approval, movement, identity manifest, line manifest, or revision; finalize. | Each invalid transaction rolls back identity, receipt, movement, evidence and manifest rows; no balance. |
| J23 Receipt duplicate/conflicting identity | Try duplicate six-part identity under another ID; try same ID with conflicting tuple; try create the same identity twice in one receipt. | UNIQUE/PK/FK rejects; no partial receipt identity or movement. |
| J24 Receipt policy guard | Attempt policy row `existing_only`; then test approved `receipt_may_create` receipt with previously nonexistent identity. | `existing_only` insertion rejected; receipt-create succeeds when complete. |
| J25 Receipt root/revision cross-bind and post-commit mutation | Rebind receipt root command/commit/effect; mutate revision or line identity/quantity/evidence/approval; append new line or manifest after commit. | Every update/delete/post-commit insert rejected; root, revision, effects and balance unchanged. |
| J26 Actor requirements | Set receipt receiver equal to second approver; bootstrap approver equal to either counter. | SQL CHECK rejects. Separately test that Main compares authenticated principal identities, not merely distinct strings. |
| J27 Invalid evidence references | Use nonexistent evidence, wrong commit/resource/resource kind/acquiring actor, nonexistent approval assertion, or assertion for another line. | FK/trigger rejects; whole business transaction rolled back. |
| J28 Evidence and authorization append-only | For every evidence, verification, assertion, key, key-event row, attempt UPDATE and DELETE. Try out-of-commit evidence/assertion insertion after finalization. | Mutations/deletions and late inserts reject. SQLite does not treat arbitrary key-event rows as trusted revocations. |
| J29 Movement arithmetic / safe integers | Try inconsistent deltas, after snapshots, negative resulting balances, quantity 0, and values `9007199254740992`/outside signed safe range. | CHECK/trigger rejects; ledger-derived balances unchanged. |
| J30 Movement before snapshot / direct balance write | Use a before snapshot different from current view; try `UPDATE inventory_balances`. | Snapshot guard rejects; view write rejected; no ledger change. |
| J31 Movement UPDATE/DELETE | On committed movements attempt quantity UPDATE and DELETE. | Append-only triggers reject; row and balance unchanged. |
| J32 Manifest/effect bijection | Omit one effect manifest; add orphan manifest; wrong target type/ID/key; extra effect; add manifest after finalization. | Deferred FK/finalization/completeness trigger rejects; no partial commit. |
| J33 Bootstrap/receipt evidence and movement reconciliation | Query identity-origin sets versus itemized lines, evidence/approval references, movement sets and manifest sets in both directions. | All differences empty on valid fixture; any injected extra/missing member blocks finalization. |
| J34 | Inventory identity, hash and numeric formats | Attempt empty/uppercase/space medicine ID; empty canonical unit; invalid tracking/lot pair; invalid expiry sentinel/calendar date; malformed ID/hash; quantity 0, negative quantity and `9007199254740992`. | SQLite form/date/hash/safe-integer CHECKs reject; well-formed but unknown catalog medicine/unit is rejected by Main, not credited to SQLite. |
| J35 Lifecycle wrong-command and revision hash | For each lifecycle transition use command type/order ID/expected revision/request hash from another command; attempt repeat accept and fulfill before accept. | Revision guard/FK rejects; state and history unchanged. |
| J36 Nonce replay after rollback | Durably consume nonce; begin business operation then force rollback; insert same nonce value under a new ID/command. | UNIQUE nonce value rejects replay; no business rows from failed transaction. |
| J37 Nonce replay after success | Commit valid command then reuse nonce value under same and different command; try initial state consumed. | Unique nonce/state guard rejects; original nonce and assertion unchanged. |
| J38 Append-only families | For every append-only table in Stage H catalogue, execute one UPDATE and DELETE by known PK. Include `commands`, manifests, finalizations, revisions, lines, reservations, identities, movements, evidence/verification, authorization, key/history, nonce history and recovery. | Every forbidden mutation rejects; only documented nonce forward state and commit applying→committed transitions are accepted. |
| J39 Duplicate commit ID identical retry | Commit a valid command; submit same `commit_id` and exact identity again. | Main queries and returns the original commit after full effect comparison; no duplicate rows. Direct duplicate INSERT rejected by UNIQUE constraint. |
| J40 Duplicate commit ID conflicting retry | Reuse winning ID with different hash/type/aggregate/expected revision. | Fail closed; winning rows unchanged; explicit conflict observation; no silent overwrite. |
| J41 Interrupted transaction | Start a file-backed transaction, insert a valid partial command, close test connection before COMMIT; reopen. | All uncommitted business rows absent; prior committed state intact; checks clean. |
| J42 Uncertain successful COMMIT | Commit complete command but deliberately drop result before caller receives it; reconnect and query same commit ID and full expected effect set. | Return exact first successful result only after full match; no second effects or reversal. |
| J43 Competing reservations | Two connections; A `BEGIN IMMEDIATE`, reserves 4 of 5 and commits. B attempts `BEGIN IMMEDIATE`, then retries from fresh snapshot after lock. | B receives/waits through transient BUSY; after retry shortage rejects; final available 1/reserved 4, never oversubscribed. |
| J44 Concurrent same commit ID | Two connections submit same commit/request and then conflicting request under same ID. | One first commit wins; exact duplicate reads full result; conflict fails closed. |
| J45 WAL/FULL recovery | File-backed DB; record pragmas on each connection; close/reopen after full commit and after interrupted transaction; run both integrity checks. | Committed command is complete; uncommitted command absent; no claim beyond tested OS/filesystem. |
| J46 Final relational audit | Query `PRAGMA foreign_key_check`, `PRAGMA integrity_check`, exact ledger/view balances, command/revision/effect anti-joins and SQLite schema object inventory. | No FK rows, `ok`, exact balances, no missing/extra committed effect or required revision. |

The test runner must record exact SQL, transaction boundaries, SQLite error
text, expected/actual rows and state for every case. A design requirement or
static trigger inspection is not a test result. Tests involving actual identity,
cryptographic signatures, online authorization, crash/power loss, trusted
writer ownership or filesystem durability must report their Main/operational
boundary and must not overstate what SQLite proves.

## 9. Recovery, idempotency, concurrency and uncertain outcomes

- `commit_id` and `command_id` are unique, immutable first-writer identities.
  Exact retries read and compare the entire command identity, all manifests
  and effect rows, aggregate revisions and resulting balances before returning
  the original result.
- A different request under an existing commit ID is an explicit conflict;
  no row is updated and no automatic reversal occurs.
- `BEGIN IMMEDIATE` serializes writers before balance reads. Every movement's
  before snapshot is compared to the derived balance. A failed lock acquisition
  is transient, not a definitive rejection.
- A lost COMMIT response is `submission_unknown` until a healthy connection
  queries the same commit ID and validates every expected row. Partial,
  inconsistent or uncertain evidence requires human adjudication.
- The nonce is durably consumed before business writes, so a failed business
  transaction does not restore nonce availability.
- No automatic journal deletion, reservation release, conflict resolution or
  reversal is added.
- WAL/FULL settings are per file/connection as documented. A successful
  setting readback is not proof of universal power-loss immunity.

## 10. Enforcement boundary

| Invariant | Enforcer |
|---|---|
| Commit identity keys, relational FKs, manifest/effect bidirectional match, effect-kind grammar, command-specific revision/root/effect completeness, exact line/movement relationships, tested format and safe integer checks | SQLite constraints/triggers, with enforcement enabled and schema intact |
| Failed finalization leaves no partial business rows | Stage J `RAISE(ROLLBACK)` completeness trigger; all earlier SQL errors require the Main transaction wrapper to roll back |
| Receipt-created identities require the owner-approved policy value | SQLite policy insert guard plus owner decision metadata |
| Request/effect hash derivation, canonical JSON, enabled medicine/unit existence, true evidence provenance, signature verification, external authorization/key status, actual person identity | Main process / trusted service |
| Distinct actor IDs mean distinct humans | Main identity provider; SQLite only compares stored identifiers |
| Single trusted writer, narrow IPC, no trigger/schema tampering, retry on BUSY, first-COMMIT outcome comparison, uncertain result adjudication | Operational/Main-process |
| WAL/FULL configuration on every connection and storage durability | Operational configuration; must be measured on target driver/filesystem |
| No legacy stock import and no automatic history deletion | Main migration boundary and operational retention |

SQLite cannot identify its trusted writer or independently prove a
cryptographic signature, online authorization, external key revocation,
medicine-catalog truth, or the real-world identity of actors.

## 11. Traceability

### 11.1 Prior Stage G/I defects

| Prior defect / finding | Corrective control in Stage J | Regression case |
|---|---|---|
| Stage G: finalized receipt root rebound to different command/commit/effect while revision remained old | Retain Stage H root identity immutability, exact revision binding and manifest target equality | J25, J32 |
| Stage G: post-commit manifest/effect insertion | Applying-only insert guards, append-only manifest and effect guards | J07, J25, J28, J32 |
| Stage G: bootstrap identity without count line/evidence/approval/movement | Stage H bidirectional bootstrap checks plus Stage J exact set/cardinality and verified evidence/movement requirements | J18–J20, J33 |
| Stage G: empty medicine ID | Stage H nonempty canonical-format CHECK; Main catalog validation boundary retained | J34 |
| Stage G: receipt could not create new inventory identity | Binding owner rule; force receipt_may_create; one-transaction receipt identity/evidence/approval/movement/manifest model | J21–J25 |
| Stage I critical: `order.create` committed reserve without revision 1 | Stage J command-specific finalization requires exact revision 1, pending projection, correct command/commit/hash, exact effect grammar; `RAISE(ROLLBACK)` | J03–J06, J46 |
| Stage I: receipt policy text contradicted owner decision | Remove unresolved alternative; Stage J trigger rejects `existing_only` | J24 |
| Stage I unexecuted lifecycle/lineage/shortage/movement/nonce/immutability/retry/concurrency/recovery tests | Explicit SQL procedures and observables in the independent validation matrix | J04–J46 |

### 11.2 Approved decision traceability

| Approved decision | Stage J preservation |
|---|---|
| Five release-one commands only | Existing Stage H `commands.command_type` closed CHECK; command grammar covers all five. |
| `pending → accepted → fulfilled` exact mapping | Stage J requires revisions 1/2/3 and their exact command, commit, aggregate, request hash and root projection. |
| Create reserves atomically | Create finalizer requires per-line exact reservation and reserve movement; failed finalization rolls back. |
| Acceptance has zero inventory movement | Acceptance grammar requires exactly revision effect and zero movements. |
| Fulfillment consumes exact reservation | Fulfill grammar requires a one-to-one quantity/identity/reservation movement set. |
| Bootstrap count, independent count and separate approval | Two evidence references and actor distinctions per line; exact approved opening movement and identity-line bijection. |
| Receipt source evidence, receiver and second approver | Receipt line foreign keys, verification check, actor inequality and per-line approval assertion. |
| Receipt may create new identity | Explicit and mandatory `receipt_may_create`; identity and receipt chain atomic. |
| No legacy stock conversion | No legacy-import command or schema path is added. |
| No release/cancel/reject/expiry/correction/reversal/return operation | Closed command and movement-kind sets retained. |
| No automatic journal deletion | Append-only protections retained and included in J38. |
| BUSY is not a definitive rejection | Bounded retry/uncertain semantics retained in §9 and J43. |
| First successful COMMIT wins | Immutable unique IDs, full-result exact retry comparison and J39–J44. |
| No silent conflict resolution or automatic reversal | Conflict observations and human adjudication only. |
| Missing inventory classification blocks | Main validates enabled catalog and completeness before command. |
| Main-only DB ownership/narrow IPC | Operational boundary retained; not claimed as SQLite-enforced. |
| Pending reservations may persist indefinitely | No timeout or release path introduced. |

## 12. Unresolved issues and limitations

No unresolved owner decision remains for receipt identity creation; the
approved policy is binding. The Stage G report itself was not present in the
workspace, so Stage G's exact source reproductions cannot be reconstructed
independently beyond the descriptions preserved by Stage H/I. The Stage I
environment evidence and successful checks are reported, not rerun here.

The Stage J DDL and fixture suite remain **unexecuted by design**. Independent
validation must first confirm that the composed installation script parses,
that the new trigger compiles against every inherited Stage H column and
trigger, and that all J01–J46 tests produce the specified result. In
particular, the trigger's count/effect grammar and `RAISE(ROLLBACK)` atomicity
must be adversarially executed before implementation is considered.

The report does not claim tests passed, validation succeeded, or
implementation readiness.

## 13. Stage status

`STAGE_36A70J_SPECIFICATION_READY_FOR_INDEPENDENT_VALIDATION`

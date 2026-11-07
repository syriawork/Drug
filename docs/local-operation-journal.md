# Main-process local operation journal

The Stage 36A2A journal is owned by Electron's Main Process and stored at
`path.join(app.getPath('userData'), 'operation-journal')`. Each operation ID has
one final JSON file, named from a SHA-256 digest of the ID so filesystem
characters in IDs are not used as path components. The operation identity itself
remains the Stage 36A1 shape:

```text
{ operationId, operationType, canonicalPayload, payloadHash }
```

The journal record shape is:

```text
{
  schemaVersion: 1,
  operation: { operationId, operationType, canonicalPayload, payloadHash },
  lifecycle: {
    status,
    createdAt,
    lastAttemptAt,
    originalResultReference
  },
  integrity: { recordChecksum }
}
```

`createdAt` is assigned when an operation is prepared and remains unchanged.
`lastAttemptAt` is `null` until `recordAttempt()` records a canonical UTC ISO
timestamp. `originalResultReference` remains `null` until an original durable
result exists. A `confirmed` record requires a non-empty reference; once stored,
the reference cannot be cleared or replaced.

`payloadHash` identifies the canonical operation payload. `recordChecksum` is a
separate SHA-256 digest of deterministic canonical serialization of
`{schemaVersion, operation, lifecycle}` plus `orderRequest` when the record
carries one. The checksum detects accidental corruption; it is not cryptographic
authentication and does not make the file tamper-proof. Changing `requestId` or
any field of the persisted document payload invalidates the checksum.

The optional `orderRequest` field is scoped to the `reserve` operation type
(the operation that creates `order_requests/{requestId}`). It persists:

- `requestId` — the stable Firestore document ID of `order_requests/{requestId}`;
- `uid` — the authenticated Main-process UID that owns the request;
- `requestedItems` — the exact submission intent (`medicineId` + `quantity`
  lines) bound to the Stage 36A1 `canonicalPayload.items`;
- `payload` — the exact immutable Firestore document payload used to create
  `order_requests/{requestId}`: `{ uid, items: [{ medicineId, medicineName,
  quantity }], status: 'pending', requestDate: 'SERVER_TIMESTAMP' }`, or `null`
  until the payload snapshot is recorded. The document contract allows exactly
  the keys `['uid', 'items', 'status', 'requestDate']`; no extra key is
  persisted. `requestDate` and the `medicineName` snapshots are never
  regenerated on retry or restart.

`orderRequest` is validated strictly when a record is created, loaded, updated,
and recovered: its shape, the `requestId` pattern, the `uid`, the items, the
payload keys and values, and the binding between the order request and the
stored Stage 36A1 operation identity (`requestId === canonicalPayload.orderId`,
`uid === canonicalPayload.userId`, items multiset equality). Non-`reserve`
operation types cannot carry an `orderRequest`.

The journal calls the existing Stage 36A1 operation-ID and stored-identity
validators. It does not generate operation IDs. Its API provides initialization
and recovery, record lookup, preparation of an already-created identity,
lifecycle status updates, and explicit attempt timestamp recording. Submission
workflows are not connected to it in this stage.

## Persistence and recovery

Writes use exclusive, uniquely named temporary files in the journal directory.
The Main Process writes and flushes the file, closes it, reads it back, validates
the schema and both hashes, and only then renames it to the final name. Existing
final records are validated before updates. A failed rename does not unlink the
existing final record; recovery later fails closed if the remaining final and
temporary contents disagree.

On Windows, Node's file rename operation is used for replacement of a verified
existing file. If Windows refuses replacement (for example, because of an open
file), the failure is surfaced; the code does not delete the destination and
retry. Directory handles are not synchronized on Windows because directory
`fsync` is not generally available there. Other platforms attempt a directory
synchronization and tolerate only known unsupported-operation errors. File
flushes and renames improve recovery behavior, but this design does not claim
absolute durability against every power-loss or storage-device failure.

Recovery validates final and temporary records before accepting them. A single
valid temporary record can be promoted when no final exists. Identical valid
final and temporary files are accepted without deleting the temporary evidence.
Different valid versions, multiple conflicting temporary records, or corrupt
records are not guessed through: corrupt files are moved to uniquely named
`.corrupt` quarantine files, their bytes are preserved, and initialization
fails closed for manual review. No automatic reconstruction, quarantine cleanup,
or deletion is performed.

## Retention

There is no automatic deletion, age limit, record-count limit, cleanup timer, or
quarantine cleanup. Records remain retained in every lifecycle state:
`prepared`, `submission_unknown`, `confirmed`, `definitively_rejected`,
`identity_conflict`, and `corrupt`. Any future deletion policy requires separate
owner approval.

## Schema versioning

`schemaVersion` is `1`, the only supported version. Existing journal records
written under schemaVersion 1 (before this extension, without `orderRequest`)
continue to validate exactly as before: `orderRequest` is optional, so those
records are neither silently reinterpreted, nor discarded, nor overwritten. An
existing record never gains or loses `orderRequest` through an update — the
presence of `orderRequest` is fixed when the record is prepared, and lifecycle
updates preserve it byte for byte.

Because the extension is backward compatible under schemaVersion 1, no new
schema version is introduced and no migration is required. Any record whose
contents do not strictly match the schema (with or without `orderRequest`) is
rejected: on recovery, invalid files are moved to uniquely named `.corrupt`
quarantine files with their bytes preserved, and initialization fails closed for
manual review.

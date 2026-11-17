# Stage 36A70R — Owner-Facing Evidence-Request Register

**Internal-review draft only. No owner requests have been sent.** This version is reconciled against the complete, freshly reread original protocol. No repository files were modified, and no host queries, collection, runtime activity, handoff-file inspection, profile access, or journal access was performed.

## Management status

| Item | Required status |
|---|---|
| Disposition | **REVISION REQUIRED** |
| Qualification | **INCOMPLETE** |
| All control owners | **OWNER NOT IDENTIFIED** |
| Evidence channel | **NOT APPROVED** |
| Runtime authorization | **NOT GRANTED** |
| sandboxRuntimeAcceptance | **NOT_TESTED** |
| packagedRuntimeQualification | **NOT_TESTED** |
| Historical OperationJournal caveat | **UNRESOLVED** |
| Independent verification/freshness | **PARTIALLY SATISFIED** as a stated requirement; no external evidence has been validated. |

The protocol says the required external mechanisms are not established. This draft does not claim COMPLETE_PASS, authorize collection, or authorize runtime activity. The two unresolved matters remain **protocol clarifications**, not established requirements: evidence-record byte-length measurement method and allocation of total working bytes across multiple volumes.

## Common submission and safety conditions

- Identify only pre-existing authoritative sources, controls, and approval records. Do not invent owners, systems, products, policies, evidence, approval, or implementation status.
- Identify each accountable owner and approval authority using an authoritative delegation source. Until verified, record **OWNER NOT IDENTIFIED**.
- The evidence channel remains **NOT APPROVED** until the destination, access-control owner, authorized writers, write authorization, retention, audit, and transfer integrity are verified.
- Keep configuration evidence, effective-enforcement evidence, telemetry, and administrator attestations distinct. A declaration or attestation alone does not establish effective behavior.
- Do not access or inspect protected profiles, OperationJournals, credentials, production data, or other protected content. **Do not open or transmit the handoff manifest or package at this stage.**
- Minimize evidence. Do not include command transcripts, usernames/SIDs, profile paths, credentials, tokens, personal documents, production databases, or journal data. Mask protected path strings and content from operators.
- Do not create or configure controls, accounts, brokers, profiles, staging, or destinations; enable features; change firmware, settings, ACLs, or permissions; or launch Sandbox, a VM, an application, or qualification tests.
- A confirmed, measured violation is **COMPLETE_FAIL** where the protocol specifies it. Missing, stale, unauthenticated, ambiguous, contradictory, interrupted, or unverifiable evidence is **INCOMPLETE**. Unknown is never a pass.
- The historical OperationJournal caveat remains **UNRESOLVED**. Do not inspect profiles or journals or propose a rerun to resolve it.

## Requests

### 1. Endpoint authorization and OS-enforced access boundary

- **Control objective:** Establish that an existing, independently verifiable OS/endpoint control enforces the restricted identity’s access boundary.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the exact control owner, delegated authority, mechanism/version, authoritative configuration repository, policy ID, and approval/effective configuration record.
- **Authoritative evidence required:** Signed, target-host evidence for the exact restricted identity and launched process token: SID reference, enabled and deny-only group SIDs, integrity level, and all privileges. Show that the identity is non-administrative and lacks backup, restore, take-ownership, debug, impersonation, or equivalent bypass privileges. Provide machine-generated effective access-check output covering the volume root, every ancestor through C:\Stage36A70R-Handoff, package/config/manifest subtrees, and results. It must report owner, security descriptors, inherited and explicit ACEs, actual token and groups, applicable privileges, and evaluated access results.
- **Required outcomes:** Show no untrusted write/delete/rename/ACL-change rights on package data or its ancestors; no collection-identity write/modify/delete rights on package data; and results write access only for designated principals.
- **Independent verification:** Reviewer validates token evidence, effective access evaluation, control configuration and policy scope from authenticated sources, including group membership, inheritance, ownership, privilege-based bypasses, and applicable access paths. Configuration declarations are not substitutes for effective-access evidence.
- **Freshness / validity:** Evidence must correspond to the exact host, token, process, and effective policy for the proposed interval. Include source/version, policy ID, time, and signature.
- **Fail-closed:** Missing, stale, assertion-only, or unauthenticated evidence, or inability to establish the boundary without touching protected data: **INCOMPLETE**. Confirmed boundary violation: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** No protected-object access or enumeration; do not disclose usernames, SIDs, profile paths, or protected path strings to operators.
- **Can be assessed without protected-data access?** Potentially, from authenticated control-plane and sanitized access-check evidence. Otherwise **INCOMPLETE**.
- **Protocol basis:** §§0–1, 4, 7.

### 2. Protected-data coverage and storage-path accounting

- **Control objective:** Establish complete deny/no-read coverage for protected data and all non-approved storage locations without inspecting their contents.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the authoritative policy/inventory owner, approval, and delegation for scope completeness.
- **Authoritative evidence required:** Signed, machine-generated effective-access evidence evaluated against the exact token and privilege set. It must cover protected profiles, OperationJournals, production data, credentials, all other non-approved locations, and **all possible link targets**. Identify the authoritative inventory and policy source, scope/version, freshness, coverage rules, exclusions, and evaluator.
- **Independent verification:** Reviewer validates completeness from authoritative configuration and signed enforcement records without opening, listing, enumerating, or reading protected objects. Protected path strings and content must be masked from operators.
- **Freshness / validity:** Scope, policy, exclusions, and evaluation must be current for the host and proposed interval; include version and evaluation time.
- **Fail-closed:** A category list, local scan, unverified deny rule, assertion, or incomplete coverage is insufficient and yields **INCOMPLETE**. Confirmed successful or attempted access to a protected profile or journal is **COMPLETE_FAIL** under the telemetry result rule.
- **Sensitive-data restrictions:** Do not access or enumerate protected objects or disclose protected paths or contents.
- **Can be assessed without protected-data access?** Only if authoritative coverage and signed enforcement evidence prove completeness without accessing protected objects; otherwise **INCOMPLETE**.
- **Protocol basis:** §§0–1, 7.

### 3. Managed broker, PowerShell provenance, and controlled environment

- **Control objective:** Establish that a pre-existing managed mechanism launches the restricted process without loading or accessing any Windows user profile and with controlled startup provenance.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the broker/control owner, delegated authority, policy ID, authoritative configuration, and approval record.
- **Authoritative evidence required:** Broker/service or documented OS launch mechanism, executable identity and signature/version, full executable path, restricted token, launch parameters, process ID, process start time, and PowerShell edition/version. Supply existing process-start and file-I/O telemetry demonstrating profile-free startup and a clean controlled environment block.
- **Exact environment and module evidence:** The process must be fresh and 64-bit, launched with -NoProfile -NoLogo; these flags alone do **not** prevent Windows from loading a user profile. Evidence must establish no profile-load operation or profile access, including the collection identity’s pre-existing isolated profile; no user PATH, startup scripts, aliases, custom functions, or custom module paths; and use only documented built-ins and identified inbox components. Record the **exact module names actually loaded** and their **signed system locations/provenance** from existing process/module telemetry. The protocol identifies Microsoft.PowerShell.Utility, CimCmdlets, and DISM as inbox components.
- **Independent verification:** Reviewer checks broker policy, binary signature/version, process identity/timing, PowerShell edition/version, environment, profile-load events, and module names/signatures/locations against authenticated broker and telemetry sources. Do not infer profile isolation from -NoProfile.
- **Freshness / validity:** Broker configuration and executable evidence must be effective for the proposed process. Telemetry must cover startup and the collection interval and be tied to the exact process/run.
- **Fail-closed:** Missing or unverifiable broker, environment, module provenance, profile-free launch, or process evidence: **INCOMPLETE**. Any profile access means the no-profile-touch property was not met and requires **INCOMPLETE**; confirmed successful or attempted access to a protected profile/journal is **COMPLETE_FAIL** under the telemetry result rule.
- **Sensitive-data restrictions:** Do not inspect any profile or journal. Do not disclose profile paths, usernames, or SIDs.
- **Can be assessed without protected-data access?** Broker configuration and sanitized telemetry may be reviewed without protected contents. No process may be launched under this register.
- **Protocol basis:** §§0–1, 7.

### 4. Process-creation, module, profile, file, and registry telemetry

- **Control objective:** Establish complete, tamper-resistant evidence of relevant process and access events for the entire startup and collection interval.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the sensor and management-source owner, approval, configuration, and coverage scope.
- **Authoritative evidence required:** Signed telemetry keyed to process ID and run ID covering process creation and token, image/module loading, profile-load events, and successful or attempted file and registry access for every relevant process. Include sensor identity/version, configuration and filter scope, tamper-protection state, health/heartbeat, retention completeness, event sequence/count reconciliation, and time-source/synchronization status.
- **Independent verification:** Reviewer validates signed records and coverage against the sensor’s independently authenticated management source; verifies the sensor could not be disabled or records altered by the operator/restricted identity; and reconciles event counts/sequences and time status. Protected path strings and content must be masked.
- **Freshness / validity:** Configuration, health, time synchronization, and retention evidence must cover the whole relevant interval and be current.
- **Fail-closed:** Missing, incomplete, unauthenticated, or tamper-uncertain telemetry: **INCOMPLETE**. Confirmed successful or attempted protected profile/journal access: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** Report only signed access/no-access status and coverage metadata; no protected contents or unmasked paths.
- **Can be assessed without protected-data access?** Potentially, using authenticated configuration and sanitized event metadata. No telemetry was collected for this draft.
- **Protocol basis:** §§0–1, 7.

### 5. Protected staging and same-file-object inspection

- **Control objective:** Establish a stable, OS-protected handoff staging boundary and a pre-existing inspection facility that verifies each file through one open file object.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify owners and approvals for staging protection, storage, transfer provenance, and the inspection facility.
- **Authoritative evidence required:** A signed, pre-existing staging-provisioning record binding the actual handoff transfer to C:\Stage36A70R-Handoff, its stable volume ID/file ID, mount identity, storage owner, and separately designated results directory. Provide independent transfer/inventory provenance and current volume metadata showing local, non-redirected storage. Effective controls must protect the volume root, every ancestor, and package subtrees against untrusted modification, substitution, rename, delete, remount, and ACL changes throughout inspection. Results must be the sole writable exception and must not grant control over the parent or package siblings.
- **Required file-object evidence:** Identify the existing approved facility that keeps one handle per file from pre-read metadata through hash and byte-length computation to post-read metadata; binds all checks to the same file object; and prevents writes, truncation, rename, delete, or replacement during that interval. Evidence must include volume identity, file ID, type, reparse status, alternate-stream status, and hard-link count before and after.
- **Exact gates:** **Do not open any handoff file**—including manifest, checksum, receipt, .wsb, README, or package—until the staging boundary, ancestor chain, token/access checks, telemetry, and pre-read metadata gates have independently passed. Every handoff file must have exactly one hard link and no unexpected stream; link target names must not be disclosed. Do not follow reparse points. Path-based checks or file IDs alone do not prove same-object atomicity or immutability.
- **Inventory procedure after the gate:** Traverse manually, one directory at a time; include hidden/system entries and empty directories; do not use wildcard paths or automatic recursion; do not traverse reparse points or enumerate outside the approved staging root and results directory. Record every relative path before content reads, normalize and check paths/collisions as in Request 7, and keep the staging boundary stable. The results directory must exist, be empty, contain no reparse point, and have the approved effective ACL.
- **Independent verification:** Reviewer validates signed transfer and provisioning records against independent inventory, access-check, volume, and telemetry sources, and validates the inspection facility’s identity and behavior without opening handoff files.
- **Freshness / validity:** Controls and telemetry must remain effective over the entire review interval; volume/mount identity and directory-chain identities must be stable.
- **Fail-closed:** Unknown or unverified staging, access boundary, ancestry, same-handle facility, or metadata: **INCOMPLETE**. Confirmed unsafe entry, multiple hard link, unexpected stream, reparse point, or boundary violation: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** No handoff file is opened before the gate; no protected data or link target names are exposed.
- **Can be assessed without protected-data access?** Existing control, transfer provenance, and facility can be assessed from independent records. Actual handoff inspection is not authorized now.
- **Protocol basis:** §§0–1, 4, 7.

### 6. Organizational trust anchors, signer authority, and trusted timestamping

- **Control objective:** Establish independent trust in publishers, signers, timestamps, and signed evidence.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the authoritative PKI trust-anchor catalog, signer-role/delegation source, approved TSA, revocation source, and responsible owners.
- **Authoritative evidence required:** Exact organizational trust-anchor fingerprints sourced independently of the handoff/evidence; signer identity and delegated role; approved signing purpose; certificate chain, validity, and revocation evidence; TSA identity and authorization; and receipt-validation method. The attestation signer may not be the restricted collection operator. The independent reviewer must not have prepared the host or signed the attestation.
- **Exact timestamp requirements:** The RFC 3161 token’s SHA-256 messageImprint must cover the exact CMS SignerInfo.signature octets. Validate token signature, TSA chain to a separately pinned TSA anchor, TSA identity, timestamping authorization including timestamping EKU, certificate validity at genTime, and revocation at signing time and review using authoritative CRL/OCSP or approved archived evidence. Validate the evidence signer’s chain, identity, role, purpose, validity at trusted time, and revocation. A CMS signingTime attribute is not trusted time.
- **Independent verification:** Reviewer obtains anchors and role records from independent authoritative sources and validates signatures, identities, purposes, timestamp imprint, TSA authorization, validity, revocation, and trusted time.
- **Freshness / validity:** Certificate and revocation checks must be appropriate to signing time and review time. Collection end must be no more than 24 hours before RFC 3161 genTime; receipt must arrive within 24 hours after trusted time (see Request 8).
- **Fail-closed:** Missing/unverified anchors, signer authority, TSA/EKU, imprint, validity, revocation, or trusted time: **INCOMPLETE**.
- **Sensitive-data restrictions:** No private keys, credentials, protected contents, or unnecessary personal data.
- **Can be assessed without protected-data access?** Trust configuration and validation policy can be assessed without protected contents.
- **Protocol basis:** §§0–1, 6–7.

### 7. Authenticated inventory baseline and publisher

- **Control objective:** Establish that the complete package inventory baseline is authoritative, signed, version-bound, and maintained outside the handoff.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the authorized publisher, release-signing key, role source, approval, and authoritative baseline source.
- **Authoritative evidence required:** Identify the inventory source and its location **outside the handoff tree/package**, its custodian, schema/version, publisher authorization, and transfer/case binding. The detached inventory must use RFC 8785 JSON Canonicalization Scheme (JCS), UTF-8 without BOM, with no bytes outside the canonical JSON representation. It has exactly five top-level members—entries, format, manifestSha256, packageVersion, schemaVersion—and exactly four entry members—lengthBytes, path, sha256, type. format is Stage36A70R-HandoffInventory; schemaVersion is 1; files have nonnegative decimal-string lengths and lowercase 64-hex SHA-256; directories have null length and hash. The detached signature covers the exact canonical UTF-8 bytes.
- **Inventory scope and normalization:** The signed inventory covers every file, including manifest, checksum companion, .wsb, and all 174 payload files, and every directory including empty directories. It is not included in its own entries. Bind package version to the publisher’s signed release record and manifestSha256 to the authenticated manifest digest. Normalize paths to Unicode NFC and /; reject rooted paths, empty components, ./.., colon/stream syntax, controls, trailing dot/space, reserved Windows device names, ambiguous separators, duplicates, and Windows case-insensitive collisions. Sort entries by normalized path’s UTF-8 bytes in ascending unsigned-byte lexicographic order.
- **Independent verification:** Reviewer validates signature, publisher authority, key/trust anchor, canonical encoding/schema, package version and manifest binding, transfer binding, completeness, and later one-to-one comparison against the observed tree. The baseline must not be supplied only by the handoff.
- **Freshness / validity:** Baseline and signature must match the exact package version, manifest digest, and authenticated transfer.
- **Fail-closed:** Missing, unsigned, stale, incomplete, unbound, noncanonical, or unverifiable baseline: **INCOMPLETE**. Authenticated inventory mismatch: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** At this stage, do not open or transmit the handoff manifest or package. Request only source/authority and non-sensitive control metadata; the baseline source must be outside the package.
- **Can be assessed without protected-data access?** Publisher, source location, schema, and verification design can be assessed without protected contents. Package comparison is not authorized now.
- **Protocol basis:** §§0–1, 4, 7.

### 8. Unique case/run identity, evidence destination, and transfer

- **Control objective:** Establish a unique, replay-resistant evidence workflow and an approved, pre-existing destination and transfer channel.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the case/evidence-system owner, destination access owner, authorized writers, transfer-channel owner, and their approval/delegation records. Until destination controls are verified, the channel is **NOT APPROVED**.
- **Authoritative evidence required:** The destination must be **pre-created**, access-controlled, and authorized for this evidence. Verify destination identity, access owner, authorized writers, write authorization, retention, audit source, and transfer-integrity method. The system must issue a unique collection-run ID and provide tamper-evident audit evidence that the case/run pair and receipt serial were not previously issued, submitted, accepted, superseded, or reused. The evidence record must use a **newly issued unique filename**; explicitly prohibit overwrite and append.
- **Receipt and transfer requirements:** The signed payload binds exact evidence filename, case ID, unique run ID, organization asset/host ID, restricted-identity SID reference, collection start/end UTC, record version, byte length, SHA-256, signer identity, and signing time. Use detached CMS/PKCS#7 over the complete receipt payload. Recheck run/receipt uniqueness and status on receipt. Transfer receipt and record through the approved channel; validate signature, trusted timestamp, freshness, uniqueness, association, and transfer integrity on receipt; recompute record hash and length; store receipt separately. If the destination is not verified safe, do not write; report **INCOMPLETE** only through an already approved audit/ticket channel.
- **Independent verification:** Reviewer validates authoritative system identity/data source, event sequence, time synchronization, uniqueness/replay records, destination ACL/ownership/writers, retention/audit controls, and transfer integrity.
- **Freshness / validity:** Collection end is at most 24 hours before RFC 3161 genTime; receipt arrives within 24 hours after that trusted time; uniqueness/status is checked again on receipt.
- **Fail-closed:** Missing destination controls, run uniqueness, audit history, freshness, transfer integrity, or receipt recheck: **INCOMPLETE**. Authenticated receipt-to-record digest or byte-length mismatch: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** Do not write to an unverified destination or include profiles, journals, credentials, personal/production content, raw transcripts, or unnecessary identifiers.
- **Can be assessed without protected-data access?** System, destination, and transfer controls may be assessed from authoritative metadata. No record is created or transferred under this draft.
- **Protocol basis:** §§0, 6–7.

### 9. Authoritative host-support sources and Windows host requirements

- **Control objective:** Identify the authoritative support source and define the exact future read-only host measurements. This request is **not** permission to run host queries.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the owner and approved Windows Sandbox support source, including source version/date applicable to the exact build.
- **Host identity and provenance:** Record organization asset ID (not a user profile path), collection UTC, operator role/identity through the approved sign-off process, independent reviewer sign-off, and the identity/elevation state for each evidence set.
- **Exact requirements and measurement sources:**
  - **64-bit process check:** Run `[Environment]::Is64BitProcess` in the fresh PowerShell session and record the returned Boolean. The required result is `True`. Do not infer bitness solely from the launch configuration. An unavailable or unverifiable result is `INCOMPLETE`; a confirmed `False` fails the 64-bit requirement under the §7 result rules.
  - Supported **x64 Windows Pro, Enterprise, or Education** edition/build; record edition, display/version, build and revision. If support for the exact build cannot be established from the approved source, do not assume support. The protocol’s read-only sources are the Windows current-version registry properties and Win32_OperatingSystem.
  - **Total physical RAM:** at least **8 GiB = 8,589,934,592 bytes**; use Win32_ComputerSystem.TotalPhysicalMemory raw bytes, without rounding.
  - **Available memory:** at least **4 GiB = 4,294,967,296 bytes**. Win32_OperatingSystem.FreePhysicalMemory is KiB: multiply the raw integer by exactly 1024. If that class is unavailable, Win32_PerfFormattedData_PerfOS_Memory.AvailableMBytes is whole MiB: multiply by exactly 1,048,576; accept a pass only at **4,097 MiB = 4,296,015,872 bytes** or more. A lower fallback is **INCOMPLETE** unless an independently validated finer-resolution value is available; conflicting sources are **INCOMPLETE**. Capture raw value, native unit, conversion, and resulting integer bytes. Measure at preflight and remeasure immediately before any later, separately authorized Sandbox launch.
  - **CPU:** at least **two physical CPU cores**; record processor model and logical processor count as context. Use Win32_Processor; if multiple rows exist, record each and check the manually summed physical-core total.
  - Each required Boolean must be explicitly **True**: VirtualizationFirmwareEnabled, VMMonitorModeExtensions, SecondLevelAddressTranslationExtensions, and HypervisorPresent (from Win32_ComputerSystem).
  - Windows optional feature Containers-DisposableClientVM must have state **Enabled**, using Get-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM. Disabled or DisabledWithPayloadRemoved is a completed failure; missing feature, query error, or unavailable result is **INCOMPLETE**.
  - In 64-bit PowerShell, exact executable-presence check is Test-Path -LiteralPath (Join-Path $env:WINDIR 'System32\WindowsSandbox.exe') -PathType Leaf; required result **True**. False is a completed failure. Do not launch it.
  - Any required restart must already have occurred before the host is considered ready.
  - Record exact raw free-space bytes for each actual approved staging/results volume, tied to that path’s volume identity, using Win32_LogicalDisk for only those exact volumes. Do not query unrelated drives. Disk calculation and multi-volume ambiguity are addressed in Request 12.
  - Record the read-only evidence session’s elevation Boolean (True/False), not username/SID/profile path; elevation is provenance, not a pass criterion. Record collection UTC in ISO 8601 and organization-approved time-source/synchronization status.
- **Session constraints:** Host-wide read-only facts require a separate session through an already approved profile-free broker; keep it separate from restricted-identity artifact inspection. Use a fresh 64-bit PowerShell process with -NoProfile -NoLogo, clean environment, approved process/module telemetry, and the profile/journal prohibitions. Queries are individual read-only queries, not a collector, and are not run on the current workstation.
- **Independent verification:** Reviewer checks raw values, units, conversions, source provenance, host identity, timestamp/time source, and applicable support-source version. Rounded values or administrator assertion alone are insufficient.
- **Freshness / validity:** Measurements are tied to the specific host and collection time. Available memory is remeasured immediately before any later separately authorized launch.
- **Fail-closed:** Confirmed threshold/Boolean/feature/executable failure: **COMPLETE_FAIL**. Missing, null, rounded, conflicting, stale, nonnumeric, negative, overflowed, or unauthenticated data: **INCOMPLETE**. For the whole-MiB memory fallback, below 4,097 MiB is **INCOMPLETE** absent a validated finer measurement.
- **Sensitive-data restrictions:** Record only prescribed scalar results; do not export usernames, SIDs, profile paths, or broad system inventories.
- **Can be assessed without protected-data access?** Authoritative support documentation can be assessed without protected data. Actual measurements require separate authorization and are not run here.
- **Protocol basis:** §§0, 1–3, 7.

### 10. Authenticated manifest digest and 174 payload entries

- **Control objective:** Define independent authentication and complete one-to-one verification of the manifest and payload, subject to the pre-read gate.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the authorized artifact publisher, key/role source, trust anchor, and approval.
- **Authoritative evidence required:** A signed transfer receipt from the authorized publisher providing the expected SHA-256 of manifest\SHA256SUMS.csv, bound to case/transfer, host/staging volume, and trusted time. The checksum companion on the staging volume does not authenticate itself. Only after the Request 5 gate, verify exactly 174 unique payload rows, the manifest’s exact required columns, safe relative paths, valid 64-hex hashes, and nonnegative byte lengths. Compare each row’s path, type, length, and SHA-256 one-to-one with the signed inventory; also account for the two control files, all directories, and all actual entries. Do not invent column names not specified in the protocol.
- **Independent verification:** Reviewer validates expected-digest signature, trust chain, signer role, certificate purpose/validity/revocation, case/transfer binding, and freshness independently of the handoff. The accepted facility must bind hash, length, and pre/post metadata to the same file object.
- **Freshness / validity:** Expected digest must be authenticated, current, and bound to the exact transfer/package. All 174 entries and the complete directory inventory must be reconciled.
- **Fail-closed:** Missing, unauthenticated, stale, substituted, or unverifiable expected digest; incomplete inventory; or inability to verify safely: **INCOMPLETE**. Mismatch against an authenticated expected digest, or a confirmed missing/extra/altered artifact: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** Do not open the manifest or package at this stage. Do not use privileged access to bypass an access failure.
- **Can be assessed without protected-data access?** Digest authority and process design can be assessed without protected contents. File verification is not authorized now.
- **Protocol basis:** §§1, 4, 7.

### 11. Evidence-record byte-length and digest binding

- **Control objective:** Ensure the evidence record is cryptographically bound to its detached receipt and that receipt verification is independently repeatable.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the evidence-signing authority and approval for the receipt format and validation process.
- **Authoritative evidence required:** The signed payload binds exact evidence filename, case ID, unique run ID, host/asset ID, restricted identity reference, collection start/end UTC, record version, byte length, SHA-256, signer identity, and signing time. On receipt, recompute SHA-256 and byte length of the exact evidence record and compare both to the signed payload; keep the receipt separate from the record.
- **Protocol clarification — not an established requirement:** Section 6 requires byte length in the signed payload and receiver-side recomputation, but does **not** prescribe a specific byte-length measurement method for the evidence record. Do not treat same-handle measurement as a protocol requirement. Ask for clarification; do not invent a method.
- **Independent verification:** Reviewer verifies signature, record/receipt association, filename/version, all bound fields, trusted timestamp, freshness, revocation, and recomputed digest and length.
- **Freshness / validity:** Apply the 24-hour windows in Requests 6 and 8 and recheck status on receipt.
- **Fail-closed:** Missing or unverifiable binding/signature/freshness: **INCOMPLETE**. Authenticated digest or byte-length mismatch: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** Do not put the evidence record’s own digest in the record; its digest belongs in the detached receipt. Neither record nor receipt needs to contain its own digest.
- **Can be assessed without protected-data access?** Receipt specification and validation procedure can be assessed without protected contents; no receipt is created or validated here.
- **Protocol basis:** §6; byte-length method clarification required.

### 12. Working-byte estimate and per-volume free-space decision

- **Control objective:** Apply the protocol’s exact working-byte estimate and formula while resolving, rather than inventing, the allocation rule for multiple volumes.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the owner and approval authority for resolving the protocol’s multi-volume allocation ambiguity.
- **Authoritative evidence required:** The protocol defines estimated_total_working_bytes as the sum of:
  1. complete handoff bundle bytes to be staged;
  2. one guest-local copy of each production and QA package;
  3. one separate instrumented QA copy if planned, otherwise zero;
  4. documented peak temporary working space; and
  5. expected results/output bytes.

  For estimates not supplied by an authenticated manifest, use a written conservative estimate approved by the reviewer; if unsupported, **INCOMPLETE**. If instrumented-copy size is unknown, the protocol’s conservative fallback is **at least the full QA package size**.

  The exact formula is:

  required_free_bytes = ceiling(1.5 × estimated_total_working_bytes)


  Use integer arithmetic and round any fractional byte upward. Retain original byte values and calculation. Compare raw integer free bytes for each actual staging/results volume; do not use rounded GiB, use another drive, or aggregate free space across volumes.
- **Protocol clarification — not an established requirement:** The protocol gives a single total estimate and says each actual staging/results volume must meet its applicable required_free_bytes, but does not fully specify how to allocate that total across multiple volumes. Obtain clarification; do **not** invent a per-volume allocation formula. Until the applicable amount for each volume is established, the decision is **INCOMPLETE**.
- **Independent verification:** Reviewer checks estimate components, supporting source, integer arithmetic/ceiling, raw per-volume free bytes, and exact volume identity.
- **Freshness / validity:** Free-byte measurements must be tied to the actual approved volume(s) and collection time. Retain raw values and calculations.
- **Fail-closed:** Unsupported estimates, unknown applicable per-volume allocation, missing/rounded values, or inability to tie free bytes to the approved volume: **INCOMPLETE**. Confirmed insufficient free bytes against the approved applicable requirement: **COMPLETE_FAIL**.
- **Sensitive-data restrictions:** Do not enumerate unrelated drives or directories or include broad filesystem inventories.
- **Can be assessed without protected-data access?** Formula and allocation clarification can be assessed without protected contents. Host measurements require separate authorization.
- **Protocol basis:** §§2–3, 7; multi-volume allocation clarification required.

### 13. Exact .wsb mappings, security settings, and separate host ACL review

- **Control objective:** Require exact static configuration review and a distinct effective host ACL review. Neither is runtime acceptance.
- **Accountable owner / approval:** OWNER NOT IDENTIFIED. Identify the approved configuration source and owner/authority for host access-control policy.
- **Authoritative evidence required — exactly three mappings:** After the pre-read gate, review config\external-host\stage36a70r-external-host.wsb as text only; never launch it.

  | Host folder | Guest folder | Required .wsb permission |
  |---|---|---|
  | C:\Stage36A70R-Handoff\packages\production\win-unpacked | C:\Stage36A70R\Input\production | <ReadOnly>true</ReadOnly> |
  | C:\Stage36A70R-Handoff\packages\qa\win-unpacked | C:\Stage36A70R\Input\qa | <ReadOnly>true</ReadOnly> |
  | C:\Stage36A70R-Handoff\results | C:\Stage36A70R\Results | <ReadOnly>false</ReadOnly> |

  Confirm exactly three mappings; all host paths resolve to the actual dedicated directories; results is the **only declared writable mapping**; and no profile, home, workspace, journal, or broad parent directory is mapped.
- **Required security settings:** Networking disabled; clipboard disabled; audio input disabled; video input disabled; printer redirection disabled; vGPU disabled; Protected Client enabled; memory allocation remains **4096 MB**.
- **Separate effective host ACL review:** For each exact host directory, an administrator reviews Properties → Security → Advanced → Effective Access for the restricted identity and records the result, corroborated by machine-generated access-check evidence. Review inherited entries, group membership, explicit allow/deny entries, owner, and parent permissions. Review all principals/groups with results write access. The pre-existing approved policy must identify the designated results writer(s), including whether the approved operator/launching identity and restricted inspection identity are the same; do not infer that they are. Only the approved identity/identities and administrators may write as specified by the protocol. Package directories must provide the restricted identity read/list/traverse access and no host write/modify/delete access. Results must be dedicated and empty, with effective ACLs matching the pre-existing approved policy. Do not change permissions. XML ReadOnly flags and host ACL evidence are separate; neither proves guest behavior.
- **Independent verification:** Reviewer checks complete static .wsb text, mapping set, required settings, exact host paths, and host Effective Access/effective-policy evidence independently.
- **Freshness / validity:** Configuration and ACL evidence must apply to the exact host and effective policy at review time; required restart, if any, must already have occurred.
- **Fail-closed:** Confirmed incorrect path, permission, setting, extra mapping, unsafe ACL, or unauthorized writer: **COMPLETE_FAIL**. Missing or unresolvable evidence: **INCOMPLETE**.
- **Sensitive-data restrictions:** Do not inspect protected profiles/journals to perform ACL review; use independently verifiable security-descriptor/access-check evidence and signed policy scope.
- **Can be assessed without protected-data access?** Static text and sanitized effective-access evidence can be reviewed without protected contents. No .wsb launch or guest-behavior test is authorized.
- **Protocol basis:** §§2, 5, 7.

## Result states and runtime limits

- **COMPLETE_PASS** requires every protocol query and manual check to complete and every required mechanism, control owner, evidence source, configuration, effective enforcement, telemetry, signer, and reviewer verification to be independently authenticated. The protocol’s Section 0 mechanisms are not established here; current qualification therefore remains **INCOMPLETE**, not COMPLETE_PASS.
- **COMPLETE_FAIL** applies only when required checks completed and a definite failure is confirmed.
- **INCOMPLETE** applies when evidence is missing, ambiguous, unauthenticated, stale, contradictory, interrupted, or unsafe to obtain.
- Any eventual passing preflight could mean only **EXTERNAL HOST ACCEPTED FOR ISOLATION SETUP CONSIDERATION ONLY**. sandboxRuntimeAcceptance and packagedRuntimeQualification remain **NOT_TESTED**. Sandbox activation, application launch, and packaged-runtime qualification remain unauthorized.
- The historical OperationJournal caveat remains **UNRESOLVED**.

## Fresh requirement-by-requirement comparison

| Original protocol requirement | Exact register section | Result | Comparison |
|---|---|---|---|
| §0, control identification and current feasibility | Management status; Requests 1–10, 13 | MATCH | Exact mechanisms, owners, sources, and policy IDs remain unestablished; the register preserves OWNER NOT IDENTIFIED, NOT APPROVED, and INCOMPLETE rather than implying controls exist. |
| §0, OS access-boundary identity, policy, owner/delegation, effective token/access check, signed host coverage | Request 1 | MATCH | Includes exact mechanism/version, authoritative source/policy, owner/delegation, exact-process token, access-check evidence, and signed coverage. |
| §0, managed process launch | Request 3 | MATCH | Requires existing broker/OS mechanism identity, executable/signature/version, policy, restricted token, launch evidence, and suppressed Windows profile loading. |
| §0, process/file-I/O telemetry | Request 4 | MATCH | Requires exact sensor/source, signed export, coverage, tamper protection, health, retention, time synchronization, and completeness. |
| §0, stable file-object inspection | Request 5 | MATCH | Requires existing OS protection and signed facility binding pre-read metadata, hash, byte length, post-read checks, and immutable interval to one open file object. |
| §0, PKI/trusted time | Request 6 | MATCH | Requires independent trust-anchor fingerprints, authorized signer-role source, approved TSA, revocation source, and validation method. |
| §0, inventory publisher/case-run authority | Requests 7–8 | MATCH | Requires authorized publisher/key/role source, signed external baseline, and authoritative unique/replay-resistant case-run system. |
| §0, identity/host/staging provenance | Requests 1, 5, 9 | MATCH | Requires identity/delegation, asset identity, transfer/provisioning records, stable volume owner and mount identity. |
| §0, evidence storage/transfer | Request 8 | MATCH | Requires pre-created destination, access owner, write authorization, retention/audit, and verifiable transfer integrity. |
| §0, host-support criteria | Request 9 | MATCH | Requires exact authoritative Windows Sandbox support source and version/date for the exact build. |
| §0, independence of sources and evidence classes | Common conditions; Requests 1–10 | MATCH | Requires independent sources and keeps configuration, enforcement, telemetry, and attestation distinct. |
| §0, current mandatory INCOMPLETE; no protected workflow absent controls | Management status; Result states | MATCH | Preserves current INCOMPLETE and prohibits implying COMPLETE_PASS. |
| §1, restricted non-admin identity and prohibited bypass privileges | Request 1 | MATCH | Lists non-administrative status and backup/restore, take-ownership, debug, impersonation, and equivalent bypass privileges; no account/token/ACL changes. |
| §1, signer authority and independent reviewer | Request 6 | MATCH | Requires independently verified signer role/delegation; signer is not the restricted operator; reviewer did not prepare host or sign attestation. |
| §1, exact-process token report | Request 1 | MATCH | Includes SID reference, enabled/deny-only groups, integrity level, all privileges, and actual process-token binding. |
| §1, signed staging-provisioning/transfer record | Request 5 | MATCH | Includes stable volume/file identity, authenticated transfer provenance, and results as sole writable exception. |
| §1, effective access check and exact boundary outcomes | Requests 1, 5, 13 | MATCH | Covers root/ancestors/package/config/manifest/results; effective owner, ACEs, groups, privileges and access results; package and results outcomes. |
| §1, protected-data categories, link targets, source/scope/exclusions/evaluator | Request 2 | MATCH | Explicitly includes protected profiles, journals, production, credentials, other non-approved locations, all possible link targets, and provenance fields. |
| §1, telemetry events and failure consequences | Request 4 | MATCH | Includes process/token, image/module, profile, file/registry success or attempt, PID/run ID, sequence/count reconciliation; confirmed protected profile/journal access is COMPLETE_FAIL. |
| §1, per-file metadata and same-object facility | Request 5 | MATCH | Includes type, reparse, streams, link count, volume/file ID, same-handle before/after checks, exactly one hard link, no unexpected stream, no link-target disclosure. |
| §1, detached signatures, trust anchors, independent reviewer, source-ID reconciliation | Requests 1, 6, 8 | MATCH | Requires independent anchors/roles, signatures and reviewer; host/token/process/volume/control/run evidence is reconciled. |
| §1, host-wide queries separated from restricted file inspection | Request 9 | MATCH | Requires separate brokered session and records identity/elevation for each evidence set. |
| §1, profile-free 64-bit PowerShell, controlled environment, exact module provenance | Request 3 and Request 9 | MATCH | Includes -NoProfile -NoLogo, 64-bit, clean environment, no profile access, module names and signed system locations; flags are not treated as proof. |
| §1, individual queries only; no collector, settings changes, Sandbox/VM/app/test launch | Common conditions; Request 9 | MATCH | Explicitly prohibits these activities and states that no host query is authorized now. |
| §1, bounded staging/results use and minimal scalar export | Common conditions; Requests 5, 8–10 | MATCH | Limits evidence to required scalars and approved locations; prohibits broad inventories and unrelated-drive enumeration. |
| §2, host identity, UTC, operator role, independent review | Request 9; Request 8 | MATCH | Includes organization asset ID, UTC, operator role/identity, and independent reviewer sign-off. |
| §2, supported x64 Windows edition/build | Request 9 | MATCH | Specifies x64 Pro/Enterprise/Education, edition/version/build/revision, and authoritative exact-build support source. |
| §2, total and available RAM thresholds/timing | Request 9 | MATCH | Specifies 8 GiB/8,589,934,592 bytes and 4 GiB/4,294,967,296 bytes; preflight measurement and later pre-launch available-memory remeasurement. |
| §2, CPU/virtualization and hypervisor | Request 9 | MATCH | Requires at least two physical cores; firmware virtualization, VM monitor, SLAT, and HypervisorPresent each explicitly True. |
| §2, feature, executable, restart | Request 9 | MATCH | Requires Containers-DisposableClientVM Enabled, exact WindowsSandbox.exe leaf-presence check True, and any required restart already completed. |
| §2, per-volume exact free bytes and no aggregation | Requests 9, 12 | CLARIFICATION REQUIRED | Raw bytes and separate actual volumes are required; the protocol does not fully specify how to allocate its single total estimate across multiple volumes. No allocation formula is invented. |
| §2, handoff integrity and results directory | Requests 5, 7, 10 | MATCH | Requires 174 unique payload entries, complete inventory, file type/length/hash/identity, safe paths, no unexpected/missing entries, and separate empty results directory. |
| §2, static Sandbox configuration | Request 13 | MATCH | Requires exact three mappings, read-only package inputs, results-only writable mapping, and no profile/workspace/journal/broad-parent mapping. |
| §2, effective host ACL separate from .wsb | Request 13 | MATCH | Requires Effective Access on all three directories, inherited/group/owner/parent checks, all results writers, and preserves distinction from XML flags/guest behavior. |
| §2, exclusions and safe evidence handling | Common conditions; Requests 4, 8 | MATCH | Prohibits sensitive-data collection/disclosure and requires safe export, no overwrite/append, authenticated timestamp and sign-off. |
| §2, Results directory and disk formula subsection | Request 12; Request 13 | CLARIFICATION REQUIRED | Formula/components, conservative estimate, raw volume bytes, no aggregation, and empty/dedicated results are covered. Per-volume allocation remains unresolved by the protocol. |
| §3, 64-bit process and OS edition/version/build sources | Requests 3, 9 | MATCH | Requires 64-bit PowerShell and the stated OS registry/CIM sources and fields. |
| §3, total RAM source and exact threshold | Request 9 | MATCH | Uses Win32_ComputerSystem.TotalPhysicalMemory in bytes; preserves exact 8-GiB threshold. |
| §3, available RAM source/conversion/fallback | Request 9 | MATCH | Uses Win32_OperatingSystem.FreePhysicalMemory × 1024; fallback only if unavailable, AvailableMBytes × 1,048,576, pass at 4,097 MiB/4,296,015,872 bytes; conflict/lower fallback rules preserved. |
| §3, CPU rows and required Boolean handling | Request 9 | MATCH | Uses Win32_Processor; multiple rows recorded/summed; null/unavailable is INCOMPLETE, not false or pass. |
| §3, hypervisor source/value | Request 9 | MATCH | Requires Win32_ComputerSystem.HypervisorPresent=True. |
| §3, optional-feature source/state/classification | Request 9 | MATCH | Requires Containers-DisposableClientVM Enabled; disabled/payload removed is failure; missing/error is incomplete. |
| §3, executable path/test/result | Request 9 | MATCH | Preserves exact 64-bit Test-Path expression, -PathType Leaf, required True, and no launch. |
| §3, disk query source and bounds | Requests 9, 12 | CLARIFICATION REQUIRED | Requires exact-volume Win32_LogicalDisk raw byte measurements and no unrelated drives/aggregation; multi-volume allocation remains unresolved. |
| §3, elevation and collection timestamp | Request 9 | MATCH | Records elevation only as Boolean and UTC ISO 8601 plus approved time-source/synchronization status. |
| §4, pre-read staging boundary gate and stop rule | Request 5 | MATCH | Prohibits opening any handoff file before signed provenance, stable identity, effective boundary, ancestor, telemetry, and metadata checks pass. |
| §4, complete bounded inventory | Requests 5, 7 | MATCH | Requires manual bounded traversal, hidden/system entries, empty directories, path checks, no recursion/reparse following, and separate results check. |
| §4, JCS schema, encoding, scope, normalization, sorting, signature | Request 7 | MATCH | Preserves exact schema members/types, RFC 8785/JCS, UTF-8/no BOM, complete file/directory scope, NFC/path/collision rules, sort order, detached signature, and external location. |
| §4, expected manifest digest and 174-row comparison | Request 10 | MATCH | Requires independent expected digest, exact 174 rows, one-to-one path/type/length/hash comparison, and distinguishes authenticated mismatch (COMPLETE_FAIL) from missing/unverifiable (INCOMPLETE). |
| §4, same-handle file verification | Request 5; Request 10 | MATCH | Requires hash/length from the same handle with unchanged pre/post metadata and immutable interval; path-only checks are insufficient. |
| §5, exact .wsb file, mapping paths, roles, permissions, and security settings | Request 13 | MATCH | Specifies the protocol’s three exact mappings, <ReadOnly> values, all security settings, exact text-only path, and no launch. |
| §5, host Effective Access and ACL outcomes | Request 13 | MATCH | Requires separate review of all three paths, inherited/explicit entries, groups, owner, parent, package access, results writers, and no ACL changes. |
| §5, static/host evidence does not prove guest behavior | Request 13; Result states | MATCH | Explicitly preserves guest behavior and Sandbox acceptance as untested; no runtime launch. |
| §6, evidence record contents and minimization | Requests 8–11; Common conditions | MATCH | Covers case/asset/time/operator, scalar results, digest outcome, mapping/ACL results, state, signatures, reviewer, and sensitive-data exclusions. |
| §6, evidence destination, filename, no overwrite/append | Request 8 | MATCH | Requires pre-created verified destination, unique new filename, no overwrite/append, and no write to unverified destination. |
| §6, detached record digest and receipt fields | Requests 8, 11 | MATCH | Covers exact filename, case/run/host/identity reference, times, version, byte length, digest, signer, and signing time; receipt kept separate and record does not contain its own digest. |
| §6, CMS, RFC 3161 imprint/EKU/revocation | Requests 6, 8 | MATCH | Requires detached CMS/PKCS#7, exact signature-octet imprint, TSA EKU, validity/revocation at required times, and independent anchors. |
| §6, freshness, uniqueness, replay, receipt recheck, transfer validation | Request 8 | MATCH | Preserves the 24-hour windows, audit checks for issued/submitted/accepted/superseded/reused IDs/serials, receipt recheck, recomputation, and transfer validation. |
| §6, evidence-record byte-length method | Request 11 | CLARIFICATION REQUIRED | The protocol requires byte length in the signed payload and receiver recomputation, but specifies no particular measurement method. The register does not impose one. |
| §7, COMPLETE_PASS conditions and limited conclusion | Result states; Requests 1–13 | MATCH | Requires all controls/checks and independent evidence; limits any pass to isolation-setup consideration and preserves both NOT_TESTED states. |
| §7, COMPLETE_FAIL conditions | Requests 1–10, 12–13; Result states | MATCH | Preserves completed-failure outcomes for confirmed threshold, access, artifact, mapping, ACL, digest, and protected-access failures. |
| §7, INCOMPLETE conditions | Management status; Requests 1–13; Result states | MATCH | Preserves incomplete outcomes for missing, stale, ambiguous, unauthenticated, unsafe, or unverifiable evidence. |
| §8, administrator sign-off fields | Requests 8–10, 13 | MATCH | Register requires the case/asset/run, evidence/receipt, manifest/inventory, host results, mapping/ACL, exclusion, result, profile-free process, control identifiers, timestamp, and reviewer sign-off evidence. |
| Final status and historical caveat | Management status; Result states | MATCH | Retains REVISION REQUIRED, INCOMPLETE, NOT GRANTED, both NOT_TESTED states, and UNRESOLVED; no rerun or protected-data access is proposed. |

## Final change log

| Change | Related internal-review finding |
|---|---|
| Closed the Request 12 formula code fence and verified the displayed formula is exactly ceiling(1.5 × estimated_total_working_bytes). | **Finding 12 — Disk allocation:** exact formula/components and conservative fallback; preserve multi-volume allocation ambiguity. |
| Renamed Request 11 to **“Evidence-record byte-length and digest binding”** and updated comparison/change-log references; retained the statement that no specific measurement method is prescribed. | **Finding 11 — Receipt/evidence-record length:** distinguish signed length/recomputation from an unprescribed measurement method. |
| Reread the complete protocol and refreshed the comparison against §§0–8 and the final status, rather than relying on prior summaries or verification tables. | **Review-wide requirement:** direct reconciliation against the complete original protocol. |
| Added explicit identity/operator/reviewer provenance, separate host-query session constraints, exact CIM/feature/executable sources, and precise Boolean/fallback classifications. | **Finding 9 — Host support and measurements; Additional finding 1 — Identity/host/staging provenance.** |
| Added the bounded manual inventory procedure and exact .wsb text-only path; clarified that results-writer identities must come from the approved policy rather than an inferred identity equivalence. | **Finding 5 — Protected staging; Additional finding 3 — .wsb and host ACL evidence.** |
| Preserved all three exact mapping rows, every specified security setting, separate Effective Access review, and untested guest/runtime behavior. | **Additional finding 3 — .wsb and host ACL evidence; Additional finding 4 — Runtime limits.** |
| Expanded the comparison table to map each protocol gate, evidence class, measurement subsection, freshness rule, result rule, and sign-off requirement to the exact register section. | **Prior review findings 1–12 and additional mandatory controls 1–5.** |
| Preserved the evidence-record byte-length and multi-volume allocation items as **protocol clarifications**, not established requirements; retained all required management statuses and authorization limits. | **Findings 11–12; Additional findings 4–5; historical caveat/disposition findings.**
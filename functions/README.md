# Drug Manager Cloud Functions

This is a standalone TypeScript project for the trusted Drug Manager backend.
Its dependencies and build output are isolated from the Electron application's
package and TypeScript configuration.

## Runtime and dependency compatibility

The project targets Node.js 24 (`nodejs24`) for second-generation Cloud
Functions. Google's current [Cloud Run functions runtime support
table](https://docs.cloud.google.com/functions/docs/runtime-support#node.js)
lists Node.js 24 as a Run functions runtime, with deprecation scheduled for
2028-04-30 and decommission for 2028-10-31. The runtime must be rechecked before
deployment.

Pinned package versions were checked against npm package metadata:

- `firebase-functions` 7.4.0 requires Node.js `>=18`.
- `firebase-admin` 14.5.0 requires Node.js `>=22`.
- `typescript` 7.0.2 requires Node.js `>=16.20.0`.
- `@types/node` 24.19.2 describes the selected Node.js runtime types.

## Local checks

Run from this directory:

```powershell
npm ci
npm run typecheck
npm run build
```

`typecheck` and `build` do not require Firebase credentials or contact Firebase.
Generated JavaScript and source maps go to `lib/`; installed packages and build
output are ignored by this project's `.gitignore`.

Run isolated unit tests with:

```powershell
npm test
```

The authentication foundation is under `src/auth/`. It reads `users/{uid}`
through the Admin SDK for each authorization decision and never accepts caller
identity or role from callable data. User profile `uid`, `role`, and `status`
must be valid; malformed profiles fail closed. Callable error handling
preserves intentional `HttpsError` responses and maps unexpected failures to a
generic `internal` response while logging only the static operation name and
error type.

Authorization deliberately matches the current Firestore Rules:

- The Rules `isApproved()` condition checks `status == 'approved'` and does
  not additionally check role. The matching approval helper therefore does
  not impose a role restriction; an approved administrator or assistant also
  satisfies it.
- The Rules `isAdmin()` condition allows both `admin` and `assistant`. The
  administrator and assistant helper names both represent that same manager
  capability. Neither requires approval status.

These are compatibility semantics, not a new business-operation policy. Any
role-specific distinction must be designed with the separately authorized
Firestore Rules redesign.

The entry point initializes the Firebase Admin app once and still exports no
callable or business operation. Unit tests use injected profile readers and
diagnostics; they do not initialize an Admin connection or contact Firebase.
Do not add credentials, service-account files, or privileged configuration to
this project.

## Emulator authorization test

The isolated lab in `../emulator-lab/firebase.json` runs Auth, Firestore, and
Functions, bound to loopback at ports `9099`, `8080`, and `5001`. Firebase CLI
automatically starts the Gen 2 Functions support emulators for Eventarc and
Cloud Tasks, also bound to loopback at ports `9299` and `9499`. All services
use `demo-drug-manager-stage3` by default. The lab rejects `LAB_PROJECT_ID`
values that do not start with `demo-`.

Run the end-to-end authorization suite from the repository root:

```powershell
npm --prefix functions run test:emulator
```

The runner builds Functions and uses `firebase emulators:exec --only
auth,firestore,functions`, which shuts down the emulator processes started by
that test run on success or failure. Eventarc and Cloud Tasks are the only
additional processes Firebase CLI starts as mandatory Gen 2 support services.
The runner disables Application Default Credentials/metadata discovery for the
demo-only emulator run. It creates unique Auth emulator accounts
and test-only `users/{uid}` profiles, then removes them. Fixture REST calls
are hard-guarded to loopback and the demo project.

The integration suite fails rather than skips when Auth, Firestore, Functions,
Eventarc, or Cloud Tasks is unavailable or not listening at its configured
loopback port. Unexpected profile-read failures are covered by the isolated
unit test and are returned as a generic `internal` callable error; raw errors
and stack traces are not sent to clients.

For manual inspection, start the foreground lab from the repository root:

```powershell
npm run emulator:start
```

This starts only Auth, Firestore, and Functions. Press `Ctrl+C` in that same
terminal to stop the processes launched by that command. Do not run the
automatic test runner at the same time as the foreground lab; both use the
same ports.

`authorizationProbe` is a test-only callable. It is explicitly disabled unless
the Functions emulator sets `FUNCTIONS_EMULATOR=true`; it performs profile
authorization checks only, does not touch business collections, and must not
become a deployed business API.

This lab configuration is independent of the Electron build. The packaged QA
application currently has no Functions-emulator endpoint; adding one would
require a separately authorized stage and a build-time restriction. Production
must never be pointed at this local Functions endpoint.

## Stage 34D emulator contract and test coverage

See [docs/stage34d-test-contract.md](./docs/stage34d-test-contract.md) for the
concise Stage 34D test contract used by the local emulator suite. The document
summarizes the confirmed implementation behavior, the temporary assumptions
approved for this stage, and the original Stage 33L/33N requirements that remain
unavailable in the repository.

## Deployment

No Functions deployment configuration or deploy script is included at this
foundation stage. Do not deploy from the root Firebase configuration: it
currently points Firestore rules at the emulator lab. Production project,
billing, APIs, IAM, region, and deployment approval must be verified separately
before adding a Functions-specific deployment configuration.

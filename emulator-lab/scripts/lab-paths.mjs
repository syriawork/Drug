/**
 * Shared paths and constants for the isolated emulator laboratory.
 *
 * The laboratory is deliberately self-contained:
 *  - its own firebase.json (only Auth + Firestore, UI disabled)
 *  - its own copy of the authoritative Firestore Rules
 *  - its own private tool installation (emulator-lab/tools/node_modules)
 *  - its own "demo-" project id, so it can never resolve to a real project
 *
 * Nothing here is part of the drug-manager application dependency graph.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** .../drug-manager/emulator-lab */
export const labRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** .../drug-manager */
export const projectRoot = dirname(labRoot);

export const labFirebaseConfigPath = join(labRoot, 'firebase.json');

export const labRulesPath = join(labRoot, 'firestore.rules');

export const firebaseCliPath = join(
  labRoot,
  'tools',
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js',
);

/** Demo project id: Firebase emulators accept "demo-*" ids without any login. */
export const LAB_PROJECT_ID = process.env['LAB_PROJECT_ID'] ?? 'demo-drug-manager-stage3';

export const AUTH_EMULATOR_HOST = `127.0.0.1:${process.env['LAB_AUTH_PORT'] ?? '9099'}`;

export const FIRESTORE_EMULATOR_HOST = `127.0.0.1:${process.env['LAB_FIRESTORE_PORT'] ?? '8080'}`;

/** The compiled integration test that must be executed against the emulators. */
export const integrationTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'firestore-rules-emulator.test.js',
);

/**
 * The Stage 5B repository suite. It shares ONE emulator with the Stage 3 suite
 * but flushes its own documents, so the two must not run CONCURRENTLY in the
 * same process: one would delete the other's fixtures mid-run.
 */
export const repositoriesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'repository-emulator.test.js',
);

/**
 * The Stage 6 order-processing suite. Same isolation rule as above: it seeds and
 * flushes its own documents, so it runs in its own `node --test` process.
 */
export const orderProcessingTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'order-processing-emulator.test.js',
);

/**
 * The Stage 9 user-management suite. Same isolation rule as above: it seeds and
 * flushes its own `users` documents, so it runs in its own `node --test` process.
 */
export const usersRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'users-rules-emulator.test.js',
);

/**
 * The Stage 10 medicine-management suite. Same isolation rule as above: it seeds
 * and flushes its own `medicines` documents, so it runs in its own `node --test`
 * process.
 */
export const medicinesRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'medicines-rules-emulator.test.js',
);

/**
 * The Stage 11 order-requests suite path.
 *
 * Added beside the Stage 9 and Stage 10 entries for the same reason: the suite
 * seeds and flushes its own documents, so it runs in its own `node --test`
 * process against its own emulator instance.
 */
export const orderRequestsRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'order-requests-rules-emulator.test.js',
);

/**
 * The Stage 12 orders-history suite path.
 *
 * Added beside the Stage 9, 10 and 11 entries for the same reason: the suite seeds
 * and flushes its own documents, so it runs in its own `node --test` process
 * against its own emulator instance.
 */
export const ordersHistoryRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'orders-history-rules-emulator.test.js',
);

/**
 * The Stage 13 system-settings suite path.
 *
 * Added beside the Stage 9, 10, 11 and 12 entries for the same reason: the suite
 * seeds and flushes its own documents, so it runs in its own `node --test` process
 * against its own emulator instance.
 */
export const settingsRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'settings-rules-emulator.test.js',
);

/**
 * The Stage 14 stock-movement audit suite path.
 *
 * Added beside the Stage 9-13 entries for the same reason: the suite seeds and
 * flushes its own documents, so it runs in its own `node --test` process against
 * its own emulator instance.
 */
export const stockLogsRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'stock-logs-rules-emulator.test.js',
);

/** Stage 15's real inbound-stock transaction and authorization suite. */
export const inboundStockRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'inbound-stock-rules-emulator.test.js',
);

/** Stage 16's employee order-request submission and Rules suite. */
export const orderRequestSubmissionRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'order-request-submission-rules-emulator.test.js',
);

/** Stage 17's employee owner-scoped order-history suite. */
export const personalOrderHistoryRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'personal-order-history-rules-emulator.test.js',
);

/** Stage 18's employee owner-scoped request-status read suite. */
export const employeeOrderRequestStatusRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'employee-order-request-status-rules-emulator.test.js',
);

/** Stage 19's selected-order stock movement detail suite. */
export const orderStockMovementsRulesTestFile = join(
  projectRoot,
  'dist',
  'tests',
  'repositories',
  'order-stock-movements-rules-emulator.test.js',
);

export const authoritativeRulesPath = process.env['DRUG_MANAGER_ANDROID_RULES_PATH']
  ?? join('E:', 'programs and applications', 'mobile', 'drug', 'firestore.rules');

export function assertLabIsInstalled() {
  if (!existsSync(firebaseCliPath)) {
    throw new Error(
      `the isolated Firebase CLI is missing: ${firebaseCliPath}\nRun: npm run emulator:setup`,
    );
  }
}

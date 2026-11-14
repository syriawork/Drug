'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { app } = require('electron');

if (process.env.STAGE36A70R_QUALIFY === '1' && process.type === 'browser') {
  const outputPath = process.env.STAGE36A70R_OUTPUT;
  const userDataPath = process.env.STAGE36A70R_USER_DATA;

  if (userDataPath && !app.isReady()) {
    app.setPath('userData', userDataPath);
  }

  app.whenReady().then(async () => {
    const results = [];
    const observations = {};
    let sqliteModule;

    function test(id, run) {
      try {
        const detail = run();
        results.push({ id, status: 'PASS', detail: detail === undefined ? null : detail });
      } catch (error) {
        results.push({
          id,
          status: 'FAIL',
          error: {
            name: error instanceof Error ? error.name : typeof error,
            code: error && typeof error === 'object' && 'code' in error ? error.code : null,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    function errorDetails(error) {
      return {
        name: error instanceof Error ? error.name : typeof error,
        code: error && typeof error === 'object' && 'code' in error ? error.code : null,
        message: error instanceof Error ? error.message : String(error),
      };
    }

    function authorizerConstants() {
      const source = sqliteModule && sqliteModule.constants ? sqliteModule.constants : {};
      return {
        ok: typeof source.SQLITE_OK === 'number' ? source.SQLITE_OK : 0,
        deny: typeof source.SQLITE_DENY === 'number' ? source.SQLITE_DENY : 1,
        insert: typeof source.SQLITE_INSERT === 'number' ? source.SQLITE_INSERT : 18,
        update: typeof source.SQLITE_UPDATE === 'number' ? source.SQLITE_UPDATE : 23,
        delete: typeof source.SQLITE_DELETE === 'number' ? source.SQLITE_DELETE : 9,
        pragma: typeof source.SQLITE_PRAGMA === 'number' ? source.SQLITE_PRAGMA : 19,
        transaction: typeof source.SQLITE_TRANSACTION === 'number' ? source.SQLITE_TRANSACTION : 22,
        savepoint: typeof source.SQLITE_SAVEPOINT === 'number' ? source.SQLITE_SAVEPOINT : 32,
        attach: typeof source.SQLITE_ATTACH === 'number' ? source.SQLITE_ATTACH : 24,
        detach: typeof source.SQLITE_DETACH === 'number' ? source.SQLITE_DETACH : 25,
        createTable: typeof source.SQLITE_CREATE_TABLE === 'number' ? source.SQLITE_CREATE_TABLE : 2,
        dropTable: typeof source.SQLITE_DROP_TABLE === 'number' ? source.SQLITE_DROP_TABLE : 11,
        alterTable: typeof source.SQLITE_ALTER_TABLE === 'number' ? source.SQLITE_ALTER_TABLE : 26,
      };
    }

    function serializeAuthorizerCall(call) {
      return {
        actionCode: call[0],
        argument1: call[1],
        argument2: call[2],
        databaseName: call[3],
        triggerOrView: call[4],
      };
    }

    const runtime = {
      electron: process.versions.electron || null,
      node: process.versions.node || null,
      sqliteVersionInNode: process.versions.sqlite || null,
      processType: process.type || null,
      execPath: process.execPath,
      isolatedUserDataPath: app.getPath('userData'),
      requestedUserDataPath: userDataPath || null,
    };

    test('R-01 exact Electron runtime metadata', () => {
      assert.equal(runtime.processType, 'browser');
      assert.ok(runtime.electron, 'Electron version is unavailable');
      assert.ok(runtime.node, 'Node.js version is unavailable');
      if (userDataPath) {
        assert.equal(
          path.resolve(runtime.isolatedUserDataPath),
          path.resolve(userDataPath),
          'Electron userData did not use the isolated test directory',
        );
      }
      return runtime;
    });

    try {
      sqliteModule = require('node:sqlite');
      observations.sqliteModuleExports = Object.keys(sqliteModule).sort();
      observations.sqliteConstantExports = sqliteModule.constants
        ? Object.keys(sqliteModule.constants).sort()
        : [];
    } catch (error) {
      observations.sqliteImportError = errorDetails(error);
    }

    test('R-02 node:sqlite import and DatabaseSync instantiation', () => {
      assert.ok(sqliteModule, 'require("node:sqlite") failed');
      assert.equal(typeof sqliteModule.DatabaseSync, 'function');
      const db = new sqliteModule.DatabaseSync(':memory:');
      try {
        assert.equal(db.prepare('SELECT 1 AS value').get().value, 1);
      } finally {
        db.close();
      }
      return {
        databaseSyncType: typeof sqliteModule.DatabaseSync,
        instanceCreated: true,
        queryResult: 1,
        databaseSyncMethods: Object.getOwnPropertyNames(sqliteModule.DatabaseSync.prototype).sort(),
      };
    });

    test('R-03 actual SQLite engine version', () => {
      assert.ok(sqliteModule && sqliteModule.DatabaseSync, 'DatabaseSync is unavailable');
      const db = new sqliteModule.DatabaseSync(':memory:');
      try {
        const queryVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
        assert.equal(typeof queryVersion, 'string');
        return {
          processVersion: runtime.sqliteVersionInNode,
          queryVersion,
          compileOptions: db.prepare('PRAGMA compile_options').all().map((row) => row.compile_options),
        };
      } finally {
        db.close();
      }
    });

    test('R-04 DatabaseSync authorizer API exposure', () => {
      assert.ok(sqliteModule && sqliteModule.DatabaseSync, 'DatabaseSync is unavailable');
      const available = typeof sqliteModule.DatabaseSync.prototype.setAuthorizer === 'function';
      assert.equal(available, true, 'DatabaseSync.prototype.setAuthorizer is absent');
      return {
        setAuthorizerType: typeof sqliteModule.DatabaseSync.prototype.setAuthorizer,
      };
    });

    test('R-05 authorizer deny, replace, remove, callback actions and prepared statement behavior', () => {
      assert.ok(sqliteModule && sqliteModule.DatabaseSync, 'DatabaseSync is unavailable');
      assert.equal(typeof sqliteModule.DatabaseSync.prototype.setAuthorizer, 'function');

      const constants = authorizerConstants();
      const db = new sqliteModule.DatabaseSync(':memory:');
      const deniedCalls = [];
      const replacementCalls = [];
      let preparedBeforeAuthorizer;

      try {
        db.exec('CREATE TABLE target (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
        db.exec("INSERT INTO target (id, value) VALUES (1, 'seed')");
        db.exec("ATTACH DATABASE ':memory:' AS extra");
        preparedBeforeAuthorizer = db.prepare('INSERT INTO target (id, value) VALUES (?, ?)');

        const deniedCodes = new Set([
          constants.insert,
          constants.update,
          constants.delete,
          constants.transaction,
          constants.savepoint,
          constants.attach,
          constants.detach,
          constants.createTable,
          constants.dropTable,
          constants.alterTable,
        ]);
        const denyWritesAndControls = (...args) => {
          deniedCalls.push(args);
          const pragmaWrite = args[0] === constants.pragma && args[2] !== null && args[2] !== undefined;
          return deniedCodes.has(args[0]) || pragmaWrite ? constants.deny : constants.ok;
        };
        db.setAuthorizer(denyWritesAndControls);

        const deniedOperations = [];
        for (const [id, sql] of [
          ['insert', "INSERT INTO target (id, value) VALUES (2, 'blocked')"],
          ['update', "UPDATE target SET value = 'blocked' WHERE id = 1"],
          ['delete', 'DELETE FROM target WHERE id = 1'],
        ]) {
          try {
            db.exec(sql);
            deniedOperations.push({ id, result: 'ALLOWED' });
          } catch (error) {
            deniedOperations.push({ id, result: 'DENIED', error: errorDetails(error) });
          }
        }

        let preparedBeforeResult;
        try {
          preparedBeforeAuthorizer.run(3, 'prepared-before-authorizer');
          preparedBeforeResult = 'ALLOWED';
        } catch (error) {
          preparedBeforeResult = { result: 'DENIED', error: errorDetails(error) };
        }

        let prepareAfterResult;
        try {
          db.prepare("INSERT INTO target (id, value) VALUES (4, 'prepared-after-authorizer')");
          prepareAfterResult = 'PREPARE_ALLOWED';
        } catch (error) {
          prepareAfterResult = { result: 'DENIED_DURING_PREPARE', error: errorDetails(error) };
        }

        const controlAttempts = [];
        for (const [id, sql] of [
          ['pragma-write', 'PRAGMA foreign_keys = OFF'],
          ['begin', 'BEGIN'],
          ['commit', 'COMMIT'],
          ['rollback', 'ROLLBACK'],
          ['savepoint', 'SAVEPOINT s1'],
          ['release', 'RELEASE SAVEPOINT s1'],
          ['attach', "ATTACH DATABASE ':memory:' AS extra"],
          ['detach', 'DETACH DATABASE extra'],
        ]) {
          try {
            db.exec(sql);
            controlAttempts.push({ id, result: 'ALLOWED' });
          } catch (error) {
            controlAttempts.push({ id, result: 'DENIED', error: errorDetails(error) });
          }
        }
        const foreignKeysAfterAttempt = db.prepare('PRAGMA foreign_keys').get().foreign_keys;

        db.setAuthorizer((...args) => {
          replacementCalls.push(args);
          return constants.ok;
        });
        let replacementResult;
        try {
          db.exec("INSERT INTO target (id, value) VALUES (5, 'replacement-authorizer')");
          replacementResult = 'ALLOWED';
        } catch (error) {
          replacementResult = { result: 'DENIED', error: errorDetails(error) };
        }

        let removalResult;
        try {
          db.setAuthorizer(null);
          db.exec("INSERT INTO target (id, value) VALUES (6, 'authorizer-removed')");
          removalResult = 'ALLOWED';
        } catch (error) {
          removalResult = { result: 'UNSUPPORTED_OR_DENIED', error: errorDetails(error) };
        }

        const schemaCalls = [];
        const schemaDeniedCodes = new Set([
          constants.createTable,
          constants.dropTable,
          constants.alterTable,
        ]);
        db.setAuthorizer((...args) => {
          schemaCalls.push(args);
          return schemaDeniedCodes.has(args[0]) ? constants.deny : constants.ok;
        });
        const schemaAttempts = [];
        for (const [id, sql] of [
          ['create-table', 'CREATE TABLE denied_schema (id INTEGER)'],
          ['drop-table', 'DROP TABLE target'],
          ['alter-table', 'ALTER TABLE target RENAME TO target_renamed'],
        ]) {
          try {
            db.exec(sql);
            schemaAttempts.push({ id, result: 'ALLOWED' });
          } catch (error) {
            schemaAttempts.push({ id, result: 'DENIED', error: errorDetails(error) });
          }
        }

        const rows = db.prepare('SELECT id, value FROM target ORDER BY id').all();
        const observedCalls = deniedCalls.map(serializeAuthorizerCall);
        const schemaActionCalls = schemaCalls.map(serializeAuthorizerCall);
        const expectedDenied = deniedOperations.every((operation) => operation.result === 'DENIED');
        const requiredActionCalls = new Set(deniedCalls.map((call) => call[0]));
        observations.authorizer = {
          namedConstantsAvailable: Object.keys(sqliteModule.constants || {}).filter((key) => key.startsWith('SQLITE_')),
          constantsUsed: constants,
          deniedOperations,
          preparedBeforeAuthorizer: preparedBeforeResult,
          prepareAfterAuthorizer: prepareAfterResult,
          controlAttempts,
          foreignKeysAfterAttempt,
          replacementResult,
          removalResult,
          schemaAttempts,
          schemaActionCalls,
          deniedCallbackCalls: observedCalls,
          replacementCallbackCalls: replacementCalls.map(serializeAuthorizerCall),
          finalRows: rows,
        };

        assert.equal(expectedDenied, true, 'one or more DML statements were not denied');
        for (const code of [constants.insert, constants.update, constants.delete]) {
          assert.ok(requiredActionCalls.has(code), `authorizer did not observe action code ${code}`);
        }
        assert.ok(
          controlAttempts.every((attempt) => attempt.result === 'DENIED'),
          'one or more protected control operations were not denied',
        );
        assert.ok(
          schemaAttempts.every((attempt) => attempt.result === 'DENIED'),
          'one or more protected schema operations were not denied',
        );
        const observedSchemaCodes = new Set(schemaCalls.map((call) => call[0]));
        for (const code of schemaDeniedCodes) {
          assert.ok(observedSchemaCodes.has(code), `schema authorizer action code ${code} was not observed`);
        }
        assert.equal(prepareAfterResult.result, 'DENIED_DURING_PREPARE');
        assert.equal(replacementResult, 'ALLOWED', 'replacement authorizer did not allow the write');
        assert.equal(removalResult, 'ALLOWED', 'setAuthorizer(null) did not remove the authorizer');
        assert.ok(rows.some((row) => row.id === 5), 'replacement authorizer insert is absent');
        assert.ok(rows.some((row) => row.id === 6), 'removed authorizer insert is absent');
        return observations.authorizer;
      } finally {
        db.close();
      }
    });

    test('R-06 independent connections have independent foreign-key and authorizer state', () => {
      assert.ok(sqliteModule && sqliteModule.DatabaseSync, 'DatabaseSync is unavailable');
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stage36a70r-'));
      const databasePath = path.join(tempRoot, 'isolation.sqlite');
      let connectionA;
      let connectionB;

      try {
        const initializer = new sqliteModule.DatabaseSync(databasePath);
        initializer.exec(`
          PRAGMA foreign_keys = ON;
          CREATE TABLE parents (id TEXT PRIMARY KEY);
          CREATE TABLE children (
            id TEXT PRIMARY KEY,
            parent_id TEXT NOT NULL REFERENCES parents(id)
          );
          CREATE TABLE command_commits (
            commit_id TEXT PRIMARY KEY,
            state TEXT NOT NULL
          );
          CREATE TABLE orders (
            order_id TEXT PRIMARY KEY,
            commit_id TEXT NOT NULL REFERENCES command_commits(commit_id),
            current_revision INTEGER NOT NULL CHECK (current_revision >= 0)
          );
          CREATE TABLE order_revisions (
            order_id TEXT NOT NULL REFERENCES orders(order_id),
            revision INTEGER NOT NULL,
            status TEXT NOT NULL,
            PRIMARY KEY (order_id, revision)
          );
        `);
        initializer.close();

        connectionA = new sqliteModule.DatabaseSync(databasePath);
        connectionB = new sqliteModule.DatabaseSync(databasePath);
        connectionA.exec('PRAGMA foreign_keys = ON');
        connectionB.exec('PRAGMA foreign_keys = OFF');

        const foreignKeysA = connectionA.prepare('PRAGMA foreign_keys').get().foreign_keys;
        const foreignKeysB = connectionB.prepare('PRAGMA foreign_keys').get().foreign_keys;
        const deniedByA = [];
        connectionA.setAuthorizer((actionCode, arg1, arg2, databaseName, triggerOrView) => {
          deniedByA.push({ actionCode, arg1, arg2, databaseName, triggerOrView });
          return actionCode === 18 ? 1 : 0;
        });

        let connectionAWrite;
        try {
          connectionA.exec("INSERT INTO parents (id) VALUES ('a-blocked')");
          connectionAWrite = 'ALLOWED';
        } catch (error) {
          connectionAWrite = { result: 'DENIED', error: errorDetails(error) };
        }

        let foreignKeyOnWrite;
        connectionA.setAuthorizer(null);
        try {
          connectionA.exec("INSERT INTO children (id, parent_id) VALUES ('a-invalid', 'missing-parent')");
          foreignKeyOnWrite = 'COMMITTED';
        } catch (error) {
          foreignKeyOnWrite = { result: 'DENIED', error: errorDetails(error) };
        }

        connectionB.exec(`
          BEGIN;
          INSERT INTO parents (id) VALUES ('b-parent');
          INSERT INTO children (id, parent_id) VALUES ('b-invalid', 'missing-parent');
          COMMIT;
        `);

        connectionB.exec(`
          BEGIN;
          INSERT INTO command_commits (commit_id, state) VALUES ('commit-incomplete', 'committed');
          INSERT INTO orders (order_id, commit_id, current_revision)
            VALUES ('order-incomplete', 'missing-commit', 0);
          COMMIT;
        `);

        const parentRows = connectionB.prepare('SELECT id FROM parents ORDER BY id').all();
        const invalidChildRows = connectionB.prepare('SELECT id, parent_id FROM children ORDER BY id').all();
        const incompleteOrder = connectionB.prepare(`
          SELECT o.order_id, o.commit_id, o.current_revision,
            (SELECT COUNT(*) FROM order_revisions r WHERE r.order_id = o.order_id) AS revision_count,
            (SELECT COUNT(*) FROM command_commits c WHERE c.commit_id = o.commit_id) AS commit_count
          FROM orders o WHERE o.order_id = 'order-incomplete'
        `).get();
        const foreignKeyViolations = connectionB.prepare('PRAGMA foreign_key_check').all();

        assert.equal(foreignKeysA, 1, 'connection A did not enable foreign keys');
        assert.equal(foreignKeysB, 0, 'connection B did not disable foreign keys');
        assert.notEqual(connectionAWrite, 'ALLOWED', 'connection A authorizer did not deny its write');
        assert.notEqual(foreignKeyOnWrite, 'COMMITTED', 'connection A committed an invalid FK child');
        assert.ok(invalidChildRows.some((row) => row.id === 'b-invalid'), 'connection B did not commit invalid FK child');
        assert.equal(incompleteOrder.revision_count, 0, 'incomplete order unexpectedly has a revision');
        assert.equal(incompleteOrder.commit_count, 0, 'incomplete order unexpectedly has its referenced commit');

        observations.connectionIsolation = {
          sameFile: true,
          twoIndependentConnections: true,
          connectionAForeignKeys: foreignKeysA,
          connectionBForeignKeys: foreignKeysB,
          authorizerOnAInsert: connectionAWrite,
          foreignKeyViolationOnA: foreignKeyOnWrite,
          committedRowsOnB: {
            parents: parentRows,
            children: invalidChildRows,
            incompleteOrder,
          },
          foreignKeyCheckOnB: foreignKeyViolations,
          authorizerCallsOnA: deniedByA,
        };
        return observations.connectionIsolation;
      } finally {
        if (connectionA) {
          try { connectionA.close(); } catch {}
        }
        if (connectionB) {
          try { connectionB.close(); } catch {}
        }
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    });

    const output = {
      qualification: 'Stage 36A70R Electron SQLite runtime qualification',
      runtime,
      status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL',
      results,
      observations,
    };

    try {
      if (!outputPath) {
        throw new Error('STAGE36A70R_OUTPUT was not set');
      }
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    } catch (error) {
      console.error(error);
      app.exit(1);
      return;
    }

    app.exit(output.status === 'PASS' ? 0 : 1);
  }).catch((error) => {
    const output = {
      qualification: 'Stage 36A70R Electron SQLite runtime qualification',
      status: 'FAIL',
      fatalError: {
        name: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message : String(error),
      },
    };
    try {
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
      }
    } finally {
      app.exit(1);
    }
  });
}

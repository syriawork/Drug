import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FirebaseConfigError, resolveFirebaseAuthConfig, validateFirebaseAuthConfig } from "../../electron/config/firebase-config";
import { resolveAndValidateFirebaseConfig, createFirebaseClients } from "../../electron/config/firebase-bootstrap";
import { resolveFirestoreRestConfig, isFirestoreConfigured } from "../../electron/config/firestore-config";

describe("Firebase Auth config validation", () => {
  it("rejects missing API key in production mode", () => {
    assert.throws(
      () => validateFirebaseAuthConfig(resolveFirebaseAuthConfig("production", {})),
      FirebaseConfigError,
    );
  });

  it("rejects missing project ID in production mode", () => {
    assert.throws(
      () => validateFirebaseAuthConfig(resolveFirebaseAuthConfig("production", { FIREBASE_API_KEY: "test-key" })),
      FirebaseConfigError,
    );
  });

  it("accepts valid production config", () => {
    const config = resolveFirebaseAuthConfig("production", {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
    });
    assert.doesNotThrow(() => validateFirebaseAuthConfig(config));
  });

  it("accepts emulator config without API key or project ID", () => {
    const config = resolveFirebaseAuthConfig("development", {
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    });
    assert.doesNotThrow(() => validateFirebaseAuthConfig(config));
  });

  it("rejects emulator host in production mode", () => {
    assert.throws(
      () => resolveFirebaseAuthConfig("production", {
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        FIREBASE_API_KEY: "test-key",
        FIREBASE_PROJECT_ID: "test-project",
      }),
      FirebaseConfigError,
    );
  });
});

describe("Firestore config validation", () => {
  it("reports not configured when project ID is empty", () => {
    const config = resolveFirestoreRestConfig({});
    assert.equal(isFirestoreConfigured(config), false);
  });

  it("reports configured when project ID is set", () => {
    const config = resolveFirestoreRestConfig({ FIREBASE_PROJECT_ID: "test-project" });
    assert.equal(isFirestoreConfigured(config), true);
  });

  it("accepts emulator config without project ID", () => {
    const config = resolveFirestoreRestConfig({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    assert.equal(isFirestoreConfigured(config), true);
  });
});

describe("Environment consistency", () => {
  it("both emulators enabled is consistent", () => {
    const authConfig = resolveFirebaseAuthConfig("development", {
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    });
    const firestoreConfig = resolveFirestoreRestConfig({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    const authUsesEmulator = authConfig.emulatorHost !== undefined;
    const firestoreUsesEmulator = firestoreConfig.emulatorHost !== undefined || firestoreConfig.baseUrl !== undefined;
    assert.equal(authUsesEmulator, true);
    assert.equal(firestoreUsesEmulator, true);
    assert.equal(authUsesEmulator, firestoreUsesEmulator);
  });

  it("auth emulator without firestore emulator is inconsistent", () => {
    const authConfig = resolveFirebaseAuthConfig("development", {
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    });
    const firestoreConfig = resolveFirestoreRestConfig({});
    const authUsesEmulator = authConfig.emulatorHost !== undefined;
    const firestoreUsesEmulator = firestoreConfig.emulatorHost !== undefined || firestoreConfig.baseUrl !== undefined;
    assert.equal(authUsesEmulator, true);
    assert.equal(firestoreUsesEmulator, false);
    assert.notEqual(authUsesEmulator, firestoreUsesEmulator);
  });

  it("firestore emulator without auth emulator is inconsistent", () => {
    const authConfig = resolveFirebaseAuthConfig("production", {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
    });
    const firestoreConfig = resolveFirestoreRestConfig({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    const authUsesEmulator = authConfig.emulatorHost !== undefined;
    const firestoreUsesEmulator = firestoreConfig.emulatorHost !== undefined || firestoreConfig.baseUrl !== undefined;
    assert.equal(authUsesEmulator, false);
    assert.equal(firestoreUsesEmulator, true);
    assert.notEqual(authUsesEmulator, firestoreUsesEmulator);
  });

  it("both production targets configured is consistent", () => {
    const authConfig = resolveFirebaseAuthConfig("production", {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
    });
    const firestoreConfig = resolveFirestoreRestConfig({
      FIREBASE_PROJECT_ID: "test-project",
    });
    const authUsesEmulator = authConfig.emulatorHost !== undefined;
    const firestoreUsesEmulator = firestoreConfig.emulatorHost !== undefined || firestoreConfig.baseUrl !== undefined;
    assert.equal(authUsesEmulator, false);
    assert.equal(firestoreUsesEmulator, false);
    assert.equal(authUsesEmulator, firestoreUsesEmulator);
  });

  it("existing valid emulator configuration", () => {
    const authConfig = resolveFirebaseAuthConfig("development", {
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    });
    const firestoreConfig = resolveFirestoreRestConfig({
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    assert.doesNotThrow(() => validateFirebaseAuthConfig(authConfig));
    assert.equal(isFirestoreConfigured(firestoreConfig), true);
  });

  it("existing valid production configuration", () => {
    const authConfig = resolveFirebaseAuthConfig("production", {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
    });
    const firestoreConfig = resolveFirestoreRestConfig({
      FIREBASE_PROJECT_ID: "test-project",
    });
    assert.doesNotThrow(() => validateFirebaseAuthConfig(authConfig));
    assert.equal(isFirestoreConfigured(firestoreConfig), true);
  });
});


describe("Firebase bootstrap (resolveAndValidateFirebaseConfig)", () => {
  it("both valid local Emulators accepted", () => {
    const result = resolveAndValidateFirebaseConfig(true, {
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    assert.ok(result.firebaseAuthConfig.emulatorHost !== undefined);
    assert.ok(result.firestoreConfig.emulatorHost !== undefined);
  });

  it("both valid production targets accepted", () => {
    const result = resolveAndValidateFirebaseConfig(true, {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
    });
    assert.equal(result.firebaseAuthConfig.emulatorHost, undefined);
    assert.equal(result.firestoreConfig.emulatorHost, undefined);
  });

  it("production Auth + Firestore Emulator rejected", () => {
    assert.throws(
      () => resolveAndValidateFirebaseConfig(true, {
        FIREBASE_API_KEY: "test-key",
        FIREBASE_PROJECT_ID: "test-project",
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
    );
  });

  it("auth Emulator + remote Firestore rejected", () => {
    assert.throws(
      () => resolveAndValidateFirebaseConfig(true, {
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        FIREBASE_PROJECT_ID: "test-project",
        FIRESTORE_ALLOW_REMOTE_TARGET: "true",
      }),
    );
  });

  it("auth Emulator + remote Firestore with opt-in rejected", () => {
    assert.throws(
      () => resolveAndValidateFirebaseConfig(true, {
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        FIREBASE_PROJECT_ID: "test-project",
        FIRESTORE_BASE_URL: "https://firestore.googleapis.com/v1",
        FIRESTORE_ALLOW_REMOTE_TARGET: "true",
      }),
    );
  });

  it("production Auth + custom remote Firestore follows opt-in policy", () => {
    const result = resolveAndValidateFirebaseConfig(true, {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
      FIRESTORE_BASE_URL: "https://firestore.googleapis.com/v1",
      FIRESTORE_ALLOW_REMOTE_TARGET: "true",
    });
    assert.equal(result.firebaseAuthConfig.emulatorHost, undefined);
  });

  it("invalid loopback endpoint rejected", () => {
    assert.throws(
      () => resolveAndValidateFirebaseConfig(true, {
        FIREBASE_AUTH_EMULATOR_HOST: "evil.com:9099",
      }),
    );
  });

  it("matching project IDs accepted", () => {
    const result = resolveAndValidateFirebaseConfig(true, {
      FIREBASE_API_KEY: "test-key",
      FIREBASE_PROJECT_ID: "test-project",
    });
    assert.equal(result.firebaseAuthConfig.projectId, "test-project");
    assert.equal(result.firestoreConfig.projectId, "test-project");
  });

  it("missing required production project ID rejected", () => {
    assert.throws(
      () => resolveAndValidateFirebaseConfig(true, {
        FIREBASE_API_KEY: "test-key",
      }),
    );
  });

  it("invalid configuration prevents Firebase client construction", () => {
    assert.throws(
      () => resolveAndValidateFirebaseConfig(true, {}),
    );
  });
});


describe("Client construction prevention", () => {
  it("invalid Auth config prevents both clients from being constructed", () => {
    let authCalled = false;
    let firestoreCalled = false;
    assert.throws(() => {
      createFirebaseClients(
        true,
        {},
        () => { authCalled = true; return {}; },
        () => { firestoreCalled = true; return {}; },
      );
    });
    assert.equal(authCalled, false, "auth factory must not be called");
    assert.equal(firestoreCalled, false, "firestore factory must not be called");
  });

  it("environment mismatch prevents both clients from being constructed", () => {
    let authCalled = false;
    let firestoreCalled = false;
    assert.throws(() => {
      createFirebaseClients(
        false,
        {
          FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
        },
        () => { authCalled = true; return {}; },
        () => { firestoreCalled = true; return {}; },
      );
    });
    assert.equal(authCalled, false, "auth factory must not be called");
    assert.equal(firestoreCalled, false, "firestore factory must not be called");
  });
});

describe("Firestore network prevention", () => {
  it("incomplete config prevents fetchImpl from being called", async () => {
    const { FirestoreRestClient } = await import("../../electron/services/firestore-rest");
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return new Response("{}"); };
    const client = new FirestoreRestClient({
      config: { projectId: "", databaseId: "(default)", requestTimeoutMs: 15000 },
      fetchImpl: mockFetch,
      getAccessToken: async () => "token",
    });
    try {
      await client.getDocument("test/doc");
    } catch (e) {
      // Expected to throw
    }
    assert.equal(fetchCalled, false, "fetchImpl must not be called with incomplete config");
  });

  it("remote target without opt-in prevents fetchImpl from being called", async () => {
    const { FirestoreRestClient } = await import("../../electron/services/firestore-rest");
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return new Response("{}"); };
    const client = new FirestoreRestClient({
      config: { projectId: "test-project", databaseId: "(default)", requestTimeoutMs: 15000 },
      fetchImpl: mockFetch,
      getAccessToken: async () => "token",
      allowRemoteTarget: false,
    });
    try {
      await client.getDocument("test/doc");
    } catch (e) {
      // Expected to throw
    }
    assert.equal(fetchCalled, false, "fetchImpl must not be called without opt-in for remote target");
  });

  it("invalid Emulator endpoint prevents fetchImpl from being called", async () => {
    const { FirestoreRestClient } = await import("../../electron/services/firestore-rest");
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return new Response("{}"); };
    const client = new FirestoreRestClient({
      config: { projectId: "test-project", databaseId: "(default)", emulatorHost: "evil.com:8080", requestTimeoutMs: 15000 },
      fetchImpl: mockFetch,
      getAccessToken: async () => "token",
    });
    try {
      await client.getDocument("test/doc");
    } catch (e) {
      // Expected to throw
    }
    assert.equal(fetchCalled, false, "fetchImpl must not be called with invalid Emulator endpoint");
  });

  it("valid local emulator target reaches fetchImpl", async () => {
    const { FirestoreRestClient } = await import("../../electron/services/firestore-rest");
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return new Response(JSON.stringify({ fields: {} })); };
    const client = new FirestoreRestClient({
      config: { projectId: "test-project", databaseId: "(default)", emulatorHost: "127.0.0.1:8080", requestTimeoutMs: 15000 },
      fetchImpl: mockFetch,
      getAccessToken: async () => "token",
    });
    try {
      await client.getDocument("test/doc");
    } catch (e) {
      // May throw due to response parsing, but fetch should have been called
    }
    assert.equal(fetchCalled, true, "fetchImpl must be called for valid local emulator target");
  });

  it("valid remote target with opt-in reaches fetchImpl", async () => {
    const { FirestoreRestClient } = await import("../../electron/services/firestore-rest");
    let fetchCalled = false;
    const mockFetch = async () => { fetchCalled = true; return new Response(JSON.stringify({ fields: {} })); };
    const client = new FirestoreRestClient({
      config: { projectId: "test-project", databaseId: "(default)", requestTimeoutMs: 15000 },
      fetchImpl: mockFetch,
      getAccessToken: async () => "token",
      allowRemoteTarget: true,
    });
    try {
      await client.getDocument("test/doc");
    } catch (e) {
      // May throw due to response parsing, but fetch should have been called
    }
    assert.equal(fetchCalled, true, "fetchImpl must be called for valid remote target with opt-in");
  });
});


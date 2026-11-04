/**
 * Build-time capability flags for the packaged application.
 *
 * This file is the production default. The dedicated QA pipeline compiles a
 * generated alternative and installs that compiled module in the QA output.
 *
 * ALLOW_FIREBASE_EMULATORS controls whether the packaged application may connect
 * to local Firebase Auth and Firestore Emulators. It is NEVER enabled by a
 * runtime environment variable - it is baked into the application at compile
 * time by the QA packaging pipeline.
 *
 * Production build: ALLOW_FIREBASE_EMULATORS = false
 * QA build:         ALLOW_FIREBASE_EMULATORS = true
 *
 * The QA build remains fully packaged:
 *   app.isPackaged === true
 *   isDevelopment  === false
 *   ALLOW_FIREBASE_EMULATORS === true
 */
export const ALLOW_FIREBASE_EMULATORS = false;

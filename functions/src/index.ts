import { getApps, initializeApp } from 'firebase-admin/app';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { createAuthorizationService } from './auth/authorization';
import { createAdminUserProfileReader } from './auth/user-profile';
import { withSafeCallableErrors } from './callable/error-handling';

if (getApps().length === 0) {
  initializeApp();
}

const authorization = createAuthorizationService({
  profiles: createAdminUserProfileReader(),
});

type AuthorizationCapability = 'approved-user' | 'administrator' | 'assistant';

function readCapability(data: unknown): AuthorizationCapability {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new HttpsError('invalid-argument', 'A capability is required.');
  }

  const capability = (data as Record<string, unknown>)['capability'];
  if (capability !== 'approved-user' && capability !== 'administrator' && capability !== 'assistant') {
    throw new HttpsError('invalid-argument', 'The requested capability is invalid.');
  }
  return capability;
}

export const authorizationProbe = onCall(async (request) =>
  withSafeCallableErrors('authorizationProbe', async () => {
    if (process.env['FUNCTIONS_EMULATOR'] !== 'true') {
      throw new HttpsError('failed-precondition', 'This test-only callable is available only in the Functions emulator.');
    }

    const capability = readCapability(request.data);
    switch (capability) {
      case 'approved-user':
        await authorization.requireApprovedEmployee(request);
        break;
      case 'administrator':
        await authorization.requireAdministrator(request);
        break;
      case 'assistant':
        await authorization.requireAssistant(request);
        break;
    }
    return { capability, granted: true };
  }),
);

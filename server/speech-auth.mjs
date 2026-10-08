import { createHmac } from 'node:crypto';

/** @param {string | Uint8Array} secret */
export function speechSigningSecret(secret) {
  // Domain separation prevents a speech ticket from validating as a login
  // cookie even though both services are configured with the same root secret.
  return createHmac('sha256', secret).update('ledger/speech-ticket/v1').digest();
}

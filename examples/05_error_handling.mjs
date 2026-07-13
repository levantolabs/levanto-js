// Error handling: readiness check and typed errors.
//
// Run:  LEVANTO_API_KEY=lv_live_... node examples/05_error_handling.mjs
import { LevantoClient, AuthError, ValidationError, LevantoError } from 'levanto';

const apiKey = process.env.LEVANTO_API_KEY;
if (!apiKey) {
  console.error('Set LEVANTO_API_KEY to run this example.');
  process.exit(1);
}

const client = new LevantoClient({ apiKey });

// ready() never throws: true once the (scale-to-zero) endpoint is warm, false
// while it is still spinning up. Useful as a pre-flight or health probe.
console.log('ready:', await client.ready());

try {
  // scale requires exactly 5 levels; three levels is rejected server-side.
  await client.scale('some document', 'rate it', ['only', 'three', 'levels']);
} catch (err) {
  if (err instanceof ValidationError) {
    console.log('ValidationError:', err.status, '-', err.detail);
  } else if (err instanceof AuthError) {
    console.log('AuthError (bad/expired key):', err.status);
  } else if (err instanceof LevantoError) {
    // Base class: also covers timeouts and exhausted transport retries.
    console.log('LevantoError:', err.message);
  } else {
    throw err;
  }
}

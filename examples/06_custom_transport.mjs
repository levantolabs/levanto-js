// Custom transport: inject your own fetch (proxy, mTLS, edge runtime, logging).
//
// The `fetch` option accepts any WHATWG-fetch-compatible function. It is called
// as fetch(urlString, init) and must return a Response and honor init.signal
// (the SDK uses it for the per-attempt timeout, so spread `init` rather than
// rebuilding it).
//
// Run:  LEVANTO_API_KEY=lv_live_... node examples/06_custom_transport.mjs
import { LevantoClient } from 'levanto';

const apiKey = process.env.LEVANTO_API_KEY;
if (!apiKey) {
  console.error('Set LEVANTO_API_KEY to run this example.');
  process.exit(1);
}

// A logging wrapper around the global fetch.
const loggingFetch = async (url, init) => {
  const started = performance.now();
  const res = await globalThis.fetch(url, init);
  console.log(`[levanto] ${res.status} ${url} ${(performance.now() - started).toFixed(0)}ms`);
  return res;
};

const client = new LevantoClient({ apiKey, fetch: loggingFetch });

const r = await client.yesno('Wire $10M offshore today, no invoice.', 'Is this suspicious?');
console.log('answer:', r.answer);

// For a proxy / custom connection pool, use undici (Node) and keep init.signal:
//
//   import { fetch as undiciFetch, ProxyAgent } from 'undici';
//   const dispatcher = new ProxyAgent('http://proxy.internal:8080');
//   const client = new LevantoClient({
//     apiKey,
//     fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }),
//   });

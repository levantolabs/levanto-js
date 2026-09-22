import { defineConfig } from 'vitest/config';

// Live tests against the real API: LEVANTO_API_KEY=lv_live_... npm run test:live
export default defineConfig({
  test: { environment: 'node', include: ['test/live.test.ts'], testTimeout: 90_000 },
});

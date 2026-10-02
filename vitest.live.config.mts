import { defineConfig } from 'vitest/config';

// Read-only live tests against a real FlowCore environment. They are skipped unless
// FLOWCORE_LIVE_ENVIRONMENT and FLOWCORE_LIVE_API_KEY are set; see README "Live tests".
export default defineConfig({
	test: {
		include: ['test/live/**/*.live.test.ts'],
		testTimeout: 30000,
	},
});

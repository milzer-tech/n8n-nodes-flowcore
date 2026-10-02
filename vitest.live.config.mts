import { defineConfig } from 'vitest/config';

// Read-only live tests against a real FlowCore environment. They are skipped unless
// FLOWCORE_LIVE_ENVIRONMENT and FLOWCORE_LIVE_API_KEY are set; see README "Live tests".
// The settings are handed to the tests via `provide`, so test code needs no process access.
export default defineConfig({
	test: {
		include: ['test/live/**/*.live.test.ts'],
		testTimeout: 30000,
		provide: {
			flowcoreLive: {
				environment: process.env.FLOWCORE_LIVE_ENVIRONMENT ?? '',
				apiKey: process.env.FLOWCORE_LIVE_API_KEY ?? '',
				resource: process.env.FLOWCORE_LIVE_RESOURCE || 'followUp',
				recordId: process.env.FLOWCORE_LIVE_RECORD_ID ?? '',
			},
		},
	},
});

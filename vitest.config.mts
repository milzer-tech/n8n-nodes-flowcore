import { defineConfig } from 'vitest/config';

// Fixture-based tests only. Live tests against a FlowCore environment run separately via
// `npm run test:live` (vitest.live.config.mts).
export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		exclude: ['test/live/**', 'node_modules/**', 'dist/**'],
	},
});

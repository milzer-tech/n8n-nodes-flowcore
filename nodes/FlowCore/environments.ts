/**
 * Fixed FlowCore API base URLs per environment.
 *
 * Verified in milzer-tech/flowcore: config/env/production.js and config/env/staging.js
 * (`host`), README.md and docs/v1/skeleton.json (OpenAPI servers).
 *
 * This is the only place these URLs are defined. The credential test and every node request
 * resolve the base URL from here, so Production and Staging can never be mixed up and there is
 * no fallback from one environment to the other.
 */
export const FLOWCORE_BASE_URLS = {
	production: 'https://app.flowcore.cloud',
	staging: 'https://app-staging.flowcore.cloud',
} as const;

export type FlowCoreEnvironment = keyof typeof FLOWCORE_BASE_URLS;

export const DEFAULT_ENVIRONMENT: FlowCoreEnvironment = 'production';

export function isFlowCoreEnvironment(value: unknown): value is FlowCoreEnvironment {
	return (
		typeof value === 'string' && Object.prototype.hasOwnProperty.call(FLOWCORE_BASE_URLS, value)
	);
}

/** Returns the fixed base URL of an environment, or throws for anything unknown. */
export function getBaseUrl(environment: unknown): string {
	if (!isFlowCoreEnvironment(environment)) {
		throw new Error(
			`Unknown FlowCore environment "${String(environment)}". Select Production or Staging in the credential.`,
		);
	}
	return FLOWCORE_BASE_URLS[environment];
}

/**
 * The same mapping as an n8n expression, for places that can only take expressions (the
 * credential test). An unknown environment resolves to `undefined`, so the request fails
 * instead of silently using another environment.
 */
export const BASE_URL_EXPRESSION = `={{ ${Object.entries(FLOWCORE_BASE_URLS)
	.map(
		([environment, url]) =>
			`$credentials.environment === ${JSON.stringify(environment)} ? ${JSON.stringify(url)} : `,
	)
	.join('')}undefined }}`;

/** Key prefixes issued per environment (milzer-tech/flowcore UserApiKeyEnvironmentService.ts). */
export const API_KEY_PREFIXES: Record<FlowCoreEnvironment, string> = {
	production: 'fc_live_',
	staging: 'fc_test_',
};

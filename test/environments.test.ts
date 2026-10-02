import { describe, expect, it } from 'vitest';
import { FlowCoreApi } from '../credentials/FlowCoreApi.credentials';
import {
	BASE_URL_EXPRESSION,
	FLOWCORE_BASE_URLS,
	getBaseUrl,
} from '../nodes/FlowCore/environments';

/** Evaluates the body of the `={{ … }}` expression the way n8n would for plain JS. */
function evaluateBaseUrlExpression(environment: unknown): unknown {
	const match = /^=\{\{(.*)\}\}$/s.exec(BASE_URL_EXPRESSION);
	if (!match) throw new Error('Not an n8n expression');
	return new Function('$credentials', `return (${match[1]});`)({ environment });
}

describe('environment mapping', () => {
	it('maps each environment to its fixed, verified base URL', () => {
		expect(FLOWCORE_BASE_URLS).toEqual({
			production: 'https://app.flowcore.cloud',
			staging: 'https://app-staging.flowcore.cloud',
		});
		expect(getBaseUrl('production')).toBe('https://app.flowcore.cloud');
		expect(getBaseUrl('staging')).toBe('https://app-staging.flowcore.cloud');
	});

	it('rejects unknown environments instead of falling back', () => {
		for (const value of [undefined, '', 'Production', 'dev', 'https://evil.example', 'toString']) {
			expect(() => getBaseUrl(value)).toThrow(/Unknown FlowCore environment/);
		}
	});

	it('uses the same mapping in the credential test expression', () => {
		expect(evaluateBaseUrlExpression('production')).toBe(FLOWCORE_BASE_URLS.production);
		expect(evaluateBaseUrlExpression('staging')).toBe(FLOWCORE_BASE_URLS.staging);
		expect(evaluateBaseUrlExpression('other')).toBeUndefined();
	});
});

describe('FlowCore API credential', () => {
	const credential = new FlowCoreApi();

	it('exposes exactly Environment and API Key', () => {
		expect(credential.properties.map((property) => property.name)).toEqual([
			'environment',
			'apiKey',
		]);
	});

	it('offers only Production and Staging, defaulting to Production', () => {
		const environment = credential.properties[0];
		expect(environment.type).toBe('options');
		expect(environment.required).toBe(true);
		expect(environment.default).toBe('production');
		expect(environment.options).toEqual([
			{ name: 'Production', value: 'production' },
			{ name: 'Staging', value: 'staging' },
		]);
	});

	it('stores the API key as a secret', () => {
		expect(credential.properties[1].typeOptions?.password).toBe(true);
	});

	it('authenticates with the x-api-key header and never with Authorization', () => {
		const headers = credential.authenticate.properties.headers ?? {};
		expect(headers).toEqual({ 'x-api-key': '={{$credentials.apiKey}}' });
		expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('authorization');
	});

	it('tests the credential with a read-only request in the selected environment', () => {
		expect(credential.test.request).toMatchObject({
			method: 'GET',
			url: '/me/api-key',
			baseURL: BASE_URL_EXPRESSION,
		});
	});
});

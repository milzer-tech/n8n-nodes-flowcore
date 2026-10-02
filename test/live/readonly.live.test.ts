/**
 * LIVE tests against a real FlowCore environment. Read-only by design: they never create,
 * update or execute anything, so they cannot change customer data in any environment.
 *
 * Required:  FLOWCORE_LIVE_ENVIRONMENT = staging | production
 *            FLOWCORE_LIVE_API_KEY     = API key of a test user in that environment
 * Optional:  FLOWCORE_LIVE_RESOURCE    = node resource to read (default: followUp)
 *            FLOWCORE_LIVE_RECORD_ID   = record of that resource to list actions for
 */
import type { IDataObject, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import { describe, expect, inject, it } from 'vitest';
import { FlowCore } from '../../nodes/FlowCore/FlowCore.node';
import { getBaseUrl } from '../../nodes/FlowCore/environments';
import { supportsActions } from '../../nodes/FlowCore/resources';
import { flowCoreRequest } from '../../nodes/FlowCore/transport';

// Provided by vitest.live.config.mts from the FLOWCORE_LIVE_* environment variables.
const { environment, apiKey, resource, recordId } = inject('flowcoreLive');
const enabled = Boolean(environment && apiKey);

/** A context whose HTTP helper behaves like n8n's: real request, credential header added. */
function liveContext(params: IDataObject): IExecuteFunctions {
	const httpRequestWithAuthentication = async (_name: string, options: IHttpRequestOptions) => {
		const url = new URL(options.url, options.baseURL);
		for (const [key, value] of Object.entries(options.qs ?? {}))
			url.searchParams.set(key, String(value));
		if (options.method && options.method !== 'GET') {
			throw new Error('Live tests are read-only; refusing a non-GET request');
		}
		const response = await fetch(url, {
			method: 'GET',
			headers: { ...(options.headers as Record<string, string>), 'x-api-key': apiKey as string },
			redirect: 'manual',
		});
		const text = await response.text();
		return {
			statusCode: response.status,
			headers: {},
			body: text ? (JSON.parse(text) as unknown) : undefined,
		};
	};

	return {
		getNode: () => ({
			id: 'live',
			name: 'FlowCore',
			type: 'flowCore',
			typeVersion: 1,
			position: [0, 0],
			parameters: {},
		}),
		getInputData: () => [{ json: {} }],
		getCredentials: async () => ({ environment, apiKey }),
		getNodeParameter: (name: string, _index: number, fallback?: unknown) =>
			name in params ? params[name] : fallback,
		continueOnFail: () => false,
		helpers: { httpRequestWithAuthentication },
	} as unknown as IExecuteFunctions;
}

describe.skipIf(!enabled)(`FlowCore live (${environment || 'disabled'}, read-only)`, () => {
	it('resolves the fixed base URL of the selected environment', () => {
		expect(getBaseUrl(environment)).toMatch(/^https:\/\/app(-staging)?\.flowcore\.cloud$/);
	});

	it('accepts the API key on the credential test endpoint', async () => {
		const body = await flowCoreRequest.call(liveContext({}), {
			method: 'GET',
			path: '/me/api-key',
		});
		expect(body).toHaveProperty('userId');
	});

	it('counts and lists records', async () => {
		const node = new FlowCore();
		const [count] = await node.execute.call(
			liveContext({ resource, operation: 'count', filters: {} }),
		);
		expect(typeof count[0].json.count).toBe('number');

		const [records] = await node.execute.call(
			liveContext({
				resource,
				operation: 'getAll',
				returnAll: false,
				limit: 2,
				filters: {},
				options: {},
			}),
		);
		expect(records.length).toBeLessThanOrEqual(2);
		for (const record of records) expect(record.json).toHaveProperty('id');
	});

	it.skipIf(!recordId || !supportsActions(resource))('lists the actions of a record', async () => {
		const node = new FlowCore();
		const [actions] = await node.execute.call(
			liveContext({ resource, operation: 'getActions', recordId }),
		);
		for (const action of actions) expect(action.json).toHaveProperty('id');
	});
});

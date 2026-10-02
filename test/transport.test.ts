import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';
import { flowCoreRequest, MAX_PAGE_SIZE, paginate } from '../nodes/FlowCore/transport';
import {
	authenticationError,
	insufficientPermissionsError,
	staleFingerprintResponse,
} from './fixtures';
import { createContext, TEST_API_KEY } from './helpers';

describe('request construction', () => {
	it('sends requests to the selected environment with the FlowCore credential', async () => {
		for (const [environment, baseURL] of [
			['production', 'https://app.flowcore.cloud'],
			['staging', 'https://app-staging.flowcore.cloud'],
		]) {
			const { context, requests } = createContext({
				environment,
				responses: [{ statusCode: 200, body: { count: 1 } }],
			});
			await flowCoreRequest.call(context, {
				method: 'GET',
				path: '/api/followups/count',
				qs: { where: '{"taskType":"TODO"}' },
			});

			expect(requests).toHaveLength(1);
			expect(requests[0].credentialName).toBe('flowCoreApi');
			expect(requests[0].options).toMatchObject({
				method: 'GET',
				baseURL,
				url: '/api/followups/count',
				qs: { where: '{"taskType":"TODO"}' },
				json: true,
				returnFullResponse: true,
				ignoreHttpStatusErrors: true,
			});
		}
	});

	it('sets Accept JSON and never an Authorization header', async () => {
		const { context, requests } = createContext({ responses: [{ statusCode: 200, body: {} }] });
		await flowCoreRequest.call(context, { method: 'GET', path: '/api/contacts/count' });
		const headers = requests[0].options.headers ?? {};
		expect(headers).toEqual({ Accept: 'application/json' });
	});

	it('sends a JSON body only when given', async () => {
		const { context, requests } = createContext({
			responses: [
				{ statusCode: 200, body: {} },
				{ statusCode: 201, body: {} },
			],
		});
		await flowCoreRequest.call(context, { method: 'GET', path: '/a' });
		await flowCoreRequest.call(context, { method: 'POST', path: '/b', body: { notice: 'x' } });
		expect(requests[0].options).not.toHaveProperty('body');
		expect(requests[1].options.body).toEqual({ notice: 'x' });
	});

	it('refuses an unknown environment without sending a request', async () => {
		const { context, requests } = createContext({ environment: 'custom' });
		await expect(
			flowCoreRequest.call(context, { method: 'GET', path: '/x' }),
		).rejects.toBeInstanceOf(NodeOperationError);
		expect(requests).toHaveLength(0);
	});
});

describe('API error handling', () => {
	async function failWith(
		statusCode: number,
		body: unknown,
		environment = 'staging',
		apiKey = TEST_API_KEY,
	) {
		const { context } = createContext({ environment, apiKey, responses: [{ statusCode, body }] });
		try {
			await flowCoreRequest.call(context, {
				method: 'GET',
				path: '/api/operationsbookings/1',
				itemIndex: 0,
			});
		} catch (error) {
			return error as NodeApiError;
		}
		throw new Error('Expected the request to fail');
	}

	it('explains a rejected API key and spots a key from the other environment', async () => {
		const error = await failWith(401, authenticationError, 'production', TEST_API_KEY);
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('FlowCore rejected the API key (production)');
		expect(error.description).toContain('looks like a staging key');
		expect(error.httpCode).toBe('401');
	});

	it('distinguishes missing permissions (401 with code 702) from a bad key', async () => {
		const error = await failWith(401, insufficientPermissionsError);
		expect(error.message).toContain('lacks the permission');
		expect(error.description).toContain('insufficient permissions');
	});

	it('handles the empty bodies FlowCore sends for blueprint errors in production', async () => {
		const error = await failWith(404, '');
		expect(error.message).toBe('FlowCore could not find the requested resource');
		expect(error.description).toContain('another FlowCore client');
	});

	it('keeps the server message of a 409 from record actions', async () => {
		const error = await failWith(409, staleFingerprintResponse);
		expect(error.message).toContain('current state');
		expect(error.description).toContain('Die Vorschau hat sich inzwischen geändert');
	});

	it('treats success:false in a 2xx body as an error', async () => {
		const error = await failWith(200, { success: false, message: 'Invalid credentials' });
		expect(error.message).toBe('FlowCore reported that the request failed');
		expect(error.description).toContain('Invalid credentials');
	});

	it('never puts the API key into error messages', async () => {
		for (const [status, body] of [
			[401, authenticationError],
			[500, ''],
			[400, { message: 'Invalid JSON in where' }],
		] as const) {
			const error = await failWith(status, body);
			expect(
				JSON.stringify({ m: error.message, d: error.description, r: error.errorResponse }),
			).not.toContain(TEST_API_KEY);
		}
	});

	it('wraps network failures without the request configuration', async () => {
		const networkError = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
			config: { headers: { 'x-api-key': TEST_API_KEY } },
		});
		const { context } = createContext({ responses: [networkError] });
		const error = (await flowCoreRequest
			.call(context, { method: 'GET', path: '/x' })
			.catch((caught: unknown) => caught)) as NodeApiError;
		expect(error).toBeInstanceOf(NodeApiError);
		expect(error.message).toBe('Could not reach FlowCore (staging)');
		expect(
			JSON.stringify({ m: error.message, d: error.description, r: error.errorResponse }),
		).not.toContain(TEST_API_KEY);
	});
});

describe('pagination', () => {
	function pages(total: number) {
		return vi.fn(async (skip: number, limit: number) => {
			const count = Math.max(0, Math.min(limit, total - skip));
			return { records: Array.from({ length: count }, (_, i) => ({ id: skip + i })), total };
		});
	}

	it('reads all pages with skip/limit at the 300-record cap', async () => {
		const fetchPage = pages(650);
		const records = await paginate(fetchPage, true, 0);
		expect(records).toHaveLength(650);
		expect(fetchPage.mock.calls).toEqual([
			[0, MAX_PAGE_SIZE],
			[300, MAX_PAGE_SIZE],
			[600, MAX_PAGE_SIZE],
		]);
	});

	it('stops at the limit and asks only for what is still needed', async () => {
		const fetchPage = pages(1000);
		const records = await paginate(fetchPage, false, 320);
		expect(records).toHaveLength(320);
		expect(fetchPage.mock.calls).toEqual([
			[0, 300],
			[300, 20],
		]);
	});

	it('stops when total is reached even if the page was full', async () => {
		const fetchPage = pages(300);
		await paginate(fetchPage, true, 0);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it('stops on an empty first page', async () => {
		const fetchPage = pages(0);
		expect(await paginate(fetchPage, true, 0)).toEqual([]);
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});
});

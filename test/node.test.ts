import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { FlowCore } from '../nodes/FlowCore/FlowCore.node';
import {
	actionsResponse,
	BOOKING_ID,
	countResponse,
	createResponse,
	executeResponse,
	findOneResponse,
	FOLLOWUP_ID,
	insufficientPermissionsError,
	overviewPage,
	previewResponse,
	staleFingerprintResponse,
} from './fixtures';
import { createContext, type ContextSetup, type FakeResponse } from './helpers';

const node = new FlowCore();

async function run(setup: ContextSetup) {
	const harness = createContext(setup);
	const output = await node.execute.call(harness.context);
	return { ...harness, output: output[0] };
}

describe('records', () => {
	it('gets one record and links it to its input item', async () => {
		const { output, requests } = await run({
			params: { resource: 'booking', operation: 'get', recordId: BOOKING_ID },
			responses: [{ statusCode: 200, body: findOneResponse }],
		});
		expect(requests[0].options).toMatchObject({
			method: 'GET',
			url: `/api/operationsbookings/${BOOKING_ID}`,
		});
		expect(output).toEqual([{ json: findOneResponse.records[0], pairedItem: { item: 0 } }]);
	});

	it('url-encodes record IDs', async () => {
		const { requests } = await run({
			params: { resource: 'contact', operation: 'get', recordId: '../users' },
			responses: [{ statusCode: 200, body: findOneResponse }],
		});
		expect(requests[0].options.url).toBe('/api/contacts/..%2Fusers');
	});

	it('searches through /overview with filters, sort and pagination', async () => {
		const { output, requests } = await run({
			params: {
				resource: 'travel',
				operation: 'getAll',
				returnAll: true,
				filters: { query: 'Island', where: '{"isOffer":{"!":true}}' },
				options: { sortBy: 'updatedAt', sortDirection: 'ASC', select: 'id,title', populate: '' },
			},
			responses: (options: IHttpRequestOptions): FakeResponse => {
				const qs = options.qs as IDataObject;
				const skip = qs.skip as number;
				return { statusCode: 200, body: overviewPage(skip, skip === 0 ? 300 : 5, 305) };
			},
		});

		expect(output).toHaveLength(305);
		expect(output.every((item) => (item.pairedItem as { item: number }).item === 0)).toBe(true);
		expect(requests.map((request) => request.options.url)).toEqual([
			'/api/travels/overview',
			'/api/travels/overview',
		]);
		expect(requests[0].options.qs).toEqual({
			query: 'Island',
			where: '{"isOffer":{"!":true}}',
			sort: '[{"property":"updatedAt","direction":"ASC"}]',
			select: 'id,title',
			limit: 300,
			skip: 0,
		});
		expect((requests[1].options.qs as IDataObject).skip).toBe(300);
	});

	it('respects the limit when not returning all', async () => {
		const { output, requests } = await run({
			params: { resource: 'invoice', operation: 'getAll', returnAll: false, limit: 2 },
			responses: [{ statusCode: 200, body: overviewPage(0, 2, 99) }],
		});
		expect(output).toHaveLength(2);
		expect(requests[0].options.qs).toEqual({ limit: 2, skip: 0 });
	});

	it('rejects invalid JSON filters before calling FlowCore', async () => {
		await expect(
			run({ params: { resource: 'contact', operation: 'count', filters: { where: '{nope' } } }),
		).rejects.toBeInstanceOf(NodeOperationError);
	});

	it('counts records', async () => {
		const { output, requests } = await run({
			params: {
				resource: 'followUp',
				operation: 'count',
				filters: { where: { taskType: 'TODO' } },
			},
			responses: [{ statusCode: 200, body: countResponse }],
		});
		expect(requests[0].options).toMatchObject({
			url: '/api/followups/count',
			qs: { where: '{"taskType":"TODO"}' },
		});
		expect(output[0].json).toEqual({ count: 42 });
	});

	it('creates a follow-up attached to a readable record', async () => {
		const { output, requests } = await run({
			params: {
				resource: 'followUp',
				operation: 'create',
				notice: 'Call the customer',
				additionalFields: {
					dueDate: '2026-10-05',
					taskType: 'TODO',
					relatedModel: 'operationsbookings',
					relatedRecordId: BOOKING_ID,
					teamIds: 'g1, g2',
				},
			},
			responses: [
				{ statusCode: 200, body: findOneResponse },
				{ statusCode: 201, body: createResponse },
			],
		});
		expect(requests[0].options).toMatchObject({
			method: 'GET',
			url: `/api/operationsbookings/${BOOKING_ID}`,
			qs: { select: 'id' },
		});
		expect(requests[1].options).toMatchObject({ method: 'POST', url: '/api/followups' });
		expect(requests[1].options.body).toEqual({
			notice: 'Call the customer',
			dueDate: '2026-10-05T00:00:00.000Z',
			taskType: 'TODO',
			groups: ['g1', 'g2'],
			collection: 'operationsbookings',
			recordId: BOOKING_ID,
		});
		expect(output[0].json).toEqual(createResponse.records[0]);
	});

	it('updates a follow-up with PUT and only the given fields', async () => {
		const { requests } = await run({
			params: {
				resource: 'followUp',
				operation: 'update',
				recordId: FOLLOWUP_ID,
				updateFields: { assigneeId: 'u1', description: 'Details' },
			},
			responses: [
				{ statusCode: 200, body: { total: 1, totalCount: 1, records: [{ id: FOLLOWUP_ID }] } },
			],
		});
		expect(requests[0].options).toMatchObject({
			method: 'PUT',
			url: `/api/followups/${FOLLOWUP_ID}`,
		});
		expect(requests[0].options.body).toEqual({ user: 'u1', description: 'Details' });
	});

	it('refuses an update without fields', async () => {
		await expect(
			run({
				params: { resource: 'contact', operation: 'update', recordId: 'c1', contactFields: {} },
			}),
		).rejects.toThrow('Set at least one field');
	});

	it('creates a contact from friendly fields plus JSON attributes', async () => {
		const { requests } = await run({
			params: {
				resource: 'contact',
				operation: 'create',
				contactFields: {
					firstname: 'Ada',
					lastname: 'Lovelace',
					email: 'ada@example.com',
					attributesJson: '{"birthdate":"1990-01-01"}',
				},
			},
			responses: [{ statusCode: 201, body: { success: true, total: 1, records: [{ id: 'c1' }] } }],
		});
		expect(requests[0].options.body).toEqual({
			birthdate: '1990-01-01',
			firstname: 'Ada',
			lastname: 'Lovelace',
			email: 'ada@example.com',
		});
	});

	it('does not offer writes on bookings', async () => {
		await expect(
			run({ params: { resource: 'booking', operation: 'update', recordId: BOOKING_ID } }),
		).rejects.toThrow(/not supported/);
	});
});

describe('record actions', () => {
	const actionPath = `/api/operationsbookings/${BOOKING_ID}/actions`;

	it('lists the actions of a record as items', async () => {
		const { output, requests } = await run({
			params: { resource: 'booking', operation: 'getActions', recordId: BOOKING_ID },
			responses: [{ statusCode: 200, body: actionsResponse }],
		});
		expect(requests[0].options).toMatchObject({ method: 'GET', url: actionPath });
		expect(output.map((item) => item.json.id)).toEqual(['cancel', 'createInvoice']);
		expect(output[0].json.recordId).toBe(BOOKING_ID);
	});

	it('previews an action with its inputs', async () => {
		const { output, requests } = await run({
			params: {
				resource: 'booking',
				operation: 'previewAction',
				recordId: BOOKING_ID,
				actionId: 'cancel',
				actionInputs: '{"cancellationDate":"2026-09-21"}',
			},
			responses: [{ statusCode: 200, body: previewResponse }],
		});
		expect(requests[0].options).toMatchObject({
			method: 'POST',
			url: `${actionPath}/cancel/preview`,
			body: { cancellationDate: '2026-09-21' },
		});
		expect(output[0].json.fingerprint).toBe(previewResponse.preview.fingerprint);
	});

	it('executes a previewing action with the fingerprint of a fresh preview', async () => {
		const { output, requests } = await run({
			params: {
				resource: 'booking',
				operation: 'executeAction',
				recordId: BOOKING_ID,
				actionId: 'cancel',
				actionInputs: { cancellationDate: '2026-09-21' },
				actionOptions: {},
			},
			responses: [
				{ statusCode: 200, body: actionsResponse },
				{ statusCode: 200, body: previewResponse },
				{ statusCode: 200, body: executeResponse },
			],
		});
		expect(requests.map((request) => `${request.options.method} ${request.options.url}`)).toEqual([
			`GET ${actionPath}`,
			`POST ${actionPath}/cancel/preview`,
			`POST ${actionPath}/cancel`,
		]);
		expect(requests[2].options.body).toEqual({
			cancellationDate: '2026-09-21',
			fingerprint: previewResponse.preview.fingerprint,
		});
		expect(output[0].json).toMatchObject({
			recordId: BOOKING_ID,
			actionId: 'cancel',
			success: true,
			data: executeResponse.data,
			availableActions: [],
			preview: previewResponse.preview,
		});
	});

	it('executes an action without preview directly after checking availability', async () => {
		const { requests } = await run({
			params: {
				resource: 'booking',
				operation: 'executeAction',
				recordId: BOOKING_ID,
				actionId: 'createInvoice',
				actionInputs: '{}',
			},
			responses: [
				{ statusCode: 200, body: actionsResponse },
				{ statusCode: 200, body: { success: true, data: {}, meta: { actions: [] } } },
			],
		});
		expect(requests).toHaveLength(2);
		expect(requests[1].options).toMatchObject({
			method: 'POST',
			url: `${actionPath}/createInvoice`,
			body: {},
		});
	});

	it('uses a confirmed fingerprint from the workflow without previewing again', async () => {
		const { requests } = await run({
			params: {
				resource: 'booking',
				operation: 'executeAction',
				recordId: BOOKING_ID,
				actionId: 'cancel',
				actionInputs: '{}',
				actionOptions: { fingerprint: 'confirmed-fp' },
			},
			responses: [{ statusCode: 200, body: executeResponse }],
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].options.body).toEqual({ fingerprint: 'confirmed-fp' });
	});

	it('fails without executing when FlowCore does not offer the action', async () => {
		const harness = createContext({
			params: {
				resource: 'booking',
				operation: 'executeAction',
				recordId: BOOKING_ID,
				actionId: 'book',
				actionInputs: '{}',
			},
			responses: [{ statusCode: 200, body: actionsResponse }],
		});
		await expect(node.execute.call(harness.context)).rejects.toThrow(/not available/);
		expect(harness.requests).toHaveLength(1);
	});

	it('refuses actions that need an interactive dialog', async () => {
		const harness = createContext({
			params: {
				resource: 'invoice',
				operation: 'executeAction',
				recordId: 'i1',
				actionId: 'special',
				actionInputs: '{}',
			},
			responses: [
				{
					statusCode: 200,
					body: { actions: [{ id: 'special', label: 'Special', confirmation: { mode: 'view' } }] },
				},
			],
		});
		await expect(node.execute.call(harness.context)).rejects.toThrow(/interactive dialog/);
		expect(harness.requests).toHaveLength(1);
	});

	it('does not retry when the fingerprint went stale', async () => {
		const harness = createContext({
			params: {
				resource: 'booking',
				operation: 'executeAction',
				recordId: BOOKING_ID,
				actionId: 'cancel',
				actionInputs: '{}',
				actionOptions: { fingerprint: 'old' },
			},
			responses: [{ statusCode: 409, body: staleFingerprintResponse }],
		});
		await expect(node.execute.call(harness.context)).rejects.toBeInstanceOf(NodeApiError);
		expect(harness.requests).toHaveLength(1);
	});

	it('loads action options for the selected resource and record', async () => {
		const harness = createContext({
			params: { resource: 'booking', recordId: BOOKING_ID },
			responses: [{ statusCode: 200, body: actionsResponse }],
		});
		const options = await node.methods.loadOptions.getRecordActions.call(harness.context);
		expect(harness.requests[0].options.url).toBe(actionPath);
		expect(options).toEqual([
			{
				name: 'Stornieren',
				value: 'cancel',
				description: actionsResponse.actions[0].confirmation?.description,
			},
			{ name: 'Rechnung erstellen', value: 'createInvoice', description: undefined },
		]);
	});

	it('asks for a fixed record ID before loading action options', async () => {
		const harness = createContext({ params: { resource: 'booking', recordId: '={{ $json.id }}' } });
		await expect(node.methods.loadOptions.getRecordActions.call(harness.context)).rejects.toThrow(
			/fixed Record ID/,
		);
		expect(harness.requests).toHaveLength(0);
	});
});

describe('item handling', () => {
	it('processes every input item and keeps item links', async () => {
		const { output } = await run({
			items: 2,
			params: (itemIndex) => ({
				resource: 'booking',
				operation: 'get',
				recordId: `id-${itemIndex}`,
			}),
			responses: (options) => ({
				statusCode: 200,
				body: { records: [{ id: String(options.url).split('/').pop() }] },
			}),
		});
		expect(output).toEqual([
			{ json: { id: 'id-0' }, pairedItem: { item: 0 } },
			{ json: { id: 'id-1' }, pairedItem: { item: 1 } },
		]);
	});

	it('returns an error item per failed input with Continue On Fail', async () => {
		const { output } = await run({
			items: 2,
			continueOnFail: true,
			params: (itemIndex) => ({
				resource: 'booking',
				operation: 'get',
				recordId: `id-${itemIndex}`,
			}),
			responses: [
				{ statusCode: 401, body: insufficientPermissionsError },
				{ statusCode: 200, body: findOneResponse },
			],
		});
		expect(output[0]).toMatchObject({
			json: { error: expect.stringContaining('lacks the permission'), httpCode: '401' },
			pairedItem: { item: 0 },
		});
		expect(output[1]).toMatchObject({ json: { id: BOOKING_ID }, pairedItem: { item: 1 } });
	});
});

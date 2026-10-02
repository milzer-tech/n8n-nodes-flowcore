import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { getModel, supportsActions } from './resources';
import { flowCoreRequest, isObject, paginate } from './transport';

/** Runs the selected operation for one input item and returns the output records. */
export async function executeOperation(
	this: IExecuteFunctions,
	itemIndex: number,
): Promise<IDataObject[]> {
	const resource = this.getNodeParameter('resource', itemIndex) as string;
	const operation = this.getNodeParameter('operation', itemIndex) as string;
	const model = getModel(resource);

	switch (operation) {
		case 'get':
			return [await getRecord.call(this, model, itemIndex)];
		case 'getAll':
			return await searchRecords.call(this, model, itemIndex);
		case 'count':
			return [await countRecords.call(this, model, itemIndex)];
		case 'create':
		case 'update':
			return [await writeRecord.call(this, resource, model, operation, itemIndex)];
		case 'getActions':
		case 'previewAction':
		case 'executeAction':
			if (!supportsActions(resource)) break;
			if (operation === 'getActions') return await listActions.call(this, model, itemIndex);
			if (operation === 'previewAction') return [await previewAction.call(this, model, itemIndex)];
			return [await executeAction.call(this, model, itemIndex)];
	}

	throw new NodeOperationError(
		this.getNode(),
		`The operation "${operation}" is not supported for "${resource}"`,
		{ itemIndex },
	);
}

function recordPath(model: string, recordId: string): string {
	return `/api/${encodeURIComponent(model)}/${encodeURIComponent(recordId)}`;
}

function requiredString(this: IExecuteFunctions, name: string, itemIndex: number): string {
	const value = String(this.getNodeParameter(name, itemIndex, '') ?? '').trim();
	if (!value) {
		throw new NodeOperationError(this.getNode(), `The parameter "${name}" must not be empty`, {
			itemIndex,
		});
	}
	return value;
}

/** Blueprint responses wrap single records as `{ records: [record] }`. */
function firstRecord(this: IExecuteFunctions, body: IDataObject, itemIndex: number): IDataObject {
	const records = body.records;
	if (Array.isArray(records) && isObject(records[0])) return records[0];
	throw new NodeOperationError(this.getNode(), 'FlowCore returned no record', { itemIndex });
}

export function parseJsonObject(
	this: IExecuteFunctions,
	value: unknown,
	name: string,
	itemIndex: number,
): IDataObject {
	if (value === undefined || value === null || value === '') return {};
	let parsed: unknown = value;
	if (typeof value === 'string') {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch {
			throw new NodeOperationError(this.getNode(), `${name} is not valid JSON`, { itemIndex });
		}
	}
	if (!isObject(parsed)) {
		throw new NodeOperationError(this.getNode(), `${name} must be a JSON object`, { itemIndex });
	}
	return parsed;
}

/** Same rule as FlowCore's MCP layer: YYYY-MM-DD is midnight UTC, otherwise an ISO timestamp. */
export function toTimestamp(
	this: IExecuteFunctions,
	value: unknown,
	name: string,
	itemIndex: number,
): string {
	const text = String(value).trim();
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
	const parsed = new Date(dateOnly ? `${text}T00:00:00.000Z` : text);
	if (!Number.isFinite(parsed.getTime())) {
		throw new NodeOperationError(this.getNode(), `${name} is not a valid date: ${text}`, {
			itemIndex,
		});
	}
	return parsed.toISOString();
}

async function getRecord(
	this: IExecuteFunctions,
	model: string,
	itemIndex: number,
): Promise<IDataObject> {
	const recordId = requiredString.call(this, 'recordId', itemIndex);
	const body = await flowCoreRequest.call(this, {
		method: 'GET',
		path: recordPath(model, recordId),
		itemIndex,
	});
	return firstRecord.call(this, body, itemIndex);
}

function readQuery(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const filters = this.getNodeParameter('filters', itemIndex, {}) as IDataObject;
	const qs: IDataObject = {};
	const query = typeof filters.query === 'string' ? filters.query.trim() : '';
	if (query) qs.query = query;
	const where = parseJsonObject.call(this, filters.where, 'Where (JSON)', itemIndex);
	if (Object.keys(where).length) qs.where = JSON.stringify(where);
	return qs;
}

async function searchRecords(
	this: IExecuteFunctions,
	model: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const returnAll = this.getNodeParameter('returnAll', itemIndex, false) as boolean;
	const limit = returnAll ? 0 : (this.getNodeParameter('limit', itemIndex, 50) as number);
	const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

	const qs = readQuery.call(this, itemIndex);
	const sortBy = typeof options.sortBy === 'string' ? options.sortBy.trim() : '';
	if (sortBy) {
		qs.sort = JSON.stringify([{ property: sortBy, direction: options.sortDirection || 'DESC' }]);
	}
	for (const key of ['select', 'populate'] as const) {
		const value = typeof options[key] === 'string' ? (options[key] as string).trim() : '';
		if (value) qs[key] = value;
	}

	return await paginate(
		async (skip, pageSize) => {
			const body = await flowCoreRequest.call(this, {
				method: 'GET',
				path: `/api/${encodeURIComponent(model)}/overview`,
				qs: { ...qs, limit: pageSize, skip },
				itemIndex,
			});
			const records = Array.isArray(body.records) ? body.records.filter(isObject) : [];
			return { records, total: typeof body.total === 'number' ? body.total : undefined };
		},
		returnAll,
		limit,
	);
}

async function countRecords(
	this: IExecuteFunctions,
	model: string,
	itemIndex: number,
): Promise<IDataObject> {
	const body = await flowCoreRequest.call(this, {
		method: 'GET',
		path: `/api/${encodeURIComponent(model)}/count`,
		qs: readQuery.call(this, itemIndex),
		itemIndex,
	});
	return { count: body.count };
}

async function writeRecord(
	this: IExecuteFunctions,
	resource: string,
	model: string,
	operation: 'create' | 'update',
	itemIndex: number,
): Promise<IDataObject> {
	let attributes: IDataObject;
	if (resource === 'contact') {
		attributes = contactAttributes.call(this, itemIndex);
	} else if (resource === 'followUp') {
		attributes = await followUpAttributes.call(this, operation, itemIndex);
	} else {
		throw new NodeOperationError(
			this.getNode(),
			`The operation "${operation}" is not supported for "${resource}"`,
			{ itemIndex },
		);
	}

	if (!Object.keys(attributes).length) {
		throw new NodeOperationError(this.getNode(), 'Set at least one field', { itemIndex });
	}

	const body =
		operation === 'create'
			? await flowCoreRequest.call(this, {
					method: 'POST',
					path: `/api/${encodeURIComponent(model)}`,
					body: attributes,
					itemIndex,
				})
			: await flowCoreRequest.call(this, {
					method: 'PUT',
					path: recordPath(model, requiredString.call(this, 'recordId', itemIndex)),
					body: attributes,
					itemIndex,
				});
	return firstRecord.call(this, body, itemIndex);
}

const CONTACT_FIELDS = ['email', 'firstname', 'lastname', 'mobile', 'phone', 'prefix'];

function contactAttributes(this: IExecuteFunctions, itemIndex: number): IDataObject {
	const fields = this.getNodeParameter('contactFields', itemIndex, {}) as IDataObject;
	const attributes = parseJsonObject.call(
		this,
		fields.attributesJson,
		'Other Attributes (JSON)',
		itemIndex,
	);
	for (const key of CONTACT_FIELDS) {
		if (typeof fields[key] === 'string' && fields[key] !== '') attributes[key] = fields[key];
	}
	return attributes;
}

async function followUpAttributes(
	this: IExecuteFunctions,
	operation: 'create' | 'update',
	itemIndex: number,
): Promise<IDataObject> {
	const fields = this.getNodeParameter(
		operation === 'create' ? 'additionalFields' : 'updateFields',
		itemIndex,
		{},
	) as IDataObject;
	const attributes: IDataObject = {};

	if (operation === 'create') {
		attributes.notice = requiredString.call(this, 'notice', itemIndex);
	} else if (typeof fields.notice === 'string' && fields.notice.trim()) {
		attributes.notice = fields.notice;
	}
	if (typeof fields.description === 'string' && fields.description) {
		attributes.description = fields.description;
	}
	for (const key of ['dueDate', 'reminderDate'] as const) {
		if (fields[key]) attributes[key] = toTimestamp.call(this, fields[key], key, itemIndex);
	}
	if (fields.reminderType) attributes.reminderType = fields.reminderType;
	if (fields.taskType) attributes.taskType = fields.taskType;
	if (typeof fields.assigneeId === 'string' && fields.assigneeId.trim()) {
		attributes.user = fields.assigneeId.trim();
	}

	if (operation === 'create') {
		const teamIds = String(fields.teamIds ?? '')
			.split(',')
			.map((id) => id.trim())
			.filter(Boolean);
		if (teamIds.length) attributes.groups = teamIds;

		const relatedRecordId = String(fields.relatedRecordId ?? '').trim();
		const relatedModel = fields.relatedModel as string | undefined;
		if (relatedRecordId && !relatedModel) {
			throw new NodeOperationError(this.getNode(), 'Related Record ID requires Related Resource', {
				itemIndex,
			});
		}
		if (relatedModel && !relatedRecordId) {
			throw new NodeOperationError(this.getNode(), 'Related Resource requires Related Record ID', {
				itemIndex,
			});
		}
		if (relatedModel && relatedRecordId) {
			// Like FlowCore's own create_followup: read the record as the user first, so a
			// follow-up can only be attached to a readable record of the user's own client.
			await flowCoreRequest.call(this, {
				method: 'GET',
				path: recordPath(relatedModel, relatedRecordId),
				qs: { select: 'id' },
				itemIndex,
			});
			attributes.collection = relatedModel;
			attributes.recordId = relatedRecordId;
		}
	}

	return attributes;
}

function actionsPath(model: string, recordId: string): string {
	return `${recordPath(model, recordId)}/actions`;
}

async function fetchActions(
	this: IExecuteFunctions,
	model: string,
	recordId: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const body = await flowCoreRequest.call(this, {
		method: 'GET',
		path: actionsPath(model, recordId),
		itemIndex,
	});
	return Array.isArray(body.actions) ? body.actions.filter(isObject) : [];
}

async function listActions(
	this: IExecuteFunctions,
	model: string,
	itemIndex: number,
): Promise<IDataObject[]> {
	const recordId = requiredString.call(this, 'recordId', itemIndex);
	const actions = await fetchActions.call(this, model, recordId, itemIndex);
	return actions.map((action) => ({ ...action, recordId }));
}

function actionRequest(this: IExecuteFunctions, itemIndex: number) {
	return {
		recordId: requiredString.call(this, 'recordId', itemIndex),
		actionId: requiredString.call(this, 'actionId', itemIndex),
		inputs: parseJsonObject.call(
			this,
			this.getNodeParameter('actionInputs', itemIndex, '{}'),
			'Action Inputs (JSON)',
			itemIndex,
		),
	};
}

async function fetchPreview(
	this: IExecuteFunctions,
	model: string,
	recordId: string,
	actionId: string,
	inputs: IDataObject,
	itemIndex: number,
): Promise<IDataObject> {
	const body = await flowCoreRequest.call(this, {
		method: 'POST',
		path: `${actionsPath(model, recordId)}/${encodeURIComponent(actionId)}/preview`,
		body: inputs,
		itemIndex,
	});
	if (!isObject(body.preview)) {
		throw new NodeOperationError(this.getNode(), 'FlowCore returned no preview', { itemIndex });
	}
	return body.preview;
}

async function previewAction(
	this: IExecuteFunctions,
	model: string,
	itemIndex: number,
): Promise<IDataObject> {
	const { recordId, actionId, inputs } = actionRequest.call(this, itemIndex);
	const preview = await fetchPreview.call(this, model, recordId, actionId, inputs, itemIndex);
	return { recordId, actionId, ...preview };
}

/**
 * Runs a record action. FlowCore decides availability, permissions and effects; this only
 * follows its protocol: an action with a preview runs only with the fingerprint of the current
 * preview. Without a fingerprint supplied by the workflow, the node reads the action list and
 * the preview (both side-effect free) and sends the fresh fingerprint.
 */
async function executeAction(
	this: IExecuteFunctions,
	model: string,
	itemIndex: number,
): Promise<IDataObject> {
	const { recordId, actionId, inputs } = actionRequest.call(this, itemIndex);
	const options = this.getNodeParameter('actionOptions', itemIndex, {}) as IDataObject;
	let fingerprint = typeof options.fingerprint === 'string' ? options.fingerprint.trim() : '';
	let preview: IDataObject | undefined;

	if (!fingerprint) {
		const actions = await fetchActions.call(this, model, recordId, itemIndex);
		const action = actions.find((candidate) => candidate.id === actionId);
		if (!action) {
			const available = actions.map((candidate) => String(candidate.id)).join(', ') || 'none';
			throw new NodeOperationError(
				this.getNode(),
				`The action "${actionId}" is not available for this record`,
				{
					itemIndex,
					description: `FlowCore only offers actions the record's state and the user's permissions allow. Available now: ${available}.`,
				},
			);
		}
		const mode = isObject(action.confirmation) ? action.confirmation.mode : undefined;
		if (mode === 'view') {
			throw new NodeOperationError(
				this.getNode(),
				`The action "${actionId}" needs an interactive dialog in FlowCore and cannot run from n8n`,
				{ itemIndex },
			);
		}
		if (mode === 'preview') {
			preview = await fetchPreview.call(this, model, recordId, actionId, inputs, itemIndex);
			fingerprint = typeof preview.fingerprint === 'string' ? preview.fingerprint : '';
		}
	}

	const body = await flowCoreRequest.call(this, {
		method: 'POST',
		path: `${actionsPath(model, recordId)}/${encodeURIComponent(actionId)}`,
		body: fingerprint ? { ...inputs, fingerprint } : inputs,
		itemIndex,
	});

	const result: IDataObject = {
		recordId,
		actionId,
		success: body.success,
		data: body.data,
		availableActions: isObject(body.meta) ? body.meta.actions : undefined,
	};
	if (preview) result.preview = preview;
	return result;
}

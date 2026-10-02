import type { INodeProperties, INodePropertyOptions } from 'n8n-workflow';
import {
	ACTION_RESOURCES,
	ALL_RESOURCES,
	FOLLOWUP_RELATED_MODELS,
	FOLLOWUP_REMINDER_TYPES,
	FOLLOWUP_TASK_TYPES,
	RESOURCES,
	type ResourceKey,
} from './resources';

const resourceProperty: INodeProperties = {
	displayName: 'Resource',
	name: 'resource',
	type: 'options',
	noDataExpression: true,
	options: ALL_RESOURCES.map((key) => ({ name: RESOURCES[key].label, value: key })),
	default: 'booking',
};

function operationsFor(resource: ResourceKey): INodePropertyOptions[] {
	const noun = RESOURCES[resource].label.toLowerCase();
	const operations: INodePropertyOptions[] = [
		{
			name: 'Count',
			value: 'count',
			description: `Count ${noun}s matching a filter`,
			action: `Count ${noun}s`,
		},
		{ name: 'Get', value: 'get', description: `Get a ${noun} by ID`, action: `Get a ${noun}` },
		{
			name: 'Get Many',
			value: 'getAll',
			description: `Search and list ${noun}s`,
			action: `Get many ${noun}s`,
		},
	];
	if (RESOURCES[resource].write) {
		operations.push(
			{
				name: 'Create',
				value: 'create',
				description: `Create a ${noun}`,
				action: `Create a ${noun}`,
			},
			{
				name: 'Update',
				value: 'update',
				description: `Update a ${noun}`,
				action: `Update a ${noun}`,
			},
		);
	}
	if (RESOURCES[resource].actions) {
		operations.push(
			{
				name: 'Execute Action',
				value: 'executeAction',
				description: `Run a FlowCore action on a ${noun}`,
				action: `Execute an action on a ${noun}`,
			},
			{
				name: 'Get Actions',
				value: 'getActions',
				description: `List the actions currently available for a ${noun}`,
				action: `Get available actions for a ${noun}`,
			},
			{
				name: 'Preview Action',
				value: 'previewAction',
				description: `Preview what an action would do to a ${noun}, without changing anything`,
				action: `Preview an action on a ${noun}`,
			},
		);
	}
	return operations.sort((a, b) => a.name.localeCompare(b.name));
}

const operationProperties: INodeProperties[] = ALL_RESOURCES.map((resource) => ({
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: [resource] } },
	options: operationsFor(resource),
	default: 'get',
}));

const recordIdProperty: INodeProperties = {
	displayName: 'Record ID',
	name: 'recordId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. 68c1a2b3c4d5e6f708192a3b',
	description: 'The FlowCore ID of the record',
	displayOptions: {
		show: {
			operation: ['get', 'update', 'getActions', 'previewAction', 'executeAction'],
		},
	},
};

const searchProperties: INodeProperties[] = [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show: { operation: ['getAll'] } },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { operation: ['getAll'], returnAll: [false] } },
	},
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: { operation: ['getAll', 'count'] } },
		options: [
			{
				displayName: 'Search Text',
				name: 'query',
				type: 'string',
				default: '',
				description:
					'Free-text search over the fields FlowCore searches for this resource (max. 1000 characters).',
			},
			{
				displayName: 'Where (JSON)',
				name: 'where',
				type: 'json',
				default: '{}',
				description:
					'FlowCore criteria object, e.g. {"status": "BOOKED", "createdAt": {">=": "2026-01-01"}}. Supports equality, IN arrays, comparisons, not, in, nin, contains, startsWith, endsWith, like, exists, or and and. Unknown fields are rejected.',
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { operation: ['getAll'] } },
		options: [
			{
				displayName: 'Fields',
				name: 'select',
				type: 'string',
				default: '',
				placeholder: 'e.g. status,createdAt',
				description:
					'Comma-separated top-level fields to return. Leave empty for all readable fields.',
			},
			{
				displayName: 'Populate Relations',
				name: 'populate',
				type: 'string',
				default: '',
				placeholder: 'e.g. customer',
				description: 'Comma-separated relations to include as objects (max. 10).',
			},
			{
				displayName: 'Sort By',
				name: 'sortBy',
				type: 'string',
				default: '',
				placeholder: 'e.g. updatedAt',
				description: 'Field to sort by',
			},
			{
				displayName: 'Sort Direction',
				name: 'sortDirection',
				type: 'options',
				options: [
					{ name: 'Ascending', value: 'ASC' },
					{ name: 'Descending', value: 'DESC' },
				],
				default: 'DESC',
			},
		],
	},
];

const taskTypeOptions = FOLLOWUP_TASK_TYPES.map((value) => ({
	name: value
		.toLowerCase()
		.split('_')
		.map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
		.join(' '),
	value,
}));

const reminderTypeOptions = FOLLOWUP_REMINDER_TYPES.map((value) => ({
	name: value === 'email' ? 'Email' : 'In-App Notification',
	value,
}));

const followUpContentFields: INodeProperties[] = [
	{
		displayName: 'Assignee User ID',
		name: 'assigneeId',
		type: 'string',
		default: '',
		description: 'ID of the FlowCore user the follow-up is assigned to',
	},
	{
		displayName: 'Description',
		name: 'description',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description: 'Optional longer description',
	},
	{
		displayName: 'Due Date',
		name: 'dueDate',
		type: 'dateTime',
		default: '',
		description: 'When the follow-up is due. A plain date means the start of that day (UTC).',
	},
	{
		displayName: 'Reminder Date',
		name: 'reminderDate',
		type: 'dateTime',
		default: '',
		description: 'When to remind the assignee',
	},
	{
		displayName: 'Reminder Type',
		name: 'reminderType',
		type: 'options',
		options: reminderTypeOptions,
		default: 'notification',
	},
	{
		displayName: 'Task Type',
		name: 'taskType',
		type: 'options',
		options: taskTypeOptions,
		default: 'TODO',
	},
];

const followUpProperties: INodeProperties[] = [
	{
		displayName: 'Text',
		name: 'notice',
		type: 'string',
		required: true,
		default: '',
		description: 'What has to be done (max. 2000 characters).',
		displayOptions: { show: { resource: ['followUp'], operation: ['create'] } },
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['followUp'], operation: ['create'] } },
		options: (
			[
				...followUpContentFields,
				{
					displayName: 'Related Record ID',
					name: 'relatedRecordId',
					type: 'string',
					default: '',
					description: 'ID of the record the follow-up belongs to. Requires Related Resource.',
				},
				{
					displayName: 'Related Resource',
					name: 'relatedModel',
					type: 'options',
					options: FOLLOWUP_RELATED_MODELS,
					default: 'operationsbookings',
					description: 'Type of the record the follow-up belongs to. Requires Related Record ID.',
				},
				{
					displayName: 'Team IDs',
					name: 'teamIds',
					type: 'string',
					default: '',
					description: 'Comma-separated IDs of the teams (groups) the follow-up is assigned to',
				},
			] as INodeProperties[]
		).sort((a, b) => a.displayName.localeCompare(b.displayName)),
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['followUp'], operation: ['update'] } },
		options: (
			[
				...followUpContentFields,
				{
					displayName: 'Text',
					name: 'notice',
					type: 'string',
					default: '',
					description: 'What has to be done (max. 2000 characters).',
				},
			] as INodeProperties[]
		).sort((a, b) => a.displayName.localeCompare(b.displayName)),
	},
	{
		displayName:
			'To complete or reopen a follow-up, use the Execute Action operation with the actions "complete" and "reopen".',
		name: 'followUpDoneNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ['followUp'], operation: ['update'] } },
	},
];

const contactFields: INodeProperties[] = [
	{
		displayName: 'Email',
		name: 'email',
		type: 'string',
		placeholder: 'name@email.com',
		default: '',
	},
	{ displayName: 'First Name', name: 'firstname', type: 'string', default: '' },
	{ displayName: 'Last Name', name: 'lastname', type: 'string', default: '' },
	{ displayName: 'Mobile', name: 'mobile', type: 'string', default: '' },
	{
		displayName: 'Other Attributes (JSON)',
		name: 'attributesJson',
		type: 'json',
		default: '{}',
		description:
			'Further contact attributes as a JSON object, using FlowCore field names. FlowCore validates them; unknown or invalid attributes are rejected.',
	},
	{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
	{
		displayName: 'Prefix',
		name: 'prefix',
		type: 'string',
		default: '',
		placeholder: 'e.g. Dr.',
		description: 'Title or prefix of the contact',
	},
];

const contactProperties: INodeProperties[] = [
	{
		displayName: 'Fields',
		name: 'contactFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: { resource: ['contact'], operation: ['create', 'update'] } },
		options: contactFields,
	},
];

const actionProperties: INodeProperties[] = [
	{
		displayName: 'Action Name or ID',
		name: 'actionId',
		type: 'options',
		typeOptions: {
			loadOptionsMethod: 'getRecordActions',
			loadOptionsDependsOn: ['resource', 'recordId'],
		},
		required: true,
		default: '',
		description:
			'The action to run. The list is loaded from FlowCore for the record ID entered above and only shows actions the record currently offers to this user. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
		displayOptions: {
			show: { resource: ACTION_RESOURCES, operation: ['previewAction', 'executeAction'] },
		},
	},
	{
		displayName: 'Action Inputs (JSON)',
		name: 'actionInputs',
		type: 'json',
		default: '{}',
		description:
			'Input values for the action as a flat JSON object, e.g. {"cancellationDate": "2026-10-01"}. Use Preview Action to see which inputs an action accepts.',
		displayOptions: {
			show: { resource: ACTION_RESOURCES, operation: ['previewAction', 'executeAction'] },
		},
	},
	{
		displayName: 'Options',
		name: 'actionOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { resource: ACTION_RESOURCES, operation: ['executeAction'] } },
		options: [
			{
				displayName: 'Confirmed Preview Fingerprint',
				name: 'fingerprint',
				type: 'string',
				default: '',
				description:
					'Fingerprint from an earlier Preview Action, e.g. after a human approval step. FlowCore then only runs the action if its preview is still unchanged. Leave empty to preview and execute in one step.',
			},
		],
	},
	{
		displayName:
			'Execute Action changes data in FlowCore. Do not enable "Retry On Fail" for this operation.',
		name: 'executeActionNotice',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: ACTION_RESOURCES, operation: ['executeAction'] } },
	},
];

export const nodeProperties: INodeProperties[] = [
	resourceProperty,
	...operationProperties,
	recordIdProperty,
	...searchProperties,
	...contactProperties,
	...followUpProperties,
	...actionProperties,
];

import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { nodeProperties } from './description';
import { executeOperation } from './operations';
import { getModel, supportsActions } from './resources';
import { CREDENTIAL_NAME, flowCoreRequest, isObject } from './transport';

// Programmatic rather than declarative: executing a record action needs dependent requests
// (list actions → preview → execute with the preview's fingerprint), Get Many pages through
// skip/limit, and every request shares one error mapping that keeps secrets out of messages.
//
// Deliberately not `usableAsTool`: Execute Action changes business data, and FlowCore's own agent
// interface (MCP) adds an explicit confirmation step this node does not have.
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class FlowCore implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FlowCore',
		name: 'flowCore',
		icon: { light: 'file:flowcore.svg', dark: 'file:flowcore.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Read FlowCore records and run FlowCore record actions',
		defaults: { name: 'FlowCore' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_NAME, required: true }],
		properties: nodeProperties,
	};

	methods = {
		loadOptions: {
			/** Actions the entered record currently offers to the credential's user. */
			async getRecordActions(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const resource = this.getCurrentNodeParameter('resource') as string;
				const recordId = String(this.getCurrentNodeParameter('recordId') ?? '').trim();
				if (!supportsActions(resource)) return [];
				if (!recordId || recordId.startsWith('=')) {
					throw new NodeOperationError(
						this.getNode(),
						'Enter a fixed Record ID to load the available actions, or set the action ID with an expression',
					);
				}
				const model = getModel(resource);
				const body = await flowCoreRequest.call(this, {
					method: 'GET',
					path: `/api/${encodeURIComponent(model)}/${encodeURIComponent(recordId)}/actions`,
				});
				const actions = Array.isArray(body.actions) ? body.actions.filter(isObject) : [];
				return actions.map((action) => ({
					name: String(action.label ?? action.id),
					value: String(action.id),
					description: isObject(action.confirmation)
						? String(action.confirmation.description ?? action.confirmation.title ?? '')
						: undefined,
				}));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const results = await executeOperation.call(this, itemIndex);
				for (const json of results) {
					returnData.push({ json, pairedItem: { item: itemIndex } });
				}
			} catch (error) {
				if (this.continueOnFail()) {
					const json: IDataObject = { error: (error as Error).message };
					if (error instanceof NodeApiError) {
						if (error.description) json.description = error.description;
						if (error.httpCode) json.httpCode = error.httpCode;
					}
					returnData.push({ json, pairedItem: { item: itemIndex } });
					continue;
				}
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}

		return [returnData];
	}
}

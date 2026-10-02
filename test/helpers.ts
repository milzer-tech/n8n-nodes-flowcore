import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
} from 'n8n-workflow';
import { vi } from 'vitest';

/** A fake Staging-format key (prefix + 43 characters), assembled so it never looks like a real one. */
export const TEST_API_KEY = ['fc_test_', 'x'.repeat(43)].join('');

export interface FakeResponse {
	statusCode: number;
	body?: unknown;
}

/** A recorded call to helpers.httpRequestWithAuthentication. */
export interface RecordedRequest {
	credentialName: string;
	options: IHttpRequestOptions;
}

type Responder = (options: IHttpRequestOptions) => FakeResponse | Promise<FakeResponse>;

export interface ContextSetup {
	/** Node parameters; a function receives the item index. */
	params?: IDataObject | ((itemIndex: number) => IDataObject);
	items?: number;
	environment?: string;
	apiKey?: string;
	continueOnFail?: boolean;
	/** Responses in call order, or one function deciding per request. */
	responses?: Array<FakeResponse | Error> | Responder;
}

const node: INode = {
	id: 'flowcore-node',
	name: 'FlowCore',
	type: 'n8n-nodes-flowcore.flowCore',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

/**
 * Minimal stand-in for n8n's IExecuteFunctions/ILoadOptionsFunctions. The fake HTTP helper
 * mimics what n8n does with `returnFullResponse: true` + `ignoreHttpStatusErrors: true`: it
 * resolves with `{ statusCode, body }` for every HTTP status.
 */
export function createContext(setup: ContextSetup = {}) {
	const requests: RecordedRequest[] = [];
	const queue = Array.isArray(setup.responses) ? [...setup.responses] : undefined;
	const responder = typeof setup.responses === 'function' ? setup.responses : undefined;

	const paramsFor = (itemIndex: number): IDataObject =>
		typeof setup.params === 'function' ? setup.params(itemIndex) : (setup.params ?? {});

	const httpRequestWithAuthentication = vi.fn(
		async (credentialName: string, options: IHttpRequestOptions) => {
			requests.push({ credentialName, options });
			let next: FakeResponse | Error | undefined;
			if (responder) next = await responder(options);
			else next = queue?.shift();
			if (!next) throw new Error(`Unexpected request ${options.method} ${options.url}`);
			if (next instanceof Error) throw next;
			return { statusCode: next.statusCode, headers: {}, body: next.body };
		},
	);

	const context = {
		getNode: () => node,
		getInputData: () => Array.from({ length: setup.items ?? 1 }, () => ({ json: {} })),
		getCredentials: async () => ({
			environment: setup.environment ?? 'staging',
			apiKey: setup.apiKey ?? TEST_API_KEY,
		}),
		getNodeParameter: (name: string, itemIndex: number, fallback?: unknown) => {
			const params = paramsFor(itemIndex);
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Missing test parameter "${name}"`);
		},
		getCurrentNodeParameter: (name: string) => paramsFor(0)[name],
		continueOnFail: () => setup.continueOnFail ?? false,
		helpers: { httpRequestWithAuthentication },
	};

	return {
		context: context as unknown as IExecuteFunctions & ILoadOptionsFunctions,
		requests,
		httpRequestWithAuthentication,
	};
}

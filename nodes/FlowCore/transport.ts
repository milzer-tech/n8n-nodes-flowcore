import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { API_KEY_PREFIXES, getBaseUrl, isFlowCoreEnvironment } from './environments';

export const CREDENTIAL_NAME = 'flowCoreApi';

/** Page size cap of FlowCore's native read API (/overview): blueprints.maxLimit = 300. */
export const MAX_PAGE_SIZE = 300;

type FlowCoreContext = IExecuteFunctions | ILoadOptionsFunctions;

export interface FlowCoreRequest {
	method: IHttpRequestMethods;
	path: string;
	qs?: IDataObject;
	body?: IDataObject;
	itemIndex?: number;
}

interface FlowCoreCredentials {
	environment?: string;
	apiKey?: string;
}

interface FullResponse {
	statusCode: number;
	body: unknown;
}

/**
 * Sends one request to the FlowCore API of the environment selected in the credential.
 *
 * Every operation and option loader goes through here, so base URL resolution, authentication
 * (x-api-key, added by the credential) and error mapping are identical everywhere. Requests are
 * never retried here; mutating calls must not be repeated blindly.
 */
export async function flowCoreRequest(
	this: FlowCoreContext,
	request: FlowCoreRequest,
): Promise<IDataObject> {
	const credentials = (await this.getCredentials(CREDENTIAL_NAME)) as FlowCoreCredentials;

	let baseURL: string;
	try {
		baseURL = getBaseUrl(credentials.environment);
	} catch (error) {
		throw new NodeOperationError(this.getNode(), (error as Error).message, {
			itemIndex: request.itemIndex,
		});
	}

	const options: IHttpRequestOptions = {
		method: request.method,
		baseURL,
		url: request.path,
		headers: { Accept: 'application/json' },
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	if (request.qs && Object.keys(request.qs).length) options.qs = request.qs;
	if (request.body !== undefined) options.body = request.body;

	let response: FullResponse;
	try {
		response = (await this.helpers.httpRequestWithAuthentication.call(
			this,
			CREDENTIAL_NAME,
			options,
		)) as FullResponse;
	} catch (error) {
		// Network-level failure (DNS, TLS, timeout). Only the message is passed on: the
		// original error object carries the request configuration including headers.
		const message = (error as Error)?.message || 'Unknown network error';
		throw new NodeApiError(this.getNode(), { message } as JsonObject, {
			message: `Could not reach FlowCore (${String(credentials.environment)})`,
			description: message,
			itemIndex: request.itemIndex,
		});
	}

	const body = parseBody(response.body);
	if (response.statusCode >= 400 || (isObject(body) && body.success === false)) {
		throw toFlowCoreError(this, response.statusCode, body, credentials, request);
	}
	if (!isObject(body)) {
		throw new NodeApiError(this.getNode(), { message: 'Unexpected response' } as JsonObject, {
			message: 'FlowCore returned an unexpected response',
			description: `Expected a JSON object from ${request.method} ${request.path}.`,
			httpCode: String(response.statusCode),
			itemIndex: request.itemIndex,
		});
	}
	return body;
}

function parseBody(body: unknown): unknown {
	if (typeof body !== 'string') return body;
	if (!body.trim()) return undefined;
	try {
		return JSON.parse(body) as unknown;
	} catch {
		return body;
	}
}

export function isObject(value: unknown): value is IDataObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Maps a FlowCore error response to an actionable NodeApiError.
 *
 * Verified response shapes (milzer-tech/flowcore):
 * - auth/permission policies: `{ code, status, name, message }`; missing permissions are a 401
 *   with code 702 / name InsufficientPermissionsError (config/errors.js)
 * - record actions: `{ success: false, message, meta? }` with 403/404/409
 * - overview/count/aggregate: `{ message }` with 400/403/404/413/504
 * - blueprint 400/403/404/500 in production: empty body
 */
export function toFlowCoreError(
	context: FlowCoreContext,
	statusCode: number,
	body: unknown,
	credentials: FlowCoreCredentials,
	request: FlowCoreRequest,
): NodeApiError {
	const serverMessage =
		isObject(body) && typeof body.message === 'string' && body.message.trim()
			? body.message.trim()
			: typeof body === 'string' && body.trim() && body.length < 500
				? body.trim()
				: undefined;
	const name = isObject(body) && typeof body.name === 'string' ? body.name : undefined;
	const code = isObject(body) ? body.code : undefined;
	const environment = String(credentials.environment);

	let message: string;
	let hint: string | undefined;

	if (statusCode === 401 && (code === 702 || name === 'InsufficientPermissionsError')) {
		message = 'The FlowCore user of this API key lacks the permission for this operation';
		hint = 'Ask a FlowCore administrator to grant the required role permission to the user.';
	} else if (statusCode === 401) {
		message = `FlowCore rejected the API key (${environment})`;
		hint =
			keyEnvironmentHint(credentials) ??
			'Check that the API key is current and not revoked, and that the credential’s environment matches the key.';
	} else if (statusCode === 403) {
		message = 'The FlowCore user of this API key is not allowed to do this';
	} else if (statusCode === 404) {
		message = 'FlowCore could not find the requested resource';
		hint =
			'The record may not exist, may be deleted, or may belong to another FlowCore client. For record actions, the action ID may be unknown for this resource.';
	} else if (statusCode === 409) {
		message = 'FlowCore refused the action in the record’s current state';
		hint =
			'The action may not be available for this record any more, or the preview changed since it was fetched. Run Preview Action again.';
	} else if (statusCode === 400) {
		message = 'FlowCore rejected the request as invalid';
	} else if (statusCode === 413) {
		message = 'The FlowCore response would be too large';
		hint = 'Request fewer records per page or fewer fields.';
	} else if (statusCode === 504) {
		message = 'The FlowCore query timed out';
		hint = 'Narrow the filter or request fewer records.';
	} else if (statusCode >= 500) {
		message = `FlowCore returned a server error (${statusCode})`;
	} else {
		// HTTP 2xx with `success: false`, e.g. an authentication failure reported in the body.
		message = 'FlowCore reported that the request failed';
	}

	const description = [serverMessage, hint].filter(Boolean).join(' ');
	const errorBody: JsonObject = { message: serverMessage ?? message, httpCode: statusCode };
	if (isObject(body) && isObject(body.meta)) errorBody.meta = body.meta as JsonObject;

	return new NodeApiError(context.getNode(), errorBody, {
		message,
		description: description || `${request.method} ${request.path} failed with HTTP ${statusCode}.`,
		httpCode: String(statusCode),
		itemIndex: request.itemIndex,
	});
}

/** Points out a key from the other environment without revealing the key itself. */
function keyEnvironmentHint(credentials: FlowCoreCredentials): string | undefined {
	const { environment, apiKey } = credentials;
	if (!isFlowCoreEnvironment(environment) || typeof apiKey !== 'string') return undefined;
	const expected = API_KEY_PREFIXES[environment];
	const other = (Object.keys(API_KEY_PREFIXES) as Array<keyof typeof API_KEY_PREFIXES>).find(
		(env) => env !== environment && apiKey.startsWith(API_KEY_PREFIXES[env]),
	);
	if (!other) return undefined;
	return `The API key looks like a ${other} key, but the credential uses ${environment} (expected prefix ${expected}).`;
}

export interface PageResult {
	records: IDataObject[];
	total?: number;
}

/**
 * Reads pages through skip/limit until the requested number of records is reached or the
 * server returns a short page. FlowCore's native read API caps each page at 300 records and
 * reports the full match count in `total`.
 */
export async function paginate(
	fetchPage: (skip: number, limit: number) => Promise<PageResult>,
	returnAll: boolean,
	limit: number,
): Promise<IDataObject[]> {
	const wanted = returnAll ? Number.POSITIVE_INFINITY : Math.max(0, limit);
	const results: IDataObject[] = [];
	let skip = 0;

	while (results.length < wanted) {
		const pageSize = Math.min(MAX_PAGE_SIZE, wanted - results.length);
		const page = await fetchPage(skip, pageSize);
		const records = page.records;
		results.push(...records.slice(0, wanted - results.length));
		skip += records.length;

		if (records.length < pageSize) break;
		if (typeof page.total === 'number' && skip >= page.total) break;
	}

	return results;
}

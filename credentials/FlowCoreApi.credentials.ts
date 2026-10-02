import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';
import { BASE_URL_EXPRESSION, DEFAULT_ENVIRONMENT } from '../nodes/FlowCore/environments';

export class FlowCoreApi implements ICredentialType {
	name = 'flowCoreApi';

	displayName = 'FlowCore API';

	icon: Icon = {
		light: 'file:../nodes/FlowCore/flowcore.svg',
		dark: 'file:../nodes/FlowCore/flowcore.dark.svg',
	};

	documentationUrl = 'https://github.com/milzer-tech/n8n-nodes-flowcore#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Environment',
			name: 'environment',
			type: 'options',
			required: true,
			options: [
				{ name: 'Production', value: 'production' },
				{ name: 'Staging', value: 'staging' },
			],
			default: DEFAULT_ENVIRONMENT,
			description: 'The FlowCore environment the API key belongs to',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'Personal API key of a FlowCore user. All requests run with this user’s permissions. Production keys start with fc_live_, Staging keys with fc_test_.',
		},
	];

	// FlowCore reads the key from the x-api-key header. No Authorization header may be sent:
	// FlowCore routes any request carrying one through HTTP Basic authentication instead.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

	// GET /me/api-key is read-only, needs only a valid key and returns key metadata without
	// secrets (milzer-tech/flowcore docs/user-api-keys.md).
	test: ICredentialTestRequest = {
		request: {
			baseURL: BASE_URL_EXPRESSION,
			url: '/me/api-key',
			method: 'GET',
			headers: { Accept: 'application/json' },
		},
	};
}

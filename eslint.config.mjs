import { config } from '@n8n/node-cli/eslint';

export default [
	...config,
	{
		// Tests are not shipped in the package. They may read live-test settings from the
		// environment, use a fake API key and evaluate the credential's base URL expression.
		files: ['test/**/*.ts'],
		rules: {
			'@n8n/community-nodes/no-restricted-globals': 'off',
			'@n8n/community-nodes/no-hardcoded-secrets': 'off',
			'@n8n/community-nodes/no-dangerous-functions': 'off',
		},
	},
];

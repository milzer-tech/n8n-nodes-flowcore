declare module 'vitest' {
	export interface ProvidedContext {
		flowcoreLive: {
			environment: string;
			apiKey: string;
			resource: string;
			recordId: string;
		};
	}
}

export {};

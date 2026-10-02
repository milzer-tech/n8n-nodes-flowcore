/**
 * Response fixtures shaped after verified FlowCore contracts (milzer-tech/flowcore).
 * IDs and values are synthetic; no customer data.
 */

export const BOOKING_ID = '68c1a2b3c4d5e6f708192a3b';
export const FOLLOWUP_ID = '68c1a2b3c4d5e6f708192a3c';

/** GET /api/<model>/:id - api/blueprints/findone.js */
export const findOneResponse = {
	success: true,
	total: 1,
	records: [{ id: BOOKING_ID, status: 'BOOKED', updatedAt: '2026-09-30T08:00:00.000Z' }],
};

/** GET /api/<model>/overview - NativeOverviewService.ts: { records, total } */
export function overviewPage(from: number, count: number, total: number) {
	return {
		records: Array.from({ length: count }, (_, index) => ({ id: `record-${from + index}` })),
		total,
	};
}

/** GET /api/<model>/count - AggregateService.ts */
export const countResponse = { count: 42 };

/** POST /api/<model> - api/blueprints/create.js (HTTP 201) */
export const createResponse = {
	success: true,
	total: 1,
	records: [{ id: FOLLOWUP_ID, notice: 'Call the customer' }],
};

/** GET /api/:model/:id/actions - docs/development/record-actions.md */
export const actionsResponse = {
	actions: [
		{
			id: 'cancel',
			label: 'Stornieren',
			icon: 'x-circle',
			variant: 'danger',
			placement: 'primary',
			confirmation: {
				mode: 'preview',
				title: 'Vorgang stornieren?',
				description: 'Der Status des Vorgangs wird auf "Storniert" gesetzt.',
			},
		},
		{ id: 'createInvoice', label: 'Rechnung erstellen', placement: 'menu' },
	],
};

/** POST /api/:model/:id/actions/:action/preview */
export const previewResponse = {
	preview: {
		summary: [{ label: 'Reisepreis', value: '1.600,00 €' }],
		notices: [{ tone: 'warning', text: 'Nur der Status wird gesetzt.' }],
		inputs: [{ name: 'cancellationDate', type: 'date', label: 'Stornodatum', value: '2026-09-21' }],
		fingerprint: 'a91f00000000000000000000000000aa',
	},
};

/** POST /api/:model/:id/actions/:action */
export const executeResponse = {
	success: true,
	data: { status: 'CANCELED', cancellationDate: '2026-09-21T00:00:00.000Z' },
	meta: { actions: [] },
};

/** 409 from the fingerprint gate, carrying the fresh preview (RecordActionsController.ts). */
export const staleFingerprintResponse = {
	success: false,
	message: 'Die Vorschau hat sich inzwischen geändert. Bitte erneut prüfen und bestätigen.',
	meta: { preview: { summary: [], notices: [], fingerprint: '7c02' } },
};

/** 401 from isAuthenticated - config/errors.js AuthenticationError */
export const authenticationError = {
	code: 701,
	status: 401,
	name: 'AuthenticationError',
	message: 'You must be authenticated to access this resources.',
};

/** 401 from hasModelPermissions - config/errors.js InsufficientPermissionsError */
export const insufficientPermissionsError = {
	code: 702,
	status: 401,
	name: 'InsufficientPermissionsError',
	message: 'You have insufficient permissions to perform this action.',
};

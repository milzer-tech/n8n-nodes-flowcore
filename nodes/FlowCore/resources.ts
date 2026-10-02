/**
 * The FlowCore resources this node exposes, mapped to their verified model identities
 * (milzer-tech/flowcore src/api/models, routes /api/<model>).
 *
 * `actions` marks models registered for record actions (RecordActionsService REGISTRY).
 * `write` marks models whose blueprint create/update FlowCore itself uses as a business path:
 * follow-ups (MCP create_followup/update_followup) and contacts (customer integrations). Bookings
 * and invoices are changed only through record actions; FlowCore calls generic writes on them
 * "unsafe" because they bypass business workflows.
 */
export const RESOURCES = {
	booking: { model: 'operationsbookings', label: 'Booking', actions: true, write: false },
	contact: { model: 'contacts', label: 'Contact', actions: false, write: true },
	followUp: { model: 'followups', label: 'Follow-Up', actions: true, write: true },
	invoice: { model: 'invoices', label: 'Invoice', actions: true, write: false },
	travel: { model: 'travels', label: 'Travel', actions: false, write: false },
} as const;

export type ResourceKey = keyof typeof RESOURCES;

export function getModel(resource: string): string {
	const definition = (RESOURCES as Record<string, { model: string }>)[resource];
	if (!definition) throw new Error(`Unsupported FlowCore resource "${resource}"`);
	return definition.model;
}

export function supportsActions(resource: string): boolean {
	return Boolean((RESOURCES as Record<string, { actions: boolean }>)[resource]?.actions);
}

const keys = Object.keys(RESOURCES) as ResourceKey[];
export const ACTION_RESOURCES = keys.filter((key) => RESOURCES[key].actions);
export const WRITE_RESOURCES = keys.filter((key) => RESOURCES[key].write);
export const ALL_RESOURCES = keys;

/** Records a follow-up can be attached to (MCP FOLLOWUP_RECORD_RESOURCES → model identity). */
export const FOLLOWUP_RELATED_MODELS = [
	{ name: 'Accommodation', value: 'accommodations' },
	{ name: 'Agency', value: 'agencies' },
	{ name: 'Booking', value: 'operationsbookings' },
	{ name: 'Contact', value: 'contacts' },
	{ name: 'Invoice', value: 'invoices' },
	{ name: 'Supplier', value: 'suppliers' },
	{ name: 'Travel', value: 'travels' },
];

/** Verified enums from milzer-tech/flowcore src/api/mcp/semantic-registry.ts. */
export const FOLLOWUP_TASK_TYPES = [
	'BOOKING_OR_CHANGE_REQUEST',
	'CANCELLATION_CUSTOMER_FOLLOWUP',
	'CANCELLATION_DEADLINE',
	'CANCELLATION_FOLLOWUP_DATE',
	'CANCELLATION_FROM',
	'CUSTOMER_DOWN_PAYMENT',
	'FREE_CANCELLATION_UNTIL',
	'PAYMENT_DEADLINE',
	'TODO',
];
export const FOLLOWUP_REMINDER_TYPES = ['email', 'notification'];

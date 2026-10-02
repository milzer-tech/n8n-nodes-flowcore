# Changelog

## 0.1.1

- The node can be used as an AI agent tool (`usableAsTool`), as required for n8n verification.
  Require human approval when an agent may execute actions.

## 0.1.0

- FlowCore API credential with Production/Staging environment and API key (x-api-key), tested
  via `GET /me/api-key`.
- FlowCore node: bookings, contacts, follow-ups, invoices and travels with Get, Get Many
  (paginated `/overview`), Count; Create/Update for contacts and follow-ups; Get Actions, Preview
  Action and Execute Action for bookings, follow-ups and invoices.

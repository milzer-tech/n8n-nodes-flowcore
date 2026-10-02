# n8n-nodes-flowcore

n8n community node for [FlowCore](https://flowcore.cloud), the travel ERP platform. It reads
FlowCore records and runs FlowCore record actions from n8n workflows.

Business logic and authorization stay in FlowCore: every request runs as the FlowCore user who
owns the API key, inside that user's client (tenant), with that user's permissions. The node only
orchestrates.

- [Installation](#installation)
- [Credentials](#credentials)
- [Resources and operations](#resources-and-operations)
- [Record actions](#record-actions)
- [Webhooks](#webhooks)
- [Example workflow](#example-workflow)
- [Development](#development)
- [Known limitations](#known-limitations)
- [Publishing and n8n verification](#publishing-and-n8n-verification)

## Installation

Self-hosted n8n only (until the package is verified by n8n).

**From npm (once published):** In n8n, go to **Settings → Community Nodes → Install** and enter
`n8n-nodes-flowcore`. See the
[n8n docs on installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

**Before publication, from a build of this repository:**

```bash
npm ci
npm run build
npm pack                      # creates n8n-nodes-flowcore-<version>.tgz
```

Install the tarball into the n8n custom extensions folder (default `~/.n8n/custom`, or the
directory in `N8N_CUSTOM_EXTENSIONS`) and restart n8n:

```bash
cd ~/.n8n/custom
npm install /path/to/n8n-nodes-flowcore-0.1.0.tgz
```

With Docker, mount that folder into the container (`/home/node/.n8n/custom`).

## Credentials

Create a credential of type **FlowCore API**:

| Field       | Description                                                               |
| ----------- | ------------------------------------------------------------------------- |
| Environment | `Production` (default) or `Staging`.                                      |
| API Key     | Personal API key of a FlowCore user. Stored encrypted by n8n as a secret. |

The environment selects a fixed API base URL. There is no free-text URL field and no fallback
from one environment to the other:

| Environment | API base URL                         |
| ----------- | ------------------------------------ |
| Production  | `https://app.flowcore.cloud`         |
| Staging     | `https://app-staging.flowcore.cloud` |

**Getting an API key:** in FlowCore's API key management, a user creates their own key, or an
administrator creates one for a user (permissions `API_KEYS_MANAGE_OWN` / `ADMIN_USERS_API_KEYS`).
The key is shown only once. Production keys start with `fc_live_`, Staging keys with `fc_test_`.
Use a dedicated technical user per customer integration and give it only the role permissions the
workflow needs (for example `FOLLOWUPS_ADD`, `OPERATIONSBOOKINGS_EDIT`).

**Testing:** n8n's **Test** button calls `GET /me/api-key` in the selected environment. It
reads only the key's metadata.

**One credential per customer and environment.** A key belongs to exactly one FlowCore client,
so create separate credential entries, for example `FlowCore – Customer A (Staging)` and
`FlowCore – Customer A (Production)`. Build and test the workflow against the Staging credential,
then switch the node to the Production credential. There is intentionally no tenant selector: the
key alone determines the customer.

The key is sent in the `x-api-key` header. The node never logs it, and n8n never exports it with
workflows.

## Resources and operations

| Resource  | FlowCore model       | Operations                                                                        |
| --------- | -------------------- | --------------------------------------------------------------------------------- |
| Booking   | `operationsbookings` | Get, Get Many, Count, Get Actions, Preview Action, Execute Action                 |
| Contact   | `contacts`           | Get, Get Many, Count, Create, Update                                              |
| Follow-Up | `followups`          | Get, Get Many, Count, Create, Update, Get Actions, Preview Action, Execute Action |
| Invoice   | `invoices`           | Get, Get Many, Count, Get Actions, Preview Action, Execute Action                 |
| Travel    | `travels`            | Get, Get Many, Count                                                              |

- **Get**: `GET /api/<model>/<id>`. Returns the record.
- **Get Many**: `GET /api/<model>/overview`. Returns one item per record. Options:
  - **Return All**, or a **Limit**. Pages are read with `skip`/`limit`, at most 300 records per
    request.
  - Filters: **Search Text** (FlowCore's free-text search) and **Where (JSON)** (FlowCore
    criteria, e.g. `{"status": "BOOKED", "createdAt": {">=": "2026-01-01T00:00:00Z"}}`).
  - **Sort By** / **Sort Direction**, **Fields**, **Populate Relations**.
  - Unknown fields or invalid filters are rejected by FlowCore with HTTP 400 and are not ignored
    silently. ISO timestamps in filters need a timezone.
- **Count**: `GET /api/<model>/count` with the same filters. Returns `{ "count": n }`.
- **Create / Update** (contacts and follow-ups only): `POST /api/<model>` and
  `PUT /api/<model>/<id>`. Only the fields you set are sent.
  - Follow-ups: text, description, due date, reminder, task type, assignee. On create, also
    teams and a related record. The related record is read first, so a follow-up can only be
    attached to a record the user may read. To complete or reopen a follow-up, use the
    `complete` / `reopen` actions.
  - Contacts: first name, last name, email, phone, mobile, prefix, plus **Other Attributes
    (JSON)** for further FlowCore fields. FlowCore validates them.

Bookings and invoices are deliberately read-only apart from record actions: FlowCore itself
treats raw writes to them as unsafe because they bypass its business workflows.

Each output item is linked to the input item it came from. With **Continue On Fail**, a failed
item returns `{ error, description, httpCode }` and the remaining items still run.

## Record actions

Record actions are FlowCore's business operations on a record, for example cancelling a booking,
creating an invoice, issuing or sending an invoice, or completing a follow-up. FlowCore decides
which actions a record offers, whether the user may run them, and what they do. The node does not
re-implement any of this.

- **Get Actions** (`GET /api/<model>/<id>/actions`) lists the actions the record offers _now_
  to _this user_. Actions ruled out by the record's state or the user's permissions are absent.
- **Preview Action** (`POST …/actions/<action>/preview`) shows what the action would do, without
  side effects. It returns `summary`, `notices`, the accepted `inputs` and a `fingerprint`.
- **Execute Action** (`POST …/actions/<action>`) runs the action and returns the changed fields
  (`data`) and the actions available afterwards. It proceeds as follows:
  1. It checks the action list. If FlowCore no longer offers the action, the node fails
     without changing anything.
  2. For actions with a preview, it fetches a fresh preview and sends its fingerprint, as
     FlowCore requires.
  3. Actions that need an interactive FlowCore dialog (`confirmation.mode = view`) are refused.
  4. If you set **Confirmed Preview Fingerprint** (from an earlier Preview Action, e.g. after a
     human approval step via _Send and Wait_), the node sends that fingerprint instead. FlowCore
     then refuses with HTTP 409 if the preview has changed since the approval.

**Action Name or ID** is loaded from FlowCore for the resource and the **Record ID** entered in
the node. When the record ID is an expression, set the action ID with an expression too (e.g.
`cancel`). **Action Inputs (JSON)** is a flat object such as
`{"cancellationDate": "2026-10-01"}`. Run Preview Action to see which inputs an action accepts.

Execute Action is never retried by the node. Do not enable **Retry On Fail** for it. If an AI
agent uses the node as a tool, require human approval for that tool.

## Webhooks

FlowCore can call a URL when records change. This MVP has no custom FlowCore trigger node:
FlowCore has no API to register and remove webhooks, so n8n could not manage their lifecycle.
Use the standard **Webhook** node instead.

1. Add a **Webhook** node, method `POST`. Use a long, random path, because FlowCore does not
   sign its requests.
2. Activate the workflow and copy the **Production URL**.
3. In FlowCore's settings, open the webhook configuration (stored as `webhooks` in the client
   settings; requires access to Settings). Add the URL and select the modules or system events:
   - Modules are model identities such as `contacts`, `followups` or `travels`, and fire on
     create, update and destroy.
   - The booking status events are `BOOKING_CHANGED_STATUS_TO_BOOKED`, `…_REQUESTED` and
     `…_CANCELED`.
4. FlowCore sends a JSON body like this:

   ```json
   {
   	"model": "operationsbookings",
   	"action": "update",
   	"payload": [{ "id": "68c1a2b3c4d5e6f708192a3b" }],
   	"key": "…",
   	"secret": "…"
   }
   ```

   For a system event, `action` is the event name (e.g. `BOOKING_CHANGED_STATUS_TO_CANCELED`)
   and `model` is `operationsbookings`. `payload` contains only record IDs. Fetch the current record with a FlowCore **Get** node
   (`{{ $json.body.payload[0].id }}`) instead of trusting the webhook body.

Delivery details from FlowCore's implementation:

- Events are debounced for about 3 seconds per record.
- There are no retries; a failed delivery is only logged by FlowCore.
- There is no signature header.

> **Security note:** for compatibility with older integrations, FlowCore currently puts the
> client's legacy shared API key into `key` and the client ID into `secret`. n8n stores webhook
> bodies in its execution data. Restrict access to these executions, or turn off saving
> successful executions for the workflow, until FlowCore removes these fields.

A FlowCore Trigger node is a possible future extension once FlowCore offers webhook
registration, deregistration and signed deliveries.

## Example workflow

[`examples/booking-cancelled-follow-up.json`](examples/booking-cancelled-follow-up.json) can be
imported via **Workflows → Import from File**. It runs these steps:

1. **Webhook** receives `BOOKING_CHANGED_STATUS_TO_CANCELED` from FlowCore.
2. **FlowCore → Booking → Get** reads the current booking.
3. **FlowCore → Follow-Up → Create** creates a follow-up "Check cancellation fees" attached to
   the booking, due in two days.

After importing, select your own FlowCore credential in both FlowCore nodes. The example contains
no credentials or customer data.

## Development

Requirements: Node.js ≥ 22.12, npm.

```bash
npm ci
npm run dev          # starts n8n with this node hot-reloaded (http://localhost:5678)
npm run build        # n8n-node build → dist/
npm run lint         # n8n community-node lint rules
npm run format       # prettier
npm run typecheck    # TypeScript incl. tests
npm test             # fixture-based tests (no network)
```

### Tests

- **Fixture-based tests** (`test/*.test.ts`, run by `npm test` and CI) do not need network or
  credentials. Their fixtures in `test/fixtures.ts` follow FlowCore's documented response shapes.
  They cover the environment mapping, credential and request construction, pagination, response
  mapping, record actions and error handling.
- **Live tests** (`test/live/*.live.test.ts`, `npm run test:live`) call a real FlowCore
  environment.
  - They are skipped unless they are configured explicitly.
  - They are **read-only**: they refuse any non-GET request, so they never change data, not
    even on Staging.
  - Use a test user's key:

```bash
FLOWCORE_LIVE_ENVIRONMENT=staging \
FLOWCORE_LIVE_API_KEY=fc_test_... \
FLOWCORE_LIVE_RESOURCE=booking \
FLOWCORE_LIVE_RECORD_ID=<booking id on staging> \
npm run test:live
```

There are no automated mutating tests against any environment. Test create, update and execute
manually on Staging with test data.

## Known limitations

- Five resources only (bookings, contacts, follow-ups, invoices, travels). Other FlowCore models
  can be read with n8n's HTTP Request node, using the FlowCore API credential.
- No create/update for bookings, invoices or travels. Booking creation through FlowCore's booking
  API (`/api/v3/travel/legacy/book`) is not part of the MVP.
- No delete operation.
- Field inputs are offered only for verified fields. Other fields use JSON with FlowCore's field
  names, and the node does not validate them.
- Updates cannot clear a field (empty inputs are not sent).
- Get Many uses offset pagination. Records written during a long "Return All" run can shift
  between pages. Each request returns at most 300 records.
- Action options can only be loaded for a fixed record ID.
- Actions that need an interactive FlowCore dialog (`view` mode) cannot run from n8n.
- The node can be used as an AI agent tool. Execute Action then runs without the confirmation
  step of FlowCore's MCP interface. Give agents the node only with n8n's human approval for
  tools enabled, or limit the tool to read operations.
- No FlowCore Trigger node (see [Webhooks](#webhooks)).
- FlowCore has no inbound rate limiting today. Keep batch sizes and concurrency moderate anyway.

## Publishing and n8n verification

Not done yet. The process, when the package is ready:

1. Make the GitHub repository public. n8n verification requires a public repository whose URL
   matches `repository.url` in `package.json`.
2. Set up npm publishing from GitHub Actions with provenance
   ([`.github/workflows/publish.yml`](.github/workflows/publish.yml)). Prefer npm Trusted
   Publishing (OIDC) over a stored token. n8n requires provenance for verification since
   1 May 2026.
3. Run `npm run release` locally. It lints, builds, bumps the version, updates the changelog, tags
   and pushes. The tag triggers the publish workflow.
4. Check the published package with `npx @n8n/scan-community-package n8n-nodes-flowcore`.
5. Submit it in the [n8n Creator Portal](https://creators.n8n.io/nodes). Requirements include:
   - no runtime dependencies
   - MIT license
   - English UI
   - documentation
   - the [technical](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/)
     and [UX guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/ux-guidelines/)

## License

[MIT](LICENSE.md)

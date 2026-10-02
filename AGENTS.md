# n8n-nodes-flowcore – agent guide

n8n community node for FlowCore (travel ERP). One credential (`FlowCoreApi`), one programmatic
node (`FlowCore`). FlowCore owns business logic and authorization; this package only calls its
API.

## Architecture

```
credentials/FlowCoreApi.credentials.ts   Environment dropdown + API key, x-api-key header, test GET /me/api-key
nodes/FlowCore/environments.ts           THE ONLY place with base URLs (production/staging) + key prefixes
nodes/FlowCore/transport.ts              flowCoreRequest(): base URL, request options, error mapping; paginate()
nodes/FlowCore/resources.ts              node resource → FlowCore model identity, which support actions/writes
nodes/FlowCore/description.ts            UI properties (resource/operation pattern)
nodes/FlowCore/operations.ts             per-operation logic (get, getAll, count, create, update, actions)
nodes/FlowCore/FlowCore.node.ts          node class: execute loop (item linking, continueOnFail), loadOptions
test/                                    fixture-based vitest tests; test/live = read-only live tests
examples/                                importable example workflow (placeholder credentials only)
```

Rules that must hold:

- Every HTTP call goes through `flowCoreRequest` (`helpers.httpRequestWithAuthentication` with
  the `flowCoreApi` credential). No `fetch`/axios, no runtime dependencies.
- The base URL always comes from `getBaseUrl(credentials.environment)`. There is no URL field, no
  custom environment and no fallback between Production and Staging.
- Never send an `Authorization` header. FlowCore routes it into HTTP Basic auth.
- Never put the API key, request headers or raw HTTP client errors into error messages or output.
- Mutating requests (POST/PUT, Execute Action) are never retried automatically.
- No tenant/client selector: the API key determines the FlowCore client.
- Do not re-implement FlowCore business rules (availability, permissions, action effects).

## Verify API contracts before changing them

Do not invent endpoints, parameters, headers or response fields. The FlowCore backend is
`milzer-tech/flowcore` (Sails.js). Verify every contract there before coding against it, and
cite the source in a comment or the fixture:

| Topic                     | Where to look in milzer-tech/flowcore                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| Auth (x-api-key)          | `config/http.js`, `src/api/services/UserApiKeyAuthService.ts`, `docs/user-api-keys.md` |
| Base URLs                 | `config/env/production.js`, `config/env/staging.js`, `README.md`                       |
| Blueprint CRUD + envelope | `config/blueprints.js`, `api/blueprints/*.js`                                          |
| overview/count/aggregate  | `docs/development/native-read-api.md`, `src/api/services/ReadRequestService.ts`        |
| Record actions            | `docs/development/record-actions.md`, `src/api/services/RecordActionsService.ts`       |
| Errors                    | `config/errors.js`, `api/responses/*.js`, controllers' error handlers                  |
| Webhooks                  | `src/api/services/WebhooksService.ts`, `WebhooksWorkerService.ts`                      |
| Business-safe writes      | `src/api/mcp/*` (what FlowCore's own MCP exposes and calls "unsafe")                   |
| OpenAPI                   | `docs/v1/tourware.json` (generated), served at `/docs`                                 |

If a contract cannot be verified, leave the feature out and document it as a limitation.
Update `test/fixtures.ts` whenever a verified response shape changes.

## Commands

Node.js ≥ 22.12.

```bash
npm ci
npm run dev          # n8n with the node hot-reloaded
npm run build        # n8n-node build
npm run lint         # n8n community-node lint (must pass; verification requirement)
npm run format       # prettier (format:check in CI)
npm run typecheck    # tsc incl. tests
npm test             # fixture-based tests, no network
npm run test:live    # read-only live tests; needs FLOWCORE_LIVE_ENVIRONMENT + FLOWCORE_LIVE_API_KEY
```

Live tests must stay read-only. Never add mutating live tests that can run against Production.

## n8n conventions

The scaffold's guides in `.agents/` describe n8n node conventions (`nodes.md`, `properties.md`,
`nodes-programmatic.md`, `credentials.md`, `versioning.md`). Breaking parameter changes need a new
node version (see `versioning.md`). Update `CHANGELOG.md` with every version bump. UI texts,
code and docs are in English.

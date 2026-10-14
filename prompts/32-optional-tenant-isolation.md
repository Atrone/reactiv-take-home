# Prompt 32 — Optional tenant isolation

Do not run this prompt unless the user explicitly asks for tenant isolation or for SCL01. Prompt 31 must already be done. This work is a production extension. It is not required by the take-home PDF.

## Read first

- Architecture section 8, the row-level security paragraphs, including the warning that superusers and `BYPASSRLS` bypass policies
- Acceptance criteria SCL01
- Take-home PDF page 3, only to keep the private service credential distinct from user authorization

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- A service bearer token authenticates the editor process. It is not merchant authorization.
- The browser still must not send a tenant id that the server trusts.
- Do not claim production identity security, SSO, or a penetration test.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/32-optional-tenant-isolation.md`.

## Goal

Two demo tenants cannot read or update each other's configurations by id. Postgres row-level security is enforced with the role the service actually uses, not with a superuser.

## Implement

1. Add a second tenant id in the environment, used only by tests, or create both tenants inside the test. Do not put a tenant picker in the UI.
2. The app server's demo scope still comes from server environment. Add a test-only server path or an injected scope in tests so a second tenant can be selected without reading a browser field. Production-shaped code should take the tenant from the trusted server context. If you add a real session cookie, it must be HttpOnly and it must not be the config-service token.
3. Repository methods already take `tenantId`. Add tests that tenant A's id is not-found when requested as tenant B, for get and for update, and that the 404 body does not include tenant A's document.
4. Enable RLS on `configurations`. The policy compares `tenant_id` to a transaction-local setting. Set that setting on the same connection that runs the query, and reset it when the connection returns to the pool.
5. The config service must connect as a role that does not bypass RLS. Create that role in a migration. Tests that assert isolation must use that role. A follow-up test may show that a superuser bypasses RLS, and the README must say the service does not use a superuser.
6. Update `docs/architecture.md` and the README: RLS is implemented for the local database role. It is not a complete merchant IAM product. Sessions, if you did not add them, remain a documented gap.

## Acceptance criteria that fully pass only if this prompt is completed

- **SCL01.** Tenant scope comes from the trusted server side, and load, create, and update honor it. Merchant A cannot read or write B's configuration by guessing an id. The service key is not treated as merchant authorization. Evidence: two-tenant tests using the non-owner database role.

## Take-home PDF requirements

No PDF requirement depends on this prompt. Do not remove demo behavior that prompts 01–31 already proved.

## Verification

- `pnpm test` including the two-tenant and RLS tests
- A manual attempt, as the app role, to select the other tenant's row without the tenant setting, which must return no rows

## Done when

- SCL01 passes under the app role.
- The README limit is updated.
- You have not started prompt 33 unless the user also asked for it.

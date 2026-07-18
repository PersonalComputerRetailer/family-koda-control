# Cloudflare Worker development

The Cloudflare deployment uses `src/index.ts`, Cloudflare Workers, and a D1
database. The existing FastAPI app remains available as the local reference
implementation while the Worker rollout is completed.

## Local Worker workflow

Create your local Worker config from the committed template (the real
`wrangler.jsonc` is gitignored so private deployment values cannot be
committed):

```bash
cp wrangler.jsonc.example wrangler.jsonc
```

Install Node dependencies, generate Worker types, and run the Worker tests:

```bash
npm install
npx wrangler types
npx vitest run --config vitest.config.mts
npx tsc -p tsconfig.json
```

Start the Worker with a locally persisted D1 database:

```bash
npx wrangler dev
```

Before the first remote deployment, replace the placeholder D1 ID in
`wrangler.jsonc` with the ID returned by:

```bash
npx wrangler d1 create koda-control-db
```

Then apply the migration and deploy:

```bash
npx wrangler d1 migrations apply koda-control-db --remote
npx wrangler deploy
```

`migrations/0001_initial.sql` creates the schema and six default categories.
It starts a fresh hosted household database. If `data/cashflow.db` contains
real expenses, export and validate that data before the remote migration is
applied rather than overwriting the hosted database.

## Tests

The Worker integration tests run in the Workers runtime with a local D1
database. They apply the same D1 migration used for deployment and cover the
initial budget, expense creation, overspending, validation, zero budgets, and
duplicate categories.

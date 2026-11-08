# Tests

Automated tests for Rekap Keuangan RT. They never touch the live Supabase project.

| Suite | What it runs against | Command |
|---|---|---|
| unit | Pure helpers extracted from `app.js` (no browser), static checks on the HTML | `npm run test:unit` |
| ui | `admin.html` / `index.html` in jsdom, in demo mode (empty config, data in a fresh in-memory localStorage per test) | `npm run test:ui` |
| db | `schema.sql` on a throwaway PostgreSQL, with a small Supabase stand-in (`helpers/supabase_stub.sql`) and fixed seed data (`helpers/seed.sql`) | `npm run test:db` |

```bash
cd tests
npm install        # jsdom
npm test           # all suites
```

Needs Node 20+ and, for the db suite, PostgreSQL 14+ client and server tools (`initdb`, `pg_ctl`, `psql`; `brew install postgresql@16`).
The db suite creates a temporary cluster on a free localhost port and deletes it afterwards. To reuse a running local server instead, set `REKAP_PG_PORT` (it connects to 127.0.0.1 as `postgres` with trust auth and creates/drops the `rekap_rls` database).

Known defects are kept as executable tests marked `todo` with their ID from `docs/test-cases-and-automation.docx` (for example `{ todo: 'DEF-001: …' }`). They show as todo, not failures, so the suite stays green; when a defect is fixed its test starts passing and the `todo` marker should be removed.

Test names start with the catalogue ID (AUTH-01, BAYAR-03, …) used in the test document.

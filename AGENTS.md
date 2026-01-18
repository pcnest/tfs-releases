# AGENTS

This repo hosts the Build Readiness SQLite tracker in `build-readiness-sqlite/`.

## Project map
- `build-readiness-sqlite/server/src/index.ts`: Express setup, middleware, and localhost bind.
- `build-readiness-sqlite/server/src/routes.ts`: `/healthz`, `/api/ingest`, `/release/:rid`, `/api/draft-approval/:rid`.
- `build-readiness-sqlite/server/src/db.ts`: SQLite schema and helpers. Data lives at `process.cwd()/data/build_readiness.db`.
- `build-readiness-sqlite/server/src/types.ts`: Zod schemas and API to DB mappers.
- `build-readiness-sqlite/server/src/ai.ts`: OpenAI draft generation logic.
- `build-readiness-sqlite/server/views/*.ejs`: Release table and approval request UI.
- `build-readiness-sqlite/ingest-from-tfs.ps1`: PowerShell ingest agent.
- `build-readiness-sqlite/TEST_GUIDE.md`: Manual test steps.

## Dev workflow
- Install deps: `cd build-readiness-sqlite/server` then `npm install`.
- Run dev: `npm run dev` (dotenv reads `.env` from the current working directory).
- Build/start: `npm run build` then `npm start`.

## Config
- `.env` is expected in the working directory you run from.
  - `AUTH_TOKEN` is required for `/api/ingest` and `/api/draft-approval`.
  - `OPENAI_API_KEY` enables AI draft generation.
  - `PORT` controls the server port (defaults to 8080).

## Manual tests
- No automated test suite.
- Use `build-readiness-sqlite/TEST_GUIDE.md` or `build-readiness-sqlite/test-ingest.ps1` with a running server.

## Common changes
- Add data fields: update `build-readiness-sqlite/server/src/types.ts`, `build-readiness-sqlite/server/src/db.ts`, and `build-readiness-sqlite/server/views/table.ejs`.
- Adjust approval request/AI: edit `build-readiness-sqlite/server/src/ai.ts`, `build-readiness-sqlite/server/src/routes.ts`, and `build-readiness-sqlite/server/views/table.ejs`.

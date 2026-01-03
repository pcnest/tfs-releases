Scaffold a local-only web app (Node 18+, TypeScript) that accepts JSON from a PowerShell agent, stores rows in SQLite, and renders a release table. No cloud, no ORM.

### Stack

- Node 18+, TypeScript
- Express + EJS (server-rendered)
- SQLite via better-sqlite3 (DB file: ./data/build_readiness.db)
- Tailwind via CDN
- helmet + morgan
- zod for payload validation
- dotenv for AUTH_TOKEN and PORT

### Project structure

build-readiness-sqlite/
server/
src/{index.ts,db.ts,routes.ts,types.ts}
views/{layout.ejs,table.ejs}
package.json
tsconfig.json
public/styles.css
.env.example
.gitignore
README.md
data/ (created at runtime; holds build_readiness.db)

### .env.example

AUTH_TOKEN=c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1
PORT=8080

### Database (better-sqlite3)

- Ensure ./data exists; open ./data/build_readiness.db.
- On startup, run this idempotent SQL:

CREATE TABLE IF NOT EXISTS build_readiness (
release_id TEXT NOT NULL,
wi_id INTEGER NOT NULL,
wi_type TEXT NOT NULL,
title TEXT NOT NULL,
state TEXT NOT NULL,
tags TEXT,
acceptance_criteria TEXT,
description TEXT,
dev_notes TEXT,
qa_notes TEXT,
score TEXT, -- e.g., "4/6"
missing TEXT, -- e.g., "DevNotes, QANotes"
review_evidence TEXT, -- e.g., "Field" or "Relation"
created_at TEXT NOT NULL DEFAULT (datetime('now')),
PRIMARY KEY (release_id, wi_id)
);
CREATE INDEX IF NOT EXISTS idx_release ON build_readiness(release_id);

- Provide DB helpers:
  - replaceReleaseRows(releaseId: string, rows: DbRow[]) -> transaction:
    DELETE FROM build_readiness WHERE release_id = ?;
    then bulk INSERT with:
    INSERT INTO build_readiness(...)
    VALUES(...)
    ON CONFLICT(release_id, wi_id) DO UPDATE SET
    wi_type=excluded.wi_type, title=excluded.title, state=excluded.state,
    tags=excluded.tags, acceptance_criteria=excluded.acceptance_criteria,
    description=excluded.description, dev_notes=excluded.dev_notes,
    qa_notes=excluded.qa_notes, score=excluded.score, missing=excluded.missing,
    review_evidence=excluded.review_evidence, created_at=excluded.created_at;
  - getByRelease(releaseId) ORDER BY wi_type, wi_id;
  - getCounts(releaseId) -> { total, pbiCount, bugCount, fullScoreCount }
    (fullScoreCount = rows whose score has equal numerator/denominator, e.g., "4/4").

### Types (types.ts)

Define API row (from agent) and DB row (snake_case):
type ApiRow = {
release_id: string;
id: number; // -> wi_id
type: string; // -> wi_type
title: string;
state: string;
tags?: string;
acceptanceCriteria?: string;
description?: string;
devNotes?: string;
qaNotes?: string;
score?: string; // "N/M"
missing?: string; // "DevNotes, QANotes"
reviewEvidence?: string; // "Field" | "Relation" | "None"
}
type DbRow = {
release_id: string;
wi_id: number;
wi_type: string;
title: string;
state: string;
tags?: string;
acceptance_criteria?: string;
description?: string;
dev_notes?: string;
qa_notes?: string;
score?: string;
missing?: string;
review_evidence?: string;
created_at?: string;
}
Add a zod schema for ApiRow[] and a mapper ApiRow -> DbRow.

### Express app

- index.ts:
  - load .env (dotenv)
  - express.json({ limit: '2mb' }), helmet, morgan, serve /public
  - run DB init/migration
  - bind to 127.0.0.1 by default: app.listen(port, '127.0.0.1', ...)
- routes.ts:
  - GET /healthz -> { ok: true }
  - POST /api/ingest
    - Require Authorization: Bearer <AUTH_TOKEN>
    - Body: array<ApiRow>; validate with zod (max ~5000 rows)
    - Ensure all rows share the same release_id; reject if mixed
    - Map to DbRow (id->wi_id, type->wi_type, acceptanceCriteria->acceptance_criteria,
      devNotes->dev_notes, qaNotes->qa_notes, reviewEvidence->review_evidence)
    - replaceReleaseRows(releaseId, mappedRows)
    - Return { ok: true, release_id, inserted: n }
  - GET /release/:rid.json -> return rows as JSON (ordered by wi_type, wi_id)
  - GET /release/:rid -> render EJS table
    - compute counts: total, PBI vs Bug (by wi_type), and % full-score

### Views (EJS)

- layout.ejs: HTML shell with Tailwind CDN; container; slot for body
- table.ejs:
  - Sticky header: “Release <rid>” + counts (PBIs, Bugs, Total, % full score)
  - Search input that filters rows by title/type/state/tags (client-side JS)
  - Table columns: WI, Type, Title, State, Score, Missing, DevNotes?, QANotes?, Tags, Review
    - DevNotes?/QANotes? show ✓ if non-empty
    - Review shows review_evidence or empty dash
  - Buttons: “Copy CSV” and “Copy TSV” (copy only visible/filtered rows)

### Security

- Check AUTH_TOKEN on /api/ingest; if missing/invalid -> 401
- Keep server bound to localhost unless explicitly changed

### package.json (server)

Scripts:
"dev": "tsx src/index.ts",
"build": "tsc -p tsconfig.json",
"start": "node dist/index.js"
Deps:
express, ejs, helmet, morgan, better-sqlite3, dotenv, zod
DevDeps:
typescript, tsx, @types/node, @types/express, @types/morgan

### tsconfig

- target ES2020; moduleResolution node; outDir dist; rootDir src; strict true

### Empty-state UX

If /release/:rid has 0 rows, show an empty-state with curl POST example for /api/ingest.

Generate all files with runnable code and comments. Make it work locally out of the box.

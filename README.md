Scaffold a local-only web app (Node 18+, TypeScript) that stores data in a local SQLite DB and renders an HTML table. No cloud. No ORM.

### Stack

- Node 18+, TypeScript
- Express + EJS (server-rendered)
- SQLite via better-sqlite3 (sync, local file ./data/build_readiness.db)
- Tailwind via CDN (no build tool)
- helmet + morgan middleware
- zod for payload validation

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
data/ (create at runtime; holds build_readiness.db)

### .env.example

AUTH_TOKEN=<replace-me>
PORT=8080

### DB (better-sqlite3)

- Create folder ./data if missing.
- Open ./data/build_readiness.db.
- On startup, run this SQL (idempotent):

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
missing TEXT, -- e.g., "PeerReview, QANotes"
cc8 TEXT, -- e.g., "B,D,E,F"
code_review_type TEXT,
review_evidence TEXT, -- "Field" or "Relation"
created_at TEXT NOT NULL DEFAULT (datetime('now')),
PRIMARY KEY (release_id, wi_id)
);
CREATE INDEX IF NOT EXISTS idx_release ON build_readiness(release_id);

- Provide helper functions:

  - replaceReleaseRows(releaseId, rows[]) -> wraps in a transaction:
    DELETE FROM build_readiness WHERE release_id = ?;
    then INSERT ... ON CONFLICT(release_id, wi_id) DO UPDATE SET
    wi_type=excluded.wi_type, title=excluded.title, state=excluded.state,
    tags=excluded.tags, acceptance_criteria=excluded.acceptance_criteria,
    description=excluded.description, dev_notes=excluded.dev_notes,
    qa_notes=excluded.qa_notes, score=excluded.score, missing=excluded.missing,
    cc8=excluded.cc8, code_review_type=excluded.code_review_type,
    review_evidence=excluded.review_evidence, created_at=excluded.created_at;

  - getByRelease(releaseId) ORDER BY wi_type, wi_id;
  - getCounts(releaseId) -> { total, pbiCount, bugCount, fullScoreCount } where fullScoreCount counts rows whose score matches /^\d+\/\1$/ after parsing numerator/denominator (or simpler: equals "4/4" if your max is fixed).

### Types (types.ts)

Define a Row shape aligned to agent output:
{
release_id: string;
id: number; // maps to wi_id
type: string; // -> wi_type
title: string;
state: string;
tags?: string;
acceptanceCriteria?: string;
description?: string;
devNotes?: string;
qaNotes?: string;
score?: string;
missing?: string;
cc8?: string;
codeReviewType?: string;
reviewEvidence?: string;
}

Provide a zod schema that validates an array of these.

### Express app (index.ts + routes.ts)

- Use express.json({ limit: '2mb' }), helmet, morgan; serve /public.
- GET /healthz -> { ok: true }
- POST /api/ingest
  - Require Authorization: Bearer <AUTH_TOKEN> from process.env.
  - Body: array<Row>. Validate with zod.
  - Extract release_id from the first row; ensure all rows share it.
  - Map fields to DB:
    wi_id=id, wi_type=type, acceptance_criteria=acceptanceCriteria,
    dev_notes=devNotes, qa_notes=qaNotes, code_review_type=codeReviewType,
    review_evidence=reviewEvidence
  - Call replaceReleaseRows(release_id, rows).
  - Return { ok: true, release_id, inserted: n }
- GET /release/:rid.json -> JSON of rows
- GET /release/:rid -> render views/table.ejs, passing rows + counts

### Views

- layout.ejs: HTML shell, Tailwind CDN, container, header, slot for body.
- table.ejs:
  - Sticky header showing: Release <rid>, counts for PBIs, Bugs, Total, and % “full score”
  - Search input (client-side filter by title/type/state/tags)
  - Table columns: WI, Type, Title, State, Score, Missing, DevNotes?, QANotes?, Tags, CodeReview
  - DevNotes?/QANotes? show ✓ if non-empty
  - Two buttons: “Copy CSV” and “Copy TSV” (JS walks visible rows and copies to clipboard)

### package.json (server/package.json)

Scripts:
"dev": "tsx src/index.ts",
"build": "tsc -p tsconfig.json",
"start": "node dist/index.js"
Deps:
express, ejs, helmet, morgan, better-sqlite3, dotenv, zod
DevDeps:
typescript, tsx, @types/node, @types/express, @types/morgan

### tsconfig.json

- TS target ES2020, moduleResolution node, outDir dist, rootDir src.

### Security

- Bind to 127.0.0.1 by default (local only).
- Check AUTH_TOKEN on /api/ingest.

### Small UX details

- If release has no rows, show an empty-state message with the curl example to ingest.
- Show DB file path somewhere small in the footer (for troubleshooting).

Generate all files with runnable code and comments. Make it work locally out of the box.

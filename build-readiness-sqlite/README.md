# Build Readiness SQLite Tracker

A local-only web application for tracking TFS/Azure DevOps build readiness data. Data is ingested via REST API from PowerShell agents and stored in SQLite, then rendered in an interactive web table.

## Features

- **Local-only**: Runs on `127.0.0.1` by default, no cloud dependencies
- **SQLite storage**: Lightweight database at `./data/build_readiness.db`
- **REST API**: Ingest JSON payloads from PowerShell scripts
- **Interactive UI**: Server-rendered EJS tables with client-side search
- **CSV/TSV export**: Copy filtered results to clipboard
- **TypeScript**: Fully typed codebase with Zod validation
- **Secure**: Bearer token authentication, helmet security headers

## Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Web Framework**: Express + EJS (server-rendered)
- **Database**: SQLite via better-sqlite3
- **Styling**: Tailwind CSS (CDN)
- **Validation**: Zod schemas
- **Security**: helmet, morgan, dotenv

## Project Structure

```
build-readiness-sqlite/
├── server/
│   ├── src/
│   │   ├── index.ts       # Main server entry point
│   │   ├── db.ts          # SQLite helpers
│   │   ├── routes.ts      # Express routes
│   │   └── types.ts       # TypeScript types & Zod schemas
│   ├── views/
│   │   ├── layout.ejs     # HTML layout shell
│   │   └── table.ejs      # Release table view
│   ├── package.json
│   └── tsconfig.json
├── public/
│   └── styles.css         # Custom CSS
├── data/                  # Created at runtime
│   └── build_readiness.db # SQLite database
├── .env                   # Your config (create from .env.example)
├── .env.example           # Template
├── .gitignore
└── README.md
```

## Quick Start

### 1. Install Dependencies

```bash
cd build-readiness-sqlite/server
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and customize:

```bash
cp ../.env.example ../.env
```

Example `.env`:

```
AUTH_TOKEN=c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1
PORT=8080
```

### 3. Run the Server

**Development mode** (with auto-reload):

```bash
npm run dev
```

**Production mode**:

```bash
npm run build
npm start
```

The server will start at `http://127.0.0.1:8080`

## API Endpoints

### Health Check

```bash
GET /healthz
```

Returns: `{ "ok": true }`

### Ingest Build Data

```bash
POST /api/ingest
Authorization: Bearer <AUTH_TOKEN>
Content-Type: application/json

[
  {
    "release_id": "R2024.1",
    "id": 12345,
    "type": "PBI",
    "title": "Implement feature X",
    "state": "Done",
    "tags": "backend; api",
    "acceptanceCriteria": "User can...",
    "description": "As a user...",
    "devNotes": "Implementation details",
    "qaNotes": "Test results",
    "score": "6/6",
    "missing": "",
    "reviewEvidence": "Field"
  }
]
```

**PowerShell Example**:

```powershell
$headers = @{
    "Authorization" = "Bearer c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1"
    "Content-Type" = "application/json"
}

$body = @(
    @{
        release_id = "R2024.1"
        id = 12345
        type = "PBI"
        title = "Sample Work Item"
        state = "Done"
        score = "6/6"
        devNotes = "Implementation complete"
        qaNotes = "All tests passing"
    }
) | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/ingest" `
    -Method POST -Headers $headers -Body $body
```

### View Release Table

```bash
GET /release/:releaseId
```

Example: `http://127.0.0.1:8080/release/R2024.1`

### Get Release JSON

```bash
GET /release/:releaseId.json
```

Returns:

```json
{
  "release_id": "R2024.1",
  "counts": {
    "total": 42,
    "pbiCount": 35,
    "bugCount": 7,
    "fullScoreCount": 38,
    "fullScorePercent": 90
  },
  "rows": [...]
}
```

## Database Schema

The SQLite database stores work items with the following schema:

```sql
CREATE TABLE build_readiness (
  release_id           TEXT NOT NULL,
  wi_id                INTEGER NOT NULL,
  wi_type              TEXT NOT NULL,
  title                TEXT NOT NULL,
  state                TEXT NOT NULL,
  tags                 TEXT,
  acceptance_criteria  TEXT,
  description          TEXT,
  dev_notes            TEXT,
  qa_notes             TEXT,
  score                TEXT,       -- e.g., "3/4" (PeerReview, ChangeSummary, State, QANotes)
  missing              TEXT,       -- e.g., "PeerReview, State"
  review_evidence      TEXT,       -- e.g., "Peer", "Dev", "Relation", or "None"
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (release_id, wi_id)
);
```

## Scoring System

The readiness score is calculated on a **4-point scale** with the following criteria:

### Score Breakdown (X/4)

1. **PeerReview** - Buddy Testing Complete

   - ✓ `Buddy Tested by:` field has a value
   - ✓ `Buddy Test Date:` field has a value
   - ✓ `Buddy Test Status:` contains "passed" or "pass" (case-insensitive)
   - All three conditions must be met

2. **ChangeSummary** - Development Documentation Complete

   - ✓ `What Changed:` field has a value
   - ✓ `What Was Impacted:` field has a value
   - ✓ `What Must Be Tested:` field has a value
   - All three fields must be filled

3. **State** - Appropriate Workflow State

   - ✓ Work item state is one of:
     - `Branch Checkin`
     - `Resolved`
     - `Ready for QA`

4. **QANotes** - QA Documentation
   - ✓ QA Notes field is not empty

### Review Evidence

The `review_evidence` field categorizes the type of review completed:

- **Peer** - Peer Review template filled (Buddy fields with values)
- **Dev** - Change Summary template filled (What Changed/Impacted/Tested)
- **Relation** - Has related work items linked
- **None** - No review evidence found

### Missing Column

The `missing` column shows which criteria are not yet met, helping teams quickly identify what needs completion. For example:

- `PeerReview, State` - Needs buddy testing and workflow progression
- `ChangeSummary` - Needs developer documentation
- Empty - All criteria met (4/4 score)

## Features

### Interactive Table

- **Search**: Real-time filtering by title, type, state, or tags
- **Copy**: Export visible rows as CSV or TSV
- **Stats**: See PBI/Bug counts and completion percentage
- **Checkmarks**: Visual indicators for DevNotes and QANotes
- **Color coding**: Full-score items highlighted in green

### Security

- **Authentication**: Bearer token required for `/api/ingest`
- **Localhost binding**: Server binds to `127.0.0.1` by default
- **Helmet**: Security headers via helmet middleware
- **Validation**: Zod schemas for payload validation (max 5000 rows)
- **Rate limiting**: Consider adding express-rate-limit if needed

### Data Management

- **Replace on ingest**: Each ingest replaces all rows for that release
- **Upsert logic**: Uses `ON CONFLICT` for idempotent inserts
- **Transaction-safe**: All DB operations wrapped in transactions

## Development

### File Overview

- **[index.ts](server/src/index.ts)**: Express server setup, middleware, graceful shutdown
- **[routes.ts](server/src/routes.ts)**: API endpoints and EJS rendering
- **[db.ts](server/src/db.ts)**: SQLite connection, schema migration, CRUD helpers
- **[types.ts](server/src/types.ts)**: TypeScript interfaces, Zod schemas, mappers
- **[table.ejs](server/views/table.ejs)**: Release table view with search and export

### Adding New Fields

1. Update `ApiRowSchema` in [types.ts](server/src/types.ts)
2. Update `DbRow` interface and mapper
3. Add column to SQL schema in [db.ts](server/src/db.ts)
4. Update INSERT/UPDATE statements
5. Add column to [table.ejs](server/views/table.ejs)

### Testing Locally

1. Start the server: `npm run dev`
2. Check health: `curl http://127.0.0.1:8080/healthz`
3. Ingest test data using PowerShell script
4. View table: `http://127.0.0.1:8080/release/YOUR_RELEASE_ID`

## Troubleshooting

### Port Already in Use

Change `PORT` in `.env` to an available port.

### Database Locked

Ensure only one server instance is running. SQLite uses WAL mode for better concurrency.

### Missing AUTH_TOKEN

Create `.env` file from `.env.example` and set a secure token.

### Permission Errors

Ensure `./data` directory is writable by the Node.js process.

## License

MIT

## Support

For issues or questions, check the code comments or modify to fit your needs. This is a local-only tool with no external dependencies.

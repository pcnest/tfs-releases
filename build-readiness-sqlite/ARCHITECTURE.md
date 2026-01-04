# System Architecture - AI Approval Request

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER INTERACTION                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ 1. Clicks "Draft with AI"
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CLIENT (table.ejs)                                │
│  • Checks dirty fields (warn if edited)                             │
│  • Shows spinner, disables button                                   │
│  • Builds request with auth token                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ POST /api/draft-approval/:rid
                                  │ Authorization: Bearer <token>
                                  │ { maxHighlights: 7, ... }
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    SERVER (routes.ts)                                │
│  • Validates Bearer token                                            │
│  • Validates input schema (Zod)                                      │
│  • Checks release exists                                             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                    ┌─────────────┴──────────────┐
                    │                            │
                    ▼                            ▼
        ┌──────────────────────┐    ┌──────────────────────┐
        │   DATABASE (db.ts)   │    │   AI SERVICE (ai.ts) │
        │  getRowsByRelease()  │────▶  • Rate limit check  │
        │  Returns DbRow[]     │    │  • Minify dataset    │
        └──────────────────────┘    │  • Group by themes   │
                                    │  • Identify hot items│
                                    └──────────────────────┘
                                              │
                                              │ Build prompt with:
                                              │ • System instruction
                                              │ • Dataset summary
                                              │ • Theme buckets
                                              │ • Hot item IDs
                                              ▼
                                    ┌──────────────────────┐
                                    │   OPENAI API         │
                                    │  gpt-4o-mini         │
                                    │  temperature: 0.7    │
                                    │  max_tokens: 1500    │
                                    └──────────────────────┘
                                              │
                                              │ Returns JSON:
                                              │ {
                                              │   purpose: "...",
                                              │   highlights: [...],
                                              │   primaryRisk: "...",
                                              │   blastRadius: "..."
                                              │ }
                                              ▼
                                    ┌──────────────────────┐
                                    │  VALIDATION (Zod)    │
                                    │  AiDraftOutputSchema │
                                    │  • Ensures fields    │
                                    │  • Type checking     │
                                    └──────────────────────┘
                                              │
                                              │ Validated JSON
                                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    RESPONSE TO CLIENT                                │
│  Status: 200 OK                                                      │
│  Content-Type: application/json                                      │
│  Body: { purpose, highlights, primaryRisk, blastRadius }             │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    CLIENT (table.ejs)                                │
│  • Hides spinner, enables button                                    │
│  • Populates textareas:                                              │
│    - #purpose ← data.purpose                                         │
│    - #highlights ← data.highlights.join("\n")                        │
│    - #primaryRisk ← data.primaryRisk                                 │
│    - #blastRadius ← data.blastRadius                                 │
│  • Resets dirty flags                                                │
│  • Shows success toast                                               │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Interactions

### 1. Client → Server

```javascript
fetch(`/api/draft-approval/${RELEASE_ID}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${AUTH_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    maxHighlights: 7,
    severityKeywords: ['High', 'Critical'],
  }),
});
```

### 2. Server → Database

```typescript
// routes.ts
const rows = getRowsByRelease(releaseId);
if (rows.length === 0) {
  return res.status(400).json({ error: 'No rows' });
}
```

### 3. Server → AI Service

```typescript
// routes.ts
const draft = await draftApproval(releaseId, rows, options);
res.json(draft);
```

### 4. AI Service → OpenAI

```typescript
// ai.ts
const completion = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ],
});
```

### 5. AI Service → Validation

```typescript
// ai.ts
const parsed = JSON.parse(content);
const validated = AiDraftOutputSchema.parse(parsed);
return validated;
```

## Error Flow

```
┌────────────┐
│   Error    │
└────────────┘
      │
      ├─ No rows → 400 "No rows for release"
      │
      ├─ No auth → 401 "Invalid authentication"
      │
      ├─ Rate limit → 429 "Wait X seconds"
      │
      ├─ Invalid input → 400 "Invalid input options"
      │
      ├─ OpenAI error → Retry once → 500 "Failed to generate"
      │
      └─ JSON invalid → Retry with stricter prompt → Parse again
                              │
                              ├─ Success → Return validated
                              └─ Fail → 500 "Failed after 2 attempts"
```

## State Management

### Dirty Field Tracking

```javascript
// Client-side state
dirtyFields = {
  purpose: false,      // ← User hasn't edited
  highlights: false,
  primaryRisk: false,
  blastRadius: false
}

// On user input
field.addEventListener('input', () => {
  dirtyFields[fieldId] = true;  // ← Mark as dirty
});

// Before AI draft
if (dirtyFields.purpose || dirtyFields.highlights || ...) {
  confirm("Overwrite your edits?");
}

// After AI populates
dirtyFields = { ...false };  // ← Reset all to clean
```

### Button State Machine

```
┌──────────┐
│  READY   │ ─── Click ───┐
└──────────┘               │
                           ▼
                  ┌─────────────────┐
                  │   LOADING       │
                  │ (disabled=true) │
                  │ (spinner shown) │
                  └─────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
       ┌───────────┐             ┌───────────┐
       │  SUCCESS  │             │   ERROR   │
       │ (toast)   │             │ (toast)   │
       └───────────┘             └───────────┘
              │                         │
              └─────────┬───────────────┘
                        ▼
                  ┌──────────┐
                  │  READY   │
                  └──────────┘
```

## Rate Limiting

```
Time    Request     Response
─────────────────────────────────────
00:00   Request 1 → ✓ Success
00:02   Request 2 → ✗ "Wait 3 seconds"
00:05   Request 3 → ✓ Success
00:07   Request 4 → ✗ "Wait 3 seconds"
00:10   Request 5 → ✓ Success

Cooldown: 5 seconds
Tracked: In-memory (per process)
Scope: Global (all users share cooldown)
```

## Theme Detection

```
Input: DbRow[] with titles and tags
         │
         ▼
   ┌─────────────┐
   │  Row loop   │
   └─────────────┘
         │
         ├─ "SearchElse performance issue" → SearchElse bucket
         ├─ "FTP upload timeout" → FTP bucket
         ├─ "Historical data export" → Historical Data bucket
         ├─ "ESL integration error" → ESL bucket
         └─ ...
         │
         ▼
   ┌─────────────┐
   │  Themes     │
   │  {          │
   │   SearchElse: [196681, 195883],
   │   FTP: [196682, 196683],
   │   ESL: [196684]
   │  }          │
   └─────────────┘
         │
         ▼
   Sent to AI for grouping highlights
```

## Hot Item Detection

```
For each row:
  │
  ├─ Is Bug? ─────┐
  │               ▼
  │         Check severity keywords
  │         ("High", "Critical")
  │               │
  │               ├─ Found? → HOT
  │               └─ Not found ─┐
  │                             ▼
  │                       Check missing field
  │                             │
  │                             ├─ Not empty? → HOT
  │                             └─ Empty → NORMAL
  │
  └─ Is PBI? → NORMAL

Result: [196681, 196682, ...] → Prioritized in AI prompt
```

## Email Modal Flow

```
Click "Copy Email"
       │
       ▼
┌──────────────────┐
│ Read form fields │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Format email     │
│ template with    │
│ field values     │
└──────────────────┘
       │
       ▼
┌──────────────────┐
│ Show modal with  │
│ preview          │
└──────────────────┘
       │
       ├─ Click "Copy" ──────┐
       │                     ▼
       │              navigator.clipboard
       │                     │
       │                     ▼
       │              Copied to clipboard
       │                     │
       │                     ▼
       │              Alert "Copied!"
       │                     │
       └─ Click "Close" ─────┴─▶ Hide modal
```

## Security Boundaries

```
┌─────────────────────────────────────────┐
│           TRUSTED ZONE                  │
│  ┌────────────────────────────────┐     │
│  │  Server (Node.js)              │     │
│  │  • Has AUTH_TOKEN              │     │
│  │  • Has OPENAI_API_KEY          │     │
│  │  • Validates all inputs        │     │
│  │  • Rate limits requests        │     │
│  └────────────────────────────────┘     │
│              ▲                          │
└──────────────┼──────────────────────────┘
               │ Bearer token required
               │ (sent in HTTP header)
┌──────────────┼──────────────────────────┐
│              │                           │
│  ┌───────────▼────────────────┐         │
│  │  Client (Browser)          │         │
│  │  • No secrets stored       │         │
│  │  • Token from server       │         │
│  │  • CSP-compliant code      │         │
│  └────────────────────────────┘         │
│           UNTRUSTED ZONE                │
└─────────────────────────────────────────┘
```

## File Dependencies

```
index.ts
  ├─ imports routes.ts
  │    ├─ imports db.ts
  │    │    └─ imports types.ts
  │    ├─ imports ai.ts
  │    │    └─ imports types.ts
  │    └─ imports types.ts
  │
  └─ imports db.ts
       └─ (already shown)

table.ejs
  ├─ receives data from routes.ts
  ├─ calls /api/draft-approval (routes.ts)
  └─ uses AUTH_TOKEN (from server)
```

## Database Schema

```sql
CREATE TABLE build_readiness (
  release_id           TEXT NOT NULL,      ← Used to filter
  wi_id                INTEGER NOT NULL,    ← Shown in highlights
  wi_type              TEXT NOT NULL,       ← PBI vs Bug detection
  title                TEXT NOT NULL,       ← Theme detection source
  state                TEXT NOT NULL,
  tags                 TEXT,                ← Theme detection source
  acceptance_criteria  TEXT,
  description          TEXT,
  dev_notes            TEXT,
  qa_notes             TEXT,
  score                TEXT,                ← Incomplete detection
  missing              TEXT,                ← Hot item detection
  review_evidence      TEXT,
  created_at           TEXT NOT NULL,
  PRIMARY KEY (release_id, wi_id)
);

Index: idx_release ON release_id  ← Fast lookups
```

## Prompt Structure

```
System Message:
┌─────────────────────────────────────────┐
│ "You are a release manager assistant.  │
│  Output only valid JSON matching the   │
│  specified schema. Keep text concise   │
│  and operational."                     │
└─────────────────────────────────────────┘

User Message:
┌─────────────────────────────────────────┐
│ "Generate approval request for X.Y.Z"  │
│                                         │
│ **Dataset (N items):**                 │
│ [minified JSON array]                  │
│                                         │
│ **Hot Items:** [IDs]                   │
│                                         │
│ **Themes:** SearchElse, FTP, ...       │
│                                         │
│ **Output Requirements:**               │
│ 1. purpose: 1-2 lines...              │
│ 2. highlights: 5-7 bullets with IDs... │
│ 3. primaryRisk: 2-3 lines...          │
│ 4. blastRadius: names...              │
│                                         │
│ **Example Output:**                    │
│ { ... }                                │
└─────────────────────────────────────────┘
```

## Performance Metrics

```
Operation                 Time      Cost
─────────────────────────────────────────
Database query           < 10ms    Free
Minify dataset           < 5ms     Free
Theme detection          < 5ms     Free
Hot item detection       < 5ms     Free
Build prompt             < 5ms     Free
OpenAI API call          3-5s      $0.0002
JSON validation          < 5ms     Free
Response to client       < 10ms    Free
─────────────────────────────────────────
TOTAL (typical)          3-5s      $0.0002

Rate limit cooldown: 5s
Max tickets supported: 500
Token usage: ~1000-2000 per request
```

## Edge Cases Handled

1. **No rows for release** → 400 error
2. **Invalid auth token** → 401 error
3. **Rate limit hit** → 429 error with wait time
4. **OpenAI returns markdown** → Extract JSON from code block
5. **OpenAI returns invalid JSON** → Retry with stricter prompt
6. **User edited fields** → Confirm before overwrite
7. **Empty textareas** → No dirty flag set
8. **Modal background click** → Close modal
9. **Clipboard API fails** → Show error alert
10. **Server restart** → Rate limit resets

---

This architecture ensures:

- ✅ Separation of concerns
- ✅ Type safety (TypeScript + Zod)
- ✅ Security (auth + rate limiting)
- ✅ Error resilience (retries + validation)
- ✅ User experience (feedback + confirmations)

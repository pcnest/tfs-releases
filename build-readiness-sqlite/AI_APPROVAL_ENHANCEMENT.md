# AI-Powered Approval Request Enhancement

## Overview

This enhancement adds an AI-powered "Approval Request" section to the build readiness tracker. The feature uses OpenAI's API to automatically generate release approval content from your ticket data.

## What's New

### 1. Approval Request Form

A new form appears below the tickets table on any release page (`/release/:rid`), containing:

**Basic Information:**

- Project Name (text input)
- Release Manager (text input)

**AI-Populated Fields:**

- Purpose (textarea) - Business value and key defects fixed
- Highlights (textarea) - 5-7 bullet points with ticket IDs

**Release Window Group:**

- Release Window Date (date picker)
- Release Env (dropdown: QA/Prod)
- Release Change Type (dropdown: standard/emergency)

**Additional Fields:**

- Scope (textarea) - Description of changes

**Risk & Impact Group:**

- Primary Risk (textarea) - What could go wrong if delayed
- Blast Radius (textarea) - Affected users/systems

### 2. AI Draft Button

Click "✨ Draft with AI" to:

- Analyze all tickets for the current release
- Generate purpose statement (1-2 lines)
- Create highlights with ticket IDs (e.g., "- Fixed SearchElse performance — Bug 196681, PBI 195883")
- Identify primary risks
- Calculate blast radius

The AI intelligently:

- Groups tickets by themes (SearchElse, FTP, Historical Data, etc.)
- Prioritizes critical bugs and incomplete items
- Formats highlights with proper ticket references
- Keeps content concise and operational

### 3. User Experience Features

**Dirty Field Protection:**

- Tracks if you've edited AI-populated fields
- Confirms before overwriting your manual edits
- Prevents accidental data loss

**Clear Draft Button:**

- Resets all textarea fields
- Confirms before clearing

**Copy Email Button:**

- Generates a formatted email body
- Opens modal with preview
- One-click copy to clipboard
- Includes all form data in professional format

### 4. API Endpoint

**POST /api/draft-approval/:rid**

Protected endpoint requiring Bearer token authentication.

**Request Body (optional):**

```json
{
  "maxHighlights": 7,
  "severityKeywords": ["High", "Critical"]
}
```

**Response:**

```json
{
  "purpose": "Fixes critical search performance issues...",
  "highlights": [
    "- Improved SearchElse performance by 40% — Bug 196681",
    "- Fixed FTP upload failures — Bug 196682, 196683"
  ],
  "primaryRisk": "Delaying will continue search timeouts...",
  "blastRadius": "Affects: SearchElse module (200+ users)..."
}
```

## Configuration

### Environment Variables

Add to your `.env` file:

```env
# Existing
AUTH_TOKEN=your-secret-token-here
PORT=8080

# New - OpenAI API Key
OPENAI_API_KEY=sk-proj-...your-key-here...
```

### Rate Limiting

Built-in rate limiting: **one AI request per 5 seconds** per process.

## Technical Details

### New Files

**server/src/ai.ts**

- OpenAI integration
- Prompt engineering
- Theme detection
- Hot item identification
- JSON validation with Zod

### Modified Files

**server/src/db.ts**

- Added `getRowsByRelease()` - Alias for AI module
- Added `getThemeBuckets()` - Keyword-based grouping

**server/src/types.ts**

- `DraftApprovalInputSchema` - Request validation
- `DraftApprovalOutputSchema` - Response validation

**server/src/routes.ts**

- New protected route: `POST /api/draft-approval/:rid`
- Authorization via Bearer token
- Error handling for rate limits and API failures

**server/views/table.ejs**

- Approval Request form with all fields
- Client-side JavaScript for AI interaction
- Email modal and preview
- Dirty field tracking

### Dependencies

New package installed:

- `openai` - Official OpenAI SDK

Existing packages used:

- `zod` - Schema validation
- `better-sqlite3` - Data access
- `express` - Web framework
- `ejs` - Templating

## Usage Guide

### Step 1: Set Up Environment

```bash
cd server
# Edit .env and add your OPENAI_API_KEY
npm install
npm run build
npm start
```

### Step 2: Load a Release

Navigate to: `http://127.0.0.1:8080/release/YOUR_RELEASE_ID`

### Step 3: Fill Basic Info

- Enter Project Name
- Enter Release Manager name
- Select Release Window Date
- Choose Release Env (QA/Prod)
- Select Change Type (standard/emergency)

### Step 4: Generate AI Draft

1. Click "✨ Draft with AI"
2. Wait for AI to analyze (~3-5 seconds)
3. Review generated content in Purpose, Highlights, Primary Risk, and Blast Radius fields
4. Edit as needed

### Step 5: Complete Form

- Add Scope details manually
- Adjust AI-generated content if needed

### Step 6: Copy Email

1. Click "📧 Copy Email"
2. Review in modal
3. Click "Copy to Clipboard"
4. Paste into your email client

## AI Prompt Strategy

### Context Provided to AI

- Release ID
- Minified ticket data (id, type, title, state, tags, score, missing)
- Hot items list (critical bugs, incomplete scores)
- Detected themes

### Output Constraints

- **Purpose**: 1-2 lines, business-focused
- **Highlights**: 5-7 bullets max
  - Each bullet ends with ticket IDs
  - Format: "— Bug 196681, PBI 195883"
  - Grouped by theme when possible
- **Primary Risk**: 2-3 lines
- **Blast Radius**: Names specific users/systems/modules

### Model Configuration

- **Model**: gpt-4o-mini (fast, cost-effective)
- **Temperature**: 0.7 (balanced creativity)
- **Max Tokens**: 1500
- **Retry Logic**: Attempts up to 2 times if JSON invalid

## Error Handling

### Client-Side

- Displays spinner during API call
- Shows success/error toast messages
- Disables button during request
- Confirms before overwriting edits

### Server-Side

- **400**: No rows for release
- **401**: Invalid/missing authentication
- **429**: Rate limit exceeded
- **500**: OpenAI API errors or config issues

## Security

- **Authentication**: All AI endpoints require Bearer token
- **Rate Limiting**: Prevents API abuse (5s cooldown)
- **Input Validation**: Zod schemas on all inputs
- **CSP Compliant**: No inline event handlers
- **Environment Variables**: Sensitive keys in .env (gitignored)

## Cost Considerations

**OpenAI API Costs (gpt-4o-mini):**

- ~$0.0001-0.0003 per draft request
- Based on input tokens (dataset size)
- Minimal cost for typical releases (<200 tickets)

**Tips to Reduce Costs:**

- Use rate limiting (already implemented)
- Review drafts before regenerating
- Keep ticket descriptions concise

## Testing

### Manual Test Flow

1. Ensure you have test data in a release
2. Navigate to release page
3. Click "Draft with AI"
4. Verify all 4 fields populate
5. Edit a field manually
6. Click "Draft with AI" again
7. Confirm overwrite prompt appears
8. Test "Clear Draft" button
9. Fill all fields
10. Test "Copy Email" modal
11. Verify email format in clipboard

### API Test (PowerShell)

```powershell
$headers = @{
    "Authorization" = "Bearer YOUR_AUTH_TOKEN"
    "Content-Type" = "application/json"
}

$body = @{
    maxHighlights = 7
    severityKeywords = @("High", "Critical")
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/draft-approval/YOUR_RELEASE_ID" `
    -Method POST -Headers $headers -Body $body
```

## Troubleshooting

### "OPENAI_API_KEY not configured"

- Check `.env` file exists in `server/` directory
- Verify `OPENAI_API_KEY` is set
- Restart server after adding key

### "Rate limit exceeded"

- Wait 5 seconds between requests
- Check server console for cooldown timer

### "No rows for release"

- Verify release has data: `GET /release/:rid.json`
- Ingest data via `/api/ingest` endpoint

### AI Returns Invalid JSON

- Retry mechanism attempts 2 times automatically
- Check OpenAI API status
- Review server logs for detailed error

### Button Doesn't Work

- Check browser console for JavaScript errors
- Verify AUTH_TOKEN is rendered in page
- Check CSP settings in helmet middleware

## Future Enhancements

Potential improvements:

- [ ] Save draft history to database
- [ ] Export to PDF format
- [ ] Custom AI instructions per project
- [ ] Support for multiple AI models
- [ ] Approval workflow tracking
- [ ] Email integration (send directly)
- [ ] Version comparison (diff view)

## Files Modified Summary

```
server/
├── .env                          # Added OPENAI_API_KEY
├── package.json                  # Added openai dependency
├── src/
│   ├── ai.ts                     # NEW - OpenAI integration
│   ├── db.ts                     # Added helper functions
│   ├── types.ts                  # Added AI schemas
│   └── routes.ts                 # Added /api/draft-approval route
└── views/
    └── table.ejs                 # Added Approval Request form + JS
```

## License & Credits

This enhancement integrates with:

- **OpenAI API** - GPT-4o-mini model
- **Zod** - Schema validation
- **Tailwind CSS** - UI styling (via CDN)

Built for local-only deployment with SQLite backend.

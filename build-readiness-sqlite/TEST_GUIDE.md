# Test Script for AI Approval Request Feature

## Purpose

This script demonstrates the AI-powered approval request feature by:

1. Ingesting sample release data
2. Viewing the enhanced release page with the Approval Request form
3. Testing the AI draft generation

## Prerequisites

```powershell
# 1. Ensure server is running
cd build-readiness-sqlite\server
npm run dev

# 2. Server should be at: http://127.0.0.1:8080
```

## Step 1: Ingest Sample Data

```powershell
# Set your AUTH_TOKEN from .env file
$authToken = "c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1"

$headers = @{
    "Authorization" = "Bearer $authToken"
    "Content-Type" = "application/json"
}

$sampleData = @(
    @{
        release_id = "TEST_5.0.1"
        id = 196681
        type = "Bug"
        title = "High Priority: SearchElse Performance Degradation Under Heavy Load"
        state = "Done"
        tags = "SearchElse; Performance; High"
        score = "5/6"
        missing = "Review Evidence"
        devNotes = "Optimized query indexing and caching strategy"
        qaNotes = "Performance improved by 40% under load testing"
    },
    @{
        release_id = "TEST_5.0.1"
        id = 196682
        type = "Bug"
        title = "Critical: FTP Upload Failures During Scheduled Nightly Jobs"
        state = "Done"
        tags = "FTP; Critical; Scheduler"
        score = "6/6"
        missing = ""
        devNotes = "Fixed connection timeout and retry logic"
        qaNotes = "All scheduled jobs completing successfully for 7 days"
    },
    @{
        release_id = "TEST_5.0.1"
        id = 195883
        type = "PBI"
        title = "Historical Data Export API for Compliance Audits"
        state = "Done"
        tags = "API; Compliance; Historical Data"
        score = "6/6"
        missing = ""
        devNotes = "New REST endpoint with date range filtering"
        qaNotes = "Validated with compliance team requirements"
    },
    @{
        release_id = "TEST_5.0.1"
        id = 196683
        type = "Bug"
        title = "FTP Connection Pool Exhaustion on High Volume Days"
        state = "Done"
        tags = "FTP; Performance"
        score = "6/6"
        missing = ""
        devNotes = "Increased pool size and added monitoring"
        qaNotes = "No connection failures during peak testing"
    },
    @{
        release_id = "TEST_5.0.1"
        id = 195884
        type = "PBI"
        title = "Device Page Load Time Optimization for Mobile Users"
        state = "Done"
        tags = "Device; UI; Performance; Mobile"
        score = "5/6"
        missing = "QA Notes"
        devNotes = "Lazy loading and image compression implemented"
    },
    @{
        release_id = "TEST_5.0.1"
        id = 196684
        type = "Bug"
        title = "ESL Integration Timeout During Peak Hours"
        state = "Done"
        tags = "ESL; Integration; High"
        score = "6/6"
        missing = ""
        devNotes = "Implemented circuit breaker pattern"
        qaNotes = "Stable during load testing and monitoring"
    },
    @{
        release_id = "TEST_5.0.1"
        id = 195885
        type = "PBI"
        title = "InMsg Processing Enhancement for Large Batches"
        state = "Done"
        tags = "inmsg; Performance; Batch"
        score = "6/6"
        missing = ""
        devNotes = "Parallel processing with worker threads"
        qaNotes = "Batch processing time reduced by 60%"
    }
) | ConvertTo-Json

# Ingest the data
$response = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/ingest" `
    -Method POST `
    -Headers $headers `
    -Body $sampleData

Write-Host "✓ Ingested $($response.inserted) items for release: $($response.release_id)" -ForegroundColor Green
```

## Step 2: View Release Page

Open in browser:

```
http://127.0.0.1:8080/release/TEST_5.0.1
```

You should see:

- Statistics bar (7 items, 5 PBIs, 2 Bugs, etc.)
- Tickets table with all sample data
- **NEW: Approval Request form** below the table

## Step 3: Test AI Draft Generation

### Via Web UI:

1. Scroll to "Approval Request" section
2. Fill in basic info:
   - Project Name: "TFS Mobile Enhancement"
   - Release Manager: "Your Name"
   - Release Window Date: (select a date)
   - Release Env: "Prod"
   - Change Type: "standard"
3. Click "✨ Draft with AI"
4. Wait 3-5 seconds
5. Observe auto-populated fields:
   - Purpose
   - Highlights (with ticket IDs)
   - Primary Risk
   - Blast Radius

### Via API (PowerShell):

```powershell
$authToken = "c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1"

$headers = @{
    "Authorization" = "Bearer $authToken"
    "Content-Type" = "application/json"
}

$body = @{
    maxHighlights = 7
    severityKeywords = @("High", "Critical")
} | ConvertTo-Json

$draft = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/draft-approval/TEST_5.0.1" `
    -Method POST `
    -Headers $headers `
    -Body $body

# Display results
Write-Host "`nPURPOSE:" -ForegroundColor Cyan
Write-Host $draft.purpose

Write-Host "`nHIGHLIGHTS:" -ForegroundColor Cyan
$draft.highlights | ForEach-Object { Write-Host $_ }

Write-Host "`nPRIMARY RISK:" -ForegroundColor Cyan
Write-Host $draft.primaryRisk

Write-Host "`nBLAST RADIUS:" -ForegroundColor Cyan
Write-Host $draft.blastRadius
```

## Step 4: Test Form Features

### Test Dirty Field Protection:

1. After AI draft populates fields
2. Manually edit "Purpose" field
3. Click "Draft with AI" again
4. ✓ Should prompt: "You have made edits to: purpose. AI draft will overwrite..."

### Test Clear Draft:

1. Click "Clear Draft" button
2. ✓ Should confirm before clearing
3. ✓ All textareas should be empty after confirmation

### Test Copy Email:

1. Fill all form fields (manually or via AI)
2. Click "📧 Copy Email"
3. ✓ Modal should open with formatted email
4. Click "Copy to Clipboard"
5. ✓ Paste into notepad to verify

## Expected AI Output Example

**Purpose:**

```
Fixes critical performance issues in SearchElse and FTP integrations, adds compliance-required Historical Data export API.
```

**Highlights:**

```
- Resolved SearchElse performance degradation reducing load times by 40% — Bug 196681
- Fixed FTP upload failures preventing scheduled nightly job failures — Bug 196682, Bug 196683, Bug 196684
- Added Historical Data export API for upcoming compliance audits — PBI 195883
- Optimized Device Page load times for mobile users — PBI 195884
- Enhanced ESL integration stability during peak hours — Bug 196684
- Improved InMsg batch processing by 60% — PBI 195885
```

**Primary Risk:**

```
Delaying this release will continue SearchElse timeouts affecting 200+ daily users during peak hours. FTP scheduled jobs remain at risk of failure, impacting nightly data deliveries. Compliance audits scheduled next month require the Historical Data export feature.
```

**Blast Radius:**

```
Affects: SearchElse module (200+ daily users), FTP scheduler (automated nightly jobs), Historical Data API (compliance team, external auditors), Device Page (mobile users), ESL integration (warehouse operations), InMsg batch processing (data pipeline)
```

## Troubleshooting

### "OPENAI_API_KEY not configured"

```powershell
# Check .env file
Get-Content .env | Select-String "OPENAI_API_KEY"

# Should show:
# OPENAI_API_KEY=sk-proj-...
```

### "Rate limit exceeded"

- Wait 5 seconds between requests
- Only one request per 5 seconds allowed

### Button doesn't respond

- Check browser console (F12)
- Verify AUTH_TOKEN is in page source
- Check server logs for errors

## Cleanup Test Data

```powershell
# To remove test data, you can ingest empty array or use SQLite directly
# Option 1: Stop server and delete database
Remove-Item "data\build_readiness.db"

# Option 2: Keep database but test with different release_id
# Use "TEST_5.0.2" instead of "TEST_5.0.1" in the ingest script
```

## Success Criteria

✓ Server starts without errors
✓ Sample data ingests successfully
✓ Release page displays with new Approval Request form
✓ AI Draft button generates content in 3-5 seconds
✓ All 4 fields populate (purpose, highlights, primaryRisk, blastRadius)
✓ Highlights include ticket IDs in format: "— Bug 123, PBI 456"
✓ Dirty field protection works (prompts before overwrite)
✓ Clear Draft button clears textareas
✓ Copy Email generates proper format
✓ Modal opens with email preview
✓ Copy to clipboard works

## Performance Notes

- **AI Response Time**: 3-5 seconds typical
- **API Cost**: ~$0.0001-0.0003 per request (gpt-4o-mini)
- **Rate Limit**: 1 request per 5 seconds
- **Max Tickets**: Tested with up to 200 tickets per release

## Next Steps

After successful testing:

1. Use your actual release data (replace "TEST_5.0.1" with real release ID)
2. Customize AI parameters (maxHighlights, severityKeywords) as needed
3. Adjust prompt in `ai.ts` for your organization's terminology
4. Add more theme keywords in `groupByThemes()` function
5. Consider saving drafts to database for history

---

**Documentation**: See `AI_APPROVAL_ENHANCEMENT.md` for full technical details.

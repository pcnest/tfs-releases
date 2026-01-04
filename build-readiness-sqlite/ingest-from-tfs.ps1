# ==== CONFIG ====
$TfsBaseUrl = "https://remote.spdev.us/tfs/SupplyPro.Applications"
$Project = "SupplyPro.Core"
$ReleaseID = "5.0.6.1"  # UPDATE THIS for each release
$WiqlFilterTag = "5.0.6.1"     # or use IterationPath/AreaPath filter
$Pat = "x34cxkcnvd7zuxw6egqyg2yyf6frsbw3vjjnmh37xgar2aopxwqa"

# API Config for SQLite app
$ApiUrl = "http://127.0.0.1:8080/api/ingest"
$ApiToken = "c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1"

# Output files (optional, for backup)
$OutTsv = "$PSScriptRoot\build_readiness_$ReleaseID.tsv"
$OutJson = "$PSScriptRoot\build_readiness_$ReleaseID.json"

# TLS + Auth header
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$basicAuth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$Pat"))
$Headers = @{ Authorization = "Basic $basicAuth" }

# ==== 1) Query candidate tickets via WIQL ====
$wiql = @{
  query = @"
SELECT [System.Id]
FROM WorkItems
WHERE
    [System.TeamProject] = '$Project'
    AND [System.WorkItemType] IN ('Product Backlog Item','Bug','Task')
    AND [System.State] NOT IN ('Removed')
    AND [System.Tags] CONTAINS '$WiqlFilterTag'
ORDER BY [System.ChangedDate] DESC
"@
} | ConvertTo-Json

$wiqlUrl = "$TfsBaseUrl/$Project/_apis/wit/wiql?api-version=2.2"
$wiqlRes = Invoke-RestMethod -Method Post -Uri $wiqlUrl -Headers $Headers -Body $wiql -ContentType "application/json"

if (!$wiqlRes.workItems) { 
  Write-Host "No work items found for $WiqlFilterTag" -ForegroundColor Yellow
  return 
}

$ids = ($wiqlRes.workItems | Select-Object -ExpandProperty id) -join ","

$wiUrl = "$TfsBaseUrl/_apis/wit/workitems?ids=$ids&api-version=2.2"
$items = (Invoke-RestMethod -Method Get -Uri $wiUrl -Headers $Headers).value

Write-Host "Found $($items.Count) work items`n" -ForegroundColor Cyan

# ==== 2) CC8-style readiness assessment ====
function Test-NotEmpty($v) { return -not [string]::IsNullOrWhiteSpace($v) }

function Strip-Html($html) {
  if ([string]::IsNullOrWhiteSpace($html)) { return "" }
  
  # Convert common HTML line break elements to newlines BEFORE stripping tags
  $text = $html -replace '<br\s*/?>', "`n"
  $text = $text -replace '</p>', "`n`n"
  $text = $text -replace '<p[^>]*>', ''
  $text = $text -replace '</div>', "`n"
  
  # Remove remaining HTML tags
  $text = $text -replace '<[^>]+>', ' '
  
  # Decode HTML entities
  $text = $text -replace '&nbsp;', ' '
  $text = $text -replace '&amp;', '&'
  $text = $text -replace '&lt;', '<'
  $text = $text -replace '&gt;', '>'
  $text = $text -replace '&quot;', '"'
  $text = $text -replace '&apos;', "'"
  
  # Clean up excessive whitespace on each line, but preserve line breaks
  $text = $text -replace '\t', ' '
  $text = $text -replace ' +', ' '
  $text = $text -replace ' *\n *', "`n"
  $text = $text -replace '\n{3,}', "`n`n"
  
  # Trim each line and remove completely empty lines at start/end
  $text = $text.Trim()
  
  # Remove any remaining problematic characters except newlines
  $text = $text -replace '[^\x20-\x7E\x80-\xFF\r\n]', ''
  
  return $text
}

function Detect-ReviewEvidence($f) {
  # Check if AC or Description contain review evidence
  $devText = Strip-Html $f."SupplyPro.SPApplication.DevNotes"
  $descText = Strip-Html $f."System.Description"
  
  # Check for common review indicators
  # if ($devText -match '(review|reviewed|QA|validated|tested)' -or 
  #   $descText -match '(review|reviewed|QA|validated|tested)') {
  #   return "Field"
  # }
  
  # Check for filled-out Peer Review section (has values after colons)
  # Pattern: "Buddy Tested by: [something]" on the same line
  if ($devText -match 'Buddy Tested by:[^\r\n]*\S' -or 
    $devText -match 'Buddy Test Date:[^\r\n]*\S' -or 
    $devText -match 'Buddy Test Status:[^\r\n]*\S' -or
    $descText -match 'Buddy Tested by:[^\r\n]*\S' -or 
    $descText -match 'Buddy Test Date:[^\r\n]*\S' -or 
    $descText -match 'Buddy Test Status:[^\r\n]*\S') {
    return "Peer"
  }
  
  # Check for filled-out Change Summary section (developer notes)
  # Pattern: "What Changed: [something]" on the same line
  if ($devText -match 'What Changed:[^\r\n]*\S' -or 
    $devText -match 'What Was Impacted:[^\r\n]*\S' -or 
    $devText -match 'What Must Be Tested:[^\r\n]*\S' -or
    $descText -match 'What Changed:[^\r\n]*\S' -or 
    $descText -match 'What Was Impacted:[^\r\n]*\S' -or 
    $descText -match 'What Must Be Tested:[^\r\n]*\S') {
    return "Dev"
  }
  
  # Check if there are related work items (simple heuristic)
  if ($f."System.RelatedLinkCount" -gt 0) {
    return "Relation"
  }
  
  return "None"
}

function Test-PeerReviewComplete($f) {
  $devText = Strip-Html $f."SupplyPro.SPApplication.DevNotes"
  $descText = Strip-Html $f."System.Description"
  
  # Check if all three fields are filled AND status is "passed" (case-insensitive)
  $hasBuddyBy = ($devText -match 'Buddy Tested by:[^\r\n]*\S' -or $descText -match 'Buddy Tested by:[^\r\n]*\S')
  $hasBuddyDate = ($devText -match 'Buddy Test Date:[^\r\n]*\S' -or $descText -match 'Buddy Test Date:[^\r\n]*\S')
  $hasPassed = ($devText -match 'Buddy Test Status:[^\r\n]*(passed|pass)' -or $descText -match 'Buddy Test Status:[^\r\n]*(passed|pass)')
  
  return ($hasBuddyBy -and $hasBuddyDate -and $hasPassed)
}

function Test-ChangeSummaryComplete($f) {
  $devText = Strip-Html $f."SupplyPro.SPApplication.DevNotes"
  $descText = Strip-Html $f."System.Description"
  
  # Check if all three Change Summary fields are filled
  $hasWhatChanged = ($devText -match 'What Changed:[^\r\n]*\S' -or $descText -match 'What Changed:[^\r\n]*\S')
  $hasWhatImpacted = ($devText -match 'What Was Impacted:[^\r\n]*\S' -or $descText -match 'What Was Impacted:[^\r\n]*\S')
  $hasWhatTested = ($devText -match 'What Must Be Tested:[^\r\n]*\S' -or $descText -match 'What Must Be Tested:[^\r\n]*\S')
  
  return ($hasWhatChanged -and $hasWhatImpacted -and $hasWhatTested)
}

function Test-AppropriateState($state) {
  $validStates = @('Branch Checkin', 'Resolved', 'Ready for QA')
  return ($validStates -contains $state)
}

function New-ApiRow($wi) {
  $f = $wi.fields
  
  # New 4-point scoring system
  $checks = [ordered]@{
    PeerReview    = Test-PeerReviewComplete $f
    ChangeSummary = Test-ChangeSummaryComplete $f
    State         = Test-AppropriateState $f."System.State"
    QANotes       = Test-NotEmpty $f."SupplyPro.SPApplication.QANotes"
  }

  $score = ($checks.GetEnumerator() | Where-Object { $_.Value }).Count
  $total = $checks.Count
  
  $missing = ($checks.Keys | Where-Object { -not $checks[$_] }) -join ", "
  
  # Return API-compatible format (camelCase)
  [pscustomobject]@{
    release_id         = $ReleaseID
    id                 = $wi.id
    type               = $f."System.WorkItemType"
    title              = $f."System.Title"
    state              = $f."System.State"
    severity           = $f."Microsoft.VSTS.Common.Severity"
    tags               = $f."System.Tags"
    acceptanceCriteria = Strip-Html $f."Microsoft.VSTS.Common.AcceptanceCriteria"
    description        = Strip-Html $f."System.Description"
    devNotes           = Strip-Html $f."SupplyPro.SPApplication.DevNotes"
    qaNotes            = Strip-Html $f."SupplyPro.SPApplication.QANotes"
    score              = "$score/$total"
    missing            = $missing
    reviewEvidence     = Detect-ReviewEvidence $f
  }
}

$apiRows = $items | ForEach-Object { New-ApiRow $_ }

# ==== 3) Save backup files (TSV + JSON) ====
$apiRows |
Select-Object id, type, title, state, score, missing, acceptanceCriteria, description, devNotes, qaNotes, tags, reviewEvidence |
Export-Csv -Path $OutTsv -NoTypeInformation -Delimiter "`t" -Encoding UTF8

# Use [System.IO.File]::WriteAllText for clean JSON output
$jsonContent = $apiRows | ConvertTo-Json -Depth 10 -Compress
[System.IO.File]::WriteAllText($OutJson, $jsonContent, [System.Text.Encoding]::UTF8)
Write-Host ""

# ==== 4) POST to SQLite API ====
try {
  Write-Host "Posting $($apiRows.Count) items to $ApiUrl..." -ForegroundColor Cyan
    
  $apiHeaders = @{
    "Authorization" = "Bearer $ApiToken"
    "Content-Type"  = "application/json; charset=utf-8"
  }
    
  # Serialize to JSON (array format)
  if ($apiRows.Count -eq 1) {
    $jsonBody = "[$($apiRows | ConvertTo-Json -Depth 10)]"
  }
  else {
    $jsonBody = $apiRows | ConvertTo-Json -Depth 10
  }
    
  $response = Invoke-RestMethod -Uri $ApiUrl -Method POST -Headers $apiHeaders -Body ([System.Text.Encoding]::UTF8.GetBytes($jsonBody))
    
  Write-Host "SUCCESS!" -ForegroundColor Green
  Write-Host "  Release ID: $($response.release_id)" -ForegroundColor Yellow
  Write-Host "  Rows inserted: $($response.inserted)" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "View the release at:" -ForegroundColor Cyan
  Write-Host "  http://127.0.0.1:8080/release/$($response.release_id)" -ForegroundColor White
    
}
catch {
  Write-Host "ERROR posting to API:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  if ($_.ErrorDetails.Message) {
    Write-Host "Details:" -ForegroundColor Yellow
    Write-Host $_.ErrorDetails.Message -ForegroundColor Yellow
  }
  Write-Host ""
  Write-Host "Data is still saved in the backup files above." -ForegroundColor Yellow
}

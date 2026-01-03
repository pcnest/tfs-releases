# Test script to ingest sample build readiness data
# Usage: .\test-ingest.ps1

$headers = @{
  "Authorization" = "Bearer c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1"
  "Content-Type"  = "application/json"
}

$body = @(
  @{
    release_id         = "R2024.1"
    id                 = 12345
    type               = "PBI"
    title              = "Implement user authentication"
    state              = "Done"
    tags               = "backend; security"
    acceptanceCriteria = "User can login with email and password"
    description        = "As a user, I want to login securely"
    devNotes           = "Implemented OAuth2 flow with JWT tokens"
    qaNotes            = "All security tests passing, penetration test completed"
    score              = "6/6"
    missing            = ""
    reviewEvidence     = "Field"
  },
  @{
    release_id         = "R2024.1"
    id                 = 12346
    type               = "PBI"
    title              = "Add dashboard analytics"
    state              = "In Progress"
    tags               = "frontend; analytics"
    acceptanceCriteria = "Dashboard shows key metrics"
    description        = "As an admin, I want to see analytics"
    devNotes           = "Charts implemented with Chart.js"
    qaNotes            = ""
    score              = "4/6"
    missing            = "QANotes"
    reviewEvidence     = "Relation"
  },
  @{
    release_id         = "R2024.1"
    id                 = 54321
    type               = "Bug"
    title              = "Fix memory leak in data processing"
    state              = "Done"
    tags               = "performance; backend"
    acceptanceCriteria = "Memory usage stable under load"
    description        = "Memory leak causing crashes after 24h"
    devNotes           = "Fixed event listener cleanup"
    qaNotes            = "Load tested for 48h, no leaks detected"
    score              = "5/5"
    missing            = ""
    reviewEvidence     = "Field"
  },
  @{
    release_id         = "R2024.1"
    id                 = 54322
    type               = "Bug"
    title              = "UI alignment issue on mobile"
    state              = "New"
    tags               = "frontend; ui"
    acceptanceCriteria = "UI renders correctly on all devices"
    description        = "Buttons misaligned on iOS Safari"
    devNotes           = ""
    qaNotes            = ""
    score              = "1/5"
    missing            = "DevNotes, QANotes"
    reviewEvidence     = "None"
  }
) | ConvertTo-Json -Depth 10

try {
  Write-Host "Ingesting test data to http://127.0.0.1:8080/api/ingest..." -ForegroundColor Cyan
    
  $response = Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/ingest" `
    -Method POST -Headers $headers -Body $body
    
  Write-Host "Success!" -ForegroundColor Green
  Write-Host "  Release ID: $($response.release_id)" -ForegroundColor Yellow
  Write-Host "  Rows inserted: $($response.inserted)" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "View the release at:" -ForegroundColor Cyan
  Write-Host "  http://127.0.0.1:8080/release/$($response.release_id)" -ForegroundColor White
    
}
catch {
  Write-Host "Error:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
}

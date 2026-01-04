# 🚀 Quick Start - AI Approval Request

## 1-Minute Setup

```bash
# 1. Install dependencies (if needed)
cd build-readiness-sqlite/server
npm install

# 2. Verify .env has OPENAI_API_KEY
cat .env | grep OPENAI_API_KEY

# 3. Start server
npm run dev

# 4. Open browser
# http://127.0.0.1:8080/release/YOUR_RELEASE_ID
```

## ⚡ Quick Commands

### Ingest Data

```powershell
$authToken = "c5e8a1f0d3b2c4971a6e8d05f4c3b2a19e7d6c5b4a3f2e1098d7c6b5a4e3d2c1"

Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/ingest" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $authToken"
        "Content-Type" = "application/json"
    } `
    -Body (Get-Content "path\to\your\data.json")
```

### Test AI Draft

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8080/api/draft-approval/YOUR_RELEASE_ID" `
    -Method POST `
    -Headers @{
        "Authorization" = "Bearer $authToken"
        "Content-Type" = "application/json"
    } `
    -Body (@{maxHighlights=7} | ConvertTo-Json)
```

## 🎯 Form Fields

| Field               | Type     | Required | AI Populated |
| ------------------- | -------- | -------- | ------------ |
| Project Name        | text     | ✓        | ✗            |
| Release Manager     | text     | ✓        | ✗            |
| Purpose             | textarea |          | ✓            |
| Highlights          | textarea |          | ✓            |
| Release Window Date | date     | ✓        | ✗            |
| Release Env         | select   | ✓        | ✗            |
| Release Change Type | select   | ✓        | ✗            |
| Scope               | textarea |          | ✗            |
| Primary Risk        | textarea |          | ✓            |
| Blast Radius        | textarea |          | ✓            |

## 🔘 Buttons

| Button           | Action                            |
| ---------------- | --------------------------------- |
| ✨ Draft with AI | Generates content via OpenAI API  |
| Clear Draft      | Resets textareas (confirms first) |
| 📧 Copy Email    | Opens modal with formatted email  |

## 📊 What AI Generates

✓ **Purpose** (1-2 lines)

- Business value summary
- Key defects fixed

✓ **Highlights** (5-7 bullets)

- Grouped by theme
- Ends with ticket IDs
- Example: "- Fixed FTP failures — Bug 196682, 196683"

✓ **Primary Risk** (2-3 lines)

- Impact of delay/rejection
- User/business consequences

✓ **Blast Radius** (names)

- Affected users
- Impacted systems/modules

## 🎨 AI Prompt Customization

Edit `server/src/ai.ts` → `buildPrompt()` function:

```typescript
// Change max highlights
const maxHighlights = options.maxHighlights || 6;

// Add/remove theme keywords
const themeKeywords = [
  'SearchElse',
  'YourCustomTheme', // ← Add here
  // ...
];

// Adjust severity keywords
const severityKeywords = options.severityKeywords || ['High', 'Critical'];
```

## 🔒 Security Checklist

- [ ] `.env` file exists with `OPENAI_API_KEY`
- [ ] `.env` is in `.gitignore`
- [ ] `AUTH_TOKEN` is secure (not default)
- [ ] Server only binds to `127.0.0.1` (localhost)
- [ ] Rate limiting active (5s cooldown)

## 💰 Cost Estimate

| Usage  | Tickets | Cost/Request |
| ------ | ------- | ------------ |
| Light  | 1-50    | $0.0001      |
| Medium | 51-100  | $0.0002      |
| Heavy  | 101-200 | $0.0003      |

**Model**: gpt-4o-mini (fast & affordable)

## 🐛 Common Issues

| Issue                    | Solution                                   |
| ------------------------ | ------------------------------------------ |
| "API key not configured" | Add `OPENAI_API_KEY` to `.env` and restart |
| "Rate limit exceeded"    | Wait 5 seconds between requests            |
| "No rows for release"    | Verify data with `/release/:rid.json`      |
| Button doesn't work      | Check browser console (F12)                |
| AI returns weird output  | Retry (has 2-attempt logic)                |

## 📁 Key Files

```
server/
├── .env                    # ← Add OPENAI_API_KEY here
├── src/
│   ├── ai.ts              # ← OpenAI logic & prompts
│   ├── routes.ts          # ← API endpoint
│   └── types.ts           # ← Schemas
└── views/
    └── table.ejs          # ← UI form & JavaScript
```

## 🧪 Test URLs

- Home: http://127.0.0.1:8080
- Health: http://127.0.0.1:8080/healthz
- Release: http://127.0.0.1:8080/release/YOUR_RELEASE_ID
- JSON: http://127.0.0.1:8080/release/YOUR_RELEASE_ID.json

## 📖 Full Docs

- **Complete Guide**: `AI_APPROVAL_ENHANCEMENT.md`
- **Test Script**: `TEST_GUIDE.md`
- **Main README**: `README.md`

---

**Need Help?** Check server logs: `npm run dev` output

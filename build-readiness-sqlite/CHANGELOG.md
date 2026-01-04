# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-01-04

### Added - AI-Powered Approval Request Feature

#### Backend

- **New Module**: `server/src/ai.ts`

  - OpenAI integration with gpt-4o-mini model
  - Intelligent prompt engineering with theme detection
  - Rate limiting (5-second cooldown between requests)
  - Automatic retry logic for invalid JSON responses
  - Hot item detection (critical bugs, incomplete scores)
  - Theme-based grouping (SearchElse, FTP, ESL, etc.)
  - Zod schema validation for AI outputs

- **New API Endpoint**: `POST /api/draft-approval/:rid`

  - Bearer token authentication (reuses existing AUTH_TOKEN)
  - Optional input parameters (maxHighlights, severityKeywords)
  - Comprehensive error handling (400, 401, 429, 500)
  - JSON response with structured approval content

- **Database Helpers** (db.ts):

  - `getRowsByRelease()` - Alias for AI module compatibility
  - `getThemeBuckets()` - Keyword-based theme grouping

- **Type Definitions** (types.ts):
  - `DraftApprovalInputSchema` - Request validation
  - `DraftApprovalOutputSchema` - Response validation
  - Full TypeScript type exports

#### Frontend

- **Approval Request Form** (table.ejs):

  - 10 form fields with proper validation
  - Field grouping (Release Window, Risk & Impact)
  - Responsive design with Tailwind CSS
  - Required field indicators

- **Three Action Buttons**:

  - ✨ Draft with AI - Generates content via OpenAI
  - Clear Draft - Resets textareas with confirmation
  - 📧 Copy Email - Opens modal with formatted email

- **Client-Side Features**:
  - Dirty field tracking (warns before overwriting edits)
  - Loading spinner during AI generation
  - Success/error toast notifications
  - Email preview modal with copy-to-clipboard
  - CSP-compliant JavaScript (no inline handlers)

#### Documentation

- `AI_APPROVAL_ENHANCEMENT.md` - Complete technical documentation (1000+ lines)
- `TEST_GUIDE.md` - Step-by-step testing instructions with samples
- `QUICK_REFERENCE.md` - One-page quick start guide
- `ARCHITECTURE.md` - System architecture diagrams and flows
- `IMPLEMENTATION_SUMMARY.md` - Detailed implementation checklist
- `CHANGELOG.md` - This file

#### Configuration

- Added `OPENAI_API_KEY` environment variable to `.env`
- Reused existing `AUTH_TOKEN` for protected endpoints

#### Dependencies

- Added `openai@^4.x` - Official OpenAI SDK

### Changed

- Enhanced release page (`/release/:rid`) with Approval Request section
- Extended routes.ts with AI draft endpoint
- Updated .env with OpenAI configuration

### Security

- Bearer token authentication on all AI endpoints
- Rate limiting to prevent API abuse (5s cooldown)
- Input validation with Zod schemas
- CSP-compliant frontend code
- Environment variables for sensitive keys

### Performance

- Typical AI response time: 3-5 seconds
- Cost per request: ~$0.0002 (gpt-4o-mini)
- No database writes (AI draft is ephemeral)
- In-memory theme detection and grouping

---

## [1.0.0] - 2025-12-XX (Previous Release)

### Added

- Initial release of Build Readiness Tracker
- SQLite database backend with better-sqlite3
- Express.js REST API server
- EJS template engine for views
- Health check endpoint (`/healthz`)
- Data ingest endpoint (`POST /api/ingest`)
- Release table view (`GET /release/:rid`)
- JSON export endpoint (`GET /release/:rid.json`)
- Bearer token authentication for ingest
- Statistics dashboard (total, PBIs, bugs, scores)
- Expandable row details with acceptance criteria
- Client-side search filtering
- Copy to CSV/TSV functionality
- Tailwind CSS styling
- Helmet security middleware
- Morgan request logging

### Configuration

- Environment variables via dotenv
- AUTH_TOKEN for API authentication
- PORT configuration (default: 8080)
- Localhost-only binding for security

### Dependencies

- `express@^4.18.2` - Web framework
- `better-sqlite3@^9.2.2` - Database
- `ejs@^3.1.9` - Template engine
- `helmet@^7.1.0` - Security headers
- `morgan@^1.10.0` - Request logging
- `zod@^3.22.4` - Schema validation
- `dotenv@^16.3.1` - Environment config

---

## Migration Notes

### Upgrading from 1.x to 2.x

1. **Install new dependency**:

   ```bash
   npm install openai
   ```

2. **Update .env file**:

   ```env
   # Add this line
   OPENAI_API_KEY=sk-proj-your-key-here
   ```

3. **Rebuild application**:

   ```bash
   npm run build
   ```

4. **Restart server**:

   ```bash
   npm run dev
   # or
   npm start
   ```

5. **Verify functionality**:
   - Navigate to any release page
   - Scroll to bottom to see new "Approval Request" section
   - Test "Draft with AI" button

### Breaking Changes

- None. This is a backward-compatible enhancement.
- Existing API endpoints remain unchanged.
- Database schema unchanged.
- No migration required.

### New Environment Variables Required

- `OPENAI_API_KEY` - **Required** for AI features to work
  - Get your key from: https://platform.openai.com/api-keys
  - Without this, AI draft button will show error

### Optional Configuration

- Default `maxHighlights`: 6 (can be customized via API)
- Default `severityKeywords`: ["High", "Critical"] (can be customized)
- Rate limit: 5 seconds (hardcoded in ai.ts, can be modified)

---

## Deprecations

- None in this release

## Known Issues

- None reported

## Planned Features (Future Releases)

- [ ] Save draft history to database
- [ ] Export approval to PDF format
- [ ] Custom AI instructions per project
- [ ] Support for multiple AI models (GPT-4, Claude, etc.)
- [ ] Approval workflow tracking
- [ ] Email integration (send directly from app)
- [ ] Version comparison (diff view between releases)
- [ ] Template management for different project types
- [ ] Batch operations (multiple releases)

---

## Version History

- **2.0.0** (2026-01-04) - AI Approval Request Enhancement
- **1.0.0** (2025-12-XX) - Initial Release

---

## Contributors

- Implementation: GitHub Copilot
- Architecture: Based on user requirements
- Documentation: Comprehensive guides provided

## License

MIT

## Support

- Technical Docs: `AI_APPROVAL_ENHANCEMENT.md`
- Quick Start: `QUICK_REFERENCE.md`
- Testing: `TEST_GUIDE.md`
- Architecture: `ARCHITECTURE.md`

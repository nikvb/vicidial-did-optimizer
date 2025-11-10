# DID Optimizer Codebase Structure

**Generated:** 2025-11-09
**Purpose:** Complete inventory of all project files organized by category

---

## 1. Frontend Application (React)

**Location:** `/home/na/didapi/temp_clone/frontend/src/`

### Pages (43 files)
```
src/pages/
├── Analytics.js                    - Analytics dashboard
├── AuthCallbackPage.js             - OAuth callback handler
├── Billing.js                      - Active billing page
├── Billing.old.js                  - Legacy billing (CANDIDATE FOR REMOVAL)
├── BillingNew.js                   - Billing v2 (CANDIDATE FOR REMOVAL)
├── ContactPage.js                  - Public contact page
├── Dashboard.js                    - Main dashboard
├── DIDManagement.js                - DID management interface
├── DIDManagementAdvanced.js        - Advanced DID features
├── DIDManagementDataTable.js       - Data table view
├── FeaturesPage.js                 - Public features page
├── ForgotPasswordPage.js           - Password reset flow
├── HowItWorksPage.js               - Public how-it-works page
├── LandingPage.js                  - Public landing page
├── LoginPage.js                    - Authentication page
├── PricingPage.js                  - Public pricing page
├── RegisterPage.js                 - User registration
├── ResetPasswordPage.js            - Password reset completion
├── RotationRules.js                - DID rotation configuration
├── Settings.js                     - Application settings
├── TestimonialsPage.js             - Public testimonials
├── UserManagement.js               - User admin panel
└── VerifyEmailPage.js              - Email verification
```

### Components (13 files)
```
src/components/
├── auth/
│   ├── ProtectedRoute.js           - Auth guard for private routes
│   └── PublicRoute.js              - Auth guard for public routes
├── billing/
│   ├── AddPaymentMethodModal.js    - Payment method form modal
│   ├── PaymentMethodForm.js        - LEGACY (CANDIDATE FOR REMOVAL)
│   └── PaymentMethodList.js        - Payment methods display
├── common/
│   └── LoadingSpinner.js           - Loading indicator
├── layouts/
│   └── DashboardLayout.js          - Main app layout
├── navigation/
│   └── MobileNav.js                - Mobile navigation menu
├── settings/
│   ├── ApiKeys.js                  - API key management
│   └── VICIdialIntegration.js      - VICIdial integration UI
├── AiDIDBot.js                     - AI chatbot component
├── DIDDataTable.js                 - DID data table
└── ReputationDetailsModal.js       - Reputation info modal
```

### Services (3 files)
```
src/services/
├── api.js                          - Axios HTTP client
├── authService.js                  - Authentication logic
└── tokenService.js                 - JWT token management
```

### Core Files (3 files)
```
src/
├── App.js                          - Root component & routing
├── index.js                        - React entry point
└── context/
    └── AuthContext.js              - Global auth state
```

**Frontend Total:** 43 files (excluding node_modules)

---

## 2. Backend API

### Main Server
```
/home/na/didapi/
└── server-full.js                  - Express.js application (ES modules)
```

### Routes (2 files)
```
routes/
├── billing.js                      - Billing & payment endpoints
└── vicidial.js                     - VICIdial integration API
```

### Services (10 files)
```
services/
├── billing/
│   ├── billingService.js           - Core billing logic
│   ├── monthlyBilling.js           - Subscription billing
│   ├── paypalCharging.js           - PayPal Orders API integration
│   └── paypalVault.js              - PayPal Payment Token API
├── email/
│   └── billingEmails.js            - Billing email templates
├── background-scraper-service.js   - Background reputation scanning
├── crawl4ai-service.js             - Crawl4AI Node.js integration
├── emailService.js                 - General email service
├── reputation-service.js           - Phone reputation lookups
└── webshare-proxy-service.js       - Proxy rotation service
```

### Models (10 files)
```
models/
├── AreaCodeLocation.js             - Area code geolocation data
├── AuditLog.js                     - System activity logs
├── CallRecord.js                   - Call history records
├── Campaign.js                     - VICIdial campaigns
├── DID.js                          - Phone number data model
├── Invoice.js                      - Billing invoices
├── RotationRule.js                 - Rotation configuration
├── Tenant.js                       - Multi-tenant data
├── User.js                         - User accounts & auth
└── VICIdialSetting.js              - VICIdial integration config
```

### Middleware (2 files)
```
middleware/
├── auth.js                         - JWT authentication
└── errorHandler.js                 - Global error handler
```

**Backend Total:** 25 files

---

## 3. Scraper & Crawl4AI Integration

### Node.js Services (3 files)
```
services/
├── crawl4ai-service.js             - Node.js wrapper for Crawl4AI Python
├── background-scraper-service.js   - Queue-based scraping service
└── reputation-service.js           - Reputation lookup orchestrator
```

### Python Scrapers (7 files)
```
scripts/
├── crawl4ai_scraper.py             - Base Crawl4AI scraper
├── ollama_crawl4ai_scraper.py      - Ollama LLM integration
├── openrouter_crawl4ai_scraper.py  - OpenRouter LLM integration
├── enhanced_openrouter_scraper.py  - Enhanced scraper with fallbacks
├── test_vllm_debug.py              - vLLM testing
└── test_json_parse.py              - JSON parsing tests
```

### Bulk Update Scripts (3 files)
```
/home/na/didapi/
├── bulk_update_reputation_fast.js  - Fast batch reputation updates
├── bulk_update_no_proxy.js         - Updates without proxy
└── update-specific-dids.js         - Single DID updater
```

**Scraper Total:** 13 files

---

## 4. VICIdial Integration

### Integration Files (6 files)
```
vicidial-integration/
├── vicidial-did-optimizer.agi      - Asterisk AGI script (Perl)
├── AST_DID_optimizer_sync.pl       - Call results sync (Perl)
├── dids.conf                       - Configuration template
├── install-agi.sh                  - AGI installation script
├── install-call-results-sync.sh    - Sync installation script
└── README.md                       - Integration documentation
```

### Installation Scripts (3 files)
```
/home/na/didapi/
├── install-vicidial-integration.sh
├── install-vicidial-integration-agi.sh
└── install-vicidial-integration-autodetect.sh
```

### Testing & Monitoring (6 files)
```
/home/na/didapi/
├── test-vicidial-integration.sh
├── verify-dialplan-setup.sh
├── monitor-did-api.sh
├── test-api-calls.sh
├── test-agi-simple.sh
└── test-perl-sync.sh
```

**VICIdial Total:** 15 files

---

## 5. Test Files

### 🔴 Playwright/Browser Tests (69 files - CLEANUP CANDIDATES)

**Authentication Tests (7 files):**
```
test-login.cjs
test-login-debug.cjs
test-login-dashboard.cjs
test-api3-login.cjs
test-auth-isolation.cjs
test-auth-simple.js
create-test-user.js
```

**Dashboard Tests (12 files):**
```
test-dashboard-api.cjs
test-dashboard-api-v2.cjs                    ← KEEP (latest version)
test-dashboard-api-direct.cjs
test-dashboard-client.cjs
test-dashboard-debug.cjs
test-dashboard-detailed.cjs
test-dashboard-fixed.cjs
test-dashboard-reputation.cjs
test-final-cloudflare.cjs                    ← KEEP (full integration)
test-local-dashboard.cjs
test-local-direct.cjs
test-complete-fix.js
```

**DID Management Tests (20 files):**
```
test-did-management.cjs
test-did-management-enhanced.cjs
test-local-did-management.cjs
test-did-dates-playwright.cjs
test-did-usage-fix.cjs
test-lastused-fix.cjs
test-ai-bot.cjs
test-did-component-final.cjs
test-simple-datatable.cjs
test-did-details-popup.cjs
test-reputation-modal.cjs
test-did-selection-pagination.cjs
test-pagination-selection-fix.cjs
test-reputation-modal-fixed.cjs
test-cross-page-selection-fix.cjs
test-pagination-and-selection.cjs
test-multipage-selection.cjs
test-flickering-fix.cjs
test-standard-selection.cjs
test-multipage-comprehensive.cjs
```

**DID Count & Reputation Tests (6 files):**
```
test-did-count.cjs
test-reputation-api.cjs
test-reputation-fixed.cjs
test-reputation-modal-complete.cjs
test-single-did-screenshot.js
test-screenshot-modal.cjs
```

**Settings & API Keys Tests (10 files):**
```
test-settings-api-keys.cjs
test-settings-api-keys-fixed.cjs
test-api-keys-tab.cjs
test-api-keys.cjs
test-api-keys-fixed.cjs
test-api-keys-full.cjs
test-api-keys-simple.cjs
test-api-keys-port5000.cjs
test-api-keys-fetch.js
test-api-create.js
test-api-key-creation.js
```

**Analytics Tests (2 files):**
```
test-capacity-analytics.cjs
test-destination-analytics.cjs
```

**VICIdial Settings Tests (2 files):**
```
test-vicidial-settings.cjs
test-vicidial-error-messages.cjs
```

**Billing Tests (5 files):**
```
test-billing-page.cjs
test-billing-api.cjs
test-usage-endpoint.cjs
test-vault-card.cjs
test-vault-card-v2.cjs
test-vault-api-direct.js
```

**Utility Tests (5 files):**
```
test-port-comparison.cjs
generate-test-token.js
test-email.js
test_proxy_reload.js
test-campaign-sync.sh
```

### 🟡 Python Tests (9 files - CLEANUP CANDIDATES)
```
temp_clone/
├── test-crawl4ai-init.py
├── test-crawl4ai-llm.py
├── test-ollama-direct.py
├── debug-crawl4ai-ollama.py
├── test-ollama-formats.py
├── test-crawl4ai-verbose.py
├── test-fast-ollama.py
├── test_openrouter_debug.py
├── debug_enhanced_openrouter.py
└── test_complete_integration.py
```

**Test Files Total:** 78 files

---

## 6. Utility & Management Scripts

### Server Management (10 files)
```
start-server.sh
start-production.sh
start-dev.sh
stop-production.sh
stop-dev.sh
restart-all.sh
status.sh
```

### Data Management (3 files)
```
scripts/import-area-codes.js        - Import geolocation data
update-did-reputation.sh            - Reputation updater
run-reputation-scanner.sh           - Background scanner
```

### Verification & Monitoring (3 files)
```
verify-urls.sh
verify-dialplan-setup.sh
monitor-did-api.sh
```

### VICIdial Setup (2 files)
```
setup-vicidial-sync-cron.sh
get_vicidial.sh
```

**Scripts Total:** 18 files

---

## 7. Documentation Files

```
CLAUDE.md                           - AI assistant instructions
CODEBASE_STRUCTURE.md               - This file
README.md                           - Project documentation
BILLING_SYSTEM_IMPLEMENTATION_PLAN.md
COMPLETE_BILLING_SYSTEM_READY.md
FRONTEND_IMPLEMENTATION_COMPLETE.md
IMPLEMENTATION_SUMMARY.md
PHASE_1_IMPLEMENTATION_COMPLETE.md
PRICING_STRUCTURE_SUMMARY.md
CONVERSATION_SUMMARY_SCREENSHOT_IMPLEMENTATION.md
```

---

## Summary Statistics

| Category | Active Files | Test/Debug Files | Total |
|----------|-------------|------------------|-------|
| Frontend | 43 | 0 | 43 |
| Backend API | 25 | 0 | 25 |
| Scraper/Crawl4AI | 13 | 0 | 13 |
| VICIdial Integration | 15 | 6 | 21 |
| Utility Scripts | 18 | 0 | 18 |
| Test Files | 0 | 78 | 78 |
| Documentation | 10 | 0 | 10 |
| **TOTAL** | **124** | **84** | **208** |

---

## Recommended Cleanup Actions

### 🔴 High Priority - Safe to Remove (54 files)

**Duplicate Dashboard Tests (keep only latest):**
- ✅ KEEP: `test-dashboard-api-v2.cjs`, `test-final-cloudflare.cjs`
- 🗑️ REMOVE: All other dashboard tests (10 files)

**Duplicate DID Management Tests (keep only comprehensive):**
- ✅ KEEP: `test-multipage-comprehensive.cjs`
- 🗑️ REMOVE: All other DID management tests (19 files)

**Duplicate API Keys Tests (keep only simple):**
- ✅ KEEP: `test-api-keys-simple.cjs`
- 🗑️ REMOVE: All other API keys tests (9 files)

**Debug/Development Tests:**
- 🗑️ REMOVE: All Python debug tests (10 files)
- 🗑️ REMOVE: `test-login-debug.cjs`, `test-dashboard-debug.cjs`

**Legacy/Incomplete Tests:**
- 🗑️ REMOVE: `test-auth-isolation.cjs`, `test-local-*` files

### 🟡 Medium Priority - Review Before Removal (10 files)

**Specialized Tests (may be needed for specific features):**
- `test-ai-bot.cjs` - AI chatbot testing
- `test-reputation-api.cjs` - Reputation service testing
- `test-capacity-analytics.cjs` - Analytics testing
- `test-destination-analytics.cjs` - Analytics testing
- `test-vicidial-settings.cjs` - VICIdial UI testing
- `test-billing-page.cjs` - Billing UI testing
- `test-vault-card-v2.cjs` - PayPal vaulting testing

### ✅ Keep - Essential Test Files (14 files)

**Integration Tests:**
- `test-dashboard-api-v2.cjs` - Latest dashboard test
- `test-final-cloudflare.cjs` - Full integration test
- `test-multipage-comprehensive.cjs` - Comprehensive DID test

**Feature-Specific Tests:**
- `test-api-keys-simple.cjs` - API keys functionality
- `test-reputation-modal-complete.cjs` - Reputation feature
- `test-billing-api.cjs` - Billing API
- `test-vault-card-v2.cjs` - Payment vaulting

**Utility Tests:**
- `test-email.js` - Email service
- `create-test-user.js` - Test data creation
- `generate-test-token.js` - Token generation

---

## Next Steps

1. ✅ **Review** this document with project stakeholders
2. ⚠️ **Backup** all test files before deletion
3. 🗑️ **Remove** 54 duplicate/debug test files
4. 📝 **Create** test suite documentation for remaining tests
5. 🔄 **Update** CI/CD to run essential tests only

---

**Note:** This document reflects the state of the codebase as of 2025-11-09. Keep updated as project evolves.

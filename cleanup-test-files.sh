#!/bin/bash

# Test Files Cleanup Script
# Generated: 2025-11-09
# Purpose: Remove duplicate and debug test files to reduce clutter

set -e  # Exit on error

echo "========================================"
echo "Test Files Cleanup"
echo "========================================"
echo ""

# Create backup directory
BACKUP_DIR="test-files-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "✓ Created backup directory: $BACKUP_DIR"
echo ""

# Counter
REMOVED_COUNT=0

# Function to backup and remove file
backup_and_remove() {
    local file="$1"
    if [ -f "$file" ]; then
        # Copy to backup
        cp "$file" "$BACKUP_DIR/"
        # Remove original
        rm "$file"
        echo "  🗑️  Removed: $file"
        REMOVED_COUNT=$((REMOVED_COUNT + 1))
    fi
}

echo "========================================"
echo "1. Removing Duplicate Dashboard Tests"
echo "========================================"
backup_and_remove "test-dashboard-api.cjs"
backup_and_remove "test-dashboard-api-direct.cjs"
backup_and_remove "test-dashboard-client.cjs"
backup_and_remove "test-dashboard-debug.cjs"
backup_and_remove "test-dashboard-detailed.cjs"
backup_and_remove "test-dashboard-fixed.cjs"
backup_and_remove "test-dashboard-reputation.cjs"
backup_and_remove "test-local-dashboard.cjs"
backup_and_remove "test-local-direct.cjs"
backup_and_remove "test-complete-fix.js"
echo "✓ Dashboard tests cleaned (kept: test-dashboard-api-v2.cjs, test-final-cloudflare.cjs)"
echo ""

echo "========================================"
echo "2. Removing Duplicate DID Management Tests"
echo "========================================"
backup_and_remove "test-did-management.cjs"
backup_and_remove "test-did-management-enhanced.cjs"
backup_and_remove "test-local-did-management.cjs"
backup_and_remove "test-did-dates-playwright.cjs"
backup_and_remove "test-did-usage-fix.cjs"
backup_and_remove "test-lastused-fix.cjs"
backup_and_remove "test-did-component-final.cjs"
backup_and_remove "test-simple-datatable.cjs"
backup_and_remove "test-did-details-popup.cjs"
backup_and_remove "test-reputation-modal.cjs"
backup_and_remove "test-did-selection-pagination.cjs"
backup_and_remove "test-pagination-selection-fix.cjs"
backup_and_remove "test-reputation-modal-fixed.cjs"
backup_and_remove "test-cross-page-selection-fix.cjs"
backup_and_remove "test-pagination-and-selection.cjs"
backup_and_remove "test-multipage-selection.cjs"
backup_and_remove "test-flickering-fix.cjs"
backup_and_remove "test-standard-selection.cjs"
backup_and_remove "test-did-count.cjs"
echo "✓ DID management tests cleaned (kept: test-multipage-comprehensive.cjs)"
echo ""

echo "========================================"
echo "3. Removing Duplicate API Keys Tests"
echo "========================================"
backup_and_remove "test-settings-api-keys.cjs"
backup_and_remove "test-settings-api-keys-fixed.cjs"
backup_and_remove "test-api-keys-tab.cjs"
backup_and_remove "test-api-keys.cjs"
backup_and_remove "test-api-keys-fixed.cjs"
backup_and_remove "test-api-keys-full.cjs"
backup_and_remove "test-api-keys-port5000.cjs"
backup_and_remove "test-api-keys-fetch.js"
backup_and_remove "test-api-create.js"
backup_and_remove "test-api-key-creation.js"
echo "✓ API keys tests cleaned (kept: test-api-keys-simple.cjs)"
echo ""

echo "========================================"
echo "4. Removing Duplicate Login Tests"
echo "========================================"
backup_and_remove "test-login.cjs"
backup_and_remove "test-login-debug.cjs"
backup_and_remove "test-login-dashboard.cjs"
backup_and_remove "test-api3-login.cjs"
backup_and_remove "test-auth-isolation.cjs"
backup_and_remove "test-auth-simple.js"
echo "✓ Login tests cleaned (kept: create-test-user.js, generate-test-token.js)"
echo ""

echo "========================================"
echo "5. Removing Duplicate Reputation Tests"
echo "========================================"
backup_and_remove "test-reputation-fixed.cjs"
backup_and_remove "test-reputation-api.cjs"
backup_and_remove "test-single-did-screenshot.js"
backup_and_remove "test-screenshot-modal.cjs"
echo "✓ Reputation tests cleaned (kept: test-reputation-modal-complete.cjs)"
echo ""

echo "========================================"
echo "6. Removing Duplicate Billing Tests"
echo "========================================"
backup_and_remove "test-billing-page.cjs"
backup_and_remove "test-usage-endpoint.cjs"
backup_and_remove "test-vault-card.cjs"
backup_and_remove "test-vault-api-direct.js"
echo "✓ Billing tests cleaned (kept: test-billing-api.cjs, test-vault-card-v2.cjs)"
echo ""

echo "========================================"
echo "7. Removing Utility/Debug Tests"
echo "========================================"
backup_and_remove "test-port-comparison.cjs"
backup_and_remove "test_proxy_reload.js"
echo "✓ Utility tests cleaned"
echo ""

echo "========================================"
echo "8. Removing Python Debug Tests (temp_clone/)"
echo "========================================"
ORIGINAL_DIR=$(pwd)
BACKUP_DIR_ABS="${ORIGINAL_DIR}/${BACKUP_DIR}"
cd temp_clone 2>/dev/null && {
    # Override backup function to use absolute path
    backup_and_remove() {
        local file="$1"
        if [ -f "$file" ]; then
            cp "$file" "$BACKUP_DIR_ABS/"
            rm "$file"
            echo "  🗑️  Removed: $file"
            REMOVED_COUNT=$((REMOVED_COUNT + 1))
        fi
    }

    backup_and_remove "test-crawl4ai-init.py"
    backup_and_remove "test-crawl4ai-llm.py"
    backup_and_remove "test-ollama-direct.py"
    backup_and_remove "debug-crawl4ai-ollama.py"
    backup_and_remove "test-ollama-formats.py"
    backup_and_remove "test-crawl4ai-verbose.py"
    backup_and_remove "test-fast-ollama.py"
    backup_and_remove "test_openrouter_debug.py"
    backup_and_remove "debug_enhanced_openrouter.py"
    backup_and_remove "test_complete_integration.py"
    cd "$ORIGINAL_DIR"
} || true
echo "✓ Python debug tests cleaned"
echo ""

echo "========================================"
echo "9. Removing Legacy Frontend Files"
echo "========================================"
# Reset backup function
backup_and_remove() {
    local file="$1"
    if [ -f "$file" ]; then
        cp "$file" "$BACKUP_DIR/"
        rm "$file"
        echo "  🗑️  Removed: $file"
        REMOVED_COUNT=$((REMOVED_COUNT + 1))
    fi
}
backup_and_remove "temp_clone/frontend/src/pages/Billing.old.js"
backup_and_remove "temp_clone/frontend/src/pages/BillingNew.js"
backup_and_remove "temp_clone/frontend/src/components/billing/PaymentMethodForm.js"
backup_and_remove "temp_clone/frontend/src/test-auth-isolation.cjs"
echo "✓ Legacy frontend files cleaned"
echo ""

echo "========================================"
echo "CLEANUP SUMMARY"
echo "========================================"
echo "Total files removed: $REMOVED_COUNT"
echo "Backup location: $BACKUP_DIR"
echo ""
echo "✅ Kept essential test files:"
echo "  - test-dashboard-api-v2.cjs"
echo "  - test-final-cloudflare.cjs"
echo "  - test-multipage-comprehensive.cjs"
echo "  - test-api-keys-simple.cjs"
echo "  - test-reputation-modal-complete.cjs"
echo "  - test-billing-api.cjs"
echo "  - test-vault-card-v2.cjs"
echo "  - test-ai-bot.cjs"
echo "  - test-capacity-analytics.cjs"
echo "  - test-destination-analytics.cjs"
echo "  - test-vicidial-settings.cjs"
echo "  - test-vicidial-error-messages.cjs"
echo "  - test-email.js"
echo "  - create-test-user.js"
echo "  - generate-test-token.js"
echo ""
echo "✓ Cleanup complete!"
echo ""

# Multi-Page Selection Investigation - Findings

## Problem Summary

Multi-page selection is **NOT WORKING** with react-data-table-component v7.7.0 and server-side pagination after multiple implementation attempts.

## Test Results

**Playwright Test Output:**
```
✅ Page 1: 5 DIDs selected successfully
❌ Navigate to Page 2: Bulk operations bar disappeared - selections LOST
❌ Back to Page 1: 0 checkboxes checked - all selections gone
```

## Approaches Tried

### 1. Using `persistSelectedOnPageChange` prop (FAILED)
- **What**: Added `persistSelectedOnPageChange={true}` and `persistSelectedOnSort={true}`
- **Result**: Does NOT work with `paginationServer={true}`
- **Reason**: These props were designed for client-side pagination where all data is available. With server-side pagination, the DataTable only has current page data.

### 2. Manual selection state management (FAILED)
- **What**: Maintained `selectedDIDIds` Set and used `selectableRowSelected` to mark rows
- **Issue**: `onSelectedRowsChange` is called during page transitions with empty `state.selectedRows`, clearing our selections

### 3. Page change flag guard (FAILED)
- **What**: Added `isChangingPageRef` to skip `onSelectedRowsChange` during page transitions
- **Result**: Still not working - selections still lost

## Root Cause

**react-data-table-component does NOT support multi-page selection with server-side pagination out of the box.**

The library's architecture expects:
- Client-side pagination: All data available, library manages selection state internally
- Server-side pagination: Only current page data available, but no built-in mechanism to preserve selections across pages

## Evidence

From GitHub issues:
- Issue #524: "Multi-page Row Selection with serverPagination" - Community workarounds, no official solution
- Issue #645: "[FEATURE]: Select all with server-side pagination" - Feature request, not implemented
- Issue #930: "onSelectedRowsChange called by selectableRowSelected, infinite loop" - Related conflicts

## Current State

**Files Modified:**
- `/home/na/didapi/temp_clone/frontend/src/components/DIDDataTable.js`
  - Removed `persistSelectedOnPageChange` (doesn't work)
  - Implemented custom selection tracking with `selectedDIDIds` Set
  - Added page change guard
  - Using `selectableRowSelected` to mark rows

**What Works:**
✅ Selection on single page
✅ Bulk operations (delete, mark active/inactive)
✅ Standard "Select All" checkbox
✅ No flickering

**What Doesn't Work:**
❌ Selections don't persist when navigating to another page
❌ Cannot select DIDs across multiple pages

## Recommendations

### Option 1: Alternative DataTable Libraries

Consider migrating to a library with better server-side pagination support:

#### **TanStack Table** (react-table v8)
- ✅ Explicit support for server-side pagination
- ✅ Manual row selection state management
- ✅ Headless UI - full control
- ✅ Excellent TypeScript support
- ❌ Requires more manual setup
- **npm**: `@tanstack/react-table`

#### **AG Grid Community**
- ✅ Enterprise-grade features
- ✅ Built-in server-side row model
- ✅ Multi-page selection works out of the box
- ❌ Larger bundle size
- ❌ Some features require paid license
- **npm**: `ag-grid-react`

#### **Material React Table**
- ✅ Built on TanStack Table + Material UI
- ✅ Server-side pagination support
- ✅ Pre-built components
- ✅ Good documentation
- **npm**: `material-react-table`

### Option 2: Client-Side Pagination

Load all DIDs at once and use client-side pagination:
- ✅ Multi-page selection will work with `persistSelectedOnPageChange`
- ❌ Performance impact with 499 DIDs (likely acceptable)
- ❌ Not scalable if DID count grows significantly

### Option 3: Keep Current Implementation

Accept current limitations:
- ✅ Single-page selection works
- ✅ "Select All" on current page works
- ✅ Bulk operations work for selected items
- ❌ Cannot select DIDs across multiple pages
- **Use Case**: Users typically work with DIDs on one page at a time

### Option 4: Custom "Select All Pages" API

Add back a custom button that:
1. Fetches all DID IDs from server (not full data)
2. Stores them in `selectedDIDIds`
3. Bulk operations use this Set
- ✅ Can select all DIDs regardless of pagination
- ❌ Doesn't show checkboxes across pages (visual disconnect)
- ❌ Custom UI pattern

## Recommended Action

**Immediate**: Accept Option 3 (current state) as a temporary solution
**Long-term**: Migrate to **TanStack Table** or **Material React Table** for proper server-side multi-page selection support

## Technical Details

### Why `persistSelectedOnPageChange` Doesn't Work

From react-data-table-component source code:
```typescript
const mergeSelections = !!(paginationServer &&
  (persistSelectedOnPageChange || persistSelectedOnSort));
```

This sets a flag, but with server-side pagination:
1. User selects rows on Page 1
2. Navigate to Page 2
3. DataTable receives new data (only Page 2 rows)
4. Previous page rows are gone from DataTable's internal state
5. Selection state is lost

### Test Files Created

- `/home/na/didapi/test-multipage-comprehensive.cjs` - Full Playwright test
- `/home/na/didapi/test-flickering-fix.cjs` - Flickering test
- `/home/na/didapi/test-standard-selection.cjs` - Selection test
- `/home/na/didapi/MULTIPAGE_SELECTION_TEST.md` - Manual test guide

### Screenshots

Check these screenshots to see the issue:
- `multipage-step2-page1-selected.png` - 5 DIDs selected ✅
- `multipage-step3-page2-initial.png` - No selections ❌
- `multipage-step5-back-to-page1.png` - Selections lost ❌

## Conclusion

Multi-page selection with server-side pagination requires a DataTable library specifically designed for this use case. react-data-table-component v7.7.0 does not adequately support this pattern.

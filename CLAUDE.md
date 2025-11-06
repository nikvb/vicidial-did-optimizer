# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VICIdial DID Optimizer - A Node.js/Express application providing intelligent phone number (DID) rotation for VICIdial call centers with Google OAuth authentication and real-time analytics.

## Architecture

### Single Application Structure
- **Main Server**: `server-full.js` - Express.js application with ES modules
- **Database**: MongoDB with Mongoose ODM (inline model definitions)
- **Frontend**: React SPA source in `temp_clone/frontend/` (Create React App)
- **Frontend Build**: Pre-built static files in `frontend/` directory
- **VICIdial Integration**: Perl scripts and Asterisk dialplan configuration

### Key Models (Mongoose)
- **User**: Authentication, Google OAuth, tenant association
- **DID**: Phone numbers with rotation tracking and reputation scores
- **CallRecord**: Call history and outcomes
- **AuditLog**: System activity tracking

## Common Commands

### Running the Application
```bash
# Start the server (no npm scripts defined in root)
node server-full.js

# With specific port (Cloudflare forwards https://endpoint.amdy.io to this)
PORT=5000 node server-full.js

# For development with frontend bypass
DANGEROUSLY_DISABLE_HOST_CHECK=true npm start
```

### Frontend Development
```bash
# Navigate to frontend source
cd temp_clone/frontend

# Install dependencies
npm install

# Start development server (port 3000)
npm start

# Build for production
npm run build

# Run frontend tests
npm test
```

### Testing
```bash
# E2E tests with Playwright
node test-dashboard-api-v2.cjs  # Latest dashboard test
node test-final-cloudflare.cjs  # Full integration test
node test-login.cjs             # Authentication test

# With display for debugging
DISPLAY=:0 node test-login-debug.cjs
```

### VICIdial Integration
```bash
# Install integration
sudo ./install-vicidial-integration.sh

# Test Perl configuration
perl vicidial-did-optimizer-config.pl --test

# Test with parameters
perl vicidial-did-optimizer-config.pl "CAMPAIGN001" "1001" "4155551234" "CA" "94102"
```

## Key API Endpoints

### Core VICIdial Integration
- `GET /api/v1/dids/next` - Main endpoint for DID selection (requires `x-api-key` header)
  - Parameters: `campaign_id`, `agent_id`, `customer_phone`, `customer_state`, `customer_zip`
  - Returns: Selected DID with rotation tracking

### Authentication
- `GET /api/v1/auth/google` - Initiate Google OAuth
- `GET /api/v1/auth/google/callback` - OAuth callback
- `POST /api/v1/auth/login` - Basic authentication
- `GET /api/v1/auth/logout` - Session logout
- `GET /api/v1/auth/check` - Verify authentication status

### Health & Status
- `GET /api/v1/health` - Service health check (API key required)

## Environment Variables

Required in `.env`:
```bash
# MongoDB (local database)
MONGODB_URI=mongodb://127.0.0.1:27017/did_optimizer

# Authentication
JWT_SECRET=your_jwt_secret
JWT_REFRESH_SECRET=your_refresh_secret
API_KEY=your_api_key  # For VICIdial endpoint

# Google OAuth
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret

# Application
PORT=5000
FRONTEND_URL=https://dids.amdy.io
SESSION_SECRET=your_session_secret
```

Frontend `.env` (temp_clone/frontend/.env):
```bash
# API endpoint (both dev and production)
REACT_APP_API_URL=https://endpoint.amdy.io

# Google OAuth
REACT_APP_GOOGLE_CLIENT_ID=your_client_id
```

## Implementation Details

### DID Rotation Algorithm (server-full.js:200-350)
- Round-robin selection with daily usage limits
- Tracks usage per DID with automatic daily reset
- Fallback DID when pool exhausted
- State/area code matching for geographic optimization

### Authentication Flow
- Google OAuth 2.0 with Passport.js
- MongoDB session storage (7-day expiry)
- JWT tokens for API authentication
- Session-based web authentication

### CORS Configuration
Production domains:
- `https://dids.amdy.io` (frontend)
- `https://endpoint.amdy.io` (API - used for both development and production)
- Frontend development server (when running locally)

### Key Dependencies

**Backend:**
- Express 5.1.0 (note: v5, not v4)
- Mongoose 8.18.2 for MongoDB
- Passport with Google OAuth strategy
- Playwright for E2E testing
- Multiple unused dependencies (TensorFlow, Kafka, etc.) - likely for future features

**Frontend (temp_clone/frontend):**
- React 18.2.0 with Create React App
- React Router v6 for routing
- Tailwind CSS 3.3.6 for styling
- React Query 3.39.3 for API state management
- React Hook Form 7.48.2 for forms
- Recharts 2.8.0 for data visualization
- Axios 1.6.2 for HTTP requests
- Headless UI & Heroicons for UI components

## VICIdial Integration Files

- `/etc/asterisk/dids.conf` - API configuration
- `/usr/share/astguiclient/vicidial-did-optimizer-config.pl` - Perl integration script
- Installation scripts: `install-vicidial-integration*.sh`

## Testing Approach

All tests use Playwright with headless Chromium:
- Login flow verification
- Dashboard API interactions
- Cloudflare bypass handling
- Screenshot capture on failure

## Frontend Structure

### Pages (temp_clone/frontend/src/pages/)
- `LandingPage.js` - Public landing page
- `LoginPage.js` - Authentication with Google OAuth
- `Dashboard.js` - Main dashboard overview
- `DIDManagement.js` & `DIDManagementAdvanced.js` - DID management interfaces
- `Analytics.js` - Analytics and reporting
- `UserManagement.js` - User administration
- `Settings.js` - Application settings
- `Billing.js` - Billing and subscriptions

### Components (temp_clone/frontend/src/components/)
- `auth/` - Authentication components
- `common/` - Reusable UI components
- `layouts/` - Page layouts
- `navigation/` - Navigation components
- `settings/` - Settings-related components

### Services (temp_clone/frontend/src/services/)
API service layer for backend communication

## UI Design System

### Design Philosophy
- **Dark Theme First**: Optimized for 24/7 call center operations
- **Data-First Design**: Information hierarchy optimized for telecom operations
- **Real-Time Focus**: Live data visualization with status indicators
- **Progressive Disclosure**: Complex features revealed gradually

### Color Palette (from UI-DESIGN-GUIDE.md)
```css
/* Dark Theme Base */
--bg-primary: #0f172a;        /* Main background */
--bg-secondary: #1e293b;      /* Card backgrounds */
--bg-tertiary: #334155;       /* Hover states */

/* Status Colors */
--success-green: #10b981;     /* Active DIDs */
--warning-amber: #f59e0b;     /* Warnings */
--error-red: #ef4444;         /* Errors/Inactive */
--info-cyan: #06b6d4;         /* Information */

/* Text Colors */
--text-primary: #f8fafc;      /* Primary text */
--text-secondary: #cbd5e1;    /* Secondary text */
--text-muted: #64748b;        /* Muted text */
```

### Component Patterns

#### Status Badges
```jsx
// Use for DID status, call states, system health
<StatusBadge status="active" pulse={true} />
// Colors: active (green), inactive (red), warning (yellow), processing (blue)
```

#### Metric Cards
```jsx
// Dashboard statistics display
<MetricCard
  title="Active DIDs"
  value="2,847"
  change="+12%"
  trend="up"
/>
```

#### Data Tables
```jsx
// Smart tables with sorting, filtering, pagination
<SmartTable
  data={dids}
  columns={didColumns}
  pagination={true}
  sortable={true}
  selectable={true}
/>
```

### Layout Patterns

#### Dashboard Grid
- Mobile: 1 column
- Tablet (768px+): 2 columns
- Desktop (1024px+): 3 columns
- Large (1280px+): 4 columns

#### DID Management Layout
```jsx
// Header with actions
<div className="flex justify-between items-center">
  <h1>DID Management</h1>
  <div className="flex gap-3">
    <Button variant="outline">Bulk Upload</Button>
    <Button>Add DID</Button>
  </div>
</div>
```

### VICIdial-Specific Components

#### Call Status Grid
Visual representation of call states using colored squares:
- Green: Active calls
- Yellow (pulsing): Ringing
- Blue: On hold
- Gray: Idle

#### DID Pool Cards
Display pool statistics with:
- Total DIDs count
- Active/Inactive breakdown
- Utilization percentage bar
- Real-time status indicators

### Accessibility Requirements
- WCAG 2.1 AA compliance
- Focus ring on all interactive elements
- High contrast mode support
- Screen reader friendly components
- Keyboard navigation support

### Performance Guidelines
- Use React.lazy() for route-based code splitting
- Implement virtual scrolling for large lists
- Cache API responses with React Query
- Optimize bundle size (<500KB initial load)
- Target 90+ Lighthouse score

### Implementation Notes
Reference the detailed specifications in:
- `temp_clone/UI-DESIGN-GUIDE.md` - Complete design system
- `temp_clone/DID_MANAGEMENT_SPEC.md` - DID management page specs

## Important Notes

1. **Express 5.x**: Using Express v5 (not v4), some middleware may be incompatible
2. **Two frontend directories**: Source in `temp_clone/frontend/`, built files in `frontend/`
3. **API URL**: Always uses `https://endpoint.amdy.io` for both dev and production
4. **Simple architecture**: Despite complex dependencies, actual implementation is straightforward
5. **API Key security**: VICIdial endpoint requires `x-api-key` header
6. **Session-based auth**: Web uses sessions, API uses JWT tokens
- never USE any mock data if there is no data in DB display 0
- use http://api3.amdy.io:3000 and http://api3.amdy.io:5000 do not use localhost
- NEVER USE port 3000 RUN everythign on PORT 5000 and use https://dids.amdy.io as it maps to this host and port 5000 through cloudflare.
- never use https://endpoint.amdy.io always use https://dids.amdy.io
- username for testing client@test3.com password: password123
- check every change in UI with playwright server
# GEMINI.md

This file provides guidance to Gemini when working with code in this repository.

## Project Overview

VICIdial DID Optimizer is a Node.js/Express application that provides intelligent phone number (DID) rotation for VICIdial call centers. It features Google OAuth authentication and real-time analytics. The application is designed with a multi-tenant architecture to ensure secure isolation for multiple organizations.

The project is a monorepo that includes the main server, frontend, and VICIdial integration scripts.

**Key Technologies:**

*   **Backend:** Node.js, Express, MongoDB, Mongoose, Passport.js, Playwright
*   **Frontend:** React, Create React App, Tailwind CSS, React Query, React Hook Form, Recharts, Axios
*   **VICIdial Integration:** Perl, Asterisk

## Building and Running

### Backend

To start the backend server, run the following command:

```bash
# Start the server
node server-full.js

# With a specific port
PORT=5000 node server-full.js
```

The backend can also be run and managed using PM2. The configuration for PM2 is in the `ecosystem.config.cjs` file.

```bash
# Start the server with PM2
pm2 start ecosystem.config.cjs

# View logs
pm2 logs did-optimizer

# Monitor
pm2 monit
```

### Frontend

The frontend source code is located in the `temp_clone/frontend/` directory. To run the frontend in development mode, run the following commands:

```bash
# Navigate to the frontend source directory
cd temp_clone/frontend

# Install dependencies
npm install

# Start the development server
npm start
```

To build the frontend for production, run the following command:

```bash
# Build the frontend
npm run build
```

The production build will be located in the `frontend/` directory at the root of the project.

### Testing

The project uses Playwright for end-to-end testing. To run the tests, use the following commands:

```bash
# Run the latest dashboard test
node test-dashboard-api-v2.cjs

# Run the full integration test
node test-final-cloudflare.cjs

# Run the authentication test
node test-login.cjs
```

To run the tests with a display for debugging, use the following command:

```bash
DISPLAY=:0 node test-login-debug.cjs
```

## Development Conventions

*   **Coding Style:** The backend uses ES modules.
*   **Testing:** The project uses Playwright for end-to-end testing. All tests are located in the root of the project and are named with the `test-` prefix.
*   **API URL:** The API URL is always `https://endpoint.amdy.io` for both development and production.
*   **Authentication:** The web interface uses session-based authentication, while the VICIdial integration uses API key authentication.

## Key API Endpoints

*   `GET /api/v1/dids/next`: The main endpoint for DID selection. Requires an `x-api-key` header.
*   `GET /api/v1/health`: A health check endpoint. Requires an API key.
*   `GET /api/v1/auth/google`: Initiates the Google OAuth flow.
*   `GET /api/v1/auth/google/callback`: The callback URL for the OAuth flow.
*   `POST /api/v1/auth/login`: For basic authentication.
*   `GET /api/v1/auth/logout`: Logs out the current session.
*   `GET /api/v1/auth/check`: Verifies the current authentication status.

## Environment Variables

The backend requires the following environment variables to be set in a `.env` file:

*   `MONGODB_URI`: The connection string for the MongoDB database.
*   `JWT_SECRET`: A secret key for signing JWT tokens.
*   `JWT_REFRESH_SECRET`: A secret key for signing JWT refresh tokens.
*   `API_KEY`: An API key for the VICIdial integration.
*   `GOOGLE_CLIENT_ID`: The client ID for Google OAuth.
*   `GOOGLE_CLIENT_SECRET`: The client secret for Google OAuth.
*   `PORT`: The port to run the server on.
*   `FRONTEND_URL`: The URL of the frontend.
*   `SESSION_SECRET`: A secret key for signing session cookies.

The frontend requires the following environment variables to be set in a `.env` file in the `temp_clone/frontend/` directory:

*   `REACT_APP_API_URL`: The URL of the API.
*   `REACT_APP_GOOGLE_CLIENT_ID`: The client ID for Google OAuth.

## VICIdial Integration

The VICIdial integration is handled by a set of Perl scripts and Asterisk dialplan configurations.

*   `/etc/asterisk/dids.conf`: The main configuration file for the API.
*   `/usr/share/astguiclient/vicidial-did-optimizer-config.pl`: The Perl script for the integration.
*   `install-vicidial-integration*.sh`: Installation scripts to automate the setup.

The integration works by using an AGI script (`vicidial-did-optimizer-production.agi`) to select an optimal DID for each outbound call. The call results are then synced back to the DID Optimizer API using a Perl script (`process-call-results.pl`) that is run as a cron job.

## Frontend

The frontend is a React single-page application (SPA) that is located in the `temp_clone/frontend/` directory. The production build is located in the `frontend/` directory at the root of the project.

The frontend uses the following technologies:

*   React
*   Create React App
*   Tailwind CSS
*   React Query
*   React Hook Form
*   Recharts
*   Axios

## UI Design System

The UI design system is based on a dark theme and is optimized for 24/7 call center operations. It uses a data-first design approach and focuses on real-time data visualization.

**Color Palette:**

*   **Background:** `#0f172a` (primary), `#1e293b` (secondary), `#334155` (tertiary)
*   **Status:** `#10b981` (success), `#f59e0b` (warning), `#ef4444` (error), `#06b6d4` (info)
*   **Text:** `#f8fafc` (primary), `#cbd5e1` (secondary), `#64748b` (muted)

## Markdown File Summaries

*   **AGI-DATA-CAPTURE-SUMMARY.md:** This document provides a detailed summary of the data captured by the enhanced AGI script (`vicidial-did-optimizer-enhanced.agi`). It lists all the AGI variables, VICIdial campaign data, agent information, customer/lead data, and call routing information that is captured and sent to the DID Optimizer API.

*   **AGI-SCRIPT-CONFIGURATION.md:** This document provides a detailed configuration guide for the AGI script. It explains the AGI script architecture, the core AGI variables, the configuration file parameters, and the AGI script installation process. It also provides instructions for testing the AGI script and integrating it with VICIdial campaigns.

*   **API-DOCUMENTATION.md:** This document provides a comprehensive documentation for the DID Optimizer API. It lists all the API endpoints, their parameters, and their responses. It also provides information about authentication, rate limiting, and error codes.

*   **CLAUDE.md:** This file provides guidance to Claude Code when working with code in this repository. It includes a project overview, architecture, common commands, key API endpoints, environment variables, implementation details, key dependencies, VICIdial integration files, testing approach, frontend structure, and UI design system.

*   **CONFIGURATION_GUIDE.md:** This document provides a configuration guide for the VICIdial DID Optimizer. It explains the two-file configuration system, the configuration priority, and the setup instructions. It also provides configuration examples and troubleshooting tips.

*   **CONVERSATION_SUMMARY_SCREENSHOT_IMPLEMENTATION.md:** This document provides a summary of a conversation about implementing a screenshot functionality for the RoboKiller reputation scraping system. It explains the problem, the solution, and the technical details of the implementation.

*   **DIALPLAN_MODIFICATION_STEPS.md:** This document provides a step-by-step guide for modifying the VICIdial dialplan to integrate with the DID Optimizer. It includes both a quick automated method and a detailed manual method.

*   **LOGGING.md:** This document provides a guide to the server logging. It explains the different ways to view the logs, the log types, and the log rotation.

*   **MULTIPAGE_SELECTION_FINDINGS.md:** This document provides the findings of an investigation into a multi-page selection issue with `react-data-table-component`. It explains the problem, the test results, the approaches tried, the root cause, and the recommendations.

*   **MULTIPAGE_SELECTION_TEST.md:** This document provides test instructions for the multi-page selection functionality. It explains what was implemented and how to test it.

*   **PERL_IMPLEMENTATION.md:** This document provides a guide to the Perl implementation of the VICIdial sync script. It explains why Perl was chosen, how to get started, how the script is configured, and how it works.

*   **PRODUCTION-AGI-README.md:** This document provides a readme for the production-ready AGI script. It explains the key corrections from earlier versions, the privacy mode feature, the installation process, and the testing procedures.

*   **QUICK_SETUP_GUIDE.md:** This document provides a quick setup guide for the VICIdial DID Optimizer. It includes a summary of the integration, a quick installation guide, and a manual installation guide.

*   **README-updated.md:** This is an updated version of the `README.md` file. It includes more information about the AGI-based integration.

*   **README.md:** This is the main `README.md` file for the project. It provides an overview of the project, its key features, and the installation instructions.

*   **SCRIPT_OVERVIEW.md:** This document provides an overview of the different scripts in the repository and which ones to use. It explains the AGI scripts, the call results sync scripts, and the configuration files.

*   **SERVICE_MANAGEMENT.md:** This document provides a guide to managing the DID Optimizer API as a systemd service. It explains the service management commands, the monitoring and logs, and the auto-restart configuration.

*   **TESTING-AGI-SCRIPT.md:** This document provides instructions for testing the VICIdial DID Optimizer AGI script. It explains how to call the script from VICIdial, how to test it manually, and how to view the logs.

*   **VICIDIAL-DIALPLAN-SETUP.md:** This document provides a guide for manually setting up the VICIdial dialplan to integrate with the DID Optimizer API. It explains the prerequisites, the configuration steps, and the testing procedures.

*   **VICIDIAL-TESTING-PROCEDURES.md:** This document provides comprehensive testing procedures to verify the correct installation and operation of the DID Optimizer integration with VICIdial. It includes component testing, integration testing, load testing, and failure testing.

*   **VICIDIAL_CALL_RESULT_INTEGRATION.md:** This document explains how to integrate call disposition/result reporting from VICIdial to the DID Optimizer API. It explains the VICIdial call flow architecture, the integration points, and the API endpoint implementation.

*   **VICIDIAL_DIALPLAN_INTEGRATION.md:** This guide shows how to integrate the DID Optimizer script into VICIdial's dialplan to automatically select optimal DIDs for outbound calls.

*   **VICIDIAL_SYNC_README.md:** This document provides a setup guide for the VICIdial call results sync. It explains the components, the setup instructions, and how it works.

*   **vicidial-integration/README.md:** This file provides an overview of the files in the `vicidial-integration` directory.
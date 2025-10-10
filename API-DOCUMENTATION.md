# DID Optimizer API Documentation

## Overview

The DID Optimizer API provides intelligent phone number (DID) rotation for VICIdial call centers with real-time analytics and reputation management.

**Base URL**: `https://endpoint.amdy.io`

**Version**: v1

---

## Authentication

### API Key Authentication
For VICIdial integration and programmatic access:

```http
X-API-Key: your_api_key_here
```

### Session Authentication
For web dashboard access via Google OAuth.

---

## Core Endpoints

### Get Next DID

Selects the optimal DID for an outbound call using round-robin rotation with reputation filtering.

**Endpoint**: `GET /api/v1/dids/next`

**Authentication**: API Key (required)

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `campaign_id` | string | Yes | VICIdial campaign identifier |
| `agent_id` | string | Yes | VICIdial agent identifier |
| `customer_phone` | string | No | Customer phone number |
| `customer_state` | string | No | Customer state code (for geographic matching) |
| `customer_zip` | string | No | Customer ZIP code |

**Request Example**:
```http
GET /api/v1/dids/next?campaign_id=CAMPAIGN001&agent_id=1001&customer_phone=4155551234&customer_state=CA&customer_zip=94102
X-API-Key: your_api_key_here
```

**Response** (200 OK):
```json
{
  "success": true,
  "did": {
    "phone_number": "4155559999",
    "area_code": "415",
    "state": "CA",
    "reputation_score": 95,
    "daily_usage": 145,
    "total_calls": 2847
  },
  "metadata": {
    "selection_method": "round_robin",
    "pool_size": 50,
    "fallback_used": false
  }
}
```

**Error Response** (500):
```json
{
  "success": false,
  "error": "No available DIDs in pool"
}
```

---

## Health & Status

### Health Check

Check API service health and database connectivity.

**Endpoint**: `GET /api/v1/health`

**Authentication**: API Key (required)

**Request Example**:
```http
GET /api/v1/health
X-API-Key: your_api_key_here
```

**Response** (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2025-10-03T12:34:56.789Z",
  "database": "connected",
  "uptime": 86400
}
```

---

## Authentication Endpoints

### Google OAuth Login

Initiate Google OAuth authentication flow.

**Endpoint**: `GET /api/v1/auth/google`

**Authentication**: None

**Response**: Redirects to Google OAuth consent screen

---

### Google OAuth Callback

OAuth callback handler (automatically called by Google).

**Endpoint**: `GET /api/v1/auth/google/callback`

**Authentication**: None

**Query Parameters**: Automatically provided by Google OAuth

**Response**: Redirects to dashboard on success, login page on failure

---

### Check Authentication Status

Verify current session authentication.

**Endpoint**: `GET /api/v1/auth/check`

**Authentication**: Session (cookie)

**Response** (200 OK):
```json
{
  "authenticated": true,
  "user": {
    "id": "507f1f77bcf86cd799439011",
    "email": "user@example.com",
    "name": "John Doe",
    "tenant_id": "507f191e810c19729de860ea"
  }
}
```

**Response** (401 Unauthorized):
```json
{
  "authenticated": false
}
```

---

### Logout

End current session.

**Endpoint**: `GET /api/v1/auth/logout`

**Authentication**: Session (cookie)

**Response**: Redirects to login page

---

## DID Management

### List DIDs

Retrieve all DIDs with filtering and pagination.

**Endpoint**: `GET /api/v1/dids`

**Authentication**: Session (cookie)

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Items per page (default: 50) |
| `status` | string | No | Filter by status: `active`, `inactive` |
| `state` | string | No | Filter by state code |
| `area_code` | string | No | Filter by area code |

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "phone_number": "4155559999",
      "area_code": "415",
      "state": "CA",
      "status": "active",
      "reputation_score": 95,
      "daily_usage": 145,
      "daily_limit": 200,
      "total_calls": 2847,
      "last_used": "2025-10-03T11:23:45.678Z",
      "created_at": "2025-01-15T09:00:00.000Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 5,
    "total_items": 250,
    "items_per_page": 50
  }
}
```

---

### Get DID by ID

Retrieve detailed information for a specific DID.

**Endpoint**: `GET /api/v1/dids/:id`

**Authentication**: Session (cookie)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "phone_number": "4155559999",
    "area_code": "415",
    "state": "CA",
    "status": "active",
    "reputation_score": 95,
    "daily_usage": 145,
    "daily_limit": 200,
    "total_calls": 2847,
    "successful_calls": 2134,
    "failed_calls": 713,
    "last_used": "2025-10-03T11:23:45.678Z",
    "created_at": "2025-01-15T09:00:00.000Z",
    "updated_at": "2025-10-03T11:23:45.678Z"
  }
}
```

---

### Create DID

Add a new DID to the pool.

**Endpoint**: `POST /api/v1/dids`

**Authentication**: Session (cookie)

**Request Body**:
```json
{
  "phone_number": "4155558888",
  "area_code": "415",
  "state": "CA",
  "daily_limit": 200,
  "status": "active"
}
```

**Response** (201 Created):
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "phone_number": "4155558888",
    "area_code": "415",
    "state": "CA",
    "status": "active",
    "reputation_score": 100,
    "daily_usage": 0,
    "daily_limit": 200,
    "total_calls": 0,
    "created_at": "2025-10-03T12:00:00.000Z"
  }
}
```

---

### Update DID

Modify an existing DID's properties.

**Endpoint**: `PUT /api/v1/dids/:id`

**Authentication**: Session (cookie)

**Request Body**:
```json
{
  "status": "inactive",
  "daily_limit": 150,
  "reputation_score": 85
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "phone_number": "4155559999",
    "status": "inactive",
    "daily_limit": 150,
    "reputation_score": 85,
    "updated_at": "2025-10-03T12:30:00.000Z"
  }
}
```

---

### Delete DID

Remove a DID from the pool.

**Endpoint**: `DELETE /api/v1/dids/:id`

**Authentication**: Session (cookie)

**Response** (200 OK):
```json
{
  "success": true,
  "message": "DID deleted successfully"
}
```

---

## Analytics

### Dashboard Statistics

Get overview statistics for the dashboard.

**Endpoint**: `GET /api/v1/analytics/dashboard`

**Authentication**: Session (cookie)

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "total_dids": 250,
    "active_dids": 223,
    "inactive_dids": 27,
    "total_calls_today": 12847,
    "successful_calls_today": 9634,
    "average_reputation": 92.5,
    "pool_utilization": 78.3
  }
}
```

---

### Call Records

Retrieve call history with filtering.

**Endpoint**: `GET /api/v1/analytics/calls`

**Authentication**: Session (cookie)

**Query Parameters**:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `start_date` | string | No | ISO date string (default: 30 days ago) |
| `end_date` | string | No | ISO date string (default: now) |
| `campaign_id` | string | No | Filter by campaign |
| `did` | string | No | Filter by DID phone number |
| `page` | number | No | Page number |
| `limit` | number | No | Items per page |

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439013",
      "did": "4155559999",
      "campaign_id": "CAMPAIGN001",
      "agent_id": "1001",
      "customer_phone": "4155551234",
      "call_duration": 245,
      "outcome": "connected",
      "timestamp": "2025-10-03T11:23:45.678Z"
    }
  ],
  "pagination": {
    "current_page": 1,
    "total_pages": 100,
    "total_items": 5000
  }
}
```

---

## User Management

### List Users

Get all users in the tenant.

**Endpoint**: `GET /api/v1/users`

**Authentication**: Session (cookie), Admin role required

**Response** (200 OK):
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439014",
      "email": "admin@example.com",
      "name": "Admin User",
      "role": "admin",
      "tenant_id": "507f191e810c19729de860ea",
      "created_at": "2025-01-01T00:00:00.000Z",
      "last_login": "2025-10-03T09:15:30.123Z"
    }
  ]
}
```

---

## Error Codes

| Status Code | Description |
|-------------|-------------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request - Invalid parameters |
| `401` | Unauthorized - Missing or invalid authentication |
| `403` | Forbidden - Insufficient permissions |
| `404` | Not Found - Resource doesn't exist |
| `500` | Internal Server Error |

---

## Rate Limiting

API endpoints are rate-limited to prevent abuse:

- **VICIdial endpoints** (`/api/v1/dids/next`): 1000 requests/minute
- **Dashboard endpoints**: 100 requests/minute per session
- **Authentication endpoints**: 20 requests/minute per IP

---

## VICIdial Integration

### Perl Script Configuration

Install the integration using:

```bash
sudo ./install-vicidial-integration.sh
```

### Asterisk Dialplan Configuration

Add to `/etc/asterisk/dids.conf`:

```ini
[did-optimizer]
api_url=https://endpoint.amdy.io/api/v1/dids/next
api_key=your_api_key_here
timeout=5000
fallback_did=8005551234
```

### Example Perl Usage

```perl
#!/usr/bin/perl
use strict;
use warnings;
use lib '/usr/share/astguiclient';
require 'vicidial-did-optimizer-config.pl';

my $campaign_id = "CAMPAIGN001";
my $agent_id = "1001";
my $customer_phone = "4155551234";
my $customer_state = "CA";
my $customer_zip = "94102";

my $selected_did = get_optimal_did(
    $campaign_id,
    $agent_id,
    $customer_phone,
    $customer_state,
    $customer_zip
);

print "Selected DID: $selected_did\n";
```

---

## Webhooks (Future)

Webhook support for real-time event notifications is planned for a future release.

---

## Support

For API support and questions:
- GitHub Issues: [Repository Issues](https://github.com/yourusername/did-optimizer/issues)
- Email: support@yourdomain.com

---

## Changelog

### Version 1.0.0 (Current)
- Initial API release
- Google OAuth authentication
- Round-robin DID selection
- Basic analytics endpoints
- VICIdial integration support

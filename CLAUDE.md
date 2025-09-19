# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Multi-Tenant DID (Direct Inward Dialing) Optimization Service for VICIdial, designed to manage phone number pools with intelligent rotation algorithms, real-time analytics, and machine learning-based optimization.

## Architecture

### Microservices Structure
- **Authentication Service** (Node.js/Express): Google OAuth, JWT, tenant/user management
- **DID Management Service** (Go/Gin): DID CRUD, rotation algorithms, VICIdial API integration
- **Analytics Service** (Python/FastAPI): Metrics processing, reporting, data aggregation
- **ML Service** (Python/TensorFlow/PyTorch): Model training, inference, feature engineering
- **Notification Service** (Node.js): Webhooks, email, WebSocket updates

### Data Stores
- **PostgreSQL**: Main transactional data (tenants, users, DIDs, campaigns)
- **Redis**: Caching, session storage, rate limiting
- **ClickHouse**: Time-series analytics data
- **MongoDB**: ML models, feature stores, audit logs
- **MinIO**: Object storage for exports and backups

### Infrastructure
- Service Mesh: Istio for inter-service communication
- Message Queue: Kafka for event streaming
- API Gateway: Kong/AWS API Gateway
- Load Balancer: Cloudflare/AWS ALB

## Key API Endpoints

### DID Management
- `GET /api/v1/dids/next`: Get next available DID (VICIdial integration)
- `POST /api/v1/dids`: Create new DID
- `PUT /api/v1/dids/:id`: Update DID
- `DELETE /api/v1/dids/:id`: Delete DID
- `POST /api/v1/dids/bulk`: Bulk DID operations

### Analytics
- `GET /api/v1/analytics/metrics`: Real-time metrics
- `GET /api/v1/analytics/reports`: Generate reports
- `POST /api/v1/analytics/export`: Export data

## Database Schema Highlights

Key tables in PostgreSQL:
- `tenants`: Multi-tenant organization data
- `users`: User accounts with Google OAuth integration
- `dids`: Phone numbers with rotation metadata
- `did_pools`: Logical groupings of DIDs
- `campaigns`: VICIdial campaign configurations
- `rotation_rules`: Customizable rotation algorithms
- `usage_logs`: DID usage tracking for analytics

## Frontend Structure

React SPA with:
- Components organized by feature (did/, analytics/, settings/)
- React Query for API state management
- Tailwind CSS for styling
- Recharts for data visualization
- React Hook Form for form handling

## ML Models

The system implements several ML models:
- **Conversion Predictor**: Random Forest for predicting DID conversion rates
- **Anomaly Detector**: Isolation Forest for detecting unusual patterns
- **Time Series Forecaster**: LSTM for volume predictions
- **Churn Predictor**: XGBoost for identifying at-risk DIDs

## Security Considerations

- JWT-based authentication with refresh tokens
- Google OAuth 2.0 integration
- Row-level security in PostgreSQL
- API rate limiting via Redis
- Encrypted data at rest and in transit
- Audit logging for compliance

## Environment Configuration

Services expect these environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `KAFKA_BROKERS`: Kafka broker addresses
- `JWT_SECRET`: JWT signing secret
- `GOOGLE_CLIENT_ID/SECRET`: OAuth credentials
- `VICIDIAL_API_URL`: VICIdial API endpoint
- `CLICKHOUSE_URL`: ClickHouse connection
- `MONGODB_URI`: MongoDB connection string

## VICIdial Integration

The service provides a REST API endpoint that VICIdial can call to get the next available DID:
```
GET /api/v1/dids/next?campaign_id={campaign_id}&agent_id={agent_id}
```

This endpoint implements intelligent rotation based on:
- Usage history
- Time-based cooling periods
- ML-predicted performance
- Custom rotation rules per campaign
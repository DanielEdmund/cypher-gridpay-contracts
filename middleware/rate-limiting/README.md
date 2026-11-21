# API Rate Limiting, Quotas & DDoS Protection Middleware

Protects public GridPay endpoints against denial-of-service bursts and abuse.

## Tiers & Quotas

- **Anonymous**: 60 req/min per IP.
- **Merchant Basic**: 600 req/min with API key.
- **Enterprise / Co-op**: 5,000 req/min dedicated rate limit with burst buffer.

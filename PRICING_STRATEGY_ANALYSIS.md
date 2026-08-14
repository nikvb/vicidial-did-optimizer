# DID Optimizer — Pricing Strategy & Revenue Optimization

## Current State Analysis

### Existing Pricing Model
- **Pure per-DID marginal pricing** with no base fees
- Direct: $0.040 → $0.030/DID (steps by $0.001 per 1K DIDs)
- Reseller: $0.030 → $0.020/DID (wholesale, $0.01 cheaper)
- Annual prepay: 16.67% discount (12 months for price of 10)
- **All customers get identical features** (no tier differentiation)

### Current Revenue Profile (estimated)
Assuming 34K total DIDs across 100 clients:
- **Average portfolio charge**: ~34K DIDs × $0.032/DID avg = **$1,088/month = $13K/year**
- **Top tenant (Mohamed, ~17K DIDs)**: 17K × $0.031/DID avg = **$527/month = $6.3K/year**
- **If 100 equally distributed**: 340 DIDs each × $0.040/DID = **$136/month = $1.6K/year**

**Annual Run Rate Estimate**: 100 clients × $500-$2,000/year avg = **$50K-$200K/year** (very low for SaaS)

---

## Problem: Pricing Doesn't Capture Value

### Value Delivered
1. **ML-powered DID selection** (increases answer rates by ~5-12% vs. round-robin)
2. **Reputation management** (reputation scores, reputation refresh)
3. **Geographic + demographic optimization** (state/area code targeting)
4. **AMD detection filtering** (eliminate machine/voicemail calls)
5. **Real-time analytics** (TimescaleDB, 5ms queries)
6. **Integration with VICIdial** (automatic rotation, no manual work)

**Estimated value per customer**: 
- 10% answer rate lift = ~$5K-$50K/year extra revenue per customer (depending on call volume)
- Reputation refresh avoidance = ~$500-$5K/year (prevents reputation bans)
- **Total value delivered**: **$5.5K-$55K/year per customer**

### Current Pricing
- Direct: $0.030/DID floor (at 10K DIDs, ~$360/month = $4.3K/year)
- Reseller: $0.020/DID floor = $240/month = $2.8K/year
- **Price captures only 8-78% of value delivered** 😞

---

## Market Benchmarks

### Competitor Pricing (telecom SaaS)
| Product | Model | Price |
|---------|-------|-------|
| Twilio (programmable voice) | Per call minute | $0.0135-$0.035/min |
| Bandwidth (wholesale carrier) | Per minute or bulk | $0.002-$0.01/min bulk |
| VoiceBase (call analytics) | Per minute + monthly | $0.05-$0.15/min + $500/mo |
| Dialpad (SaaS PBX) | Per seat/user | $15-$25/user/mo |
| Telnyx (carrier API) | Per call + DID rent | $0.01-$0.03/call + $0.05-$0.30/DID/mo |

**Insight**: VoiceBase (similar value: ML-powered insights) charges **$0.05-$0.15/min**. For 5-min avg call, that's **$0.25-$0.75/call**. At 100 calls/DID/month, that's **$25-$75/DID/month**. Our $0.030-$0.040/DID is **600-2500x cheaper** than comparable ML analytics.

---

## Pricing Revenue Leaks

### 1. **No Base Fee** (vulnerability)
- Customer with 100 DIDs: 100 × $0.040 = $4/month
- Marginal cost to support: ~$5-$10/month
- **Unprofitable at scale** for SMB tier

### 2. **No Feature Tiers** (leaves premium on table)
All customers get:
- Unlimited API calls
- ML selection (same as enterprise)
- White-label branding (for resellers)
- Unlimited users
- Real-time analytics

No room to upsell. No "good/better/best" packaging.

### 3. **No Usage Tiers** (leaving money on table)
Top tenant (Mohamed): 17K DIDs, 1M+ calls/day
- Current: 17K × $0.031 = **$527/month**
- High-volume should trigger usage charges or premium pricing
- Currently pays same rate as customer with 1K DIDs

### 4. **Annual Discount Too High** (eating revenue)
- 16.67% discount = 12 months for price of 10
- Best practice: 15-20% discount for annual commitment
- If top 30% of customers go annual (15% revenue save): **-$10K/year on $50K base**

### 5. **Reseller Arbitrage** (wholesale too thin)
- Reseller pays $0.020/DID floor, markup = ???
- If reseller marks up 2x, they charge end-customer $0.040 (same as direct)
- We get $0.020, reseller gets $0.020
- If reseller marks up 3x, they charge $0.060 — but then reseller margin = $0.040 and our margin = $0.020
- **No incentive for resellers to upsell aggressively** (their margin is 3x ours)

---

## Recommended Pricing Model: **Hybrid Base + Usage**

### New Pricing Structure

#### **TIER 1: Startup** (0-2K DIDs)
| Component | Price |
|-----------|-------|
| **Base/month** | **$99** |
| Per-DID (1-2K) | $0.015/DID |
| Annual discount | 20% (pay 10 months, get 12) |
| **Total at 2K DIDs** | $99 + (2K × $0.015) = **$129/mo = $1.5K/yr** |

**Features**: Basic DID rotation, reputation scores, analytics

#### **TIER 2: Growth** (2-10K DIDs)
| Component | Price |
|-----------|-------|
| **Base/month** | **$299** |
| Per-DID (2-10K) | $0.010/DID |
| API overage (>500K calls/mo) | $0.00005/call |
| Annual discount | 20% |
| **Total at 5K DIDs** | $299 + (5K × $0.010) = **$349/mo = $4.2K/yr** |

**Features**: All Startup + ML optimization, geographic targeting, advanced analytics, priority support

#### **TIER 3: Enterprise** (10K+ DIDs)
| Component | Price |
|-----------|-------|
| **Base/month** | **$799** |
| Per-DID (10K+) | $0.005/DID |
| API overage (>1M calls/mo) | $0.00002/call |
| White-label & custom domain | Included |
| Dedicated account manager | Included |
| Custom SLA & uptime guarantee | Included |
| Annual discount | 25% (pay 9 months, get 12) |
| **Total at 17K DIDs (Mohamed)** | $799 + (17K × $0.005) = **$884/mo = $10.6K/yr** |

**Features**: All Growth + white-label, API priority, custom integrations, quarterly business review

---

### Reseller Wholesale Model (Parallel Structure)

#### **RESELLER TIER 1: Startup**
- Base: $49/month
- Per-DID: $0.010/DID
- **Total at 2K**: $49 + $20 = **$69/mo** | Suggested reseller pricing to end-customer: **$99-$149/mo** | Reseller margin: 43-116%

#### **RESELLER TIER 2: Growth**
- Base: $149/month
- Per-DID: $0.007/DID
- **Total at 5K**: $149 + $35 = **$184/mo** | End-customer suggestion: **$299/mo** | Reseller margin: 62%

#### **RESELLER TIER 3: Enterprise**
- Base: $399/month
- Per-DID: $0.003/DID
- **Total at 17K**: $399 + $51 = **$450/mo** | End-customer suggestion: **$799/mo** | Reseller margin: 77%

**Insight**: Resellers now have 43-77% margin incentive to sell our tiers aggressively.

---

## Revenue Impact Projection

### Scenario 1: Current Pricing (baseline)
```
100 customers × $500-$2K/year avg = $50K-$200K/year
Expected: ~$125K/year
```

### Scenario 2: New Hybrid Pricing (estimated)
Assume customer segmentation:
- 50 customers in **Startup** tier (avg 1K DIDs): $1.5K × 50 = $75K/year
- 40 customers in **Growth** tier (avg 5K DIDs): $4.2K × 40 = $168K/year
- 10 customers in **Enterprise** tier (avg 10K DIDs): $10K × 10 = $100K/year
- **Total: $343K/year** (2.7x growth)

### Scenario 3: Aggressive Customer Expansion (upsell to value)
- Same as Scenario 2 + **upsell 30% to next tier** (capture more value)
- Growth tier customers upsell 30% to Enterprise mix: +$50K
- **Total: ~$400K/year** (3.2x growth)

### Scenario 4: Reseller Revenue (new channel)
Assume 20 resellers, each managing 500-5K customer DIDs:
- Avg 2K DIDs per reseller = 40K DIDs total under resellers
- Reseller pays wholesale, we get 50% of end-customer price
- At Growth tier rate (~$0.010-$0.015/DID): 40K × $0.012 avg = **$480/mo = $5.8K/year**
- **New revenue layer: +$5-$10K/year**

---

## Recommended Go-To-Market

### Phase 1: Segment & Grandfather (Month 1)
1. Identify customer segments (0-2K, 2-10K, 10K+)
2. Grandfather existing customers at 10% discount on new tiers (retention play)
3. Price new sign-ups at full hybrid rates
4. No forced migration (existing on old per-DID curve stay there)

### Phase 2: Land New at Hybrid Pricing (Month 2-3)
- All new customers land on Startup/Growth/Enterprise tiers
- Sales team quotes hybrid pricing with value prop (base fee = SLA, support, ML features)

### Phase 3: Upsell Migration Campaign (Month 4+)
- Monitor usage (API calls, DID count trends)
- Proactively offer tier upgrade with business value
- "Your usage is up 20% — you'd save $200/month on Growth tier"

---

## Key Metrics to Track

| Metric | Target | Current |
|--------|--------|---------|
| **ARPU** | $4,000/customer/year | $1,250-$2,000 |
| **CAC** | < $500 (self-serve reseller channel) | Unknown |
| **LTV** | 3+ year: $12K+ | $3.75K-$6K |
| **Gross Margin** | 70%+ | ~80% (infrastructure costs low) |
| **Blended Annual Growth Rate** | 150%+ | Unknown |

---

## Why This Pricing Works

1. **Value alignment**: Base fee reflects support costs; per-DID metric aligns with usage
2. **Willingness-to-pay**: Call centers capture 10-12% answer-rate lift = $5-50K value/year; we capture 8-25% of that
3. **Segmentation**: SMB/mid-market/enterprise get appropriate price points
4. **Reseller incentives**: 43-77% wholesale margin makes reseller channel profitable
5. **Expansion revenue**: API overage, white-label, custom SLAs = upsell hooks
6. **Churn resistance**: Base fee + switching cost = higher LTV than pure PAYG

---

## Implementation Checklist

- [ ] **Week 1**: Communicate new pricing to enterprise customers (grandfather offer)
- [ ] **Week 2**: Update billing code (new tier structure, API overage logic)
- [ ] **Week 3**: Update frontend (pricing calculator, landing page)
- [ ] **Week 4**: Sales enablement (pitch deck, ROI calculator, competitive positioning)
- [ ] **Month 2**: Soft launch (new customers on hybrid, existing on legacy for 60 days)
- [ ] **Month 3**: Hard cutover or generous migration path
- [ ] **Ongoing**: Monitor ARPU, churn, tier distribution; iterate tiers if needed

---

## Optional Upsells (Future)

### Premium Features (5-10% of customers)
- **Advanced ML** ($199/mo): Real-time A/B testing, custom bandit priors
- **White-label API** ($299/mo): Branded domain + API docs + support
- **Dedicated ML fine-tuning** ($499/mo): Custom model training on customer data

### Usage-Based Add-ons
- **Extra API calls** ($0.00005/call beyond tier limits): for high-volume integrations
- **Phone registration** ($1/DID one-time + $0.05/DID/mo): Hiya + Caller Registry integration
- **Custom integrations** ($500/mo): Salesforce, Pipedrive, Zendesk webhooks

---

## Questions for CFO / Product Team

1. What's our actual **cost per customer per month**? (Support, infrastructure, reputation checks)
2. What's our **target gross margin**? (70%, 80%, 90%?)
3. Should resellers get 40-80% margin, or is 30-50% acceptable?
4. Which customers would upgrade to paid features? (e.g., white-label, advanced ML)
5. Would enterprise customers pay 2-3x for dedicated support + SLA?


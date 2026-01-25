# Enhanced PayPal Logging Summary

**Date:** 2025-11-09
**Task:** Add comprehensive logging for PayPal verify and charge operations

---

## Changes Made

### 1. Enhanced `services/billing/paypalCharging.js`

#### chargePaymentToken() Function
Added comprehensive logging for:
- ✅ Full request body sent to PayPal Orders API
- ✅ Complete response from Create Order API
- ✅ Status codes from PayPal
- ✅ Full request for Capture Order API
- ✅ Complete capture response
- ✅ Detailed error logging including:
  - Error type and message
  - Status code
  - Full error stack trace
  - PayPal error result object
  - PayPal response headers
  - Complete error object with all properties
  - Token ID in error for debugging

#### verifyPaymentToken() Function
Added comprehensive logging for:
- ✅ Full verification request body
- ✅ Complete response from PayPal
- ✅ Status codes
- ✅ Order ID created during verification
- ✅ Detailed error logging including:
  - Error type, message, and stack
  - PayPal error details
  - Full error object
  - Extracted error details array

### 2. Enhanced `routes/billing.js`

#### Test Charge Endpoint (`POST /api/v1/billing/payment-methods/:id/test-charge`)
Added error logging for:
- ✅ Error message and stack trace
- ✅ Payment token ID
- ✅ Charge amount
- ✅ Tenant name
- ✅ PayPal error details (if available)
- ✅ Full error object

#### Verify Endpoint (`POST /api/v1/billing/payment-methods/:id/verify`)
Added comprehensive logging for:
- ✅ Request details (payment method ID, vault ID, tenant)
- ✅ Verification result with all details
- ✅ Error logging with full PayPal response
- ✅ Error details returned to client

---

## How to View Logs

### Real-time Log Monitoring
```bash
# Follow all logs (recommended for debugging)
sudo journalctl -u did-api -f

# Follow logs with timestamps
sudo journalctl -u did-api -f -o short-iso

# Filter for errors only
sudo journalctl -u did-api -f | grep -E "❌|🔴|ERROR"

# Filter for PayPal operations
sudo journalctl -u did-api -f | grep -E "PAYMENT|VERIFY|PayPal"
```

### Recent Logs
```bash
# Last 100 lines
sudo journalctl -u did-api -n 100 --no-pager

# Last hour of logs
sudo journalctl -u did-api --since "1 hour ago" --no-pager

# Logs from specific time
sudo journalctl -u did-api --since "2025-11-09 14:00:00" --no-pager
```

### Save Logs to File
```bash
# Save last 500 lines
sudo journalctl -u did-api -n 500 --no-pager > paypal_logs.txt

# Save all logs from today
sudo journalctl -u did-api --since today --no-pager > paypal_logs_today.txt
```

---

## Log Output Examples

### Successful Charge
```
💳 ===== CHARGING PAYMENT TOKEN =====
📝 Token ID: 9nx37ruk3hep6
💰 Amount: 1.00 USD
📄 Description: Test charge - Client Test Account

📤 Creating PayPal order...
📤 Request Body: {
  "intent": "CAPTURE",
  "purchaseUnits": [
    {
      "amount": {
        "currencyCode": "USD",
        "value": "1.00"
      },
      "description": "Test charge - Client Test Account"
    }
  ],
  "paymentSource": {
    "token": {
      "id": "9nx37ruk3hep6",
      "type": "PAYMENT_METHOD_TOKEN"
    }
  }
}

✅ Order created: 7XK29485T0123456F
📊 Status: APPROVED
🔢 Status Code: 201
📦 Full Create Response: { ... }

💰 Capturing payment...
📤 Capture Request: { "id": "7XK29485T0123456F" }

✅ Payment captured successfully
📊 Capture Status: COMPLETED
🆔 Order ID: 7XK29485T0123456F
🔢 Capture Status Code: 201
📦 Full Capture Response: { ... }
```

### Failed Charge with Details
```
❌ ===== PAYMENT CHARGING ERROR =====
🔴 Error Type: ApiError
🔴 Error Message: Invalid payment source
🔴 Status Code: 400
🔴 Error Stack: Error: Invalid payment source
    at OrdersController.ordersCreate (...)
    at chargePaymentToken (...)
📊 Error Result: {
  "name": "INVALID_REQUEST",
  "message": "Request is not well-formed, syntactically incorrect, or violates schema.",
  "details": [
    {
      "field": "/payment_source/token/id",
      "value": "9nx37ruk3hep6",
      "issue": "INVALID_PAYMENT_METHOD_TOKEN",
      "description": "Payment method token is invalid or expired."
    }
  ]
}
🔍 Full Error Object: { ... }
=======================================

❌ ===== TEST CHARGE ENDPOINT ERROR =====
🔴 Error Message: PayPal Charge Failed [Token: 9nx37ruk3hep6]: INVALID_PAYMENT_METHOD_TOKEN: Payment method token is invalid or expired.
🔴 Token ID: 9nx37ruk3hep6
🔴 Amount: 1.00
🔴 Tenant: Client Test Account
💳 PayPal Error Details: { ... }
```

### Verification Request
```
🔍 ===== VERIFY ENDPOINT CALLED =====
📝 Payment Method ID: 67890abcdef
📝 Vault ID: 9nx37ruk3hep6
📝 Tenant: Client Test Account
=======================================

🔍 ===== VERIFYING PAYMENT TOKEN =====
📝 Token ID: 9nx37ruk3hep6
📤 Verification Request Body: {
  "intent": "AUTHORIZE",
  "purchaseUnits": [
    {
      "amount": {
        "currencyCode": "USD",
        "value": "0.01"
      },
      "description": "Payment method verification"
    }
  ],
  "paymentSource": {
    "token": {
      "id": "9nx37ruk3hep6",
      "type": "PAYMENT_METHOD_TOKEN"
    }
  }
}

✅ Payment token is valid
📊 Status: CREATED
🔢 Status Code: 201
📦 Full Verification Response: { ... }
=======================================
```

---

## Troubleshooting Guide

### Common Issues

#### 1. "Payment method token is invalid or expired"
**Log Location:** Look for `INVALID_PAYMENT_METHOD_TOKEN` in error details
**Cause:** Token was revoked or expired in PayPal vault
**Solution:** Delete and re-add the payment method

#### 2. "Instrument declined"
**Log Location:** Look for `INSTRUMENT_DECLINED` in error details
**Cause:** Card was declined by issuing bank
**Solution:** Use a different card or contact bank

#### 3. "Authentication required"
**Log Location:** Look for `401` status code in PayPal initialization
**Cause:** Invalid PayPal credentials
**Solution:** Verify `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env`

#### 4. "Insufficient funds"
**Log Location:** Look for `INSUFFICIENT_FUNDS` in error details
**Cause:** Card doesn't have enough balance
**Solution:** Use a card with sufficient funds

---

## Testing the Enhanced Logging

### 1. Test Successful Verification
```bash
# Start log monitoring
sudo journalctl -u did-api -f

# In another terminal, test verification
# (Use the UI or curl)
```

### 2. Test Successful Charge
```bash
# Start log monitoring
sudo journalctl -u did-api -f | grep -E "CHARGING|CHARGE"

# Use UI to test $1.00 charge
# Watch for complete request/response logs
```

### 3. Test Error Scenarios
```bash
# Monitor error logs
sudo journalctl -u did-api -f | grep -E "❌|ERROR"

# Try operations that might fail
# - Verify expired token
# - Charge with declined card
# - Use invalid token ID
```

---

## Log Symbols Guide

- 🔧 = Initialization
- 💳 = Payment operation
- 🔍 = Verification operation
- 📤 = Request sent to PayPal
- 📦 = Full response from PayPal
- ✅ = Success
- ❌ = Error
- 🔴 = Error detail
- 📊 = Status/Result
- 🔢 = HTTP status code
- 💰 = Money/Amount
- 📝 = Information
- 🆔 = ID/Identifier

---

## Next Steps

1. ✅ **Backend restarted** with enhanced logging
2. 🧪 **Test verify operation** - Click "Verify" button and check logs
3. 🧪 **Test charge operation** - Enter $1.00 and click "Charge", check logs
4. 📊 **Review logs** - Use `sudo journalctl -u did-api -f` to see all details
5. 🐛 **Debug issues** - Look for error sections with 🔴 symbols
6. 📸 **Share logs** - If issues persist, share the log output

---

## Service Status

```bash
# Check service is running
sudo systemctl status did-api

# Restart if needed
sudo systemctl restart did-api

# View recent logs
sudo journalctl -u did-api -n 50
```

---

**Status:** ✅ Enhanced logging active
**Service:** ✅ Running
**Ready for testing:** Yes

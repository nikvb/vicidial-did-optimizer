import { Client, Environment, VaultController, LogLevel } from '@paypal/paypal-server-sdk';
import fs from 'fs';

// Lazy initialization - create client only when needed (after env vars are loaded)
let client = null;
let vaultController = null;

function initializePayPalClient() {
  if (client) {
    return vaultController; // Already initialized
  }

  // Log PayPal configuration at first use
  const paypalMode = process.env.PAYPAL_MODE;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  // Write debug info to file
  try {
    const debugInfo = `
===== PAYPAL SDK INITIALIZATION =====
Timestamp: ${new Date().toISOString()}
PayPal Mode: ${paypalMode}
Environment: ${paypalMode === 'live' ? 'PRODUCTION' : 'SANDBOX'}
Client ID: ${clientId?.substring(0, 30)}... (length: ${clientId?.length})
Secret configured: ${clientSecret ? 'YES (length: ' + clientSecret.length + ')' : 'NO'}
Secret first 20 chars: ${clientSecret?.substring(0, 20)}...
=====================================
`;
    fs.writeFileSync('/tmp/paypal-config-debug.log', debugInfo, { flag: 'a' });
  } catch (e) {
    // Ignore file write errors
  }

  if (!clientId || !clientSecret) {
    const errorMsg = `Missing PayPal credentials - ClientID: ${!!clientId}, Secret: ${!!clientSecret}`;
    try {
      fs.writeFileSync('/tmp/paypal-config-debug.log', `ERROR: ${errorMsg}\n`, { flag: 'a' });
    } catch (e) {}
    throw new Error(errorMsg);
  }

  // Initialize PayPal client with OAuth 2.0
  client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: process.env.PAYPAL_CLIENT_ID,
      oAuthClientSecret: process.env.PAYPAL_CLIENT_SECRET,
    },
    timeout: 60000, // 60 second timeout
    environment: process.env.PAYPAL_MODE === 'live' ? Environment.Production : Environment.Sandbox,
    logging: {
      logLevel: LogLevel.Debug, // Changed to Debug for maximum logging
      logRequest: { logBody: true, logHeaders: true },
      logResponse: { logHeaders: true, logBody: true },
    },
  });

  console.log('✅ PayPal Client initialized successfully');
  console.log('📡 API Base URL:', process.env.PAYPAL_MODE === 'live' ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com');
  console.log('=======================================\n');

  vaultController = new VaultController(client);
  return vaultController;
}

/**
 * Vault a credit card and return payment token
 * @param {Object} cardData - Card information
 * @returns {Promise<Object>} Vaulted payment token details
 */
export async function vaultCreditCard(cardData) {
  console.log('\n🎯 ===== VAULT CREDIT CARD REQUEST =====');
  console.log('📝 Card data received:', {
    hasNumber: !!cardData.number,
    numberLength: cardData.number?.length,
    expMonth: cardData.expMonth,
    expYear: cardData.expYear,
    hasCvv: !!cardData.cvv,
    cvvLength: cardData.cvv?.length,
    firstName: cardData.firstName,
    lastName: cardData.lastName,
    city: cardData.city,
    state: cardData.state,
    postalCode: cardData.postalCode,
    countryCode: cardData.countryCode
  });

  // Initialize PayPal client (lazy loading)
  const vault = initializePayPalClient();

  try {
    const {
      number,
      expMonth,
      expYear,
      cvv,
      firstName,
      lastName,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      countryCode
    } = cardData;

    // Format expiry as YYYY-MM
    const expiry = `${expYear}-${expMonth.toString().padStart(2, '0')}`;
    console.log('📅 Formatted expiry:', expiry);

    // Prepare request object
    const request = {
      body: {
        paymentSource: {
          card: {
            name: `${firstName} ${lastName}`.trim(),
            number: number.replace(/\s/g, ''), // Remove spaces
            expiry: expiry,
            securityCode: cvv,
            billingAddress: {
              addressLine1: addressLine1,
              addressLine2: addressLine2 || undefined,
              adminArea2: city, // City
              adminArea1: state, // State
              postalCode: postalCode,
              countryCode: countryCode || 'US'
            }
          }
        }
      }
    };

    console.log('\n📤 REQUEST TO PAYPAL API:');
    console.log('🔹 Endpoint: POST /v1/vault/payment-tokens');
    console.log('🔹 Request body:', JSON.stringify({
      paymentSource: {
        card: {
          name: request.body.paymentSource.card.name,
          number: '****' + number.slice(-4),
          expiry: request.body.paymentSource.card.expiry,
          securityCode: '***',
          billingAddress: request.body.paymentSource.card.billingAddress
        }
      }
    }, null, 2));

    console.log('\n⏳ Calling PayPal SDK createPaymentToken...');
    const startTime = Date.now();

    const { result, statusCode } = await vault.createPaymentToken(request);

    const elapsed = Date.now() - startTime;
    console.log(`\n✅ PayPal API Response received in ${elapsed}ms`);
    console.log('📊 Status Code:', statusCode);

    console.log('🎉 PayPal Payment Token created:', result.id);
    console.log('📋 Full response:', JSON.stringify(result, null, 2));

    // Extract card details from response
    const cardInfo = result.paymentSource?.card || {};

    console.log('💳 Card details from response:');
    console.log('  - Last 4:', cardInfo.lastDigits);
    console.log('  - Brand:', cardInfo.brand);
    console.log('  - Expiry:', cardInfo.expiry);
    console.log('  - Customer ID:', result.customer?.id);

    const vaultResult = {
      success: true,
      tokenId: result.id,
      last4: cardInfo.lastDigits,
      brand: cardInfo.brand,
      expiry: cardInfo.expiry,
      customerId: result.customer?.id,
      status: 'VAULTED'
    };

    console.log('✅ Returning vault result:', vaultResult);
    console.log('=======================================\n');

    return vaultResult;

  } catch (error) {
    console.error('\n❌ ===== PAYPAL VAULTING ERROR =====');
    console.error('🔴 Error Type:', error.constructor.name);
    console.error('🔴 Error Name:', error.name);
    console.error('🔴 Error Message:', error.message);
    console.error('🔴 Status Code:', error.statusCode);

    // Try to parse error object in multiple ways
    console.error('\n📋 Full Error Object:');
    try {
      console.error(JSON.stringify(error, null, 2));
    } catch (e) {
      console.error('Could not stringify error:', e.message);
      console.error('Error object keys:', Object.keys(error));
    }

    // Check for result property
    if (error.result) {
      console.error('\n📊 Error Result Object:');
      console.error(JSON.stringify(error.result, null, 2));
    }

    // Check for response property
    if (error.response) {
      console.error('\n📡 Error Response Object:');
      console.error(JSON.stringify(error.response, null, 2));
    }

    // Check for body property
    if (error.body) {
      console.error('\n📄 Error Body:');
      console.error(JSON.stringify(error.body, null, 2));
    }

    // Log stack trace
    console.error('\n📚 Stack Trace:');
    console.error(error.stack);

    // Extract error details for user-friendly message
    let errorMessage = 'Failed to vault card';
    let errorDetails = [];

    if (error.result) {
      errorMessage = error.result.message || error.result.error_description || errorMessage;
      errorDetails = error.result.details || error.result.error_details || [];
    } else if (error.body) {
      errorMessage = error.body.message || error.body.error_description || errorMessage;
      errorDetails = error.body.details || error.body.error_details || [];
    } else if (error.message) {
      errorMessage = error.message;
    }

    console.error('\n📝 Extracted Error Message:', errorMessage);
    console.error('📝 Extracted Error Details:', errorDetails);

    const detailsText = errorDetails.map(d => d.description || d.issue || JSON.stringify(d)).join(', ');

    console.error('=======================================\n');

    throw new Error(`PayPal API Error: ${errorMessage}. ${detailsText}`);
  }
}

/**
 * Get payment token details
 * @param {string} tokenId - Payment token ID
 * @returns {Promise<Object>} Payment token details
 */
export async function getPaymentToken(tokenId) {
  const vault = initializePayPalClient();
  try {
    const { result } = await vault.getPaymentToken(tokenId);
    return result;
  } catch (error) {
    console.error('❌ Error fetching payment token:', error);
    throw new Error('Failed to fetch payment token');
  }
}

/**
 * Delete payment token from vault
 * @param {string} tokenId - Payment token ID
 * @returns {Promise<boolean>} Success status
 */
export async function deletePaymentToken(tokenId) {
  const vault = initializePayPalClient();
  try {
    await vault.deletePaymentToken(tokenId);
    console.log('✅ Payment token deleted:', tokenId);
    return true;
  } catch (error) {
    console.error('❌ Error deleting payment token:', error);
    throw new Error('Failed to delete payment token');
  }
}

/**
 * List customer payment tokens
 * @param {string} customerId - Customer ID
 * @returns {Promise<Array>} List of payment tokens
 */
export async function listCustomerTokens(customerId) {
  const vault = initializePayPalClient();
  try {
    const { result } = await vault.listCustomerPaymentTokens({
      customerId,
      pageSize: 20,
      page: 1
    });

    return result.paymentTokens || [];
  } catch (error) {
    console.error('❌ Error listing payment tokens:', error);
    throw new Error('Failed to list payment tokens');
  }
}

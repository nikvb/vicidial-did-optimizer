import { Client, Environment, OrdersController, LogLevel } from '@paypal/paypal-server-sdk';
import fs from 'fs';

// Lazy initialization - create client only when needed (after env vars are loaded)
let client = null;
let ordersController = null;

function initializePayPalClient() {
  if (client) {
    return ordersController; // Already initialized
  }

  const paypalMode = process.env.PAYPAL_MODE;
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  console.log('\n🔧 ===== PAYPAL ORDERS SDK INITIALIZATION =====');
  console.log('📊 PayPal Mode:', paypalMode);
  console.log('🌍 Environment:', paypalMode === 'live' ? 'PRODUCTION' : 'SANDBOX');

  if (!clientId || !clientSecret) {
    throw new Error(`Missing PayPal credentials - ClientID: ${!!clientId}, Secret: ${!!clientSecret}`);
  }

  // Initialize PayPal client with OAuth 2.0
  client = new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: clientId,
      oAuthClientSecret: clientSecret,
    },
    timeout: 60000,
    environment: paypalMode === 'live' ? Environment.Production : Environment.Sandbox,
    logging: {
      logLevel: LogLevel.Info,
      logRequest: { logBody: true },
      logResponse: { logBody: true },
    },
  });

  console.log('✅ PayPal Orders Client initialized successfully');
  console.log('=======================================\n');

  ordersController = new OrdersController(client);
  return ordersController;
}

/**
 * Charge a vaulted payment token
 * @param {string} paymentTokenId - The payment token ID from vault
 * @param {number} amount - Amount to charge
 * @param {string} currency - Currency code (default: USD)
 * @param {string} description - Payment description
 * @returns {Promise<Object>} Charge result with transaction details
 */
export async function chargePaymentToken(paymentTokenId, amount, currency = 'USD', description = 'DID Optimizer Service') {
  console.log('\n💳 ===== CHARGING PAYMENT TOKEN =====');
  console.log('📝 Token ID:', paymentTokenId);
  console.log('💰 Amount:', amount, currency);
  console.log('📄 Description:', description);
  console.log('⏰ Timestamp:', new Date().toISOString());

  const orders = initializePayPalClient();
  console.log('✅ PayPal client initialized');

  try {
    // Step 1: Create order with payment token
    console.log('\n📤 ===== STEP 1: CREATING ORDER =====');

    const createOrderRequest = {
      body: {
        intent: 'CAPTURE',
        purchaseUnits: [
          {
            amount: {
              currencyCode: currency,
              value: amount.toFixed(2)
            },
            description: description
          }
        ],
        paymentSource: {
          token: {
            id: paymentTokenId,
            type: 'PAYMENT_METHOD_TOKEN'
          }
        }
      }
    };

    console.log('📤 Full Request Body:\n', JSON.stringify(createOrderRequest.body, null, 2));
    console.log('🔑 Using Token ID:', paymentTokenId);
    console.log('💵 Charging Amount:', amount.toFixed(2), currency);

    console.log('\n⏳ Calling PayPal createOrder API...');
    const createOrderStartTime = Date.now();

    const { result: createResult, statusCode: createStatus, ...createResponse } = await orders.createOrder(createOrderRequest);

    const createOrderDuration = Date.now() - createOrderStartTime;
    console.log(`✅ Order API call completed in ${createOrderDuration}ms`);
    console.log('📊 HTTP Status Code:', createStatus);
    console.log('🆔 Order ID:', createResult.id);
    console.log('📊 Order Status:', createResult.status);
    console.log('📦 Full Create Response:\n', JSON.stringify(createResult, null, 2));

    // Check if order is already completed (auto-captured)
    let finalResult;
    let capture;

    if (createResult.status === 'COMPLETED') {
      console.log('\n✅ ===== ORDER AUTO-COMPLETED =====');
      console.log('PayPal automatically completed the order (no manual capture needed)');

      finalResult = createResult;

      console.log('🔍 Extracting capture details from auto-completed order...');
      console.log('Purchase Units:', JSON.stringify(createResult.purchaseUnits, null, 2));

      if (!createResult.purchaseUnits || !createResult.purchaseUnits[0]) {
        throw new Error('No purchase units found in completed order');
      }

      if (!createResult.purchaseUnits[0].payments) {
        throw new Error('No payments found in purchase unit');
      }

      if (!createResult.purchaseUnits[0].payments.captures || !createResult.purchaseUnits[0].payments.captures[0]) {
        throw new Error('No captures found in payments');
      }

      capture = createResult.purchaseUnits[0].payments.captures[0];
      console.log('✅ Capture extracted:', JSON.stringify(capture, null, 2));

    } else {
      // Step 2: Capture the order if not already completed
      console.log('\n💰 ===== STEP 2: CAPTURING PAYMENT =====');
      console.log('Order Status:', createResult.status, '(requires manual capture)');
      console.log('🆔 Capturing order ID:', createResult.id);

      console.log('\n⏳ Calling PayPal captureOrder API...');
      const captureStartTime = Date.now();

      const { result: captureResult, statusCode: captureStatus, ...captureResponse } = await orders.captureOrder(createResult.id, undefined, undefined, 'return=representation');

      const captureDuration = Date.now() - captureStartTime;
      console.log(`✅ Capture API call completed in ${captureDuration}ms`);
      console.log('📊 HTTP Status Code:', captureStatus);
      console.log('📊 Capture Status:', captureResult.status);
      console.log('🆔 Order ID:', captureResult.id);
      console.log('📦 Full Capture Response:\n', JSON.stringify(captureResult, null, 2));

      finalResult = captureResult;

      console.log('🔍 Extracting capture details from capture response...');
      console.log('Purchase Units:', JSON.stringify(captureResult.purchaseUnits, null, 2));

      if (!captureResult.purchaseUnits || !captureResult.purchaseUnits[0]) {
        throw new Error('No purchase units found in capture result');
      }

      if (!captureResult.purchaseUnits[0].payments) {
        throw new Error('No payments found in purchase unit');
      }

      if (!captureResult.purchaseUnits[0].payments.captures || !captureResult.purchaseUnits[0].payments.captures[0]) {
        throw new Error('No captures found in payments');
      }

      capture = captureResult.purchaseUnits[0].payments.captures[0];
      console.log('✅ Capture extracted:', JSON.stringify(capture, null, 2));
    }

    console.log('\n✅ ===== BUILDING CHARGE RESULT =====');
    const chargeResult = {
      success: true,
      orderId: finalResult.id,
      transactionId: capture.id,
      status: capture.status,
      amount: parseFloat(capture.amount.value),
      currency: capture.amount.currencyCode,
      createTime: capture.createTime,
      updateTime: capture.updateTime,
      captureDetails: {
        finalCapture: capture.finalCapture,
        sellerProtection: capture.sellerProtection
      }
    };

    console.log('✅ Charge successful!');
    console.log('📦 Final Result:\n', JSON.stringify(chargeResult, null, 2));
    console.log('=======================================\n');

    return chargeResult;

  } catch (error) {
    console.error('\n❌ ===== PAYMENT CHARGING ERROR =====');
    console.error('⏰ Error Timestamp:', new Date().toISOString());
    console.error('🔴 Error Type:', error.constructor.name);
    console.error('🔴 Error Message:', error.message);
    console.error('🔴 Status Code:', error.statusCode);
    console.error('🔴 Error Stack:\n', error.stack);

    if (error.result) {
      console.error('📊 Error Result (error.result):\n', JSON.stringify(error.result, null, 2));
    }

    if (error.response) {
      console.error('📡 Error Response (error.response):\n', JSON.stringify(error.response, null, 2));
    }

    if (error.headers) {
      console.error('📋 Error Headers (error.headers):\n', JSON.stringify(error.headers, null, 2));
    }

    if (error.body) {
      console.error('📄 Error Body (error.body):\n', JSON.stringify(error.body, null, 2));
    }

    // Log full error object for debugging
    console.error('🔍 Full Error Object (all properties):\n', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));

    // Log all enumerable properties
    console.error('🔍 Error Enumerable Properties:');
    for (const key in error) {
      console.error(`  ${key}:`, error[key]);
    }

    console.error('=======================================\n');

    // Extract user-friendly error message
    let errorMessage = 'Payment failed';
    let errorDetails = [];

    if (error.result?.details) {
      console.error('📋 Extracting error details from error.result.details...');
      errorDetails = error.result.details.map(d => `${d.issue || 'ERROR'}: ${d.description || d.value || 'Unknown error'}`);
      errorMessage = errorDetails.join('; ');
      console.error('📋 Extracted error message:', errorMessage);
    } else if (error.result?.message) {
      console.error('📋 Using error.result.message:', error.result.message);
      errorMessage = error.result.message;
    } else if (error.message) {
      console.error('📋 Using error.message:', error.message);
      errorMessage = error.message;
    } else {
      console.error('📋 No error message found, using default');
    }

    // Include token ID in error for debugging
    const detailedError = new Error(`PayPal Charge Failed [Token: ${paymentTokenId}]: ${errorMessage}`);
    detailedError.paypalError = error;
    detailedError.tokenId = paymentTokenId;
    detailedError.originalError = error;
    detailedError.details = errorDetails;
    detailedError.fullError = error.result || error;

    console.error('❌ Throwing detailed error:', detailedError.message);
    throw detailedError;
  }
}

/**
 * Verify a payment token is still valid
 * @param {string} paymentTokenId - The payment token ID to verify
 * @returns {Promise<Object>} Token status
 */
export async function verifyPaymentToken(paymentTokenId) {
  console.log('\n🔍 ===== VERIFYING PAYMENT TOKEN =====');
  console.log('📝 Token ID:', paymentTokenId);

  try {
    // Try to create a $0.01 order to verify token validity (won't be captured)
    const orders = initializePayPalClient();

    const createOrderRequest = {
      body: {
        intent: 'AUTHORIZE', // Use authorize instead of capture for verification
        purchaseUnits: [
          {
            amount: {
              currencyCode: 'USD',
              value: '0.01'
            },
            description: 'Payment method verification'
          }
        ],
        paymentSource: {
          token: {
            id: paymentTokenId,
            type: 'PAYMENT_METHOD_TOKEN'
          }
        }
      }
    };

    console.log('📤 Verification Request Body:', JSON.stringify(createOrderRequest.body, null, 2));

    const { result, statusCode, ...response } = await orders.createOrder(createOrderRequest);

    console.log('✅ Payment token is valid');
    console.log('📊 Status:', result.status);
    console.log('🔢 Status Code:', statusCode);
    console.log('📦 Full Verification Response:', JSON.stringify(result, null, 2));
    console.log('=======================================\n');

    // Void the authorization immediately (don't capture)
    // Note: In production, you might want to capture and refund, or just not authorize at all

    return {
      valid: true,
      status: result.status,
      tokenId: paymentTokenId,
      orderId: result.id
    };

  } catch (error) {
    console.error('\n❌ ===== PAYMENT TOKEN VERIFICATION ERROR =====');
    console.error('🔴 Error Type:', error.constructor.name);
    console.error('🔴 Error Message:', error.message);
    console.error('🔴 Status Code:', error.statusCode);
    console.error('🔴 Error Stack:', error.stack);

    if (error.result) {
      console.error('📊 Error Result:', JSON.stringify(error.result, null, 2));
    }

    if (error.response) {
      console.error('📡 Error Response:', JSON.stringify(error.response, null, 2));
    }

    if (error.headers) {
      console.error('📋 Error Headers:', JSON.stringify(error.headers, null, 2));
    }

    // Log full error object for debugging
    console.error('🔍 Full Error Object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    console.error('=======================================\n');

    // Extract detailed error information
    let errorMessage = 'Token verification failed';
    let errorDetails = [];

    if (error.result?.details) {
      errorDetails = error.result.details.map(d => `${d.issue || 'ERROR'}: ${d.description || d.value || 'Unknown error'}`);
      errorMessage = errorDetails.join('; ');
    } else if (error.result?.message) {
      errorMessage = error.result.message;
    } else if (error.message) {
      errorMessage = error.message;
    }

    return {
      valid: false,
      error: errorMessage,
      errorDetails: errorDetails,
      tokenId: paymentTokenId,
      statusCode: error.statusCode,
      fullError: error.result || error
    };
  }
}

export default {
  chargePaymentToken,
  verifyPaymentToken
};

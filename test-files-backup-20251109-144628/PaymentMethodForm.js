import React, { useState } from 'react';
import axios from 'axios';
import { CreditCardIcon, LockClosedIcon } from '@heroicons/react/24/outline';

const PaymentMethodForm = ({ onSuccess, onCancel }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [cardDetails, setCardDetails] = useState({
    number: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
    firstName: '',
    lastName: '',
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'US'
  });

  const formatCardNumber = (value) => {
    return value.replace(/\s/g, '').replace(/(\d{4})/g, '$1 ').trim();
  };

  const handleCardNumberChange = (e) => {
    const value = e.target.value.replace(/\s/g, '');
    if (value.length <= 16 && /^\d*$/.test(value)) {
      setCardDetails({ ...cardDetails, number: value });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/v1/billing/payment-methods/vault`,
        {
          cardNumber: cardDetails.number,
          expiryMonth: parseInt(cardDetails.expiryMonth),
          expiryYear: parseInt(cardDetails.expiryYear),
          cvv: cardDetails.cvv,
          billingAddress: {
            firstName: cardDetails.firstName,
            lastName: cardDetails.lastName,
            street: cardDetails.street,
            city: cardDetails.city,
            state: cardDetails.state,
            zipCode: cardDetails.zipCode,
            country: cardDetails.country
          }
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`
          }
        }
      );

      if (response.data.success) {
        onSuccess();
      }
    } catch (err) {
      console.error('Failed to add payment method:', err);
      setError(err.response?.data?.error?.message || 'Failed to add payment method. Please check your card details.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center mb-6">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mr-4">
            <CreditCardIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Add Payment Method</h3>
            <p className="text-sm text-gray-600">Your card information is encrypted and stored securely by PayPal</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Card Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Card Number
            </label>
            <input
              type="text"
              value={formatCardNumber(cardDetails.number)}
              onChange={handleCardNumberChange}
              placeholder="1234 5678 9012 3456"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          {/* Expiry and CVV */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Exp Month
              </label>
              <input
                type="text"
                value={cardDetails.expiryMonth}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.length <= 2 && /^\d*$/.test(value)) {
                    setCardDetails({ ...cardDetails, expiryMonth: value });
                  }
                }}
                placeholder="MM"
                maxLength="2"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Exp Year
              </label>
              <input
                type="text"
                value={cardDetails.expiryYear}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.length <= 4 && /^\d*$/.test(value)) {
                    setCardDetails({ ...cardDetails, expiryYear: value });
                  }
                }}
                placeholder="YYYY"
                maxLength="4"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                CVV
              </label>
              <input
                type="text"
                value={cardDetails.cvv}
                onChange={(e) => {
                  const value = e.target.value;
                  if (value.length <= 4 && /^\d*$/.test(value)) {
                    setCardDetails({ ...cardDetails, cvv: value });
                  }
                }}
                placeholder="123"
                maxLength="4"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Cardholder Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                First Name
              </label>
              <input
                type="text"
                value={cardDetails.firstName}
                onChange={(e) => setCardDetails({ ...cardDetails, firstName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Last Name
              </label>
              <input
                type="text"
                value={cardDetails.lastName}
                onChange={(e) => setCardDetails({ ...cardDetails, lastName: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
          </div>

          {/* Billing Address */}
          <div className="border-t pt-6">
            <h4 className="text-sm font-medium text-gray-900 mb-4">Billing Address</h4>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Street Address
                </label>
                <input
                  type="text"
                  value={cardDetails.street}
                  onChange={(e) => setCardDetails({ ...cardDetails, street: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    City
                  </label>
                  <input
                    type="text"
                    value={cardDetails.city}
                    onChange={(e) => setCardDetails({ ...cardDetails, city: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    State
                  </label>
                  <input
                    type="text"
                    value={cardDetails.state}
                    onChange={(e) => {
                      const value = e.target.value.toUpperCase();
                      if (value.length <= 2) {
                        setCardDetails({ ...cardDetails, state: value });
                      }
                    }}
                    placeholder="CA"
                    maxLength="2"
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    ZIP Code
                  </label>
                  <input
                    type="text"
                    value={cardDetails.zipCode}
                    onChange={(e) => setCardDetails({ ...cardDetails, zipCode: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Country
                  </label>
                  <select
                    value={cardDetails.country}
                    onChange={(e) => setCardDetails({ ...cardDetails, country: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="US">United States</option>
                    <option value="CA">Canada</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Security Note */}
          <div className="bg-gray-50 rounded-lg p-4 flex items-start">
            <LockClosedIcon className="w-5 h-5 text-gray-400 mt-0.5 mr-3 flex-shrink-0" />
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-900 mb-1">Secure Payment Processing</p>
              <p>Your card information is encrypted and securely stored by PayPal. We never see or store your full card number.</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-6 py-3 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Processing...' : 'Add Payment Method'}
            </button>
          </div>
        </form>
      </div>

      {/* Test Cards Info (Only show in development) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm font-medium text-yellow-900 mb-2">Test Cards (Sandbox Only)</p>
          <div className="text-xs text-yellow-800 space-y-1">
            <p>Visa: 4111111111111111</p>
            <p>Mastercard: 5555555555554444</p>
            <p>Expiry: Any future date (e.g., 12/2028)</p>
            <p>CVV: Any 3-4 digits (e.g., 123)</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaymentMethodForm;

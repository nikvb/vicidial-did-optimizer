import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  CreditCardIcon,
  CalendarIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ArrowUpIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon,
  PlusIcon
} from '@heroicons/react/24/outline';
import PaymentMethodForm from '../components/billing/PaymentMethodForm';
import PaymentMethodList from '../components/billing/PaymentMethodList';

const API_URL = process.env.REACT_APP_API_URL || 'https://dids.amdy.io';

const Billing = () => {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState(null);
  const [usage, setUsage] = useState(null);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [error, setError] = useState(null);

  const pricingPlans = {
    basic: {
      name: 'Basic',
      description: 'Perfect for small call centers getting started',
      monthlyPrice: 99,
      yearlyPrice: 990,
      didsLimit: 250,
      perDidCost: 1.50,
      features: [
        'Up to 250 DIDs included',
        'BYO DIDs - Import your existing numbers',
        'Basic rotation algorithms',
        'Geography-based DID recommendations',
        'Automated DID purchase',
        'Standard analytics dashboard',
        'Email support (24hr response)',
        'VICIdial API integration',
        '99.5% uptime SLA'
      ]
    },
    professional: {
      name: 'Professional',
      description: 'Ideal for growing businesses with AI optimization',
      monthlyPrice: 299,
      yearlyPrice: 2990,
      didsLimit: 1000,
      perDidCost: 1.00,
      features: [
        'Up to 1,000 DIDs included',
        'All Basic features',
        '🤖 AI-powered DID rotation',
        'Predictive analytics & forecasting',
        'Advanced rotation algorithms',
        'Real-time optimization',
        'Priority support (4hr response)',
        'API webhooks',
        '99.9% uptime SLA'
      ],
      popular: true
    },
    enterprise: {
      name: 'Enterprise',
      description: 'For large-scale operations requiring custom solutions',
      monthlyPrice: 'Custom',
      yearlyPrice: 'Custom',
      didsLimit: 'Unlimited',
      perDidCost: 'Negotiated',
      features: [
        'Unlimited DIDs',
        'All Professional features',
        'Custom ML models for your data',
        'White-glove onboarding',
        '24/7 dedicated support',
        'Custom integrations',
        'Dedicated account manager',
        '99.99% uptime SLA'
      ]
    }
  };

  useEffect(() => {
    fetchBillingData();
  }, []);

  const fetchBillingData = async () => {
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const headers = { Authorization: `Bearer ${token}` };

      // Fetch all billing data in parallel
      const [subscriptionRes, usageRes, paymentMethodsRes, invoicesRes] = await Promise.all([
        axios.get(`${API_URL}/api/v1/billing/subscription`, { headers }),
        axios.get(`${API_URL}/api/v1/billing/usage`, { headers }),
        axios.get(`${API_URL}/api/v1/billing/payment-methods`, { headers }),
        axios.get(`${API_URL}/api/v1/billing/invoices?limit=10`, { headers })
      ]);

      setSubscription(subscriptionRes.data.data);
      setUsage(usageRes.data.data.usage);
      setPaymentMethods(paymentMethodsRes.data.data.paymentMethods);
      setInvoices(invoicesRes.data.data.invoices);
    } catch (err) {
      console.error('Failed to fetch billing data:', err);
      setError('Failed to load billing information. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getUsagePercentage = () => {
    if (!usage || !subscription?.usage) return 0;
    const didCount = subscription.usage.didCount || 0;
    const includedDids = subscription.usage.includedDids || 0;
    if (includedDids === 0) return 0;
    return Math.min(100, (didCount / includedDids) * 100);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'trial': return 'text-blue-600 bg-blue-100';
      case 'past_due': return 'text-yellow-600 bg-yellow-100';
      case 'suspended':
      case 'cancelled': return 'text-red-600 bg-red-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    if (typeof amount !== 'number') return '$0.00';
    return `$${amount.toFixed(2)}`;
  };

  const handlePaymentMethodUpdate = () => {
    setShowPaymentModal(false);
    fetchBillingData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading billing information...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-sm p-8 max-w-md w-full">
          <ExclamationTriangleIcon className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-2">Error Loading Billing</h2>
          <p className="text-gray-600 text-center mb-4">{error}</p>
          <button
            onClick={fetchBillingData}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Billing & Subscription</h1>
          <p className="mt-2 text-gray-600">Manage your subscription, payment methods, and billing history.</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">

            {/* Current Subscription */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Current Subscription</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(subscription?.subscription?.status)}`}>
                  {subscription?.subscription?.status || 'Unknown'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center mb-4">
                    <ShieldCheckIcon className="w-8 h-8 text-blue-600 mr-3" />
                    <div>
                      <h3 className="font-semibold text-lg capitalize">
                        {subscription?.subscription?.plan || 'Basic'} Plan
                      </h3>
                      <p className="text-gray-600">
                        {subscription?.currentPlan?.price ? formatCurrency(subscription.currentPlan.price) : '$0'}/{subscription?.subscription?.billingCycle === 'yearly' ? 'year' : 'month'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {subscription?.currentPlan?.features?.map((feature, index) => (
                      <div key={index} className="flex items-start text-sm">
                        <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </div>
                    )) || (
                      <p className="text-sm text-gray-500">Loading features...</p>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Next billing date</span>
                      <CalendarIcon className="w-4 h-4 text-gray-400" />
                    </div>
                    <p className="font-semibold">{formatDate(subscription?.subscription?.nextBillingDate)}</p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">DID Usage</span>
                      <ChartBarIcon className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold">
                        {subscription?.usage?.didCount || 0} / {subscription?.usage?.includedDids || 0}
                      </span>
                      <span className="text-sm text-gray-500">
                        {Math.round(getUsagePercentage())}%
                      </span>
                    </div>
                    <div className="bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${getUsagePercentage() > 80 ? 'bg-red-500' : 'bg-blue-600'}`}
                        style={{ width: `${getUsagePercentage()}%` }}
                      ></div>
                    </div>
                    {usage && usage.extraDids > 0 && (
                      <p className="text-xs text-gray-600 mt-2">
                        +{usage.extraDids} additional DIDs × {formatCurrency(usage.perDidRate)} = {formatCurrency(usage.totalDidFee)}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => setShowPlanModal(true)}
                    className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center justify-center"
                  >
                    <ArrowUpIcon className="w-4 h-4 mr-2" />
                    Change Plan
                  </button>
                </div>
              </div>
            </div>

            {/* Estimated Next Invoice */}
            {usage && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg shadow-sm p-6 border border-blue-100">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Estimated Next Invoice</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Base Fee</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(usage.baseFee)}</p>
                  </div>
                  {usage.extraDids > 0 && (
                    <div>
                      <p className="text-sm text-gray-600">Additional DIDs</p>
                      <p className="text-2xl font-bold text-gray-900">{formatCurrency(usage.totalDidFee)}</p>
                      <p className="text-xs text-gray-500">{usage.extraDids} DIDs × {formatCurrency(usage.perDidRate)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-600">Total</p>
                    <p className="text-3xl font-bold text-blue-600">{formatCurrency(usage.total)}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Payment Methods */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <PaymentMethodList
                paymentMethods={paymentMethods}
                onUpdate={fetchBillingData}
                onAddNew={() => setShowPaymentModal(true)}
              />
            </div>

            {/* Billing History */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Billing History</h2>
                <DocumentTextIcon className="w-5 h-5 text-gray-400" />
              </div>

              {invoices.length === 0 ? (
                <div className="text-center py-8">
                  <DocumentTextIcon className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">No invoices yet</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {invoices.map((invoice) => (
                        <tr key={invoice._id}>
                          <td className="px-4 py-4 text-sm font-medium">{invoice.invoiceNumber}</td>
                          <td className="px-4 py-4 text-sm">{formatDate(invoice.createdAt)}</td>
                          <td className="px-4 py-4 text-sm font-medium">{formatCurrency(invoice.amounts.total)}</td>
                          <td className="px-4 py-4">
                            <span className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize ${
                              invoice.status === 'paid' ? 'bg-green-100 text-green-800' :
                              invoice.status === 'failed' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            }`}>
                              {invoice.status}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            <button className="text-blue-600 hover:text-blue-700 text-sm font-medium">
                              View
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Usage Alert */}
            {getUsagePercentage() > 80 && subscription?.usage?.includedDids !== 'Unlimited' && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-start">
                  <ExclamationTriangleIcon className="w-5 h-5 text-yellow-600 mr-3 mt-0.5 flex-shrink-0" />
                  <div>
                    <h3 className="text-sm font-medium text-yellow-800">Usage Warning</h3>
                    <p className="text-sm text-yellow-700 mt-1">
                      You're using {Math.round(getUsagePercentage())}% of your DID limit. Consider upgrading your plan.
                    </p>
                    <button
                      onClick={() => setShowPlanModal(true)}
                      className="mt-2 text-sm text-yellow-800 font-medium hover:text-yellow-900"
                    >
                      Upgrade Plan →
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Next Payment */}
            {usage && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-semibold mb-4">Next Payment</h3>
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600 mb-2">
                    {formatCurrency(usage.total)}
                  </div>
                  <p className="text-gray-600 mb-1">Due on {formatDate(subscription?.subscription?.nextBillingDate)}</p>
                  <p className="text-sm text-gray-500">
                    {paymentMethods.length > 0 ? 'Auto-charged to payment method' : 'No payment method on file'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Payment Method Modal */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white rounded-lg max-w-4xl w-full my-8">
              <div className="p-6 border-b flex items-center justify-between">
                <h3 className="text-xl font-semibold">Add Payment Method</h3>
                <button
                  onClick={() => setShowPaymentModal(false)}
                  className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                >
                  ×
                </button>
              </div>

              <div className="p-6">
                <PaymentMethodForm
                  onSuccess={handlePaymentMethodUpdate}
                  onCancel={() => setShowPaymentModal(false)}
                />
              </div>
            </div>
          </div>
        )}

        {/* Plan Change Modal - Simple version for now */}
        {showPlanModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg max-w-6xl w-full max-h-screen overflow-y-auto">
              <div className="p-6 border-b">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Change Plan</h3>
                  <button
                    onClick={() => setShowPlanModal(false)}
                    className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="p-6">
                <div className="grid md:grid-cols-3 gap-6">
                  {Object.entries(pricingPlans).map(([key, plan]) => (
                    <div
                      key={key}
                      className={`border-2 rounded-xl p-6 transition-all ${
                        subscription?.subscription?.plan === key
                          ? 'border-blue-600 bg-blue-50'
                          : plan.popular
                          ? 'border-blue-300'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {plan.popular && (
                        <div className="bg-blue-600 text-white px-3 py-1 rounded-full text-sm font-semibold mb-4 text-center">
                          Most Popular
                        </div>
                      )}

                      <div className="text-center mb-6">
                        <h4 className="text-xl font-bold mb-2">{plan.name}</h4>
                        <p className="text-gray-600 text-sm mb-4">{plan.description}</p>
                        <div className="text-3xl font-bold text-blue-600">
                          {plan.monthlyPrice === 'Custom' ? 'Custom' : formatCurrency(plan.monthlyPrice)}
                          {plan.monthlyPrice !== 'Custom' && (
                            <span className="text-lg text-gray-500 font-normal">/month</span>
                          )}
                        </div>
                        {plan.monthlyPrice !== 'Custom' && (
                          <p className="text-sm text-gray-600 mt-2">
                            {formatCurrency(plan.perDidCost)}/DID overage
                          </p>
                        )}
                      </div>

                      <ul className="space-y-2 mb-6">
                        {plan.features.map((feature, featureIndex) => (
                          <li key={featureIndex} className="flex items-start text-sm">
                            <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            <span>{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {subscription?.subscription?.plan === key ? (
                        <div className="text-center py-2 text-blue-600 font-medium">
                          Current Plan
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            if (plan.name === 'Enterprise') {
                              window.location.href = 'mailto:sales@amdy.io';
                            } else {
                              alert('Plan change functionality coming soon!');
                            }
                          }}
                          className={`w-full py-3 px-4 rounded-lg font-medium transition-colors ${
                            plan.name === 'Enterprise'
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                        >
                          {plan.name === 'Enterprise' ? 'Contact Sales' : `Upgrade to ${plan.name}`}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Billing;

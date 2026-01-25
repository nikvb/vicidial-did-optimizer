import React, { useState, useEffect } from 'react';
import {
  CreditCardIcon,
  CalendarIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  DocumentTextIcon,
  ArrowUpIcon,
  CurrencyDollarIcon,
  ShieldCheckIcon
} from '@heroicons/react/24/outline';

const Billing = () => {
  const [currentUser] = useState({
    id: 'user_123',
    email: 'user@company.com',
    name: 'John Smith'
  });

  const [subscription, setSubscription] = useState({
    plan: 'Professional',
    status: 'active',
    billingCycle: 'monthly',
    amount: 299,
    currency: 'USD',
    nextBilling: '2024-02-15',
    didsUsed: 247,
    didsLimit: 500,
    features: [
      'Up to 500 DIDs',
      'Advanced Rotation',
      'Predictive Analytics',
      'Priority Support',
      'Compliance Features'
    ]
  });

  const [paymentMethod, setPaymentMethod] = useState({
    type: 'paypal',
    email: 'billing@company.com',
    lastFour: '****',
    status: 'verified'
  });

  const [billingHistory] = useState([
    {
      id: 'inv_001',
      date: '2024-01-15',
      amount: 299,
      status: 'paid',
      description: 'DID Optimizer Pro - Professional Plan',
      period: 'Jan 15, 2024 - Feb 14, 2024'
    },
    {
      id: 'inv_002',
      date: '2023-12-15',
      amount: 299,
      status: 'paid',
      description: 'DID Optimizer Pro - Professional Plan',
      period: 'Dec 15, 2023 - Jan 14, 2024'
    },
    {
      id: 'inv_003',
      date: '2023-11-15',
      amount: 299,
      status: 'paid',
      description: 'DID Optimizer Pro - Professional Plan',
      period: 'Nov 15, 2023 - Dec 14, 2024'
    },
    {
      id: 'inv_004',
      date: '2023-10-15',
      amount: 99,
      status: 'paid',
      description: 'DID Optimizer Pro - Starter Plan',
      period: 'Oct 15, 2023 - Nov 14, 2023'
    }
  ]);

  const pricingPlans = [
    {
      name: 'Starter',
      description: 'Perfect for small call centers getting started',
      monthlyPrice: 99,
      yearlyPrice: 990,
      didsLimit: 50,
      features: [
        'Up to 50 DIDs',
        'Basic rotation algorithms',
        'Standard analytics dashboard',
        'Email support',
        'CSV import/export',
        'Basic compliance features',
        'VICIdial API integration',
        '99.5% uptime SLA'
      ]
    },
    {
      name: 'Professional',
      description: 'Ideal for growing businesses',
      monthlyPrice: 299,
      yearlyPrice: 2990,
      didsLimit: 500,
      features: [
        'Up to 500 DIDs',
        'Advanced rotation algorithms',
        'Predictive analytics',
        'Priority support',
        'Compliance features',
        'Multi-carrier support',
        'API webhooks',
        '99.9% uptime SLA'
      ],
      popular: true
    },
    {
      name: 'Enterprise',
      description: 'For large-scale operations',
      monthlyPrice: 'Custom',
      yearlyPrice: 'Custom',
      didsLimit: 'Unlimited',
      features: [
        'Unlimited DIDs',
        'AI-powered optimization',
        'Custom ML models',
        '24/7 dedicated support',
        'API access & webhooks',
        'Custom integrations',
        'Dedicated account manager',
        '99.99% uptime SLA'
      ]
    }
  ];

  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const handlePlanChange = (newPlan) => {
    setSubscription({
      ...subscription,
      plan: newPlan.name,
      amount: newPlan.monthlyPrice === 'Custom' ? 'Custom' : newPlan.monthlyPrice,
      didsLimit: newPlan.didsLimit,
      features: newPlan.features
    });
    setShowPlanModal(false);
    // Here you would integrate with PayPal API to update subscription
  };

  const handlePaymentUpdate = () => {
    // Here you would integrate with PayPal API to update payment method
    setShowPaymentModal(false);
  };

  const initializePayPal = () => {
    // PayPal SDK integration would go here
    console.log('Initializing PayPal SDK...');
  };

  useEffect(() => {
    initializePayPal();
  }, []);

  const getUsagePercentage = () => {
    if (subscription.didsLimit === 'Unlimited') return 0;
    return (subscription.didsUsed / subscription.didsLimit) * 100;
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'text-green-600 bg-green-100';
      case 'past_due': return 'text-red-600 bg-red-100';
      case 'cancelled': return 'text-gray-600 bg-gray-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

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
                <span className={`px-3 py-1 rounded-full text-sm font-medium capitalize ${getStatusColor(subscription.status)}`}>
                  {subscription.status}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center mb-4">
                    <ShieldCheckIcon className="w-8 h-8 text-primary-600 mr-3" />
                    <div>
                      <h3 className="font-semibold text-lg">{subscription.plan} Plan</h3>
                      <p className="text-gray-600">
                        ${subscription.amount}/{subscription.billingCycle === 'yearly' ? 'year' : 'month'}
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    {subscription.features.map((feature, index) => (
                      <div key={index} className="flex items-center text-sm">
                        <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2 flex-shrink-0" />
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">Next billing date</span>
                      <CalendarIcon className="w-4 h-4 text-gray-400" />
                    </div>
                    <p className="font-semibold">{formatDate(subscription.nextBilling)}</p>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-gray-600">DID Usage</span>
                      <ChartBarIcon className="w-4 h-4 text-gray-400" />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{subscription.didsUsed} / {subscription.didsLimit}</span>
                      <span className="text-sm text-gray-500">
                        {subscription.didsLimit !== 'Unlimited' && `${Math.round(getUsagePercentage())}%`}
                      </span>
                    </div>
                    {subscription.didsLimit !== 'Unlimited' && (
                      <div className="mt-2">
                        <div className="bg-gray-200 rounded-full h-2">
                          <div 
                            className={`h-2 rounded-full ${getUsagePercentage() > 80 ? 'bg-red-500' : 'bg-primary-600'}`}
                            style={{ width: `${getUsagePercentage()}%` }}
                          ></div>
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setShowPlanModal(true)}
                    className="w-full btn-primary flex items-center justify-center"
                  >
                    <ArrowUpIcon className="w-4 h-4 mr-2" />
                    Change Plan
                  </button>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Payment Method</h2>
                <button
                  onClick={() => setShowPaymentModal(true)}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  Update
                </button>
              </div>

              <div className="flex items-center">
                <div className="w-12 h-8 bg-blue-600 rounded flex items-center justify-center mr-4">
                  <CreditCardIcon className="w-6 h-6 text-white" />
                </div>
                <div>
                  <p className="font-medium">PayPal</p>
                  <p className="text-sm text-gray-600">{paymentMethod.email}</p>
                  <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                    paymentMethod.status === 'verified' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {paymentMethod.status}
                  </span>
                </div>
              </div>
            </div>

            {/* Billing History */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">Billing History</h2>
                <DocumentTextIcon className="w-5 h-5 text-gray-400" />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {billingHistory.map((invoice) => (
                      <tr key={invoice.id}>
                        <td className="px-4 py-4 text-sm">{formatDate(invoice.date)}</td>
                        <td className="px-4 py-4 text-sm">{invoice.description}</td>
                        <td className="px-4 py-4 text-sm text-gray-600">{invoice.period}</td>
                        <td className="px-4 py-4 text-sm font-medium">${invoice.amount}</td>
                        <td className="px-4 py-4">
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium capitalize ${
                            invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {invoice.status}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <button className="text-primary-600 hover:text-primary-700 text-sm">
                            Download
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Usage Alert */}
            {getUsagePercentage() > 80 && subscription.didsLimit !== 'Unlimited' && (
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

            {/* Quick Actions */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
              <div className="space-y-3">
                <button 
                  onClick={() => setShowPlanModal(true)}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center">
                    <ArrowUpIcon className="w-5 h-5 text-gray-400 mr-3" />
                    <div>
                      <p className="font-medium">Upgrade Plan</p>
                      <p className="text-sm text-gray-600">Get more DIDs and features</p>
                    </div>
                  </div>
                </button>

                <button 
                  onClick={() => setShowPaymentModal(true)}
                  className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center">
                    <CreditCardIcon className="w-5 h-5 text-gray-400 mr-3" />
                    <div>
                      <p className="font-medium">Update Payment</p>
                      <p className="text-sm text-gray-600">Change PayPal account</p>
                    </div>
                  </div>
                </button>

                <a 
                  href="/contact" 
                  className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors block"
                >
                  <div className="flex items-center">
                    <DocumentTextIcon className="w-5 h-5 text-gray-400 mr-3" />
                    <div>
                      <p className="font-medium">Contact Support</p>
                      <p className="text-sm text-gray-600">Get billing assistance</p>
                    </div>
                  </div>
                </a>
              </div>
            </div>

            {/* Next Payment */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-semibold mb-4">Next Payment</h3>
              <div className="text-center">
                <div className="text-3xl font-bold text-primary-600 mb-2">
                  ${subscription.amount}
                </div>
                <p className="text-gray-600 mb-1">Due on {formatDate(subscription.nextBilling)}</p>
                <p className="text-sm text-gray-500">Auto-charged to PayPal</p>
              </div>
            </div>
          </div>
        </div>

        {/* Plan Change Modal */}
        {showPlanModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg max-w-4xl w-full max-h-screen overflow-y-auto">
              <div className="p-6 border-b">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Change Plan</h3>
                  <button
                    onClick={() => setShowPlanModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                </div>
              </div>
              
              <div className="p-6">
                <div className="grid md:grid-cols-3 gap-6">
                  {pricingPlans.map((plan, index) => (
                    <div
                      key={index}
                      className={`border-2 rounded-xl p-6 transition-all ${
                        subscription.plan === plan.name
                          ? 'border-primary-600 bg-primary-50'
                          : plan.popular
                          ? 'border-primary-300 bg-primary-25'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {plan.popular && (
                        <div className="bg-primary-600 text-white px-3 py-1 rounded-full text-sm font-semibold mb-4 text-center">
                          Most Popular
                        </div>
                      )}
                      
                      <div className="text-center mb-6">
                        <h4 className="text-xl font-bold mb-2">{plan.name}</h4>
                        <p className="text-gray-600 mb-4">{plan.description}</p>
                        <div className="text-3xl font-bold text-primary-600">
                          {plan.monthlyPrice === 'Custom' ? 'Custom' : `$${plan.monthlyPrice}`}
                          {plan.monthlyPrice !== 'Custom' && (
                            <span className="text-lg text-gray-500 font-normal">/month</span>
                          )}
                        </div>
                      </div>

                      <ul className="space-y-2 mb-6">
                        {plan.features.map((feature, featureIndex) => (
                          <li key={featureIndex} className="flex items-start text-sm">
                            <CheckCircleIcon className="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>

                      {subscription.plan === plan.name ? (
                        <div className="text-center text-primary-600 font-medium">
                          Current Plan
                        </div>
                      ) : (
                        <button
                          onClick={() => handlePlanChange(plan)}
                          className={`w-full py-2 px-4 rounded-lg font-medium transition-colors ${
                            plan.name === 'Enterprise'
                              ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              : 'bg-primary-600 text-white hover:bg-primary-700'
                          }`}
                        >
                          {plan.name === 'Enterprise' ? 'Contact Sales' : `Select ${plan.name}`}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Payment Update Modal */}
        {showPaymentModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg max-w-md w-full">
              <div className="p-6 border-b">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">Update Payment Method</h3>
                  <button
                    onClick={() => setShowPaymentModal(false)}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    ×
                  </button>
                </div>
              </div>
              
              <div className="p-6">
                <div className="text-center mb-6">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CreditCardIcon className="w-8 h-8 text-blue-600" />
                  </div>
                  <h4 className="text-lg font-semibold mb-2">PayPal Integration</h4>
                  <p className="text-gray-600">
                    Connect your PayPal account for secure monthly billing
                  </p>
                </div>

                <div className="space-y-4">
                  <div id="paypal-button-container">
                    {/* PayPal button would be rendered here */}
                    <button
                      onClick={handlePaymentUpdate}
                      className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 transition-colors"
                    >
                      Connect with PayPal
                    </button>
                  </div>
                  
                  <p className="text-xs text-gray-500 text-center">
                    Your payment information is encrypted and secure. We use PayPal's industry-leading security.
                  </p>
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
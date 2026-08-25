const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const INSTITUTION_CONFIG = {
  kleuters: {
    label: 'Kleuters',
    accountId: "acct_1U3j1hV05DBqyUIY",
    priceCents: Number(process.env.PRICE_KLEUTERS || 17000),
    destinationName: 'Benos Belz',
  },
  lagereSchool: {
    label: 'Lagere School',
    accountId: "acct_1U3j1hV05DBqyUIY",
    priceCents: Number(process.env.PRICE_LAGERE || 18500),
    destinationName: 'Benos Belz',
  },
  middelbar: {
    label: 'Middelbaar',
    accountId: "acct_1U3jruV05FDr8CDq",
    priceCents: Number(process.env.PRICE_MIDDELBAR || 20000),
    destinationName: 'Middelbar',
  },
  mipiOilelim: {
    label: 'Mipi Oilelim',
    accountId: "acct_1U3jjIV05EEmruZj",
    priceCents: Number(process.env.PRICE_MIPI || 22000),
    destinationName: 'Gan',
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { parentName, parentEmail, childrenNames, numChildren = {} } = req.body;
  const selectedInstitutions = Object.entries(INSTITUTION_CONFIG).map(([key, config]) => ({
    key,
    ...config,
    count: Number(numChildren[key] || 0),
  })).filter((institution) => institution.count > 0);

  const num = selectedInstitutions.reduce((total, institution) => total + institution.count, 0);

  if (!num || num < 1 || num > 10 || !parentEmail || !selectedInstitutions.length) {
    return res.status(400).json({ error: 'Ongeldige invoer' });
  }

  const totalCents = selectedInstitutions.reduce(
    (total, institution) => total + (institution.priceCents * institution.count),
    0
  );

  const missingAccountIds = selectedInstitutions
    .filter((institution) => !institution.accountId)
    .map((institution) => institution.label);

  if (missingAccountIds.length) {
    return res.status(500).json({
      error: `Stripe account missing for: ${missingAccountIds.join(', ')}`,
    });
  }

  // September 1st, 2026 Billing Anchor
  const billingAnchor = Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000);

  try {
    // 1. Proactively find or create a Customer on the main platform level
    // This aggregates all their upcoming subscriptions to a unified profile
    let customer;
    const existingCustomers = await stripe.customers.list({ email: parentEmail, limit: 1 });
    
    if (existingCustomers.data.length > 0) {
      customer = existingCustomers.data[0];
    } else {
      customer = await stripe.customers.create({
      email: parentEmail,
      name: parentName,
      metadata: { parentName, childrenNames }
      });
    }

    const checkoutSessions = [];

    for (const institution of selectedInstitutions) {
      // 2. Build the Checkout Session natively on the platform account
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['sepa_debit'],
        mode: 'subscription',
        customer: customer.id, // Explicitly pass the main platform customer ID
        billing_address_collection: 'required',
        locale: 'nl',

        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${institution.label} – ${institution.count} kind${institution.count > 1 ? 'eren' : ''}`,
              description: `Maandelijks schoolgeld | ${institution.destinationName} | Kinderen: ${childrenNames}`,
            },
            unit_amount: institution.priceCents * institution.count,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],

        // FIXED: For subscription mode, transfer rules MUST live inside subscription_data
        subscription_data: {
          billing_cycle_anchor: billingAnchor,
          proration_behavior: 'none',
          transfer_data: {
            destination: institution.accountId, // Automatically routes the monthly payout here!
          },
          metadata: {
            parentName,
            childrenNames,
            institution: institution.label,
            destinationName: institution.destinationName,
            accountId: institution.accountId,
            totalChildren: String(num),
            totalCents: String(totalCents),
            kleuters: String(numChildren.kleuters || 0),
            lagereSchool: String(numChildren.lagereSchool || 0),
            middelbar: String(numChildren.middelbar || 0),
            mipiOilelim: String(numChildren.mipiOilelim || 0),
          },
        },

        success_url: `${req.headers.origin}/success.html`,
        cancel_url: `${req.headers.origin}/`,
      });

      checkoutSessions.push({
        institution: institution.key,
        label: institution.label,
        destinationName: institution.destinationName,
        accountId: institution.accountId,
        url: session.url,
      });
    }

    if (checkoutSessions.length === 1) {
      return res.json({ url: checkoutSessions[0].url, session: checkoutSessions[0] });
    }

    return res.json({ urls: checkoutSessions.map((item) => item.url), sessions: checkoutSessions });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

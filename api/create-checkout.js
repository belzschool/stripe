const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const INSTITUTION_CONFIG = {
  kleuters: {
    label: 'Kleuters',
    accountId: process.env.STRIPE_ACCOUNT_BENOS_BELZ,
    priceCents: Number(process.env.PRICE_KLEUTERS || 17000),
    destinationName: 'Benos Belz',
  },
  lagereSchool: {
    label: 'Lagere School',
    accountId: process.env.STRIPE_ACCOUNT_BENOS_BELZ,
    priceCents: Number(process.env.PRICE_LAGERE || 17000),
    destinationName: 'Benos Belz',
  },
  middelbar: {
    label: 'Middelbaar',
    accountId: process.env.STRIPE_ACCOUNT_MIDDELBAR,
    priceCents: Number(process.env.PRICE_MIDDELBAR || 17000),
    destinationName: 'Middelbar',
  },
  mipiOilelim: {
    label: 'Mipi Oilelim',
    accountId: process.env.STRIPE_ACCOUNT_GAN,
    priceCents: Number(process.env.PRICE_MIPI || 17000),
    destinationName: 'Gan',
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { parentName, parentEmail, childrenNames, numChildren = {} } = req.body;
  const selectedInstitutions = Object.entries(INSTITUTION_CONFIG)
    .map(([key, config]) => ({
      key,
      ...config,
      count: Number(numChildren[key] || 0),
    }))
    .filter((institution) => institution.count > 0);

  const num = selectedInstitutions.reduce((total, institution) => total + institution.count, 0);

  if (!num || num < 1 || num > 10 || !parentEmail || !selectedInstitutions.length) {
    return res.status(400).json({ error: 'Ongeldige invoer' });
  }

  const totalCents = selectedInstitutions.reduce(
    (total, institution) => total + (institution.priceCents * institution.count),
    0
  );

  const billingAnchor = Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000);

  try {
    const checkoutSessions = [];

    for (const institution of selectedInstitutions) {
      if (!institution.accountId) {
        return res.status(500).json({ error: `Stripe account missing for ${institution.label}` });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['sepa_debit'],
        mode: 'subscription',
        customer_email: parentEmail,
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

        payment_intent_data: {
          transfer_data: {
            destination: institution.accountId,
          },
        },

        subscription_data: {
          billing_cycle_anchor: billingAnchor,
          proration_behavior: 'none',
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
};
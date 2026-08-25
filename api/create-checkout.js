const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const contextStripe = stripe.withRequestOptions({
  stripeContext: "org_6VD7dod49CuS5NX9j1v52MS",
});

const STRIPE_ACCOUNT_BENOS_BELZ = "acct_1U3j1hV05DBqyUIY"
const STRIPE_ACCOUNT_MIDDELBAR = "acct_1U3jruV05FDr8CDq"
const STRIPE_ACCOUNT_GAN = "acct_1U3jjIV05EEmruZj"
const STRIPE_ACCOUNT_MAIN = "org_6VD7dod49CuS5NX9j1v52MS"

const INSTITUTION_CONFIG = {
  kleuters: {
    label: 'Kleuters',
    accountId: STRIPE_ACCOUNT_BENOS_BELZ,
    priceCents: Number(17000),
    destinationName: 'Benos Belz',
  },
  lagereSchool: {
    label: 'Lagere School',
    accountId: STRIPE_ACCOUNT_BENOS_BELZ,
    priceCents: Number(18500),
    destinationName: 'Benos Belz',
  },
  middelbar: {
    label: 'Middelbaar',
    accountId: STRIPE_ACCOUNT_MIDDELBAR,
    priceCents: Number(20000),
    destinationName: 'Middelbar',
  },
  mipiOilelim: {
    label: 'Mipi Oilelim',
    accountId: STRIPE_ACCOUNT_GAN,
    priceCents: Number(22000),
    destinationName: 'Gan',
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
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

    const missingAccountIds = selectedInstitutions
      .filter((institution) => !institution.accountId)
      .map((institution) => institution.label);

    if (missingAccountIds.length) {
      return res.status(500).json({
        error: `Stripe-account ontbreekt voor: ${missingAccountIds.join(', ')}`,
      });
    }

    // Billing anchor voor 1 september 2026
    const billingAnchor = Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000);
    const checkoutSessions = [];

    // Loop door elke geselecteerde school en maak de sessie aan BINNEN die specifieke sub-account
    for (const institution of selectedInstitutions) {
      
      // Optie-object om Stripe te vertellen in welk sub-account we werken
      const subAccountOptions = {
        stripeAccount: institution.accountId
      };

      // Zoek of de klant al bestaat BINNEN dit specifieke sub-account
      let customer;
      const existingCustomers = await stripe.customers.list(
        { email: parentEmail, limit: 1 }, 
        subAccountOptions
      );
      
      if (existingCustomers.data && existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0]; 
      } else {
        // Bestaat nog niet? Maak de klant aan in dit specifieke sub-account
        customer = await stripe.customers.create({
          email: parentEmail,
          name: parentName,
          metadata: { parentName, childrenNames }
        }, subAccountOptions);
      }

      // Maak de Checkout Session aan direct binnen het sub-account
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['sepa_debit'],
        mode: 'subscription',
        customer: customer.id, 
        billing_address_collection: 'required',
        locale: 'nl',

        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${institution.label} – ${institution.count} kind${institution.count > 1 ? 'eren' : ''}`,
              description: `Maandelijks schoolgeld | Kinderen: ${childrenNames}`,
            },
            unit_amount: institution.priceCents * institution.count,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        }],

        subscription_data: {
          billing_cycle_anchor: billingAnchor,
          proration_behavior: 'none',
          metadata: {
            parentName,
            childrenNames,
            institution: institution.label,
            totalChildren: String(num),
            totalCents: String(totalCents),
          },
        },

        success_url: `${req.headers.origin}/success.html`,
        cancel_url: `${req.headers.origin}/`,
      }, subAccountOptions); // Foutloos uitgevoerd binnen het juiste sub-account

      checkoutSessions.push({
        institution: institution.key,
        label: institution.label,
        destinationName: institution.destinationName,
        accountId: institution.accountId,
        url: session.url,
      });
    }

    // Geef de link(s) netjes terug aan de frontend queue
    if (checkoutSessions.length === 1) {
      return res.json({ url: checkoutSessions[0].url, session: checkoutSessions[0] });
    }

    return res.json({ urls: checkoutSessions.map((item) => item.url), sessions: checkoutSessions });

  } catch (err) {
    console.error('Stripe handler critical error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
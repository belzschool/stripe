const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const STRIPE_ACCOUNT_BENOS_BELZ = "acct_1U3j1hV05DBqyUIY"
const STRIPE_ACCOUNT_MIDDELBAR = "acct_1U3jruV05FDr8CDq"
const STRIPE_ACCOUNT_GAN = "acct_1U3jjIV05EEmruZj"

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
    priceCents: Number(19000),
    destinationName: 'Benos Belz',
  },
  middelbar: {
    label: 'Middelbaar',
    accountId: STRIPE_ACCOUNT_MIDDELBAR,
    priceCents: Number(25000),
    destinationName: 'Middelbar',
  },
  mipiOilelim: {
    label: 'Mipi Oilelim',
    accountId: STRIPE_ACCOUNT_GAN,
    priceCents: Number(20000),
    destinationName: 'Gan',
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      parentName,
      parentEmail,
      childrenNames,
      invoiceName,
      billingDetails = {},
      numChildren = {},
    } = req.body;

    const billingCountry = String(billingDetails.country || 'BE').toUpperCase();
    const billingStreet = String(billingDetails.street || '').trim();
    const billingPostalCode = String(billingDetails.postalCode || '').trim();
    const billingCity = String(billingDetails.city || '').trim();

    const selectedInstitutions = Object.entries(INSTITUTION_CONFIG)
      .map(([key, config]) => ({
        key,
        ...config,
        count: Number(numChildren[key] || 0),
      }))
      .filter((institution) => institution.count > 0);

    const groupedByAccount = selectedInstitutions.reduce((acc, institution) => {
      const existing = acc[institution.accountId] || {
        accountId: institution.accountId,
        destinationName: institution.destinationName,
        label: institution.destinationName,
        count: 0,
        priceCents: 0,
        metadata: {
          kleuters: 0,
          lagereSchool: 0,
          middelbar: 0,
          mipiOilelim: 0,
        },
      };

      existing.count += institution.count;
      existing.priceCents += institution.priceCents * institution.count;
      existing.metadata[institution.key] = (existing.metadata[institution.key] || 0) + institution.count;
      acc[institution.accountId] = existing;
      return acc;
    }, {});

    const accountGroups = Object.values(groupedByAccount);
    const num = selectedInstitutions.reduce((total, institution) => total + institution.count, 0);

    if (!num || num < 1 || num > 10 || !parentEmail || !accountGroups.length) {
      return res.status(400).json({ error: 'Ongeldige invoer' });
    }

    const totalCents = accountGroups.reduce(
      (total, institution) => total + institution.priceCents,
      0
    );

    const missingAccountIds = accountGroups
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

    for (const institution of accountGroups) {
      const requestOptions = {
        stripeAccount: institution.accountId,
      };

      let customer;
      const existingCustomers = await stripe.customers.list(
        { email: parentEmail, limit: 1 },
        requestOptions
      );

      if (existingCustomers.data && existingCustomers.data.length > 0) {
        customer = existingCustomers.data[0];

        await stripe.customers.update(
          customer.id,
          {
            name: parentName,
            address: {
              line1: billingStreet || undefined,
              city: billingCity || undefined,
              postal_code: billingPostalCode || undefined,
              country: billingCountry,
            },
            metadata: {
              parentName,
              childrenNames,
              invoiceName: invoiceName || parentName,
            },
          },
          requestOptions
        );
      } else {
        customer = await stripe.customers.create({
          email: parentEmail,
          name: parentName,
          address: {
            line1: billingStreet || undefined,
            city: billingCity || undefined,
            postal_code: billingPostalCode || undefined,
            country: billingCountry,
          },
          metadata: {
            parentName,
            childrenNames,
            invoiceName: invoiceName || parentName,
          }
        }, requestOptions);
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['sepa_debit'],
        mode: 'subscription',
        customer: customer.id,
        customer_update: {
          address: 'auto',
          name: 'auto',
        },
        payment_method_collection: 'if_required',
        billing_address_collection: 'required',
        invoice_creation: {
          enabled: true,
        },
        locale: 'nl',

        line_items: [{
          price_data: {
            currency: 'eur',
            product_data: {
              name: `${institution.destinationName} – ${institution.count} kind${institution.count > 1 ? 'eren' : ''}`,
              description: `Maandelijks schoolgeld | Kinderen: ${childrenNames}`,
            },
            unit_amount: institution.priceCents,
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
            institution: institution.destinationName,
            destinationName: institution.destinationName,
            accountId: institution.accountId,
            totalChildren: String(num),
            totalCents: String(totalCents),
            kleuters: String(institution.metadata.kleuters || 0),
            lagereSchool: String(institution.metadata.lagereSchool || 0),
            middelbar: String(institution.metadata.middelbar || 0),
            mipiOilelim: String(institution.metadata.mipiOilelim || 0),
          },
        },

        success_url: `${req.headers.origin}/success.html`,
        cancel_url: `${req.headers.origin}/`,
      }, requestOptions);

      checkoutSessions.push({
        institution: institution.accountId,
        label: institution.destinationName,
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
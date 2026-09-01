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

    // First billing cycle:
    // - before 2026-09-01: create the regular subscription starting on 2026-09-01
    // - on/after 2026-09-01: charge the full September amount immediately and start the recurring cycle on 2026-10-01
    const septemberStart = new Date('2026-09-01T00:00:00Z');
    const octoberStart = new Date('2026-10-01T00:00:00Z');
    const now = new Date();
    const isAfterSeptemberStart = now >= septemberStart;
    const recurringAnchorDate = isAfterSeptemberStart ? octoberStart : septemberStart;
    const recurringBillingAnchor = Math.floor(recurringAnchorDate.getTime() / 1000);
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
            invoiceName: invoiceName || parentName,
          }
        }, requestOptions);
      }

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
            invoiceName: invoiceName || parentName,
          },
        },
        requestOptions
      );

      const recurringSession = isAfterSeptemberStart
        ? null
        : await stripe.checkout.sessions.create({
            payment_method_types: ['sepa_debit'],
            mode: 'subscription',
            customer: customer.id,
            customer_update: {
              address: 'auto',
              name: 'auto',
            },
            payment_method_collection: 'if_required',
            billing_address_collection: 'required',
            locale: 'nl',

            line_items: [{
              price_data: {
                currency: 'eur',
                product_data: {
                  name: `${institution.destinationName} – ${institution.count} kind${institution.count > 1 ? 'eren' : ''}`,
                  description: `Maandelijks schoolgeld`,
                },
                unit_amount: institution.priceCents,
                recurring: { interval: 'month' },
              },
              quantity: 1,
            }],

            subscription_data: {
              billing_cycle_anchor: recurringBillingAnchor,
              proration_behavior: 'none',
              metadata: {
                parentName,
                institution: institution.destinationName,
                destinationName: institution.destinationName,
                accountId: institution.accountId,
                totalChildren: String(num),
                totalCents: String(totalCents),
                firstBillingDate: '2026-09-01',
                recurringStartDate: '2026-09-01',
                billingCycleType: 'standard-september-cycle',
                kleuters: String(institution.metadata.kleuters || 0),
                lagereSchool: String(institution.metadata.lagereSchool || 0),
                middelbar: String(institution.metadata.middelbar || 0),
                mipiOilelim: String(institution.metadata.mipiOilelim || 0),
              },
            },

            success_url: `${req.headers.origin}/success.html`,
            cancel_url: `${req.headers.origin}/`,
          }, requestOptions);

      if (isAfterSeptemberStart) {
        const septemberSession = await stripe.checkout.sessions.create({
          payment_method_types: ['sepa_debit'],
          mode: 'payment',
          customer: customer.id,
          customer_update: {
            address: 'auto',
            name: 'auto',
          },
          billing_address_collection: 'required',
          locale: 'nl',

          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: {
                name: `${institution.destinationName} – September ${institution.count} kind${institution.count > 1 ? 'eren' : ''}`,
                description: `Volledige septemberfactuur`,
              },
              unit_amount: institution.priceCents,
            },
            quantity: 1,
          }],

          metadata: {
            parentName,
            institution: institution.destinationName,
            destinationName: institution.destinationName,
            accountId: institution.accountId,
            totalChildren: String(num),
            totalCents: String(totalCents),
            billingMonth: '2026-09',
            recurringStartDate: '2026-10-01',
            billingCycleType: 'immediate-september-charge-plus-october-cycle',
            kleuters: String(institution.metadata.kleuters || 0),
            lagereSchool: String(institution.metadata.lagereSchool || 0),
            middelbar: String(institution.metadata.middelbar || 0),
            mipiOilelim: String(institution.metadata.mipiOilelim || 0),
          },

          success_url: `${req.headers.origin}/success.html`,
          cancel_url: `${req.headers.origin}/`,
        }, requestOptions);

        checkoutSessions.push({
          institution: institution.accountId,
          label: `${institution.destinationName} – September`,
          destinationName: institution.destinationName,
          accountId: institution.accountId,
          url: septemberSession.url,
          flow: 'immediate-september-payment',
        });

        const subscriptionSession = await stripe.checkout.sessions.create({
          payment_method_types: ['sepa_debit'],
          mode: 'subscription',
          customer: customer.id,
          customer_update: {
            address: 'auto',
            name: 'auto',
          },
          payment_method_collection: 'if_required',
          billing_address_collection: 'required',
          locale: 'nl',

          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: {
                name: `${institution.destinationName} – ${institution.count} kind${institution.count > 1 ? 'eren' : ''}`,
                description: `Maandelijks schoolgeld`,
              },
              unit_amount: institution.priceCents,
              recurring: { interval: 'month' },
            },
            quantity: 1,
          }],

          subscription_data: {
            billing_cycle_anchor: recurringBillingAnchor,
            proration_behavior: 'none',
            metadata: {
              parentName,
              institution: institution.destinationName,
              destinationName: institution.destinationName,
              accountId: institution.accountId,
              totalChildren: String(num),
              totalCents: String(totalCents),
              firstBillingDate: '2026-09-01',
              recurringStartDate: '2026-10-01',
              billingCycleType: 'immediate-september-charge-plus-october-cycle',
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
          label: `${institution.destinationName} – Vanaf oktober`,
          destinationName: institution.destinationName,
          accountId: institution.accountId,
          url: subscriptionSession.url,
          flow: 'recurring-october-subscription',
        });
      } else if (recurringSession) {
        checkoutSessions.push({
          institution: institution.accountId,
          label: institution.destinationName,
          destinationName: institution.destinationName,
          accountId: institution.accountId,
          url: recurringSession.url,
          flow: 'standard-september-subscription',
        });
      }
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
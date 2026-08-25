const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { parentName, parentEmail, childrenNames, numChildren } = req.body;
  const num = parseInt(numChildren);

  if (!num || num < 1 || num > 5 || !parentEmail) {
    return res.status(400).json({ error: 'Ongeldige invoer' });
  }

  const totalCents = 17000 * num; // €170 per kind in centen

  // Vaste factuurdatum: 1 oktober 2026
  const billingAnchor = Math.floor(new Date('2026-10-01T00:00:00Z').getTime() / 1000);

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['sepa_debit'],
      mode: 'subscription',
      customer_email: parentEmail,
      billing_address_collection: 'required',
      locale: 'nl',

      // Maandelijkse terugkerende betaling
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Kleuret School – ${num} kind${num > 1 ? 'eren' : ''}`,
            description: `Maandelijks schoolgeld | Kinderen: ${childrenNames}`,
          },
          unit_amount: totalCents,
          recurring: { interval: 'month' },
        },
        quantity: 1,
      }],

      subscription_data: {
        // Alle abonnementen starten op 1 oktober
        billing_cycle_anchor: billingAnchor,
        proration_behavior: 'none',

        metadata: {
          parentName,
          childrenNames,
          numChildren: String(num),
        },
      },

      success_url: `${req.headers.origin}/success.html`,
      cancel_url: `${req.headers.origin}/`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
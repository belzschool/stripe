---
name: stripe-api-research
description: "Use when researching Stripe API objects, Checkout behavior, subscription rules, Connect account requirements, tax/compliance constraints, currency rules, webhook verification, and any API values or edge cases needed for a production integration."
---

# Stripe API research and integration skill

## Purpose

Use this skill to research Stripe’s official API and turn it into implementation-safe guidance for a project. The goal is to gather the exact object properties, valid values, supported methods, constraints, taxes, currencies, webhook rules, and legal/compliance considerations that affect a Stripe integration.

This is a source-of-truth workflow for integration planning, not a shortcut around the official Stripe docs.

## Outcome

The output should be a concise, decision-ready summary that includes:

- The Stripe product or API surface in scope
- Supported objects, fields, enums, and valid values
- Required/optional properties and constraints
- Country, currency, and payment-method restrictions
- Tax, compliance, and webhook requirements
- Known edge cases, limits, and failure modes
- A practical implementation recommendation for the current project

## Step-by-step workflow

### 1. Define the exact Stripe surface area

Start by identifying the product area under investigation:

- Checkout
- Payment Intents / Charges
- Customers
- Payment Methods
- Subscriptions / Billing
- Invoicing
- Webhooks
- Connect / platform payments
- Tax / compliance
- Currencies and settlement

For each area, write down:

- the API resource or endpoint involved
- the relevant object types
- the payment flow being used (one-time, recurring, marketplace, platform, or custom)
- whether the integration is in test mode or live mode

### 2. Gather the official Stripe documentation

Use Stripe’s docs as the authoritative source, not community examples.

Primary sources to review:

- https://docs.stripe.com/api
- https://docs.stripe.com/payments/checkout
- https://docs.stripe.com/billing
- https://docs.stripe.com/subscriptions
- https://docs.stripe.com/connect
- https://docs.stripe.com/webhooks
- https://docs.stripe.com/tax
- https://docs.stripe.com/currencies
- https://docs.stripe.com/payments/payment-methods/overview

When reviewing docs, capture:

- valid enum values
- required properties
- optional properties and defaults
- nested object shape and constraints
- limitations by country, currency, or product type
- webhook event types and signature rules
- tax, legal, and compliance implications

### 3. Extract valid values and property constraints

Turn raw docs into a structured inventory.

For every relevant object, capture:

- field names
- accepted types
- accepted values or enums
- minimum/maximum values
- relationships to other objects
- required-if conditions
- null/empty behavior
- defaults

Examples to extract for Stripe work:

- `mode`: `payment`, `subscription`, `setup`
- `payment_method_types`: `card`, `sepa_debit`, etc.
- `customer_update`: `auto`, `on_session`, `none`
- `billing_address_collection`: `auto`, `required`, `never`
- `payment_method_collection`: `always`, `if_required`
- `locale`: supported locales for Checkout
- `line_items[].price_data.currency`: lowercase ISO currency codes
- `recurring.interval`: `day`, `week`, `month`, `year`
- `subscription_data.billing_cycle_anchor`: Unix timestamp
- `proration_behavior`: `none`, `create_prorations`, `always_invoice`, etc.

### 4. Record currency, payment-method, and regional rules

Stripe rules are heavily dependent on jurisdiction and payment method.

Always verify:

- country support for a payment method
- bank account or card support for a selected currency
- currency conversion and settlement rules
- minimum charge amounts by currency
- zero-decimal vs two-decimal currencies
- cross-border fees and FX effects
- whether customer or connected account is paying

Important facts to confirm in documentation:

- API amounts are in the minor unit of the currency
- Most currencies are two-decimal; some are zero-decimal
- Currency codes must be lowercase ISO codes
- Some currencies have special rules such as JPY, HUF, ISK, TWD, UGX
- Minimum charge amounts vary by settlement currency and payment method
- Some payment methods are invite-only or region-specific
- Card network and issuer rules can impose stricter limits than Stripe’s general caps

### 5. Review compliance, legal, and operational constraints

Ask: what must the integration be legally and operationally safe for?

Check for:

- tax collection responsibilities
- VAT, GST, and sales-tax rules
- country-specific registrations or thresholds
- PII collection, storage, and billing-address rules
- Stripe account country and business configuration
- Connect account onboarding and verification requirements
- webhook security requirements and raw-body handling
- fraud, dispute, and chargeback workflows
- payout and settlement restrictions

Use Stripe Tax where tax automation is needed. Treat legal compliance as a jurisdiction-specific requirement, not a generic one-size-fits-all rule.

### 6. Validate webhook and security requirements

Stripe webhooks are operationally critical. Verify the implementation against the documentation before shipping.

Required checks:

- The webhook endpoint must receive HTTPS in live mode
- Verify the `Stripe-Signature` header using the endpoint secret
- Do not manipulate the raw request body before signature verification
- Return a successful `2xx` response quickly
- Handle duplicate events by logging or deduplicating `event.id`
- Ignore event order assumptions; event delivery is not guaranteed in order
- Use only the event types needed by the integration

### 7. Translate findings into a project-level decision matrix

Create a matrix like this for each Stripe feature:

- Object / API
- Required fields
- Supported values
- Supported countries / currencies
- Constraints or limits
- Risks or edge cases
- Recommended implementation approach

This prevents generic “Stripe can do it” assumptions from turning into broken production code.

### 8. Write implementation guidance for the project

Turn research into a precise implementation plan:

- which API objects to use
- which fields to send
- which defaults to apply
- which optional fields to omit or validate
- which account configuration is required
- what to monitor after deployment

## Decision points and branching logic

### If the project uses a regular checkout flow

Choose Stripe Checkout when:

- a hosted or embedded payment page is acceptable
- you need fast implementation with strong payment-method support
- subscriptions, customer collection, and tax features are needed

Check:

- `mode`
- `payment_method_types`
- `customer_update`
- `billing_address_collection`
- `subscription_data` vs `line_items`
- locale and success/cancel URLs

### If the project uses recurring subscriptions

Use recurring subscriptions when the customer should be billed repeatedly.

Confirm:

- billing period and anchor date rules
- start date and first billing cycle behavior
- `billing_cycle_anchor`
- `proration_behavior`
- metadata and customer lifecycle tracking
- webhook events like `invoice.paid`, `customer.subscription.updated`, or `checkout.session.completed`

### If the project uses Connect

Use Connect when money must be routed between a platform and connected accounts.

Confirm:

- `stripeAccount` or account-scoped requests
- platform vs connected-account event scopes
- payout and balance behavior
- onboarding and verification requirements
- what events to subscribe to for each account type

### If the project requires tax handling

Use Stripe Tax when tax compliance is a requirement.

Check:

- supported countries and tax calculation coverage
- product tax codes
- customer location and business location
- whether automatic tax is enabled for Checkout or subscriptions

### If the project uses custom webhooks

Use webhooks when asynchronous updates are required for subscription or payment lifecycle events.

Verify:

- endpoint secret and signature validation
- raw-body preservation
- duplicate event handling
- idempotent processing
- timing and retry behavior

## Quality criteria

A Stripe research summary is complete only if it includes all of the following:

- product area clearly scoped
- official docs reviewed and cited
- valid values and object properties extracted
- constraints by country/currency/payment method documented
- webhook or security requirements checked
- tax, compliance, and legal considerations noted
- implementation recommendations are project-specific
- obvious edge cases and failure modes listed

## Stripe-specific facts worth keeping in the research notes

This is a compact checklist of facts you should verify in every integration:

- Stripe uses a base API endpoint at `https://api.stripe.com`
- API requests use standard REST conventions and JSON responses
- Amounts are expressed in minor units for the currency
- Most currencies are two-decimal; some are zero-decimal or special cases
- `payment_method_types` varies by country and account configuration
- `customer_update` and `billing_address_collection` can affect how customer data is saved
- Refunds, subscriptions, proration, taxes, and payment-method support depend on account setup
- Webhooks must be verified; signature validation is mandatory for trust
- Connect requires account-scoped logic and event routing rules
- Stripe Checkout and Stripe Billing integrate well for hosted recurring payments
- Tax compliance is jurisdiction-specific and often needs Stripe Tax or the account’s billing configuration

## Example prompts for this skill

- Research Stripe Checkout subscription rules for a Belgian school billing flow using SEPA Direct Debit and Connect accounts.
- List valid Stripe Checkout session properties, payment method types, currency constraints, and webhook requirements for recurring payments.
- Compare Stripe Checkout vs custom Payment Intents for a marketplace using Connect and multiple currencies.
- Extract all countries, payment methods, and tax constraints relevant to charging customers in Europe.
- Build a decision matrix for Stripe subscriptions, invoices, and webhooks with metadata, billing anchors, and compliance rules.

## Related customizations to create next

- A project-specific Stripe integration instruction file for the workspace
- A Checkout-session prompt for generating valid Stripe session payloads
- A webhook validation prompt for verifying Stripe signatures and deduplicating events
- A tax and compliance checklist for Stripe Billing integrations
- A Connect-account decision guide for marketplace or SaaS platforms

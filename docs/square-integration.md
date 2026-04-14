# Square Integration

This document details how BDC Control Panel integrates with Square. Square is the **payment rail and card vault**. We decide when to charge; Square executes the charge and holds the card data.

---

## 1. APIs we use

| API | Purpose | Phase |
| --- | --- | --- |
| **Customers** | Create/update Square customer records linked to our `customers` table | Phase 1 |
| **Cards** | Store cards on file via Web Payments SDK. We hold only `card_id` tokens | Phase 1 |
| **Payments** | `CreatePayment` to charge cards on file. Used for class packs and gig fees | Phase 1 |
| **Invoices** | Send NET-terms invoices for corporate events | Phase 4 |
| **Webhooks** | Receive `payment.updated`, `card.updated`, `invoice.payment_made`, `dispute.*` | Phase 1 |

## APIs we explicitly DO NOT use

- **Subscriptions** — time-based (monthly). BDC bills per pack of 4 classes (consumption-based). Subscriptions don't fit.
- **Orders / Catalog** — we don't sell items through Square's POS flow. Charges are direct payments.
- **Loyalty** — not in scope.
- **Terminal** — we don't process in-person payments through this system (that stays on the existing Square POS).

---

## 2. Environment setup

### Sandbox vs Production

```
SQUARE_ENVIRONMENT=sandbox    # or 'production'
SQUARE_ACCESS_TOKEN=EAAA...  # sandbox token for dev, production token for live
SQUARE_APPLICATION_ID=sandbox-sq0idb-...
SQUARE_LOCATION_ID=L...
SQUARE_WEBHOOK_SIGNATURE_KEY=...
```

- **Development:** always use sandbox credentials. Sandbox has its own customer/card/payment data that doesn't affect real money.
- **Production:** only switch at cutover. The `SQUARE_ENVIRONMENT` variable controls which Square API base URL is used.
- **Never mix:** sandbox tokens cannot hit production endpoints and vice versa.

### Square SDK setup

```typescript
import { Client, Environment } from "square";

const squareClient = new Client({
  accessToken: process.env.SQUARE_ACCESS_TOKEN!,
  environment:
    process.env.SQUARE_ENVIRONMENT === "production"
      ? Environment.Production
      : Environment.Sandbox,
});

export const {
  customersApi,
  cardsApi,
  paymentsApi,
  invoicesApi,
} = squareClient;
```

This client is used **only in Edge Functions and Server Actions** — never in client-side code.

---

## 3. Customers API

Every BDC student (or corporate client) gets a corresponding Square Customer.

### Creating a customer

```typescript
import { customersApi } from "@/lib/square";

async function createSquareCustomer(student: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
}) {
  const { result } = await customersApi.createCustomer({
    idempotencyKey: `customer-create-${student.email}`,
    givenName: student.firstName,
    familyName: student.lastName,
    emailAddress: student.email,
    phoneNumber: student.phone,
    referenceId: student.email, // links back to our system
  });

  return result.customer!.id; // Square customer ID — store in customers.square_customer_id
}
```

### Linking to our database

When we create a student in `customers`, we also create a Square customer and store the `square_customer_id`:

```sql
update public.customers
set square_customer_id = 'SQ_CUSTOMER_ID_HERE'
where id = 'OUR_CUSTOMER_UUID';
```

---

## 4. Cards on File (Web Payments SDK)

### How card capture works

1. Admin opens the "Add Card" flow for a student in the dashboard.
2. The page renders the **Square Web Payments SDK** card form (an iframe — card data never touches our servers).
3. Parent enters card details in the Square iframe.
4. Square returns a `sourceId` (nonce) to our frontend.
5. Our Server Action sends the nonce to Square's Cards API to create a card on file.
6. We store the returned `card_id` in `square_payment_methods`. We **never** see the full card number.

### Frontend: rendering the card form

```typescript
// Client component — renders Square's card iframe
const payments = await window.Square.payments(
  process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID!,
  process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID!
);

const card = await payments.card();
await card.attach("#card-container"); // renders the secure iframe

// On form submit:
const tokenResult = await card.tokenize();
if (tokenResult.status === "OK") {
  // Send tokenResult.token to our Server Action
  await saveCardOnFile(customerId, tokenResult.token);
}
```

### Server Action: saving the card

```typescript
async function saveCardOnFile(customerId: string, sourceId: string) {
  const customer = await getCustomer(customerId); // fetch from our DB

  const { result } = await cardsApi.createCard({
    idempotencyKey: `card-create-${customerId}-${Date.now()}`,
    sourceId, // the nonce from Web Payments SDK
    card: {
      customerId: customer.square_customer_id!,
    },
  });

  const squareCard = result.card!;

  // Store in our DB — no full card numbers, just the token and display info
  await supabase.from("square_payment_methods").insert({
    customer_id: customerId,
    square_card_id: squareCard.id!,
    card_brand: squareCard.cardBrand,
    last_four: squareCard.last4,
    exp_month: squareCard.expMonth,
    exp_year: squareCard.expYear,
    is_default: true,
  });
}
```

---

## 5. Payments API

### Charging a card on file

This is the core operation — used by the billing worker (classes) and bulk charge (gigs).

```typescript
async function chargeCard(params: {
  customerId: string;        // our customer UUID
  amountCents: number;
  idempotencyKey: string;    // deterministic — prevents double-charges
  description: string;
}) {
  const customer = await getCustomer(params.customerId);
  const paymentMethod = await getDefaultPaymentMethod(params.customerId);

  const { result } = await paymentsApi.createPayment({
    idempotencyKey: params.idempotencyKey,
    sourceId: paymentMethod.square_card_id,
    amountMoney: {
      amount: BigInt(params.amountCents),
      currency: "USD",
    },
    customerId: customer.square_customer_id!,
    locationId: process.env.SQUARE_LOCATION_ID!,
    autocomplete: true,
    note: params.description,
  });

  return {
    paymentId: result.payment!.id!,
    status: result.payment!.status!, // 'COMPLETED', 'FAILED', etc.
  };
}
```

### Error handling

```typescript
try {
  const result = await chargeCard({ ... });

  if (result.status === "COMPLETED") {
    // Insert into charges table with status = 'completed'
  } else {
    // Insert into charges table with status = 'failed' + error details
    // Add to exceptions queue
  }
} catch (error) {
  if (error instanceof ApiError) {
    // Square API error — log error.errors, insert failed charge
    // Common: CARD_DECLINED, CARD_EXPIRED, INSUFFICIENT_FUNDS
  }
  // Add to exceptions queue for admin resolution
}
```

---

## 6. Idempotency key strategy

**Every `CreatePayment` call MUST have a deterministic idempotency key.** If the same key is sent twice, Square returns the original result instead of charging again.

### Key format by module

| Module | Key format | Example |
| --- | --- | --- |
| Classes | `class-{student_id}-pack-{pack_number}` | `class-abc123-pack-7` |
| Gigs | `gig-{gig_id}-student-{student_id}` | `gig-def456-student-abc123` |
| Recitals | `recital-{recital_id}-student-{student_id}-{fee_type}` | `recital-ghi789-student-abc123-costume` |
| Corporate | `corporate-{event_id}-milestone-{milestone_id}` | `corporate-jkl012-milestone-mno345` |

### Why deterministic, not random

Random UUIDs as idempotency keys provide no protection. If a billing worker crashes and restarts, it generates a new random key and charges the student again.

Deterministic keys mean: **the same student + the same pack = the same key, always.** Square deduplicates automatically.

### Key uniqueness constraint

The `charges` table has a `unique` constraint on `idempotency_key`:

```sql
idempotency_key text not null unique
```

This is a second safety layer: even if Square's dedup somehow fails, our database rejects the duplicate insert.

---

## 7. Webhooks

Square sends webhooks to our Edge Function when payment states change.

### Events we subscribe to

| Event | What we do |
| --- | --- |
| `payment.updated` | Update `charges.status` if it differs from what we recorded. Log to audit. |
| `card.updated` | Update `square_payment_methods` if card is disabled or expiring. Flag the student. |
| `invoice.payment_made` | Mark the corporate event milestone as paid. Insert charge. |
| `dispute.created` | Flag the charge as disputed. Alert the admin immediately. |

### Webhook receiver (Edge Function)

```typescript
import { createHmac } from "crypto";

// Verify Square's webhook signature
function verifySignature(
  body: string,
  signature: string,
  webhookUrl: string,
  signatureKey: string
): boolean {
  const hmac = createHmac("sha256", signatureKey);
  hmac.update(webhookUrl + body);
  const expectedSignature = hmac.digest("base64");
  return signature === expectedSignature;
}

// Edge Function handler
export async function handleSquareWebhook(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature")!;

  if (!verifySignature(body, signature, WEBHOOK_URL, SQUARE_WEBHOOK_SIGNATURE_KEY)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(body);

  switch (event.type) {
    case "payment.updated":
      await handlePaymentUpdated(event.data.object.payment);
      break;
    case "card.updated":
      await handleCardUpdated(event.data.object.card);
      break;
    // ... other event types
  }

  return new Response("OK", { status: 200 });
}
```

### Webhook reliability

- Square retries failed webhooks (non-2xx response) for up to 72 hours.
- Our receiver is idempotent — processing the same webhook twice has no side effects.
- If webhooks are missed entirely, the **nightly reconciliation job** catches the discrepancy.

---

## 8. Reconciliation job

The nightly reconciliation job is the safety net. It runs as an Edge Function on a cron schedule.

### Pseudocode

```
1. Fetch all Square payments from the past 24 hours via ListPayments API
2. Fetch all charges from our DB created in the past 24 hours
3. For each Square payment:
   a. Find the matching charges row (by square_payment_id or idempotency_key)
   b. If no match: flag as "unmatched Square payment" → alert
   c. If match but status differs: update our status, log to audit → alert
4. For each charges row with no matching Square payment:
   a. If status is 'completed': flag as "phantom charge" → alert
   b. If status is 'pending' and older than 1 hour: flag as "stuck charge" → alert
5. If zero discrepancies: log success to audit_log
6. Send summary to admin (email or dashboard notification)
```

### Square API call for reconciliation

```typescript
const { result } = await paymentsApi.listPayments({
  beginTime: yesterday.toISOString(),
  endTime: now.toISOString(),
  locationId: process.env.SQUARE_LOCATION_ID!,
});

const squarePayments = result.payments || [];
```

---

## 9. Invoices API (Phase 4 — Corporate Events)

For corporate clients who pay on NET terms (not card on file):

```typescript
async function createSquareInvoice(params: {
  squareCustomerId: string;
  amountCents: number;
  title: string;
  dueDate: string; // YYYY-MM-DD
}) {
  // Create an order first (required by Square Invoices)
  const { result: orderResult } = await ordersApi.createOrder({
    order: {
      locationId: process.env.SQUARE_LOCATION_ID!,
      lineItems: [{
        name: params.title,
        quantity: "1",
        basePriceMoney: {
          amount: BigInt(params.amountCents),
          currency: "USD",
        },
      }],
    },
  });

  // Create the invoice
  const { result } = await invoicesApi.createInvoice({
    invoice: {
      orderId: orderResult.order!.id!,
      locationId: process.env.SQUARE_LOCATION_ID!,
      primaryRecipient: {
        customerId: params.squareCustomerId,
      },
      paymentRequests: [{
        requestType: "BALANCE",
        dueDate: params.dueDate,
      }],
      deliveryMethod: "EMAIL",
      title: params.title,
    },
  });

  // Publish the invoice (sends the email)
  await invoicesApi.publishInvoice(result.invoice!.id!, {
    version: result.invoice!.version!,
  });

  return result.invoice!.id;
}
```

---

## 10. Testing in sandbox

- Square Sandbox provides test card numbers: `4111 1111 1111 1111` (Visa, always succeeds).
- Sandbox payments don't charge real money.
- Sandbox webhooks can be triggered manually from the Square Developer Dashboard.
- Always verify a flow end-to-end in sandbox before switching to production.
- **Production keys are never used during development.** The `SQUARE_ENVIRONMENT` env var controls this.

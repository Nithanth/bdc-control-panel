// @ts-nocheck
// Reconciliation Worker — Supabase Edge Function
// Runs nightly. Compares Square payments from the last 24h to our charges table.
// Flags mismatches for admin review.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SQUARE_BASE_URL =
  Deno.env.get("SQUARE_ENVIRONMENT") === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_LOCATION_ID = Deno.env.get("SQUARE_LOCATION_ID") || "";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const mismatches = [];

  // 1. Fetch Square payments from last 24h
  let squarePayments = [];
  try {
    const res = await fetch(
      `${SQUARE_BASE_URL}/v2/payments?begin_time=${yesterday.toISOString()}&end_time=${now.toISOString()}&location_id=${SQUARE_LOCATION_ID}`,
      {
        headers: {
          "Square-Version": "2024-01-18",
          "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    const data = await res.json();
    squarePayments = data.payments || [];
  } catch (err) {
    await supabase.from("audit_log").insert({
      action: "reconciliation.error",
      table_name: "charges",
      metadata: { error: err.message },
    });
    return Response.json({ error: "Failed to fetch Square payments" }, { status: 500 });
  }

  // 2. Fetch our charges from last 24h
  const { data: ourCharges } = await supabase
    .from("charges")
    .select("id, square_payment_id, idempotency_key, status, amount_cents")
    .gte("created_at", yesterday.toISOString())
    .lte("created_at", now.toISOString());

  const ourChargesByPaymentId = new Map();
  const ourChargesByKey = new Map();
  for (const c of ourCharges || []) {
    if (c.square_payment_id) ourChargesByPaymentId.set(c.square_payment_id, c);
    if (c.idempotency_key) ourChargesByKey.set(c.idempotency_key, c);
  }

  // 3. Check each Square payment against our records
  for (const sp of squarePayments) {
    const match = ourChargesByPaymentId.get(sp.id);

    if (!match) {
      // Unmatched Square payment — could be from the website payment link
      mismatches.push({
        type: "unmatched_square_payment",
        square_payment_id: sp.id,
        amount_cents: Number(sp.amount_money?.amount || 0),
        status: sp.status,
        note: sp.note || "",
      });
      continue;
    }

    // Status mismatch
    const expectedStatus = sp.status === "COMPLETED" ? "completed" : sp.status === "FAILED" ? "failed" : "pending";
    if (match.status !== expectedStatus) {
      mismatches.push({
        type: "status_mismatch",
        charge_id: match.id,
        square_payment_id: sp.id,
        our_status: match.status,
        square_status: sp.status,
      });

      // Auto-fix status
      await supabase
        .from("charges")
        .update({ status: expectedStatus })
        .eq("id", match.id);
    }
  }

  // 4. Check for phantom charges (our record says completed but Square doesn't have it)
  const squarePaymentIds = new Set(squarePayments.map((p) => p.id));
  for (const c of ourCharges || []) {
    if (c.status === "completed" && c.square_payment_id && !squarePaymentIds.has(c.square_payment_id)) {
      mismatches.push({
        type: "phantom_charge",
        charge_id: c.id,
        square_payment_id: c.square_payment_id,
      });
    }
  }

  // 5. Log results
  await supabase.from("audit_log").insert({
    action: "reconciliation.complete",
    table_name: "charges",
    metadata: {
      square_payments_count: squarePayments.length,
      our_charges_count: (ourCharges || []).length,
      mismatches_count: mismatches.length,
      mismatches: mismatches.slice(0, 50), // cap for storage
    },
  });

  return Response.json({
    square_payments: squarePayments.length,
    our_charges: (ourCharges || []).length,
    mismatches_count: mismatches.length,
    mismatches,
  });
});

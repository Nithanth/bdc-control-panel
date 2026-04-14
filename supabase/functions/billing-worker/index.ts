// @ts-nocheck
// Billing Worker — Supabase Edge Function
// NOTE: This file runs in the Deno runtime (Supabase Edge Functions), not Node.
// IDE TypeScript errors for Deno globals are expected and can be ignored.
// Runs on cron (nightly). Charges students who have completed a pack of classes.
//
// Logic:
// 1. Find all active enrollments
// 2. For each, count unbilled present attendance
// 3. While unbilled >= pack_size, charge the card and mark attendance as billed
// 4. Handle errors gracefully (no card, failed charge → exceptions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DRY_RUN = Deno.env.get("BILLING_DRY_RUN") === "true";

const SQUARE_BASE_URL =
  Deno.env.get("SQUARE_ENVIRONMENT") === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

const SQUARE_ACCESS_TOKEN = Deno.env.get("SQUARE_ACCESS_TOKEN") || "";
const SQUARE_LOCATION_ID = Deno.env.get("SQUARE_LOCATION_ID") || "";

interface BillingResult {
  enrollmentId: string;
  customerId: string;
  action: "charged" | "no_card" | "failed" | "skipped";
  amountCents?: number;
  error?: string;
}

Deno.serve(async (req) => {
  // Only allow POST (from cron) or manual trigger
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: BillingResult[] = [];

  // 1. Get all active enrollments
  const { data: enrollments, error: enrollError } = await supabase
    .from("enrollments")
    .select("id, customer_id, class_name, pack_size, rate_cents, current_pack, classes_in_pack")
    .eq("status", "active");

  if (enrollError) {
    return new Response(JSON.stringify({ error: enrollError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  for (const enrollment of enrollments || []) {
    // 2. Count unbilled present attendance
    const { count: unbilledCount } = await supabase
      .from("attendance")
      .select("id", { count: "exact", head: true })
      .eq("enrollment_id", enrollment.id)
      .eq("status", "present")
      .eq("billed", false);

    const unbilled = unbilledCount || 0;

    if (unbilled < enrollment.pack_size) {
      results.push({
        enrollmentId: enrollment.id,
        customerId: enrollment.customer_id,
        action: "skipped",
      });
      continue;
    }

    // 3. Check for valid card
    const { data: paymentMethod } = await supabase
      .from("square_payment_methods")
      .select("square_card_id")
      .eq("customer_id", enrollment.customer_id)
      .eq("is_default", true)
      .eq("active", true)
      .single();

    if (!paymentMethod) {
      results.push({
        enrollmentId: enrollment.id,
        customerId: enrollment.customer_id,
        action: "no_card",
        error: `Student has ${unbilled} unbilled classes but no card on file`,
      });
      continue;
    }

    // Get Square customer ID
    const { data: customer } = await supabase
      .from("customers")
      .select("square_customer_id, first_name, last_name")
      .eq("id", enrollment.customer_id)
      .single();

    if (!customer?.square_customer_id) {
      results.push({
        enrollmentId: enrollment.id,
        customerId: enrollment.customer_id,
        action: "no_card",
        error: "Customer not synced to Square",
      });
      continue;
    }

    // 4. Charge in pack-sized batches
    let remainingUnbilled = unbilled;
    let currentPack = enrollment.current_pack;

    while (remainingUnbilled >= enrollment.pack_size) {
      const idempotencyKey = `class-${enrollment.customer_id}-pack-${currentPack}`;
      const description = `${enrollment.class_name} — Pack ${currentPack} (${enrollment.pack_size} classes) for ${customer.first_name} ${customer.last_name}`;

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would charge ${enrollment.rate_cents} cents with key ${idempotencyKey}`);
        results.push({
          enrollmentId: enrollment.id,
          customerId: enrollment.customer_id,
          action: "skipped",
          amountCents: enrollment.rate_cents,
        });
        currentPack++;
        remainingUnbilled -= enrollment.pack_size;
        continue;
      }

      try {
        // Call Square Payments API
        const paymentResponse = await fetch(`${SQUARE_BASE_URL}/v2/payments`, {
          method: "POST",
          headers: {
            "Square-Version": "2024-01-18",
            "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            idempotency_key: idempotencyKey,
            source_id: paymentMethod.square_card_id,
            amount_money: {
              amount: enrollment.rate_cents,
              currency: "USD",
            },
            customer_id: customer.square_customer_id,
            location_id: SQUARE_LOCATION_ID,
            autocomplete: true,
            note: description,
          }),
        });

        const paymentData = await paymentResponse.json();

        if (!paymentResponse.ok || paymentData.errors) {
          const errorMsg = paymentData.errors?.[0]?.detail || "Square payment failed";

          // Record failed charge
          await supabase.from("charges").insert({
            customer_id: enrollment.customer_id,
            amount_cents: enrollment.rate_cents,
            currency: "USD",
            source_module: "classes",
            source_id: enrollment.id,
            description,
            idempotency_key: idempotencyKey,
            status: "failed",
            error_detail: paymentData.errors || { error: errorMsg },
          });

          results.push({
            enrollmentId: enrollment.id,
            customerId: enrollment.customer_id,
            action: "failed",
            amountCents: enrollment.rate_cents,
            error: errorMsg,
          });

          // Don't block other packs / students
          break;
        }

        const payment = paymentData.payment;

        // Insert charge record
        const { data: charge } = await supabase
          .from("charges")
          .insert({
            customer_id: enrollment.customer_id,
            amount_cents: enrollment.rate_cents,
            currency: "USD",
            source_module: "classes",
            source_id: enrollment.id,
            description,
            idempotency_key: idempotencyKey,
            square_payment_id: payment.id,
            status: payment.status === "COMPLETED" ? "completed" : "pending",
          })
          .select()
          .single();

        // Mark attendance as billed
        const { data: unbilledRows } = await supabase
          .from("attendance")
          .select("id")
          .eq("enrollment_id", enrollment.id)
          .eq("status", "present")
          .eq("billed", false)
          .order("class_date", { ascending: true })
          .limit(enrollment.pack_size);

        if (unbilledRows) {
          const ids = unbilledRows.map((r) => r.id);
          await supabase
            .from("attendance")
            .update({ billed: true, charge_id: charge?.id })
            .in("id", ids);
        }

        // Update enrollment pack counters
        currentPack++;
        remainingUnbilled -= enrollment.pack_size;

        await supabase
          .from("enrollments")
          .update({
            current_pack: currentPack,
            classes_in_pack: remainingUnbilled,
          })
          .eq("id", enrollment.id);

        // Audit log
        await supabase.from("audit_log").insert({
          action: "billing.charged",
          table_name: "charges",
          record_id: charge?.id,
          new_data: {
            enrollment_id: enrollment.id,
            pack: currentPack - 1,
            amount_cents: enrollment.rate_cents,
            square_payment_id: payment.id,
          },
        });

        results.push({
          enrollmentId: enrollment.id,
          customerId: enrollment.customer_id,
          action: "charged",
          amountCents: enrollment.rate_cents,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        results.push({
          enrollmentId: enrollment.id,
          customerId: enrollment.customer_id,
          action: "failed",
          amountCents: enrollment.rate_cents,
          error: errorMsg,
        });
        break;
      }
    }
  }

  // Summary audit log
  const charged = results.filter((r) => r.action === "charged");
  const failed = results.filter((r) => r.action === "failed");
  const noCard = results.filter((r) => r.action === "no_card");

  await supabase.from("audit_log").insert({
    action: "billing.run_complete",
    table_name: "charges",
    metadata: {
      dry_run: DRY_RUN,
      total_enrollments: enrollments?.length || 0,
      charged: charged.length,
      failed: failed.length,
      no_card: noCard.length,
      skipped: results.filter((r) => r.action === "skipped").length,
      total_charged_cents: charged.reduce((sum, r) => sum + (r.amountCents || 0), 0),
    },
  });

  return new Response(
    JSON.stringify({
      dry_run: DRY_RUN,
      summary: {
        total: enrollments?.length || 0,
        charged: charged.length,
        failed: failed.length,
        no_card: noCard.length,
      },
      results,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});

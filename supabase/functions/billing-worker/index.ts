// @ts-nocheck
// Billing Worker — Supabase Edge Function
// NOTE: This file runs in the Deno runtime (Supabase Edge Functions), not Node.
//
// Two modes per enrollment:
//   billing_mode = 'auto'   → auto-charge card on file when pack completes
//   billing_mode = 'manual' → add to billing_queue as 'due', admin decides
//
// Runs on cron (nightly) or manual POST trigger.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const DRY_RUN = Deno.env.get("BILLING_DRY_RUN") === "true";

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

  const summary = { queued: 0, charged: 0, failed: 0, no_card: 0, skipped: 0 };
  const details = [];

  // 1. Get all active enrollments with billing_mode
  const { data: enrollments, error: enrollError } = await supabase
    .from("enrollments")
    .select("id, customer_id, class_name, pack_size, rate_cents, current_pack, classes_in_pack, billing_mode")
    .eq("status", "active");

  if (enrollError) {
    return Response.json({ error: enrollError.message }, { status: 500 });
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
      summary.skipped++;
      continue;
    }

    // Get customer info
    const { data: customer } = await supabase
      .from("customers")
      .select("square_customer_id, first_name, last_name")
      .eq("id", enrollment.customer_id)
      .single();

    let remainingUnbilled = unbilled;
    let currentPack = enrollment.current_pack;

    while (remainingUnbilled >= enrollment.pack_size) {
      const packNumber = currentPack;
      const description = `${enrollment.class_name} — Pack ${packNumber} (${enrollment.pack_size} classes) for ${customer?.first_name || "?"} ${customer?.last_name || "?"}`;

      // ── MANUAL MODE: just queue it ──
      if (enrollment.billing_mode === "manual") {
        // Check if already queued (idempotent)
        const { data: existing } = await supabase
          .from("billing_queue")
          .select("id")
          .eq("enrollment_id", enrollment.id)
          .eq("pack_number", packNumber)
          .single();

        if (!existing) {
          await supabase.from("billing_queue").insert({
            enrollment_id: enrollment.id,
            customer_id: enrollment.customer_id,
            pack_number: packNumber,
            amount_cents: enrollment.rate_cents,
            status: "due",
          });

          details.push({ enrollment_id: enrollment.id, pack: packNumber, action: "queued" });
          summary.queued++;
        }

        currentPack++;
        remainingUnbilled -= enrollment.pack_size;
        continue;
      }

      // ── AUTO MODE: charge the card ──

      // Need card on file
      const { data: paymentMethod } = await supabase
        .from("square_payment_methods")
        .select("square_card_id")
        .eq("customer_id", enrollment.customer_id)
        .eq("is_default", true)
        .eq("active", true)
        .single();

      if (!paymentMethod || !customer?.square_customer_id) {
        // No card → queue as due instead of silently failing
        await supabase.from("billing_queue").upsert({
          enrollment_id: enrollment.id,
          customer_id: enrollment.customer_id,
          pack_number: packNumber,
          amount_cents: enrollment.rate_cents,
          status: "due",
          notes: "Auto-charge failed: no card on file",
        }, { onConflict: "enrollment_id,pack_number" });

        details.push({ enrollment_id: enrollment.id, pack: packNumber, action: "no_card" });
        summary.no_card++;
        break;
      }

      if (DRY_RUN) {
        console.log(`[DRY RUN] Would charge ${enrollment.rate_cents}c key=class-${enrollment.customer_id}-pack-${packNumber}`);
        currentPack++;
        remainingUnbilled -= enrollment.pack_size;
        summary.skipped++;
        continue;
      }

      const idempotencyKey = `class-${enrollment.customer_id}-pack-${packNumber}`;

      try {
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
            amount_money: { amount: enrollment.rate_cents, currency: "USD" },
            customer_id: customer.square_customer_id,
            location_id: SQUARE_LOCATION_ID,
            autocomplete: true,
            note: description,
          }),
        });

        const paymentData = await paymentResponse.json();

        if (!paymentResponse.ok || paymentData.errors) {
          const errorMsg = paymentData.errors?.[0]?.detail || "Square payment failed";

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

          await supabase.from("billing_queue").upsert({
            enrollment_id: enrollment.id,
            customer_id: enrollment.customer_id,
            pack_number: packNumber,
            amount_cents: enrollment.rate_cents,
            status: "failed",
            notes: errorMsg,
          }, { onConflict: "enrollment_id,pack_number" });

          details.push({ enrollment_id: enrollment.id, pack: packNumber, action: "failed", error: errorMsg });
          summary.failed++;
          break;
        }

        const payment = paymentData.payment;

        // Record charge
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
          await supabase
            .from("attendance")
            .update({ billed: true, charge_id: charge?.id })
            .in("id", unbilledRows.map((r) => r.id));
        }

        // Mark billing queue as paid
        await supabase.from("billing_queue").upsert({
          enrollment_id: enrollment.id,
          customer_id: enrollment.customer_id,
          pack_number: packNumber,
          amount_cents: enrollment.rate_cents,
          status: "paid",
          charge_id: charge?.id,
          paid_at: new Date().toISOString(),
        }, { onConflict: "enrollment_id,pack_number" });

        currentPack++;
        remainingUnbilled -= enrollment.pack_size;

        await supabase.from("enrollments").update({
          current_pack: currentPack,
          classes_in_pack: remainingUnbilled,
        }).eq("id", enrollment.id);

        await supabase.from("audit_log").insert({
          action: "billing.charged",
          table_name: "charges",
          record_id: charge?.id,
          new_data: { enrollment_id: enrollment.id, pack: packNumber, amount_cents: enrollment.rate_cents },
        });

        details.push({ enrollment_id: enrollment.id, pack: packNumber, action: "charged" });
        summary.charged++;
      } catch (err) {
        details.push({ enrollment_id: enrollment.id, pack: packNumber, action: "failed", error: err.message });
        summary.failed++;
        break;
      }
    }
  }

  // Summary audit log
  await supabase.from("audit_log").insert({
    action: "billing.run_complete",
    table_name: "billing_queue",
    metadata: { dry_run: DRY_RUN, ...summary },
  });

  return Response.json({ dry_run: DRY_RUN, summary, details });
});

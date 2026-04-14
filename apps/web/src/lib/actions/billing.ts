"use server";

import { createClient } from "@/lib/supabase/server";
import { squareClient } from "@/lib/square";
import { revalidatePath } from "next/cache";

// ── Manual charge from billing queue ─────────────────

export async function chargeFromQueue(queueItemId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: item } = await supabase
    .from("billing_queue")
    .select("*, enrollments(class_name, pack_size), customers(first_name, last_name, square_customer_id)")
    .eq("id", queueItemId)
    .single();

  if (!item) throw new Error("Billing queue item not found");
  if (item.status === "paid") throw new Error("Already paid");

  const customer = item.customers;
  const enrollment = item.enrollments;

  // Get card on file
  const { data: paymentMethod } = await supabase
    .from("square_payment_methods")
    .select("square_card_id")
    .eq("customer_id", item.customer_id)
    .eq("is_default", true)
    .eq("active", true)
    .single();

  if (!paymentMethod || !customer?.square_customer_id) {
    throw new Error("No card on file. Student must pay via payment link.");
  }

  const idempotencyKey = `class-${item.customer_id}-pack-${item.pack_number}`;
  const description = `${enrollment?.class_name || "Class"} — Pack ${item.pack_number} for ${customer?.first_name} ${customer?.last_name}`;

  const response = await squareClient.payments.create({
    idempotencyKey,
    sourceId: paymentMethod.square_card_id,
    amountMoney: {
      amount: BigInt(item.amount_cents),
      currency: "USD",
    },
    customerId: customer.square_customer_id,
    locationId: process.env.SQUARE_LOCATION_ID!,
    autocomplete: true,
    note: description,
  });

  const payment = response.payment!;

  // Record charge
  const { data: charge } = await supabase
    .from("charges")
    .insert({
      customer_id: item.customer_id,
      amount_cents: item.amount_cents,
      currency: "USD",
      source_module: "classes",
      source_id: item.enrollment_id,
      description,
      idempotency_key: idempotencyKey,
      square_payment_id: payment.id,
      status: payment.status === "COMPLETED" ? "completed" : "pending",
    })
    .select()
    .single();

  // Update queue item
  await supabase
    .from("billing_queue")
    .update({
      status: "paid",
      charge_id: charge?.id,
      paid_at: new Date().toISOString(),
    })
    .eq("id", queueItemId);

  // Mark attendance as billed
  const { data: unbilledRows } = await supabase
    .from("attendance")
    .select("id")
    .eq("enrollment_id", item.enrollment_id)
    .eq("status", "present")
    .eq("billed", false)
    .order("class_date", { ascending: true })
    .limit(enrollment?.pack_size || 4);

  if (unbilledRows) {
    await supabase
      .from("attendance")
      .update({ billed: true, charge_id: charge?.id })
      .in("id", unbilledRows.map((r: { id: string }) => r.id));
  }

  // Audit log
  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "billing.manual_charge",
    table_name: "billing_queue",
    record_id: queueItemId,
    new_data: { charge_id: charge?.id, amount_cents: item.amount_cents },
  });

  revalidatePath("/dashboard/billing");
  revalidatePath(`/dashboard/students/${item.customer_id}`);
}

// ── Mark as paid externally (e.g., paid via payment link) ──

export async function markQueueItemPaid(queueItemId: string, notes?: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: item } = await supabase
    .from("billing_queue")
    .select("*")
    .eq("id", queueItemId)
    .single();

  if (!item) throw new Error("Billing queue item not found");

  await supabase
    .from("billing_queue")
    .update({
      status: "paid",
      paid_at: new Date().toISOString(),
      notes: notes || "Marked paid by admin (external payment)",
    })
    .eq("id", queueItemId);

  // Mark attendance as billed
  const { data: unbilledRows } = await supabase
    .from("attendance")
    .select("id")
    .eq("enrollment_id", item.enrollment_id)
    .eq("status", "present")
    .eq("billed", false)
    .order("class_date", { ascending: true })
    .limit(4);

  if (unbilledRows) {
    await supabase
      .from("attendance")
      .update({ billed: true })
      .in("id", unbilledRows.map((r: { id: string }) => r.id));
  }

  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "billing.marked_paid",
    table_name: "billing_queue",
    record_id: queueItemId,
    new_data: { notes },
  });

  revalidatePath("/dashboard/billing");
}

// ── Waive a pack (e.g., comp, trial, etc.) ───────────

export async function waiveQueueItem(queueItemId: string, reason: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  await supabase
    .from("billing_queue")
    .update({
      status: "waived",
      notes: reason,
      paid_at: new Date().toISOString(),
    })
    .eq("id", queueItemId);

  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "billing.waived",
    table_name: "billing_queue",
    record_id: queueItemId,
    new_data: { reason },
  });

  revalidatePath("/dashboard/billing");
}

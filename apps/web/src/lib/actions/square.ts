"use server";

import { createClient } from "@/lib/supabase/server";
import { squareClient } from "@/lib/square";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

// ── Customer sync ────────────────────────────────────

export async function syncCustomerToSquare(customerId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .single();

  if (!customer) throw new Error("Customer not found");
  if (customer.square_customer_id) return customer.square_customer_id as string;

  const response = await squareClient.customers.create({
    idempotencyKey: `customer-create-${customerId}`,
    givenName: customer.first_name,
    familyName: customer.last_name,
    emailAddress: customer.email || undefined,
    phoneNumber: customer.phone || undefined,
    referenceId: customerId,
  });

  const squareCustomerId = response.customer!.id!;

  await supabase
    .from("customers")
    .update({ square_customer_id: squareCustomerId })
    .eq("id", customerId);

  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "customer.synced_to_square",
    table_name: "customers",
    record_id: customerId,
    new_data: { square_customer_id: squareCustomerId },
  });

  revalidatePath(`/dashboard/students/${customerId}`);
  return squareCustomerId;
}

// ── Card on file ─────────────────────────────────────

export async function saveCardOnFile(customerId: string, sourceId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Ensure customer is synced to Square first
  const squareCustomerId = await syncCustomerToSquare(customerId);

  const response = await squareClient.cards.create({
    idempotencyKey: `card-create-${customerId}-${Date.now()}`,
    sourceId,
    card: {
      customerId: squareCustomerId,
    },
  });

  const squareCard = response.card!;

  // Mark any existing cards as non-default
  await supabase
    .from("square_payment_methods")
    .update({ is_default: false })
    .eq("customer_id", customerId);

  const { data: savedCard, error } = await supabase
    .from("square_payment_methods")
    .insert({
      customer_id: customerId,
      square_card_id: squareCard.id!,
      card_brand: squareCard.cardBrand || "UNKNOWN",
      last_four: squareCard.last4 || "????",
      exp_month: squareCard.expMonth || 0,
      exp_year: squareCard.expYear || 0,
      is_default: true,
      active: true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.from("audit_log").insert({
    user_id: user?.id,
    action: "card.saved",
    table_name: "square_payment_methods",
    record_id: savedCard.id,
    new_data: { card_brand: squareCard.cardBrand, last_four: squareCard.last4 },
  });

  revalidatePath(`/dashboard/students/${customerId}`);
  redirect(`/dashboard/students/${customerId}`);
}

// ── Charge a card ────────────────────────────────────

export async function chargeCard(params: {
  customerId: string;
  amountCents: number;
  idempotencyKey: string;
  description: string;
  sourceModule: string;
  sourceId: string;
}) {
  const supabase = createClient();

  // Get customer + default payment method
  const { data: customer } = await supabase
    .from("customers")
    .select("square_customer_id")
    .eq("id", params.customerId)
    .single();

  if (!customer?.square_customer_id) {
    throw new Error("Customer has no Square account");
  }

  const { data: paymentMethod } = await supabase
    .from("square_payment_methods")
    .select("square_card_id")
    .eq("customer_id", params.customerId)
    .eq("is_default", true)
    .eq("active", true)
    .single();

  if (!paymentMethod) {
    throw new Error("Customer has no active payment method");
  }

  try {
    const response = await squareClient.payments.create({
      idempotencyKey: params.idempotencyKey,
      sourceId: paymentMethod.square_card_id,
      amountMoney: {
        amount: BigInt(params.amountCents),
        currency: "USD",
      },
      customerId: customer.square_customer_id,
      locationId: process.env.SQUARE_LOCATION_ID!,
      autocomplete: true,
      note: params.description,
    });

    const payment = response.payment!;

    // Insert charge record
    const { data: charge } = await supabase
      .from("charges")
      .insert({
        customer_id: params.customerId,
        amount_cents: params.amountCents,
        currency: "USD",
        source_module: params.sourceModule,
        source_id: params.sourceId,
        description: params.description,
        idempotency_key: params.idempotencyKey,
        square_payment_id: payment.id,
        status: payment.status === "COMPLETED" ? "completed" : "failed",
      })
      .select()
      .single();

    return { chargeId: charge?.id, paymentId: payment.id, status: payment.status };
  } catch (err: unknown) {
    // Record failed charge
    const errorMessage = err instanceof Error ? err.message : "Unknown Square error";

    const { data: charge } = await supabase
      .from("charges")
      .insert({
        customer_id: params.customerId,
        amount_cents: params.amountCents,
        currency: "USD",
        source_module: params.sourceModule,
        source_id: params.sourceId,
        description: params.description,
        idempotency_key: params.idempotencyKey,
        status: "failed",
        error_detail: { error: errorMessage },
      })
      .select()
      .single();

    return { chargeId: charge?.id, paymentId: null, status: "FAILED", error: errorMessage };
  }
}

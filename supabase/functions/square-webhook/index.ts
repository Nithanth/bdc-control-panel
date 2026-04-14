// @ts-nocheck
// Square Webhook Receiver — Supabase Edge Function
// Receives webhook POSTs from Square, verifies HMAC signature,
// and updates charge/card status in our DB.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const WEBHOOK_SIGNATURE_KEY = Deno.env.get("SQUARE_WEBHOOK_SIGNATURE_KEY") || "";
const WEBHOOK_URL = Deno.env.get("SQUARE_WEBHOOK_URL") || "";

function verifySignature(body, signature, url, key) {
  const hmac = createHmac("sha256", key);
  hmac.update(url + body);
  const expected = hmac.digest("base64");
  return signature === expected;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = await req.text();
  const signature = req.headers.get("x-square-hmacsha256-signature") || "";

  if (!verifySignature(body, signature, WEBHOOK_URL, WEBHOOK_SIGNATURE_KEY)) {
    return new Response("Invalid signature", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  const event = JSON.parse(body);
  const eventType = event.type;

  try {
    switch (eventType) {
      case "payment.updated": {
        const payment = event.data?.object?.payment;
        if (!payment?.id) break;

        // Find our charge by square_payment_id
        const { data: charge } = await supabase
          .from("charges")
          .select("id, status")
          .eq("square_payment_id", payment.id)
          .single();

        if (charge && charge.status !== mapPaymentStatus(payment.status)) {
          const oldStatus = charge.status;
          const newStatus = mapPaymentStatus(payment.status);

          await supabase
            .from("charges")
            .update({ status: newStatus })
            .eq("id", charge.id);

          // If payment completed, update billing queue too
          if (newStatus === "completed") {
            await supabase
              .from("billing_queue")
              .update({ status: "paid", paid_at: new Date().toISOString() })
              .eq("charge_id", charge.id);
          }

          await supabase.from("audit_log").insert({
            action: "webhook.payment_updated",
            table_name: "charges",
            record_id: charge.id,
            old_data: { status: oldStatus },
            new_data: { status: newStatus, square_status: payment.status },
          });
        }
        break;
      }

      case "card.disabled":
      case "card.updated": {
        const card = event.data?.object?.card;
        if (!card?.id) break;

        const { data: pm } = await supabase
          .from("square_payment_methods")
          .select("id, active")
          .eq("square_card_id", card.id)
          .single();

        if (pm) {
          const isActive = card.enabled !== false;
          if (pm.active !== isActive) {
            await supabase
              .from("square_payment_methods")
              .update({ active: isActive })
              .eq("id", pm.id);

            await supabase.from("audit_log").insert({
              action: "webhook.card_updated",
              table_name: "square_payment_methods",
              record_id: pm.id,
              new_data: { active: isActive, square_card_id: card.id },
            });
          }
        }
        break;
      }

      default:
        // Log unhandled event types for visibility
        await supabase.from("audit_log").insert({
          action: `webhook.unhandled`,
          table_name: "audit_log",
          metadata: { event_type: eventType },
        });
    }
  } catch (err) {
    await supabase.from("audit_log").insert({
      action: "webhook.error",
      table_name: "audit_log",
      metadata: { event_type: eventType, error: err.message },
    });
  }

  // Always return 200 so Square doesn't retry
  return new Response("OK", { status: 200 });
});

function mapPaymentStatus(squareStatus) {
  switch (squareStatus) {
    case "COMPLETED": return "completed";
    case "FAILED": return "failed";
    case "CANCELED": return "cancelled";
    default: return "pending";
  }
}

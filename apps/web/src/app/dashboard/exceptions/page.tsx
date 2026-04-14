import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export default async function ExceptionsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Failed charges
  const { data: failedCharges } = await supabase
    .from("charges")
    .select("*, customers(first_name, last_name)")
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(50);

  // Students without Square account
  const { data: noSquare } = await supabase
    .from("customers")
    .select("id, first_name, last_name, email")
    .is("square_customer_id", null)
    .eq("active", true);

  // Cards expiring within 30 days
  const now = new Date();
  const expMonth = now.getMonth() + 1;
  const expYear = now.getFullYear();
  // Cards expiring this month or already expired
  const { data: expiringCards } = await supabase
    .from("square_payment_methods")
    .select("*, customers(first_name, last_name)")
    .eq("active", true)
    .or(`exp_year.lt.${expYear},and(exp_year.eq.${expYear},exp_month.lte.${expMonth + 1})`);

  // Recent reconciliation mismatches from audit_log
  const { data: reconLogs } = await supabase
    .from("audit_log")
    .select("*")
    .eq("action", "reconciliation.complete")
    .order("created_at", { ascending: false })
    .limit(1);

  const lastRecon = reconLogs?.[0];
  const reconMismatches = lastRecon?.metadata?.mismatches || [];

  const totalExceptions =
    (failedCharges?.length || 0) +
    (noSquare?.length || 0) +
    (expiringCards?.length || 0) +
    reconMismatches.length;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Exceptions</h2>
        {totalExceptions > 0 && (
          <Badge variant="destructive">{totalExceptions}</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Items requiring admin attention: failed charges, missing cards, expiring cards, reconciliation mismatches.
      </p>

      {totalExceptions === 0 && (
        <div className="mt-8 rounded-lg border p-8 text-center text-muted-foreground">
          <p className="text-lg">No exceptions!</p>
          <p className="text-sm mt-1">Everything is running smoothly.</p>
        </div>
      )}

      {/* Failed Charges */}
      {failedCharges && failedCharges.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-red-700">
            Failed Charges ({failedCharges.length})
          </h3>
          <div className="mt-3 space-y-2">
            {failedCharges.map((charge) => (
              <div key={charge.id} className="flex items-center justify-between rounded-lg border border-red-200 p-4">
                <div>
                  <p className="font-medium">
                    {charge.customers?.first_name} {charge.customers?.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {charge.description || "No description"}
                  </p>
                  <p className="text-sm font-medium">${(charge.amount_cents / 100).toFixed(2)}</p>
                  {charge.error_detail && (
                    <p className="text-xs text-destructive mt-1">
                      {typeof charge.error_detail === "object"
                        ? JSON.stringify(charge.error_detail)
                        : charge.error_detail}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">Failed</Badge>
                  <Link
                    href={`/dashboard/students/${charge.customer_id}`}
                    className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
                  >
                    View Student
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Students Not Synced to Square */}
      {noSquare && noSquare.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-yellow-700">
            Students Not Synced to Square ({noSquare.length})
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            These students have no Square customer ID. Sync them before charging.
          </p>
          <div className="mt-3 space-y-2">
            {noSquare.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-yellow-200 p-4">
                <div>
                  <p className="font-medium">{s.first_name} {s.last_name}</p>
                  {s.email && <p className="text-sm text-muted-foreground">{s.email}</p>}
                </div>
                <Link
                  href={`/dashboard/students/${s.id}`}
                  className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
                >
                  Sync &rarr;
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiring Cards */}
      {expiringCards && expiringCards.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-orange-700">
            Expiring / Expired Cards ({expiringCards.length})
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            Cards expiring soon or already expired. Have parents update their card.
          </p>
          <div className="mt-3 space-y-2">
            {expiringCards.map((pm) => (
              <div key={pm.id} className="flex items-center justify-between rounded-lg border border-orange-200 p-4">
                <div className="flex items-center gap-3">
                  <span className="text-lg">💳</span>
                  <div>
                    <p className="font-medium">
                      {pm.customers?.first_name} {pm.customers?.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {pm.card_brand} ending in {pm.last_four} — expires {pm.exp_month}/{pm.exp_year}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/dashboard/students/${pm.customer_id}/add-card`}
                  className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100"
                >
                  Update Card
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reconciliation Mismatches */}
      {reconMismatches.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-purple-700">
            Reconciliation Mismatches ({reconMismatches.length})
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            From last reconciliation run{lastRecon?.created_at ? ` on ${new Date(lastRecon.created_at).toLocaleDateString()}` : ""}.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Type</th>
                  <th className="pb-2 pr-4">Square Payment ID</th>
                  <th className="pb-2 pr-4">Details</th>
                </tr>
              </thead>
              <tbody>
                {reconMismatches.map((m: Record<string, string>, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="py-2 pr-4">
                      <Badge variant={m.type === "unmatched_square_payment" ? "secondary" : "destructive"}>
                        {m.type?.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs">
                      {m.square_payment_id || "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs text-muted-foreground">
                      {m.type === "status_mismatch"
                        ? `Ours: ${m.our_status}, Square: ${m.square_status}`
                        : m.type === "unmatched_square_payment"
                        ? `$${((m.amount_cents as unknown as number) / 100).toFixed(2)} — ${m.note || "no note"}`
                        : "Charge in our DB but not found in Square"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Last reconciliation info */}
      <div className="mt-8 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <p className="font-medium">Reconciliation</p>
        {lastRecon ? (
          <p>
            Last run: {new Date(lastRecon.created_at).toLocaleString()} —{" "}
            {lastRecon.metadata?.square_payments_count || 0} Square payments,{" "}
            {lastRecon.metadata?.our_charges_count || 0} charges,{" "}
            {lastRecon.metadata?.mismatches_count || 0} mismatches
          </p>
        ) : (
          <p>No reconciliation runs yet. The reconciler Edge Function runs nightly.</p>
        )}
      </div>
    </div>
  );
}

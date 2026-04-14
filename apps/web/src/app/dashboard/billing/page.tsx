import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { BillingActions } from "./billing-actions";

export default async function BillingPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch billing queue with customer + enrollment info
  const { data: queueItems } = await supabase
    .from("billing_queue")
    .select(`
      *,
      customers(first_name, last_name, email, square_customer_id),
      enrollments(class_name, pack_size, billing_mode)
    `)
    .order("due_at", { ascending: false });

  const dueItems = (queueItems || []).filter((i) => i.status === "due");
  const failedItems = (queueItems || []).filter((i) => i.status === "failed");
  const recentPaid = (queueItems || []).filter((i) => i.status === "paid" || i.status === "waived").slice(0, 20);

  // Count students missing cards
  const { data: studentsNoCard } = await supabase
    .from("customers")
    .select("id, first_name, last_name")
    .is("square_customer_id", null)
    .eq("active", true);

  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="text-2xl font-semibold tracking-tight">Billing</h2>
      <p className="text-sm text-muted-foreground">
        Manage outstanding packs, charge students, and track payments.
      </p>

      {/* Summary cards */}
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Due</p>
          <p className="text-3xl font-bold text-orange-600">{dueItems.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">Failed</p>
          <p className="text-3xl font-bold text-red-600">{failedItems.length}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium text-muted-foreground">No Square Account</p>
          <p className="text-3xl font-bold text-yellow-600">{studentsNoCard?.length || 0}</p>
        </div>
      </div>

      {/* Due items */}
      {dueItems.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold">Outstanding Packs</h3>
          <div className="mt-3 space-y-2">
            {dueItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">
                    {item.customers?.first_name} {item.customers?.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.enrollments?.class_name} — Pack {item.pack_number}
                  </p>
                  <p className="text-sm font-medium">${(item.amount_cents / 100).toFixed(2)}</p>
                  {item.notes && (
                    <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                    Due
                  </Badge>
                  <BillingActions
                    itemId={item.id}
                    hasCard={!!item.customers?.square_customer_id}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed items */}
      {failedItems.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-red-700">Failed Charges</h3>
          <div className="mt-3 space-y-2">
            {failedItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between rounded-lg border border-red-200 p-4">
                <div>
                  <p className="font-medium">
                    {item.customers?.first_name} {item.customers?.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {item.enrollments?.class_name} — Pack {item.pack_number}
                  </p>
                  <p className="text-sm font-medium">${(item.amount_cents / 100).toFixed(2)}</p>
                  {item.notes && (
                    <p className="text-xs text-destructive mt-1">{item.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="destructive">Failed</Badge>
                  <BillingActions
                    itemId={item.id}
                    hasCard={!!item.customers?.square_customer_id}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Students without Square account */}
      {studentsNoCard && studentsNoCard.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold text-yellow-700">Students Not Synced to Square</h3>
          <div className="mt-3 space-y-2">
            {studentsNoCard.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-yellow-200 p-4">
                <p className="font-medium">{s.first_name} {s.last_name}</p>
                <a
                  href={`/dashboard/students/${s.id}`}
                  className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
                >
                  View &rarr;
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent paid / waived */}
      {recentPaid.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-semibold">Recent Payments</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Student</th>
                  <th className="pb-2 pr-4">Class</th>
                  <th className="pb-2 pr-4">Pack</th>
                  <th className="pb-2 pr-4">Amount</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2">Paid</th>
                </tr>
              </thead>
              <tbody>
                {recentPaid.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2 pr-4">
                      {item.customers?.first_name} {item.customers?.last_name}
                    </td>
                    <td className="py-2 pr-4">{item.enrollments?.class_name}</td>
                    <td className="py-2 pr-4">#{item.pack_number}</td>
                    <td className="py-2 pr-4">${(item.amount_cents / 100).toFixed(2)}</td>
                    <td className="py-2 pr-4">
                      <Badge variant={item.status === "paid" ? "default" : "secondary"}>
                        {item.status}
                      </Badge>
                    </td>
                    <td className="py-2">
                      {item.paid_at ? new Date(item.paid_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dueItems.length === 0 && failedItems.length === 0 && (
        <div className="mt-8 rounded-lg border p-8 text-center text-muted-foreground">
          <p className="text-lg">All caught up! No outstanding packs.</p>
          <p className="text-sm mt-1">New packs will appear here after students complete their classes.</p>
        </div>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch summary counts in parallel
  const [studentsRes, enrollmentsRes, dueRes, exceptionsRes, recentChargesRes] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("billing_queue").select("id", { count: "exact", head: true }).eq("status", "due"),
    supabase.from("charges").select("id", { count: "exact", head: true }).eq("status", "failed"),
    supabase.from("charges").select("id, customer_id, amount_cents, status, description, created_at, customers(first_name, last_name)").order("created_at", { ascending: false }).limit(5),
  ]);

  const activeStudents = studentsRes.count ?? 0;
  const activeEnrollments = enrollmentsRes.count ?? 0;
  const dueCount = dueRes.count ?? 0;
  const exceptionCount = exceptionsRes.count ?? 0;
  const recentCharges = recentChargesRes.data || [];

  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="text-2xl font-semibold tracking-tight">Dashboard</h2>
      <p className="mt-2 text-muted-foreground">
        Welcome back, {user.email}
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/dashboard/students"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <p className="text-sm font-medium text-muted-foreground">Active Students</p>
          <p className="mt-2 text-3xl font-bold">{activeStudents}</p>
        </Link>
        <Link
          href="/dashboard/attendance"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <p className="text-sm font-medium text-muted-foreground">Active Enrollments</p>
          <p className="mt-2 text-3xl font-bold">{activeEnrollments}</p>
        </Link>
        <Link
          href="/dashboard/billing"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <p className="text-sm font-medium text-muted-foreground">Packs Due</p>
          <p className={`mt-2 text-3xl font-bold ${dueCount > 0 ? "text-orange-600" : ""}`}>{dueCount}</p>
        </Link>
        <Link
          href="/dashboard/exceptions"
          className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-colors hover:bg-accent"
        >
          <p className="text-sm font-medium text-muted-foreground">Exceptions</p>
          <p className={`mt-2 text-3xl font-bold ${exceptionCount > 0 ? "text-red-600" : ""}`}>{exceptionCount}</p>
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Quick Actions */}
        <div>
          <h3 className="text-lg font-semibold">Quick Actions</h3>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href="/dashboard/students/new"
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              + Add Student
            </Link>
            <Link
              href="/dashboard/attendance"
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Mark Attendance
            </Link>
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              View Billing
            </Link>
          </div>
        </div>

        {/* Recent Charges */}
        <div>
          <h3 className="text-lg font-semibold">Recent Charges</h3>
          {recentCharges.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No charges yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {recentCharges.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div>
                    <span className="font-medium">{c.customers?.first_name} {c.customers?.last_name}</span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span>${(c.amount_cents / 100).toFixed(2)}</span>
                  </div>
                  <span className={`text-xs ${c.status === "completed" ? "text-green-600" : c.status === "failed" ? "text-red-600" : "text-muted-foreground"}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

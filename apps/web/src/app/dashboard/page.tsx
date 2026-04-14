import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch summary counts
  const [studentsRes, enrollmentsRes] = await Promise.all([
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("active", true),
    supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("status", "active"),
  ]);

  const activeStudents = studentsRes.count ?? 0;
  const activeEnrollments = enrollmentsRes.count ?? 0;

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
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Active Enrollments</p>
          <p className="mt-2 text-3xl font-bold">{activeEnrollments}</p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Upcoming Charges</p>
          <p className="mt-2 text-3xl font-bold">-</p>
          <p className="text-xs text-muted-foreground">Coming soon</p>
        </div>
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
          <p className="text-sm font-medium text-muted-foreground">Exceptions</p>
          <p className="mt-2 text-3xl font-bold">-</p>
          <p className="text-xs text-muted-foreground">Coming soon</p>
        </div>
      </div>

      <div className="mt-8">
        <h3 className="text-lg font-semibold">Quick Actions</h3>
        <div className="mt-4 flex flex-wrap gap-3">
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
        </div>
      </div>
    </div>
  );
}

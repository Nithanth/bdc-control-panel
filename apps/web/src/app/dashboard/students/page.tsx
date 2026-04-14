import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Customer } from "@/lib/types";

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const query = searchParams.q?.toLowerCase() || "";
  const showInactive = searchParams.status === "all";

  let dbQuery = supabase
    .from("customers")
    .select("*")
    .eq("type", "student")
    .order("last_name", { ascending: true });

  if (!showInactive) {
    dbQuery = dbQuery.eq("active", true);
  }

  const { data: students, error } = await dbQuery;

  if (error) {
    return <div className="text-destructive">Error loading students: {error.message}</div>;
  }

  // Client-side filter by search query
  const filtered = query
    ? (students as Customer[]).filter(
        (s) =>
          s.first_name?.toLowerCase().includes(query) ||
          s.last_name?.toLowerCase().includes(query) ||
          s.email?.toLowerCase().includes(query)
      )
    : (students as Customer[]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Students</h2>
          <p className="text-sm text-muted-foreground">{filtered.length} students</p>
        </div>
        <Link
          href="/dashboard/students/new"
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          + Add Student
        </Link>
      </div>

      {/* Filters */}
      <div className="mt-4 flex items-center gap-4">
        <form className="flex-1">
          <input
            name="q"
            type="search"
            placeholder="Search by name or email..."
            defaultValue={query}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </form>
        <Link
          href={showInactive ? "/dashboard/students" : "/dashboard/students?status=all"}
          className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
        >
          {showInactive ? "Active only" : "Show all"}
        </Link>
      </div>

      {/* Student list */}
      {filtered.length === 0 ? (
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">No students found.</p>
          <Link
            href="/dashboard/students/new"
            className="mt-2 inline-block text-sm text-primary hover:underline"
          >
            Add your first student
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {filtered.map((student) => (
            <Link
              key={student.id}
              href={`/dashboard/students/${student.id}`}
              className="flex items-center justify-between rounded-lg border p-4 transition-colors hover:bg-accent"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                  {student.first_name?.[0]}
                  {student.last_name?.[0]}
                </div>
                <div>
                  <p className="font-medium">
                    {student.first_name} {student.last_name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {student.email || "No email"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {student.is_minor && (
                  <Badge variant="outline" className="text-xs">Minor</Badge>
                )}
                {!student.active && (
                  <Badge variant="destructive" className="text-xs">Inactive</Badge>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

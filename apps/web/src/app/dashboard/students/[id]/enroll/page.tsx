import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { createEnrollment } from "@/lib/actions/students";
import type { Customer } from "@/lib/types";

export default async function EnrollStudentPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: student, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !student) {
    notFound();
  }

  const s = student as Customer;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href={`/dashboard/students/${params.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to {s.first_name} {s.last_name}
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Add Enrollment
        </h2>
        <p className="text-sm text-muted-foreground">
          for {s.first_name} {s.last_name}
        </p>
      </div>

      <form action={createEnrollment} className="space-y-6">
        <input type="hidden" name="customer_id" value={params.id} />

        <div className="space-y-2">
          <label htmlFor="class_name" className="text-sm font-medium">
            Class Name *
          </label>
          <input
            id="class_name"
            name="class_name"
            type="text"
            required
            placeholder="e.g. Beginner Bollywood Monday 6pm"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="rate_dollars" className="text-sm font-medium">
              Package Price ($) *
            </label>
            <input
              id="rate_dollars"
              name="rate_dollars"
              type="number"
              step="0.01"
              min="0.01"
              required
              placeholder="100.00"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="pack_size" className="text-sm font-medium">
              Classes per Pack
            </label>
            <input
              id="pack_size"
              name="pack_size"
              type="number"
              min="1"
              defaultValue="4"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue="active"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="active">Active</option>
            <option value="hns">Has Not Started</option>
            <option value="trial">Trial</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="billing_mode" className="text-sm font-medium">
            Billing Mode
          </label>
          <select
            id="billing_mode"
            name="billing_mode"
            defaultValue="manual"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="manual">Manual — admin charges or student pays via link</option>
            <option value="auto">Auto — charge card on file when pack completes</option>
          </select>
        </div>

        <div className="space-y-2">
          <label htmlFor="notes" className="text-sm font-medium">Notes</label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Any notes about this enrollment..."
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Create Enrollment
          </button>
          <Link
            href={`/dashboard/students/${params.id}`}
            className="inline-flex items-center rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

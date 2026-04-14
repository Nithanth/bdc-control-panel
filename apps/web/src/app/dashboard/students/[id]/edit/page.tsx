import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { updateStudent } from "@/lib/actions/students";
import type { Customer } from "@/lib/types";

export default async function EditStudentPage({
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

  const updateStudentWithId = updateStudent.bind(null, params.id);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link
          href={`/dashboard/students/${params.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Student
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          Edit: {s.first_name} {s.last_name}
        </h2>
      </div>

      <form action={updateStudentWithId} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="first_name" className="text-sm font-medium">
              First Name *
            </label>
            <input
              id="first_name"
              name="first_name"
              type="text"
              required
              defaultValue={s.first_name || ""}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="last_name" className="text-sm font-medium">
              Last Name *
            </label>
            <input
              id="last_name"
              name="last_name"
              type="text"
              required
              defaultValue={s.last_name || ""}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={s.email || ""}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="phone" className="text-sm font-medium">Phone</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              defaultValue={s.phone || ""}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="date_of_birth" className="text-sm font-medium">Date of Birth</label>
            <input
              id="date_of_birth"
              name="date_of_birth"
              type="date"
              defaultValue={s.date_of_birth || ""}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-end space-x-2 pb-2">
            <input
              id="is_minor"
              name="is_minor"
              type="checkbox"
              defaultChecked={s.is_minor}
              className="h-4 w-4 rounded border"
            />
            <label htmlFor="is_minor" className="text-sm font-medium">Minor (under 18)</label>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="notes" className="text-sm font-medium">Notes</label>
          <textarea
            id="notes"
            name="notes"
            rows={3}
            defaultValue={s.notes || ""}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center space-x-2">
            <input
              id="active"
              name="active"
              type="checkbox"
              defaultChecked={s.active}
              className="h-4 w-4 rounded border"
            />
            <label htmlFor="active" className="text-sm font-medium">Active</label>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Save Changes
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

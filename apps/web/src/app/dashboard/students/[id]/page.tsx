import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { Customer, Enrollment } from "@/lib/types";
import { EnrollmentStatusButton } from "./enrollment-status-button";
import { SyncSquareButton } from "./sync-square-button";

export default async function StudentDetailPage({
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

  const typedStudent = student as Customer;

  // Fetch enrollments
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("*")
    .eq("customer_id", params.id)
    .order("created_at", { ascending: false });

  // Fetch recent attendance
  const { data: attendance } = await supabase
    .from("attendance")
    .select("*")
    .eq("customer_id", params.id)
    .order("class_date", { ascending: false })
    .limit(20);

  // Fetch charges
  const { data: charges } = await supabase
    .from("charges")
    .select("*")
    .eq("customer_id", params.id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Fetch payment methods
  const { data: paymentMethods } = await supabase
    .from("square_payment_methods")
    .select("*")
    .eq("customer_id", params.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6">
        <Link
          href="/dashboard/students"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Students
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-lg font-medium text-primary">
            {typedStudent.first_name?.[0]}
            {typedStudent.last_name?.[0]}
          </div>
          <div>
            <h2 className="text-2xl font-semibold">
              {typedStudent.first_name} {typedStudent.last_name}
            </h2>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {typedStudent.email && <span>{typedStudent.email}</span>}
              {typedStudent.phone && (
                <>
                  <span>&middot;</span>
                  <span>{typedStudent.phone}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {typedStudent.is_minor && <Badge variant="outline">Minor</Badge>}
          {!typedStudent.active && <Badge variant="destructive">Inactive</Badge>}
          <Link
            href={`/dashboard/students/${params.id}/edit`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          >
            Edit
          </Link>
        </div>
      </div>

      {/* Square status */}
      <div className="mt-4 flex items-center gap-2 text-sm">
        {typedStudent.square_customer_id ? (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Square synced</Badge>
        ) : (
          <SyncSquareButton customerId={params.id} />
        )}
      </div>

      {/* Info grid */}
      {(typedStudent.date_of_birth || typedStudent.notes) && (
        <div className="mt-6 rounded-lg border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {typedStudent.date_of_birth && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Date of Birth</p>
                <p className="text-sm">{typedStudent.date_of_birth}</p>
              </div>
            )}
            {typedStudent.notes && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Notes</p>
                <p className="text-sm">{typedStudent.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Methods */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Payment Methods</h3>
          <Link
            href={`/dashboard/students/${params.id}/add-card`}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Add Card
          </Link>
        </div>

        {!paymentMethods || paymentMethods.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No cards on file.{" "}
            <Link href={`/dashboard/students/${params.id}/add-card`} className="text-primary hover:underline">
              Add one
            </Link>
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {paymentMethods.map((pm) => (
              <div key={pm.id} className="flex items-center justify-between rounded-lg border p-4">
                <div className="flex items-center gap-3">
                  <span className="text-lg">💳</span>
                  <div>
                    <p className="font-medium">
                      {pm.card_brand} ending in {pm.last_four}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Expires {pm.exp_month}/{pm.exp_year}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {pm.is_default && (
                    <Badge variant="outline" className="text-xs">Default</Badge>
                  )}
                  {!pm.active && (
                    <Badge variant="destructive" className="text-xs">Inactive</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enrollments */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Enrollments</h3>
          <Link
            href={`/dashboard/students/${params.id}/enroll`}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            + Add Enrollment
          </Link>
        </div>

        {!enrollments || enrollments.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No enrollments yet.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {(enrollments as Enrollment[]).map((enrollment) => (
              <div key={enrollment.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{enrollment.class_name}</p>
                    <p className="text-sm text-muted-foreground">
                      ${(enrollment.rate_cents / 100).toFixed(2)} per {enrollment.pack_size} classes
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        enrollment.status === "active"
                          ? "default"
                          : enrollment.status === "trial"
                          ? "secondary"
                          : "destructive"
                      }
                    >
                      {enrollment.status}
                    </Badge>
                    <EnrollmentStatusButton
                      enrollmentId={enrollment.id}
                      customerId={params.id}
                      currentStatus={enrollment.status}
                    />
                  </div>
                </div>
                {/* Pack progress */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      Pack {enrollment.current_pack}: {enrollment.classes_in_pack} of {enrollment.pack_size} classes
                    </span>
                    <span className="font-medium">
                      {Math.round((enrollment.classes_in_pack / enrollment.pack_size) * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-secondary">
                    <div
                      className="h-2 rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, (enrollment.classes_in_pack / enrollment.pack_size) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Attendance */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold">Recent Attendance</h3>
        {!attendance || attendance.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No attendance records yet.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Billed</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{a.class_date}</td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          a.status === "present"
                            ? "text-green-600"
                            : a.status === "absent"
                            ? "text-red-600"
                            : "text-yellow-600"
                        }
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {a.billed ? (
                        <span className="text-muted-foreground">Yes</span>
                      ) : (
                        <span className="text-muted-foreground">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Charges */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold">Charges</h3>
        {!charges || charges.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">No charges yet.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Description</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-2">{c.description || c.source_module}</td>
                    <td className="px-4 py-2 text-right font-medium">
                      ${(c.amount_cents / 100).toFixed(2)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={
                          c.status === "completed"
                            ? "default"
                            : c.status === "failed"
                            ? "destructive"
                            : "secondary"
                        }
                        className="text-xs"
                      >
                        {c.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

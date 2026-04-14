import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AttendanceSheet } from "./attendance-sheet";

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: { date?: string; class?: string };
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const selectedDate = searchParams.date || new Date().toISOString().split("T")[0];
  const selectedClass = searchParams.class || "";

  // Get distinct class names from active enrollments
  const { data: enrollments } = await supabase
    .from("enrollments")
    .select("class_name, id, customer_id, status, pack_size, classes_in_pack, current_pack")
    .in("status", ["active", "trial"])
    .order("class_name");

  // Deduplicate class names
  const classNames = Array.from(new Set((enrollments || []).map((e) => e.class_name)));

  // Filter enrollments by selected class
  const filteredEnrollments = selectedClass
    ? (enrollments || []).filter((e) => e.class_name === selectedClass)
    : [];

  // Fetch customer info for filtered enrollments
  const customerIds = filteredEnrollments.map((e) => e.customer_id);
  const { data: customers } = customerIds.length > 0
    ? await supabase
        .from("customers")
        .select("id, first_name, last_name")
        .in("id", customerIds)
    : { data: [] };

  // Fetch existing attendance for this date + these enrollments
  const enrollmentIds = filteredEnrollments.map((e) => e.id);
  const { data: existingAttendance } = enrollmentIds.length > 0
    ? await supabase
        .from("attendance")
        .select("*")
        .eq("class_date", selectedDate)
        .in("enrollment_id", enrollmentIds)
    : { data: [] };

  // Build the data for the client component
  const studentsForSheet = filteredEnrollments.map((enrollment) => {
    const customer = (customers || []).find((c) => c.id === enrollment.customer_id);
    const attendance = (existingAttendance || []).find(
      (a) => a.enrollment_id === enrollment.id
    );
    return {
      enrollmentId: enrollment.id,
      customerId: enrollment.customer_id,
      firstName: customer?.first_name || "",
      lastName: customer?.last_name || "",
      enrollmentStatus: enrollment.status as string,
      packSize: enrollment.pack_size as number,
      classesInPack: enrollment.classes_in_pack as number,
      currentPack: enrollment.current_pack as number,
      attendanceId: (attendance?.id as string) || null,
      attendanceStatus: (attendance?.status as string) || null,
      billed: (attendance?.billed as boolean) || false,
    };
  });

  return (
    <div className="mx-auto max-w-5xl">
      <h2 className="text-2xl font-semibold tracking-tight">Attendance</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Select a date and class, then mark each student.
      </p>

      {/* Date + class selectors */}
      <form className="mt-6 flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="date" className="text-sm font-medium">Date</label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={selectedDate}
            className="rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="class" className="text-sm font-medium">Class</label>
          <select
            id="class"
            name="class"
            defaultValue={selectedClass}
            className="rounded-md border bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Select a class...</option>
            {classNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Load
        </button>
      </form>

      {/* Attendance sheet */}
      {selectedClass ? (
        studentsForSheet.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            No students enrolled in this class.
          </p>
        ) : (
          <AttendanceSheet
            students={studentsForSheet}
            classDate={selectedDate}
            className={selectedClass}
          />
        )
      ) : (
        <p className="mt-8 text-sm text-muted-foreground">
          Select a class to view enrolled students.
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markAttendance,
  updateAttendanceStatus,
  unmarkAttendance,
  bulkMarkAttendance,
} from "@/lib/actions/attendance";
import { Badge } from "@/components/ui/badge";

interface StudentRow {
  enrollmentId: string;
  customerId: string;
  firstName: string;
  lastName: string;
  enrollmentStatus: string;
  packSize: number;
  classesInPack: number;
  currentPack: number;
  attendanceId: string | null;
  attendanceStatus: string | null;
  billed: boolean;
}

export function AttendanceSheet({
  students,
  classDate,
}: {
  students: StudentRow[];
  classDate: string;
  className: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleMark = async (
    student: StudentRow,
    status: "present" | "absent" | "excused"
  ) => {
    setFeedback(null);
    startTransition(async () => {
      try {
        if (student.attendanceId && !student.billed) {
          // Already marked — update
          await updateAttendanceStatus(
            student.attendanceId,
            student.customerId,
            student.enrollmentId,
            student.attendanceStatus!,
            status
          );
        } else if (!student.attendanceId) {
          // Not yet marked — create
          await markAttendance(
            student.enrollmentId,
            student.customerId,
            classDate,
            status
          );
        }
        router.refresh();
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Failed to mark attendance");
      }
    });
  };

  const handleUnmark = async (student: StudentRow) => {
    if (!student.attendanceId) return;
    if (student.billed) {
      setFeedback("Cannot remove a billed attendance record.");
      return;
    }
    setFeedback(null);
    startTransition(async () => {
      try {
        await unmarkAttendance(
          student.attendanceId!,
          student.customerId,
          student.enrollmentId,
          student.attendanceStatus === "present"
        );
        router.refresh();
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Failed to remove attendance");
      }
    });
  };

  const handleBulkPresent = async () => {
    setFeedback(null);
    const unmarked = students.filter((s) => !s.attendanceId);
    if (unmarked.length === 0) {
      setFeedback("All students already marked.");
      return;
    }
    startTransition(async () => {
      try {
        const results = await bulkMarkAttendance(
          unmarked.map((s) => ({
            enrollmentId: s.enrollmentId,
            customerId: s.customerId,
          })),
          classDate,
          "present"
        );
        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
          setFeedback(`Marked ${results.length - failed.length} students. ${failed.length} failed.`);
        }
        router.refresh();
      } catch (err) {
        setFeedback(err instanceof Error ? err.message : "Bulk mark failed");
      }
    });
  };

  const statusColors: Record<string, string> = {
    present: "bg-green-100 text-green-800 border-green-300",
    absent: "bg-red-100 text-red-800 border-red-300",
    excused: "bg-yellow-100 text-yellow-800 border-yellow-300",
  };

  return (
    <div className="mt-6">
      {/* Bulk action */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {students.length} students &middot; {classDate}
        </p>
        <button
          onClick={handleBulkPresent}
          disabled={isPending}
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Mark All Present
        </button>
      </div>

      {feedback && (
        <div className="mt-3 rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
          {feedback}
        </div>
      )}

      {/* Student rows */}
      <div className="mt-4 space-y-2">
        {students.map((student) => (
          <div
            key={student.enrollmentId}
            className="flex items-center justify-between rounded-lg border p-4"
          >
            {/* Student info */}
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">
                {student.firstName[0]}
                {student.lastName[0]}
              </div>
              <div>
                <p className="font-medium">
                  {student.firstName} {student.lastName}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Pack {student.currentPack}: {student.classesInPack}/{student.packSize}
                  </span>
                  <div className="h-1.5 w-16 rounded-full bg-secondary">
                    <div
                      className="h-1.5 rounded-full bg-primary transition-all"
                      style={{
                        width: `${Math.min(100, (student.classesInPack / student.packSize) * 100)}%`,
                      }}
                    />
                  </div>
                  {student.enrollmentStatus === "trial" && (
                    <Badge variant="secondary" className="text-xs">Trial</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Attendance buttons */}
            <div className="flex items-center gap-2">
              {student.billed && student.attendanceId ? (
                <Badge
                  className={statusColors[student.attendanceStatus || "present"]}
                >
                  {student.attendanceStatus} (billed)
                </Badge>
              ) : (
                <>
                  {(["present", "absent", "excused"] as const).map((status) => (
                    <button
                      key={status}
                      onClick={() => handleMark(student, status)}
                      disabled={isPending}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        student.attendanceStatus === status
                          ? statusColors[status]
                          : "hover:bg-accent"
                      }`}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                  {student.attendanceId && (
                    <button
                      onClick={() => handleUnmark(student)}
                      disabled={isPending}
                      className="rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                      title="Remove attendance"
                    >
                      &times;
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

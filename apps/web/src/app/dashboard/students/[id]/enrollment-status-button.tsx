"use client";

import { updateEnrollmentStatus } from "@/lib/actions/students";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function EnrollmentStatusButton({
  enrollmentId,
  customerId,
  currentStatus,
}: {
  enrollmentId: string;
  customerId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const actions: { label: string; status: string }[] = [];
  if (currentStatus === "active") {
    actions.push({ label: "Pause", status: "paused" });
    actions.push({ label: "Cancel", status: "cancelled" });
  } else if (currentStatus === "paused") {
    actions.push({ label: "Resume", status: "active" });
    actions.push({ label: "Cancel", status: "cancelled" });
  } else if (currentStatus === "trial") {
    actions.push({ label: "Activate", status: "active" });
    actions.push({ label: "Cancel", status: "cancelled" });
  }

  if (actions.length === 0) return null;

  const handleAction = async (newStatus: string) => {
    setLoading(true);
    try {
      await updateEnrollmentStatus(enrollmentId, customerId, newStatus);
      router.refresh();
    } catch {
      alert("Failed to update enrollment status");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-1">
      {actions.map((action) => (
        <button
          key={action.status}
          onClick={() => handleAction(action.status)}
          disabled={loading}
          className="rounded border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

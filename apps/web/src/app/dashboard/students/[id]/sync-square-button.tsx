"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncCustomerToSquare } from "@/lib/actions/square";

export function SyncSquareButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSync = () => {
    setError(null);
    startTransition(async () => {
      try {
        await syncCustomerToSquare(customerId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sync with Square");
      }
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleSync}
        disabled={isPending}
        className="rounded-md border border-orange-300 bg-orange-50 px-3 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50"
      >
        {isPending ? "Syncing..." : "Sync to Square"}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chargeFromQueue, markQueueItemPaid, waiveQueueItem } from "@/lib/actions/billing";

export function BillingActions({
  itemId,
  hasCard,
}: {
  itemId: string;
  hasCard: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showWaive, setShowWaive] = useState(false);
  const [waiveReason, setWaiveReason] = useState("");

  const handleCharge = () => {
    setError(null);
    startTransition(async () => {
      try {
        await chargeFromQueue(itemId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Charge failed");
      }
    });
  };

  const handleMarkPaid = () => {
    setError(null);
    startTransition(async () => {
      try {
        await markQueueItemPaid(itemId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  const handleWaive = () => {
    if (!waiveReason.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        await waiveQueueItem(itemId, waiveReason);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        {hasCard && (
          <button
            onClick={handleCharge}
            disabled={isPending}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? "..." : "Charge Now"}
          </button>
        )}
        <button
          onClick={handleMarkPaid}
          disabled={isPending}
          className="rounded-md border border-green-300 bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50"
        >
          Mark Paid
        </button>
        <button
          onClick={() => setShowWaive(!showWaive)}
          disabled={isPending}
          className="rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          Waive
        </button>
      </div>

      {showWaive && (
        <div className="flex items-center gap-1 mt-1">
          <input
            type="text"
            placeholder="Reason (comp, trial...)"
            value={waiveReason}
            onChange={(e) => setWaiveReason(e.target.value)}
            className="rounded-md border px-2 py-1 text-xs w-40"
          />
          <button
            onClick={handleWaive}
            disabled={isPending || !waiveReason.trim()}
            className="rounded-md bg-gray-600 px-2 py-1 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      )}

      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

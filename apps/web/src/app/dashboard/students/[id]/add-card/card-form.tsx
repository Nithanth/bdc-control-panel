"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCardOnFile } from "@/lib/actions/square";

declare global {
  interface Window {
    Square: {
      payments: (
        appId: string,
        locationId: string
      ) => Promise<{
        card: () => Promise<{
          attach: (selector: string) => Promise<void>;
          tokenize: () => Promise<{
            status: string;
            token: string;
            errors?: { message: string }[];
          }>;
        }>;
      }>;
    };
  }
}

export function CardForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const cardRef = useRef<{ tokenize: () => Promise<{ status: string; token: string; errors?: { message: string }[] }> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);

  const appId = process.env.NEXT_PUBLIC_SQUARE_APPLICATION_ID || "";
  const locationId = process.env.NEXT_PUBLIC_SQUARE_LOCATION_ID || "";

  useEffect(() => {
    if (!appId || !locationId) {
      setError("Square credentials not configured. Set NEXT_PUBLIC_SQUARE_APPLICATION_ID and NEXT_PUBLIC_SQUARE_LOCATION_ID.");
      return;
    }

    // Load Square Web Payments SDK
    const script = document.createElement("script");
    script.src = "https://sandbox.web.squarecdn.com/v1/square.js";
    if (process.env.NEXT_PUBLIC_SQUARE_ENVIRONMENT === "production") {
      script.src = "https://web.squarecdn.com/v1/square.js";
    }
    script.async = true;
    script.onload = async () => {
      try {
        const payments = await window.Square.payments(appId, locationId);
        const card = await payments.card();
        await card.attach("#card-container");
        cardRef.current = card;
        setSdkReady(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load Square card form");
      }
    };
    script.onerror = () => setError("Failed to load Square SDK script");
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, [appId, locationId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardRef.current) return;

    setLoading(true);
    setError(null);

    try {
      const tokenResult = await cardRef.current.tokenize();

      if (tokenResult.status !== "OK") {
        const msg = tokenResult.errors?.map((e) => e.message).join(", ") || "Card tokenization failed";
        setError(msg);
        setLoading(false);
        return;
      }

      await saveCardOnFile(customerId, tokenResult.token);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save card");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div
        id="card-container"
        className="min-h-[50px] rounded-md border bg-white p-2"
      />

      {!sdkReady && !error && (
        <p className="text-sm text-muted-foreground">Loading card form...</p>
      )}

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !sdkReady}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {loading ? "Saving card..." : "Save Card"}
      </button>
    </form>
  );
}

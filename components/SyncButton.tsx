"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncButton() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  async function handleSync() {
    setLoading(true);
    setMessage(null);

    try {
      const res = await fetch("/api/sync-tiendanube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();

      if (!res.ok) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(
          `OK: ${data.productos_upsertados} productos, ${data.variantes_upsertadas} variantes`
        );
        router.refresh();
      }
    } catch (err: any) {
      setMessage(`Error: ${String(err?.message ?? err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-md bg-numa-700 px-4 py-2 text-sm font-medium text-white hover:bg-numa-900 disabled:opacity-60"
      >
        {loading ? "Sincronizando..." : "Sincronizar con Tienda Nube"}
      </button>
      {message && <p className="text-xs text-numa-500">{message}</p>}
    </div>
  );
}

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Opcion = { id: number; label: string };

export default function VincularButton({
  mekkProductoId,
  opciones,
  tipo = "mayorista",
}: {
  mekkProductoId: number;
  opciones: Opcion[];
  tipo?: "mayorista" | "minorista";
}) {
  const [varianteId, setVarianteId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleVincular() {
    if (!varianteId) return;
    setLoading(true);

    const res = await fetch("/api/vincular", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        variante_id: Number(varianteId),
        mekk_producto_id: mekkProductoId,
        tipo_mekk: tipo,
      }),
    });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      alert("Error: " + data.error);
      return;
    }

    setVarianteId("");
    router.refresh();
  }

  return (
    <div className="flex gap-1">
      <select
        value={varianteId}
        onChange={(e) => setVarianteId(e.target.value)}
        className="max-w-[220px] rounded border border-numa-200 px-2 py-1 text-xs"
      >
        <option value="">Elegir producto...</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        onClick={handleVincular}
        disabled={!varianteId || loading}
        className="rounded bg-numa-700 px-2 py-1 text-xs text-white hover:bg-numa-900 disabled:opacity-60"
      >
        {loading ? "..." : "Vincular"}
      </button>
    </div>
  );
}

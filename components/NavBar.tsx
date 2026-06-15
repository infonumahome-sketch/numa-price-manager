"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const links = [
  { href: "/", label: "Comparativa" },
  { href: "/productos", label: "Mis productos" },
  { href: "/mekk", label: "Catálogo MËKK" },
  { href: "/exportar", label: "Exportar CSV" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-numa-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-lg font-semibold text-numa-700">
            Numa Home · Precios
          </span>
          <nav className="flex gap-4 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  pathname === link.href
                    ? "bg-numa-100 text-numa-900 font-medium"
                    : "text-numa-600 hover:bg-numa-50"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-md border border-numa-200 px-3 py-1.5 text-sm text-numa-600 hover:bg-numa-50"
        >
          Salir
        </button>
      </div>
    </header>
  );
}

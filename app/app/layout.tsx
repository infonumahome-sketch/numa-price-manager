import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Numa Home | Gestor de Precios",
  description: "Panel privado para gestionar precios de Numa Home",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body className="min-h-screen text-numa-900 antialiased">
        {children}
      </body>
    </html>
  );
}

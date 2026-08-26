import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

/**
 * Tipografía de la interfaz.
 *
 * ── Por qué Inter y por qué se fue el serif ─────────────────────────────────
 *
 * El rediseño azul y blanco (ADR 0026) sigue el registro de las plataformas de
 * reserva, y ésas son **sans-serif de punta a punta**, también en los títulos.
 * El serif de display (Fraunces) daba un aire editorial que ya no corresponde y
 * además pesaba: era una familia entera cargada para unos pocos encabezados.
 *
 * Inter es la sans más cercana a ese registro entre las de licencia abierta:
 * grotesca neutra, muy legible en tamaños chicos —que es donde vive un panel de
 * gestión— y con alturas de x generosas.
 *
 * ⚠️ La tipografía de Booking.com es propietaria y no se usa. Ésta es una
 * alternativa libre con un aire parecido, no una copia.
 *
 * `--font-display` sigue existiendo para no tocar las decenas de `font-display`
 * que hay en las pantallas; ahora apunta a la misma sans. El peso y el
 * interletrado los ponen las clases, no la familia.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Blanca Patagonia — Gestión Hotelera",
  description:
    "Sistema integral de gestión y reservas del Hotel Blanca Patagonia, El Calafate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import { baseUrlSeo } from "@/lib/seo";
import {
  ETIQUETA_BCP47,
  IDIOMA_POR_OMISION,
  esIdioma,
  type Idioma,
} from "@/lib/i18n/idiomas";
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
  // La usan unas pocas pantallas (códigos, importes alineados): no vale la
  // pena precargarla en todas.
  preload: false,
});

/*
 * La tipografía para chino (Noto Sans SC) NO se carga acá: vive en
 * `(front-publico)/[idioma]/layout.tsx`. `next/font` emite su CSS en todas las
 * rutas del módulo que la importa —se aplique o no la clase—, y desde este
 * layout eran 372 KB de CSS bloqueante (405 `@font-face`) en las 90 rutas,
 * panel incluido.
 */

export const metadata: Metadata = {
  // Base para las URLs relativas de `openGraph.images` y del `canonical`:
  // sin esto, cada página pública tendría que armar la URL absoluta a mano.
  metadataBase: new URL(baseUrlSeo()),
  title: "Blanca Patagonia — Gestión Hotelera",
  description:
    "Sistema integral de gestión y reservas del Hotel Blanca Patagonia, El Calafate.",
  // Valores por omisión para toda página que no los pise con los suyos
  // propios (el panel, por ejemplo, no comparte enlaces y no los necesita).
  openGraph: {
    siteName: "Blanca Patagonia",
    locale: "es_AR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

/**
 * El `lang` del `<html>` sale de la cabecera que pone el proxy.
 *
 * No es decorativo: un lector de pantalla elige con `lang` cómo pronunciar —un
 * texto chino leído con reglas del español es ruido— y los buscadores lo usan
 * para saber a qué audiencia mostrar la página. Tiene que ser el idioma que se
 * está viendo, no el del proyecto.
 *
 * Por qué viene por cabecera y no de `params`: este layout está **por encima**
 * del segmento `[idioma]`, así que no lo recibe. La alternativa de Next
 * (`next/root-params`) exige mover el layout raíz dentro de `app/[idioma]/`, y
 * eso obligaría al panel —que no se traduce— a vivir bajo un prefijo de idioma.
 *
 * Sin cabecera es español: el panel, el login y las pantallas con token no
 * pasan por el ruteo de idiomas y son en español.
 */
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const idioma = (await headers()).get("x-idioma");
  const etiqueta = esIdioma(idioma ?? undefined) ? idioma : IDIOMA_POR_OMISION;

  return (
    <html
      lang={ETIQUETA_BCP47[etiqueta as Idioma]}
      // El CSS usa `scroll-behavior: smooth` (anclas de la portada). Con esto
      // Next lo desactiva durante los cambios de pantalla: si no, cada
      // navegación se desplazaba animada hasta arriba en vez de saltar.
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}

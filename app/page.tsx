import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex flex-1 flex-col">
      <section className="flex flex-1 flex-col items-center justify-center gap-6 bg-gradient-to-b from-lago-50 to-stone-100 px-6 py-20 text-center">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-lago-700">
          Hostería Boutique &amp; Cabañas
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-stone-900 sm:text-6xl">
          Blanca Patagonia
        </h1>
        <p className="max-w-xl text-lg text-stone-600">
          Frente al Lago Argentino, en El Calafate. Habitaciones con vista e
          hidromasaje y cabañas con hogar a parrilla, a pasos de los glaciares del
          Parque Nacional Los Glaciares.
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-3">
          <Link
            href="/reservar"
            className="rounded-lg bg-lago-700 px-6 py-3 font-medium text-white transition hover:bg-lago-800"
          >
            Reservá tu estadía
          </Link>
          <a
            href="https://www.blancapatagonia.com"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-stone-300 bg-white/60 px-6 py-3 font-medium text-stone-700 transition hover:bg-white"
          >
            Conocé el hotel
          </a>
        </div>
      </section>
      <footer className="flex items-center justify-between border-t border-stone-200 bg-white px-6 py-4 text-sm text-stone-500">
        <span>El Calafate · Santa Cruz · Argentina</span>
        <Link href="/panel" className="hover:text-stone-800">
          Acceso staff →
        </Link>
      </footer>
    </main>
  )
}

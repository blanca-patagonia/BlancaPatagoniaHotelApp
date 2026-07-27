export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <p className="text-sm font-medium uppercase tracking-widest text-sky-600">
          Hotel Blanca Patagonia · El Calafate
        </p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight sm:text-5xl">
          Sistema de Gestión Hotelera
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-gray-500">
          Reservas, check-in / check-out, consumos, facturación y reportes en una
          sola plataforma web. Proyecto de tesis — Analista de Sistemas (IES).
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <span className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-600">
          Fase 2 — Panel de Recepción ✅
        </span>
        <span className="rounded-full border border-gray-200 px-4 py-1.5 text-sm text-gray-400">
          Próximo: Pagos y portal público
        </span>
      </div>

      <a
        href="/panel"
        className="mt-4 rounded-lg bg-sky-700 px-5 py-2.5 font-medium text-white transition hover:bg-sky-800"
      >
        Ingresar al panel de gestión →
      </a>
    </main>
  );
}

'use client'

import { useActionState, useState, type ReactNode } from 'react'
import { crearReservaPublica, type EstadoReservaPublica } from '@/app/reservar/actions'
import { Mensaje } from '@/app/_publico/ui'
import { PAGAR_DESPUES } from '@/lib/domain/cobro'
import type { Idioma } from '@/lib/i18n/idiomas'
import type { Diccionario } from '@/lib/i18n/diccionarios/es'

const ESTADO_INICIAL: EstadoReservaPublica = {}

/** Un medio de pago tal como lo muestra el checkout, ya traducido. */
export interface MedioOfrecido {
  /** Lo que viaja como `medio`: el nombre de la pasarela en `PAGO_PROVIDER`. */
  valor: string
  titulo: string
  detalle: string
  formas: string[]
  /** El importe de la seña en la moneda de ese medio. */
  importe: string
  equivalencia: string | null
}

/*
  Estilo del checkout: papelería de hotel, no formulario de aplicación.

  Tomado del paso «Confirm your stay» de Aman: campos rectos con un filete
  fino, etiquetas en versalitas, filetes en lugar de tarjetas redondeadas y un
  solo botón oscuro. Es deliberadamente distinto de `CAMPO_PUBLICO` (el
  redondeado del resto del portal): acá se está por pagar, y la sobriedad se
  lee como confianza.

  La validación visible usa `:user-invalid` y no JavaScript: el borde rojo y el
  mensaje aparecen recién cuando la persona tocó el campo y lo dejó mal, no al
  cargar la página —eso hace sentir que uno ya se equivocó antes de empezar—.
  El servidor vuelve a validar todo igual: esto es ayuda, no la garantía.
*/
const CAMPO =
  'peer w-full rounded-none border border-tinta/25 bg-white px-4 py-3.5 text-base text-tinta outline-none transition placeholder:text-stone-400 hover:border-tinta/45 focus:border-tinta user-invalid:border-red-600'

/**
 * Datos del huésped, forma de pago y confirmación.
 *
 * Se piden cuatro datos y nada más: cada campo extra en un formulario público
 * es gente que lo abandona. Documento, nacionalidad y condición frente al IVA
 * se completan en recepción durante el check-in, con el documento en la mano.
 *
 * ── La forma de pago ────────────────────────────────────────────────────────
 * Una lista con filetes, con el importe EXACTO de la seña en la moneda de cada
 * medio: quien paga en pesos ve cuántos pesos le van a debitar antes de
 * elegir. «Reservar y pagar después» está siempre, al final: no todo el mundo
 * tiene la tarjeta a mano, y perder la reserva por eso es perder la venta.
 *
 * ⚠️ Ningún campo de tarjeta: se cargan en la página de la pasarela (PCI SAQ-A,
 * ADR 0025). Las tarjetas aceptadas se nombran en texto, no con logos: informa
 * sin reproducir marcas de terceros.
 */
export function FormularioCheckout({
  tipo,
  checkIn,
  checkOut,
  huespedes,
  idioma,
  t,
  medios,
  seniaTexto,
  diasExpiracion,
  cancelacion,
}: {
  tipo: string
  checkIn: string
  checkOut: string
  huespedes: number
  idioma: Idioma
  /** Textos por props: importar los diccionarios acá los mandaría al navegador. */
  t: Diccionario['checkout']
  medios: MedioOfrecido[]
  seniaTexto: string
  diasExpiracion: number
  /** Una línea por tramo de la política de cancelación, desde la base. */
  cancelacion: string[]
}) {
  const [estado, accion, pendiente] = useActionState(crearReservaPublica, ESTADO_INICIAL)
  // Por omisión, pagar con el primer medio: es el camino que asegura la
  // reserva. Si no hay ninguno, queda «pagar después».
  const [medio, setMedio] = useState(medios[0]?.valor ?? PAGAR_DESPUES)
  const pagaAhora = medio !== PAGAR_DESPUES
  // El botón dice lo que se va a debitar EN LA MONEDA del medio elegido: si
  // paga en pesos, los pesos, no los dólares de la seña.
  const importeElegido = medios.find((m) => m.valor === medio)?.importe ?? seniaTexto
  const tarjetas = medios.find((m) => m.valor === 'stripe')?.formas ?? []

  return (
    <form action={accion} className="flex flex-col gap-12">
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="check_in" value={checkIn} />
      <input type="hidden" name="check_out" value={checkOut} />
      <input type="hidden" name="huespedes" value={huespedes} />
      {/* El idioma viaja con el envío para que los errores del servidor
          vuelvan en el idioma de la pantalla. */}
      <input type="hidden" name="idioma" value={idioma} />

      <header className="text-center">
        <h1 className="font-display text-2xl font-light tracking-[-0.01em] text-tinta sm:text-3xl">
          {t.titulo}
        </h1>
        <p className="mt-2 text-sm text-tinta-suave">{t.descripcion}</p>
      </header>

      {/* ── Tus datos ── */}
      <Seccion titulo={t.tusDatos}>
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
          <CampoFino etiqueta={t.nombre}>
            <input name="nombre" autoComplete="given-name" className={CAMPO} />
          </CampoFino>
          <CampoFino etiqueta={t.apellido} requerido error={t.campoObligatorio}>
            <input name="apellido" required autoComplete="family-name" className={CAMPO} />
          </CampoFino>
          <CampoFino etiqueta={t.email} requerido error={t.errorEmail} ayuda={t.emailAyuda}>
            <input name="email" type="email" required autoComplete="email" className={CAMPO} />
          </CampoFino>
          <CampoFino etiqueta={t.telefono} ayuda={t.telefonoAyuda}>
            <input name="telefono" type="tel" autoComplete="tel" className={CAMPO} />
          </CampoFino>
        </div>
      </Seccion>

      {/* ── Forma de pago ── */}
      <Seccion
        titulo={t.pagoTitulo}
        extra={
          tarjetas.length > 0 ? (
            <span className="flex flex-wrap justify-end gap-1.5" aria-label={t.tarjetasAceptadas}>
              {tarjetas.map((f) => (
                <span
                  key={f}
                  className="border border-tinta/15 bg-white px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-tinta-suave uppercase"
                >
                  {f}
                </span>
              ))}
            </span>
          ) : null
        }
      >
        <p className="mb-5 text-sm leading-relaxed text-tinta-suave">
          {medios.length > 0 ? t.pagoTexto : t.sinMedios}
        </p>

        <div className="border border-tinta/15 bg-white">
          {medios.map((m) => (
            <OpcionMedio
              key={m.valor}
              valor={m.valor}
              elegido={medio === m.valor}
              alElegir={setMedio}
              titulo={m.titulo}
              detalle={m.detalle}
              derecha={
                <span className="text-right">
                  <span className="block text-base whitespace-nowrap tabular-nums text-tinta">
                    {m.importe}
                  </span>
                  {m.equivalencia && (
                    <span className="block max-w-48 text-[11px] leading-snug text-tinta-suave">
                      {m.equivalencia}
                    </span>
                  )}
                </span>
              }
              pie={
                // Las tarjetas ya están arriba, junto al título; acá van las
                // formas de los medios locales (débito, efectivo…).
                m.formas.length > 0 && m.valor !== 'stripe' ? (
                  <span className="mt-1.5 block text-xs text-stone-500">{m.formas.join(' · ')}</span>
                ) : null
              }
            />
          ))}
          <OpcionMedio
            valor={PAGAR_DESPUES}
            elegido={medio === PAGAR_DESPUES}
            alElegir={setMedio}
            titulo={t.pagarDespues}
            detalle={t.pagarDespuesDetalle.replace('{dias}', String(diasExpiracion))}
          />
        </div>

        <p className="mt-4 flex items-center gap-2 text-xs text-tinta-suave">
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.4}
            aria-hidden="true"
          >
            <rect x="5" y="10" width="14" height="10" rx="1.5" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          {t.pagoSeguro}
        </p>
      </Seccion>

      {/* ── Pedido especial ── */}
      <Seccion titulo={t.pedidoEspecial}>
        <CampoFino etiqueta={t.pedidoEspecial} etiquetaOculta ayuda={t.pedidoAyuda}>
          <textarea name="pedido" rows={4} maxLength={1000} className={`${CAMPO} resize-y`} />
        </CampoFino>
      </Seccion>

      {/* ── Condiciones y confirmación ── */}
      <div className="flex flex-col gap-5">
        {cancelacion.length > 0 && (
          <ul className="space-y-1.5 border-y border-tinta/10 py-4 text-sm text-tinta-suave">
            {cancelacion.map((linea) => (
              <li key={linea} className="flex items-start gap-2.5">
                <span aria-hidden="true" className="mt-[0.6rem] h-px w-2.5 shrink-0 bg-tinta/40" />
                {linea}
              </li>
            ))}
          </ul>
        )}

        <Casilla nombre="condiciones" requerido error={t.errorCondiciones}>
          {t.condiciones}
        </Casilla>
        <Casilla nombre="promociones">{t.promociones}</Casilla>
      </div>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}

      <div className="flex flex-col items-center gap-3 text-center">
        <button
          type="submit"
          disabled={pendiente}
          className="toque inline-flex w-full items-center justify-center bg-tinta px-10 py-4 text-sm font-medium tracking-[0.14em] text-white uppercase transition duration-300 hover:bg-black active:scale-[0.99] disabled:cursor-wait disabled:opacity-70 sm:w-auto"
        >
          {pendiente
            ? pagaAhora
              ? t.redirigiendo
              : t.reservando
            : pagaAhora
              ? `${t.confirmarYPagar} · ${importeElegido}`
              : t.confirmar}
        </button>
        {!pagaAhora && (
          <p className="max-w-md text-sm leading-relaxed text-stone-500">{t.nadaAhora}</p>
        )}
      </div>
    </form>
  )
}

/* ─────────────────────────────────────────────────────────── piezas ───── */

function Seccion({
  titulo,
  extra,
  children,
}: {
  titulo: string
  extra?: ReactNode
  children: ReactNode
}) {
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-tinta/10 pb-3">
        <h2 className="font-display text-lg font-normal tracking-[-0.005em] text-tinta">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  )
}

/**
 * Campo con etiqueta visible en versalitas —nunca sólo un `placeholder` (Fase
 * 15)— y el mensaje de error que aparece con `:user-invalid` del control que
 * va antes (`peer`).
 */
function CampoFino({
  etiqueta,
  requerido,
  error,
  ayuda,
  etiquetaOculta,
  children,
}: {
  etiqueta: string
  requerido?: boolean
  error?: string
  ayuda?: string
  /** Cuando la sección ya lo nombra: la etiqueta queda para el lector de pantalla. */
  etiquetaOculta?: boolean
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-2">
      <span
        className={
          etiquetaOculta
            ? 'sr-only'
            : 'text-[11px] font-medium tracking-[0.18em] text-tinta-suave uppercase'
        }
      >
        {etiqueta}
        {requerido && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {children}
      {error && <span className="hidden text-xs text-red-600 peer-user-invalid:block">{error}</span>}
      {ayuda && <span className="text-xs leading-snug text-stone-500">{ayuda}</span>}
    </label>
  )
}

/**
 * Una opción de pago: fila de una lista con filetes.
 *
 * Es un `<input type="radio">` real con su círculo redibujado: se elige con
 * las flechas del teclado y el lector de pantalla lo anuncia como grupo de
 * opciones sin JavaScript extra. El estado de React sólo cambia el botón.
 */
function OpcionMedio({
  valor,
  elegido,
  alElegir,
  titulo,
  detalle,
  derecha,
  pie,
}: {
  valor: string
  elegido: boolean
  alElegir: (v: string) => void
  titulo: string
  detalle: string
  derecha?: ReactNode
  pie?: ReactNode
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-4 border-b border-tinta/10 px-5 py-5 transition-colors duration-200 last:border-b-0 ${
        elegido ? 'bg-hueso/70' : 'hover:bg-hueso/40'
      }`}
    >
      <input
        type="radio"
        name="medio"
        value={valor}
        checked={elegido}
        onChange={() => alElegir(valor)}
        className="mt-0.5 size-[18px] shrink-0 cursor-pointer appearance-none rounded-full border border-tinta/40 bg-white transition-all checked:border-[6px] checked:border-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lago-600"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-4">
          <span className={`text-[15px] text-tinta ${elegido ? 'font-medium' : ''}`}>{titulo}</span>
          {derecha}
        </span>
        <span className="mt-1 block text-sm leading-snug text-tinta-suave">{detalle}</span>
        {pie}
      </span>
    </label>
  )
}

/**
 * Casilla de verificación nativa, teñida con el color de la tinta. Nativa a
 * propósito: el tilde, el foco y el anuncio al lector de pantalla los resuelve
 * el navegador, y un dibujo propio tendría que reimplementar los tres.
 */
function Casilla({
  nombre,
  requerido,
  error,
  children,
}: {
  nombre: string
  requerido?: boolean
  error?: string
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer flex-wrap items-start gap-3 text-sm leading-relaxed text-tinta">
      <input
        type="checkbox"
        name={nombre}
        required={requerido}
        className="peer mt-1 size-4 shrink-0 cursor-pointer accent-[#33302b]"
      />
      <span className="min-w-0 flex-1">
        {children}
        {requerido && (
          <span className="ml-1 text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {error && (
        <span className="hidden w-full pl-7 text-xs text-red-600 peer-user-invalid:block">{error}</span>
      )}
    </label>
  )
}

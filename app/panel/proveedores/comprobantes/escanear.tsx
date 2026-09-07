'use client'

import { useActionState, useRef, useState, useSyncExternalStore } from 'react'
import { cargarComprobanteDesdeQr, type EstadoComprobante } from './actions'
import { CAMPO, Campo, Mensaje, botonClases } from '../../_components/ui'

const ESTADO_INICIAL: EstadoComprobante = {}

/**
 * Escaneo del QR de una factura recibida (objetivo 9 del pedido).
 *
 * ── Cómo funciona, y qué NO hace ────────────────────────────────────────────
 *
 * Quien carga aprieta «Sacar foto», el teléfono abre la cámara, y **el QR se lee
 * acá, en el navegador**. Al servidor viaja sólo el texto del código: la imagen no
 * sale del dispositivo y no se guarda en ninguna parte. Guardar fotos de facturas
 * es gestión documental —Storage, retención, permisos por campo— y tiene su propio
 * ADR pendiente (0013); meterlo por la puerta de atrás dejaría archivos con datos
 * fiscales sin ninguna política.
 *
 * ── Por qué el QR y no reconocimiento de texto ──────────────────────────────
 *
 * El OCR adivina: un `8` leído como `3` en el importe da una factura plausible y
 * equivocada que nadie revisa, porque el sistema «ya la cargó». El QR obligatorio
 * de la factura electrónica argentina trae los datos que el emisor le informó a
 * ARCA, con su CAE. Mismo gesto, resultado autoritativo.
 *
 * ── El navegador que no puede ───────────────────────────────────────────────
 *
 * `BarcodeDetector` existe en Chrome y Edge (incluido Android) y **no** en Safari
 * ni Firefox. Cuando falta, la pantalla lo dice y ofrece las dos salidas que sí
 * funcionan en todos lados: pegar el enlace del QR —se puede leer con la cámara
 * del sistema y compartir el link— o cargar los datos a mano. Lo que no se hace
 * es esconder el botón y dejar a alguien apretando algo que nunca responde.
 */

/** Lo mínimo de la API que se usa. No hay tipos en `lib.dom` todavía. */
interface DetectorDeCodigos {
  detect(fuente: ImageBitmapSource): Promise<{ rawValue: string }[]>
}
type ConstructorDetector = new (opciones?: { formats?: string[] }) => DetectorDeCodigos

function detectorDisponible(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window
}

export function EscanearComprobante({
  proveedores,
  cuitHotel,
}: {
  proveedores: readonly { id: string; nombre: string }[]
  cuitHotel: string | null
}) {
  const [estado, accion, pendiente] = useActionState(cargarComprobanteDesdeQr, ESTADO_INICIAL)
  const [textoQr, setTextoQr] = useState('')
  const [errorLectura, setErrorLectura] = useState<string | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const campoQr = useRef<HTMLTextAreaElement>(null)

  /*
    Capacidad del navegador con `useSyncExternalStore` y no con `useState` +
    `useEffect`: volcarla a estado desde un efecto provoca un render en cascada y
    el linter lo corta (`react-hooks/set-state-in-effect`). El tercer argumento
    —el snapshot del servidor— no es opcional: sin él el render del servidor rompe
    porque `window` no existe.
  */
  const soportaEscaneo = useSyncExternalStore(
    () => () => {},
    detectorDisponible,
    () => false,
  )

  async function leerImagen(archivo: File) {
    setErrorLectura(null)
    setLeyendo(true)
    try {
      const Detector = (window as unknown as { BarcodeDetector: ConstructorDetector })
        .BarcodeDetector
      const detector = new Detector({ formats: ['qr_code'] })
      const bitmap = await createImageBitmap(archivo)
      const codigos = await detector.detect(bitmap)
      bitmap.close?.()

      if (codigos.length === 0) {
        setErrorLectura(
          'No se encontró ningún código QR en la foto. Probá con más luz, más cerca y con el papel lo más plano posible.',
        )
        return
      }
      setTextoQr(codigos[0].rawValue)
      campoQr.current?.focus()
    } catch {
      // Un archivo que no es una imagen, un formato que el navegador no decodifica,
      // o la API fallando. No se distingue el motivo porque para quien saca la foto
      // la salida es la misma.
      setErrorLectura(
        'No se pudo leer la foto. Probá de nuevo, o pegá el enlace del QR más abajo.',
      )
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <form action={accion} className="flex flex-col gap-3 p-5">
      <input type="hidden" name="cuit_hotel" value={cuitHotel ?? ''} />

      {soportaEscaneo ? (
        <Campo
          etiqueta="Foto de la factura"
          ayuda="Se lee el código QR en este dispositivo. La foto NO se envía ni se guarda."
        >
          <input
            type="file"
            accept="image/*"
            // Abre la cámara trasera directamente en el teléfono.
            capture="environment"
            className={CAMPO}
            onChange={(e) => {
              const archivo = e.target.files?.[0]
              if (archivo) void leerImagen(archivo)
            }}
          />
        </Campo>
      ) : (
        <div className="rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200">
          <p className="font-semibold">Este navegador no puede leer el QR de una foto.</p>
          <p className="mt-1 text-stone-700">
            Funciona en Chrome y en Edge, también en Android. Desde acá tenés dos caminos que
            sirven igual: leer el QR con la cámara del teléfono y pegar el enlace abajo, o cargar
            los datos a mano.
          </p>
        </div>
      )}

      {/* `Mensaje` sólo tiene «error» y «ok»; esto es un estado en curso, así que
          va como texto y con `aria-live` para que un lector de pantalla lo diga. */}
      {leyendo && (
        <p className="text-sm text-stone-600" aria-live="polite">
          Leyendo el código…
        </p>
      )}
      {errorLectura && <Mensaje tono="error">{errorLectura}</Mensaje>}

      <Campo
        etiqueta="Contenido del QR"
        ayuda="Se completa solo al sacar la foto. También podés pegar acá el enlace que devuelve la cámara del teléfono."
      >
        <textarea
          ref={campoQr}
          name="qr"
          rows={2}
          required
          value={textoQr}
          onChange={(e) => setTextoQr(e.target.value)}
          placeholder="https://www.arca.gob.ar/fe/qr/?p=..."
          className={`${CAMPO} font-mono text-xs`}
        />
      </Campo>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo
          etiqueta="Proveedor"
          ayuda="Opcional acá: se puede vincular después, al imputarlo a su cuenta."
        >
          <select name="proveedor_id" defaultValue="" className={CAMPO}>
            <option value="">Sin vincular</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>

        {/* La razón social NO viene en el QR: el código trae el CUIT del emisor. */}
        <Campo etiqueta="Razón social" ayuda="El QR no la trae: sólo el CUIT del emisor.">
          <input name="razon_social" maxLength={120} className={CAMPO} />
        </Campo>
      </div>

      {estado.error && <Mensaje tono="error">{estado.error}</Mensaje>}
      {estado.ok && (
        <Mensaje tono="ok">
          {estado.ok} {estado.resumen}
        </Mensaje>
      )}

      {estado.avisos && estado.avisos.length > 0 && (
        <div className="rounded-lg bg-lenga-50 px-4 py-3 text-sm text-lenga-900 ring-1 ring-lenga-200">
          <p className="font-semibold">Revisá antes de imputarlo:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {estado.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="submit"
        disabled={pendiente || textoQr.trim() === ''}
        className={botonClases(
          'primario',
          'w-full self-start disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto',
        )}
      >
        {pendiente ? 'Guardando…' : 'Cargar el comprobante'}
      </button>
    </form>
  )
}

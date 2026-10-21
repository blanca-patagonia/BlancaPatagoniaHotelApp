import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  tiposUnidadPublicos,
  tarifasPublicas,
  rangosTemporadaPublicos,
  politicaCancelacionPublica,
} from '@/lib/catalogo/publico'
import type { CategoriaUnidad } from '@/lib/domain/unidades'
import { HORA_CHECK_IN, HORA_CHECK_OUT, ADMITE_MASCOTAS } from '@/lib/domain/hotel'
import { parsearRango } from '@/lib/domain/temporadas'
import { claveDeComodidad } from '@/lib/domain/comodidades'
import {
  ordenarCatalogo,
  precioVigente,
  conIva,
  fotoDe,
  fotosDe,
  type TipoCatalogo,
} from '@/lib/domain/catalogo'
import { formatearUSD } from '@/lib/domain/moneda'
import { hoyISO, sumarDias } from '@/lib/fechas'
import { Etiqueta, Tarjeta, botonPublico } from '@/app/(front-publico)/_publico/ui'
import { Marco } from '@/app/(front-publico)/_publico/marco'
import { Galeria } from '@/app/(front-publico)/_publico/galeria'
import { IconoComodidad } from '@/app/(front-publico)/_publico/icono-comodidad'
import { PortadaAlojamiento } from '../_portada'
import { JsonLdHotel } from '@/app/(front-publico)/_publico/jsonld-hotel'
import {
  textos,
  rellenar,
  idiomaValido,
  rutaConIdioma,
  alternativasDeIdioma,
  textoCapacidadEn,
  textoComodidad,
  fechaCortaEn,
  lineasCancelacion,
} from '@/lib/i18n'

interface FilaTipo {
  id: string
  codigo: string
  nombre: string
  categoria: CategoriaUnidad
  capacidad_max: number
  descripcion: string
  amenities: unknown
}

function leerAmenities(valor: unknown): string[] {
  if (Array.isArray(valor)) return valor.filter((v): v is string => typeof v === 'string')
  if (typeof valor === 'string') {
    try {
      return leerAmenities(JSON.parse(valor))
    } catch {
      return []
    }
  }
  return []
}

/**
 * Busca el tipo por su código público. `null` si no existe o está dado de baja.
 *
 * Va envuelto en `cache` porque Next llama a `generateMetadata` y al componente
 * por separado: sin esto, cada visita haría la misma consulta dos veces.
 */
const tipoPorCodigo = cache(async function tipoPorCodigo(codigo: string) {
  // Del catálogo cacheado (`lib/catalogo/publico.ts`): ya trae sólo los activos.
  const tipos = await tiposUnidadPublicos()
  return (tipos.find((t) => t.codigo === codigo) as FilaTipo | undefined) ?? null
})

/**
 * Metadatos por alojamiento.
 *
 * No es un detalle cosmético: estas páginas son las que el hotel va a compartir
 * por WhatsApp y las que puede indexar un buscador. Sin esto, todas se anuncian
 * con el mismo título y el enlace compartido no dice cuál es.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ idioma: string; codigo: string }>
}) {
  const { idioma, codigo } = await params
  const tx = textos(idioma)
  const tipo = await tipoPorCodigo(codigo)
  if (!tipo) return { title: `${tx.ficha.noEncontrado} — Blanca Patagonia` }

  const titulo = `${tipo.nombre} — Blanca Patagonia`
  const descripcion =
    tipo.descripcion ||
    rellenar(tx.ficha.metaDescripcion, {
      categoria: tx.categorias[tipo.categoria],
      capacidad: textoCapacidadEn(tx, tipo.capacidad_max),
    })
  const foto = fotoDe(tipo.codigo)

  return {
    title: titulo,
    description: descripcion,
    alternates: alternativasDeIdioma(idioma, `/alojamientos/${codigo}`),
    openGraph: {
      title: titulo,
      description: descripcion,
      images: foto ? [foto] : undefined,
    },
    twitter: {
      title: titulo,
      description: descripcion,
      images: foto ? [foto] : undefined,
    },
  }
}

/**
 * Ficha de un alojamiento.
 *
 * Estructura tomada de las fichas de habitación de Aman: la galería ocupa la
 * mitad izquierda; a la derecha van el nombre, la descripción, UN precio
 * «desde … / noche, impuestos incluidos» con el botón para ver tarifas, y
 * debajo la grilla de comodidades con íconos de línea.
 *
 * ⚠️ **Un solo precio, el de la temporada vigente.** Antes había una tabla con
 * los tres precios por temporada, que obligaba al huésped a cruzar fechas para
 * saber cuál le tocaba. `precioVigente` elige el de la temporada en la que cae
 * hoy y cambia solo el día que empieza la siguiente; si hoy no hay temporada
 * cargada (el invierno), anuncia la próxima y lo dice. El precio exacto de una
 * estadía lo da `/reservar`, que cotiza noche por noche.
 */
export default async function AlojamientoDetallePage({
  params,
}: {
  params: Promise<{ idioma: string; codigo: string }>
}) {
  const { idioma: crudo, codigo } = await params
  const idioma = idiomaValido(crudo)
  const tx = textos(idioma)
  const ruta = (r: string) => rutaConIdioma(r, idioma)
  const fila = await tipoPorCodigo(codigo)
  // Un código inventado o un alojamiento dado de baja dan 404 de verdad, no una
  // pantalla vacía: el enlace compartido tiene que decir con claridad qué pasó.
  if (!fila) notFound()

  const tipo: TipoCatalogo = {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    categoria: fila.categoria,
    capacidadMax: fila.capacidad_max,
    descripcion: fila.descripcion,
    amenities: leerAmenities(fila.amenities),
  }

  /*
    Todo sale del catálogo cacheado, el mismo que usa el listado: antes eran
    4 consultas por visita sin caché. Se invalida al editar una tarifa o una
    temporada en el panel, y «hoy» se sigue resolviendo en cada pedido.
  */
  const [todosLosTipos, todasLasTarifas, todosLosRangos, reglasCancelacion] = await Promise.all([
    tiposUnidadPublicos(),
    tarifasPublicas(),
    rangosTemporadaPublicos(),
    politicaCancelacionPublica(),
  ])
  // `precio_rack` únicamente: el neto es de agencia (migración 0031).
  const tarifasRes = { data: todasLasTarifas.filter((t) => t.tipo_unidad_id === tipo.id) }
  const rangosRes = { data: todosLosRangos }
  const otrosRes = {
    data: todosLosTipos.filter((t) => t.categoria === tipo.categoria && t.id !== tipo.id),
  }

  const precios = ((tarifasRes.data ?? []) as unknown as {
    precio_rack: number | string
    iva_pct: number | string
    temporada: { codigo: string } | null
  }[])
    .filter((t) => t.temporada)
    .map((t) => ({
      temporada: t.temporada!.codigo,
      // Con IVA: `precio_rack` se guarda sin él (ADR 0004) y el checkout lo
      // suma. Publicar el valor crudo sería anunciar un precio que no es.
      precio: conIva(Number(t.precio_rack), Number(t.iva_pct)),
    }))

  const rangos = ((rangosRes.data ?? []) as unknown as {
    rango: string
    temporada: { codigo: string } | null
  }[])
    .filter((r) => r.temporada)
    .map((r) => ({ temporada: r.temporada!.codigo, ...parsearRango(r.rango) }))

  // «Hoy» en la zona del hotel (`hoyISO`), no en la del servidor: si no, entre
  // las 21 y la medianoche de El Calafate el cambio de temporada se adelantaría.
  const vigente = precioVigente(precios, rangos, hoyISO())
  const nombreTemporada = (codigoTemporada: string) =>
    tx.ficha.temporadas[codigoTemporada as keyof typeof tx.ficha.temporadas] ?? codigoTemporada
  const leyendaTemporada = vigente
    ? vigente.esProxima
      ? rellenar(tx.ficha.proximaDesde, {
          temporada: nombreTemporada(vigente.temporada),
          fecha: fechaCortaEn(vigente.desde, idioma),
        })
      : rellenar(tx.ficha.vigenteHasta, {
          temporada: nombreTemporada(vigente.temporada),
          // El fin del rango está excluido: la última noche es el día anterior.
          fecha: fechaCortaEn(sumarDias(vigente.hasta, -1), idioma),
        })
    : null

  const otros = ordenarCatalogo(
    ((otrosRes.data ?? []) as FilaTipo[]).map((t) => ({
      id: t.id,
      codigo: t.codigo,
      nombre: t.nombre,
      categoria: t.categoria,
      capacidadMax: t.capacidad_max,
      descripcion: t.descripcion,
      amenities: leerAmenities(t.amenities),
    })),
  ).slice(0, 3)

  const categoriaTexto = tx.categorias[tipo.categoria]
  const fotos = fotosDe(tipo.codigo, tipo.categoria).map((src, i) => ({
    src,
    alt: i === 0 ? `${tipo.nombre} — ${categoriaTexto}` : `${categoriaTexto} — ${i + 1}`,
  }))

  // La capacidad encabeza la grilla: es lo primero que se pregunta quien
  // viaja en grupo, antes que el Wi-Fi.
  const comodidades = [
    { clave: 'personas' as const, texto: textoCapacidadEn(tx, tipo.capacidadMax) },
    ...tipo.amenities.map((a) => ({
      clave: claveDeComodidad(a),
      texto: textoComodidad(a, idioma, tx),
    })),
  ]

  return (
    <Marco idioma={idioma} volver={{ href: ruta('/alojamientos'), texto: tx.catalogo.todosLosAlojamientos }}>
      <JsonLdHotel />

      <article
        data-revelar
        className="grid overflow-hidden rounded-3xl bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_-12px_rgb(0_0_0/0.12)] ring-1 ring-tinta/5 lg:grid-cols-[1.15fr_1fr]"
      >
        <div className="relative min-h-72 sm:min-h-96">
          {fotos.length > 0 ? (
            <Galeria
              fotos={fotos}
              textos={{
                anterior: tx.ficha.fotoAnterior,
                siguiente: tx.ficha.fotoSiguiente,
                fotoN: tx.ficha.fotoN,
              }}
            />
          ) : (
            <PortadaAlojamiento
              codigo={tipo.codigo}
              nombre={tipo.nombre}
              categoria={tipo.categoria}
              etiquetaCategoria={categoriaTexto}
              alto="hero"
            />
          )}
        </div>

        <div className="flex flex-col p-6 sm:p-8 lg:p-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.22em] text-lago-700/70 uppercase">
                {categoriaTexto}
              </p>
              <h1 className="mt-2 font-display text-3xl leading-tight font-semibold tracking-[-0.02em] text-balance text-tinta sm:text-4xl">
                {tipo.nombre}
              </h1>
              {tipo.descripcion && (
                <p className="mt-3 leading-relaxed text-tinta-suave">{tipo.descripcion}</p>
              )}
            </div>
          </div>

          {/* Precio y botón, juntos: la decisión se toma acá. */}
          <div className="mt-6 flex flex-col gap-4 border-y border-tinta/10 py-5">
            {vigente ? (
              <div>
                <p className="text-sm text-tinta-suave">{tx.catalogo.desde}</p>
                <p className="font-display text-3xl leading-none font-semibold tracking-tight whitespace-nowrap text-tinta tabular-nums sm:text-4xl">
                  {formatearUSD(vigente.precio)}{' '}
                  <span className="text-lg font-normal text-tinta-suave">{tx.ficha.porNocheCorto}</span>
                </p>
                <p className="mt-1.5 text-xs text-stone-500">
                  {tx.ficha.impuestos} · {leyendaTemporada}
                </p>
              </div>
            ) : (
              /* Sin tarifa cargada no se inventa un número: decir «USD 0»
                 fue un bug real (Fase 18). */
              <p className="text-tinta-suave">{tx.ficha.sinTarifas}</p>
            )}
            <Link
              href={ruta(`/reservar?tipo=${tipo.id}`)}
              className={botonPublico('primario', 'w-full shrink-0 rounded-full sm:w-auto sm:self-start active:scale-[0.97]')}
            >
              {tx.ficha.verTarifas}
            </Link>
          </div>
          {vigente && <p className="mt-2 text-xs text-stone-400">{tx.ficha.precioSegunFechas}</p>}

          <h2 className="sr-only">{tx.ficha.comodidades}</h2>
          <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-3">
            {comodidades.map((cm) => (
              <li key={cm.texto} className="flex flex-col items-center gap-2 text-center">
                <IconoComodidad clave={cm.clave} />
                <span className="text-sm leading-snug text-tinta-suave">{cm.texto}</span>
              </li>
            ))}
          </ul>

          <a
            href="#detalles"
            className="toque group mt-auto inline-flex items-center gap-2 self-end pt-6 text-sm text-tinta-suave transition hover:text-tinta"
          >
            {tx.ficha.verDetalles}
            <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-y-0.5">
              ↓
            </span>
          </a>
        </div>
      </article>

      {fotos.length > 1 && <p className="mt-3 text-xs text-stone-400">{tx.ficha.galeriaNota}</p>}

      <section id="detalles" className="scroll-mt-24">
        <Tarjeta titulo={tx.portada.antesDeReservar} className="mt-8">
          <dl className="grid gap-4 p-5 sm:grid-cols-2 sm:px-6">
            <div>
              <dt className="text-sm font-medium text-tinta-suave">{tx.ficha.horarios}</dt>
              <dd className="mt-0.5 text-stone-800">
                {rellenar(tx.ficha.horariosValor, { entrada: HORA_CHECK_IN, salida: HORA_CHECK_OUT })}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-tinta-suave">{tx.ficha.mascotas}</dt>
              <dd className="mt-0.5 text-stone-800">
                {ADMITE_MASCOTAS ? tx.ficha.conMascotas : tx.ficha.sinMascotas}
              </dd>
            </div>
            {/* La política sale del Tarifario y es la misma que aplica el sistema
                al calcular un cargo por cancelación: decirla antes evita el
                reclamo después. */}
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-tinta-suave">{tx.ficha.cancelacion}</dt>
              <dd className="mt-0.5 leading-relaxed text-stone-800">
                {/* Desde las reglas vigentes, como el checkout: un texto fijo
                    seguía publicando la política vieja si el hotel la cambiaba. */}
                {reglasCancelacion.length > 0
                  ? lineasCancelacion(reglasCancelacion, tx).join(' ')
                  : tx.ficha.cancelacionTexto}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-tinta-suave">{tx.catalogo.queIncluye}</dt>
              <dd className="mt-2 flex flex-wrap gap-1.5">
                {tipo.amenities.map((a) => (
                  <Etiqueta key={a}>{textoComodidad(a, idioma, tx)}</Etiqueta>
                ))}
              </dd>
            </div>
          </dl>
        </Tarjeta>
      </section>

      {otros.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display mb-4 text-xl font-semibold text-tinta">
            {rellenar(tx.ficha.otrasOpciones, { categoria: categoriaTexto })}
          </h2>
          <ul className="grid gap-5 sm:grid-cols-3">
            {otros.map((o) => (
              <li key={o.id} data-revelar className="flex">
                <Link href={ruta(`/alojamientos/${o.codigo}`)} className="group flex w-full flex-col">
                  <div className="overflow-hidden rounded-xl transition duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 group-hover:shadow-xl">
                    <PortadaAlojamiento
                      codigo={o.codigo}
                      nombre={o.nombre}
                      categoria={o.categoria}
                      etiquetaCategoria={tx.categorias[o.categoria]}
                    />
                  </div>
                  <h3 className="mt-3 font-display font-semibold text-tinta transition group-hover:text-lago-800">
                    {o.nombre}
                  </h3>
                  <p className="mt-0.5 text-sm text-tinta-suave">{textoCapacidadEn(tx, o.capacidadMax)}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Marco>
  )
}

import { Pagina, Encabezado, Tarjeta } from '../../_components/ui'

export default function Cargando() {
  return (
    <Pagina>
      <Encabezado
        titulo="Columnas del informe"
        descripcion="Qué columna del archivo del extranet corresponde a cada dato."
      />
      <Tarjeta titulo="Cargando…">
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-stone-100" />
          ))}
        </div>
      </Tarjeta>
    </Pagina>
  )
}

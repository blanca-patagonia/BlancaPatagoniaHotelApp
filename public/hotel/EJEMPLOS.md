# Ejemplos de uso — Cómo integrar las fotos en la landing

Una vez que subas las fotos, se pueden integrar en la landing de varias formas.

## 1. Hero con imagen de fondo

Reemplazar el gradiente actual por una foto hero:

```tsx
// app/page.tsx
<section className="relative flex flex-1 flex-col items-center justify-center gap-6 px-5 py-16 text-center sm:px-6 sm:py-20">
  {/* Imagen de fondo con overlay oscuro para legibilidad del texto */}
  <div className="absolute inset-0 z-0">
    <Image
      src="/hotel/fotos/hero/lago-argentino.jpg"
      alt=""
      fill
      className="object-cover"
      priority
    />
    <div className="absolute inset-0 bg-stone-900/40" />
  </div>

  {/* Contenido sobre la imagen (z-10 para estar arriba) */}
  <div className="relative z-10">
    <p className="text-sm font-medium tracking-[0.2em] text-white uppercase">
      Hostería boutique &amp; cabañas
    </p>
    <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight text-white sm:text-6xl">
      Blanca Patagonia
    </h1>
    {/* ... resto del contenido ... */}
  </div>
</section>
```

## 2. Galería de servicios

Agregar una sección con fotos de servicios después del buscador:

```tsx
// Nueva sección en app/page.tsx
<section className="py-16 px-5 sm:px-6 bg-white">
  <div className="mx-auto max-w-5xl">
    <h2 className="text-3xl font-display font-semibold text-stone-900 text-center mb-8">
      Descubrí nuestras instalaciones
    </h2>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="relative aspect-square rounded-lg overflow-hidden">
        <Image
          src="/hotel/fotos/servicios/hidromasaje.jpg"
          alt="Hidromasaje en habitación"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/60 to-transparent flex items-end p-4">
          <span className="text-white font-medium">Hidromasaje privado</span>
        </div>
      </div>
      <div className="relative aspect-square rounded-lg overflow-hidden">
        <Image
          src="/hotel/fotos/exteriores/vista-lago.jpg"
          alt="Vista al Lago Argentino"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/60 to-transparent flex items-end p-4">
          <span className="text-white font-medium">Vista al lago</span>
        </div>
      </div>
      <div className="relative aspect-square rounded-lg overflow-hidden">
        <Image
          src="/hotel/fotos/gastronomia/desayuno.jpg"
          alt="Desayuno buffet"
          fill
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/60 to-transparent flex items-end p-4">
          <span className="text-white font-medium">Desayuno incluido</span>
        </div>
      </div>
    </div>
  </div>
</section>
```

## 3. Carrusel de habitaciones

Para `/alojamientos/[codigo]/page.tsx` (detalle de cada tipo):

```tsx
// Componente de galería simple
'use client'
import { useState } from 'react'
import Image from 'next/image'

const fotos = [
  '/hotel/fotos/habitaciones/suite-principal-1.jpg',
  '/hotel/fotos/habitaciones/suite-principal-2.jpg',
  '/hotel/fotos/habitaciones/suite-principal-3.jpg',
]

export function GaleriaHabitacion() {
  const [actual, setActual] = useState(0)

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg">
      <Image
        src={fotos[actual]}
        alt={`Vista ${actual + 1} de ${fotos.length}`}
        fill
        className="object-cover"
      />
      
      {/* Botones anterior/siguiente */}
      <button
        onClick={() => setActual((actual - 1 + fotos.length) % fotos.length)}
        className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-lg hover:bg-white"
      >
        ←
      </button>
      <button
        onClick={() => setActual((actual + 1) % fotos.length)}
        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 shadow-lg hover:bg-white"
      >
        →
      </button>

      {/* Indicadores */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
        {fotos.map((_, i) => (
          <button
            key={i}
            onClick={() => setActual(i)}
            className={`size-2 rounded-full ${i === actual ? 'bg-white' : 'bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  )
}
```

## 4. Video hero (alternativa)

Si preferís un video de fondo en vez de foto:

```tsx
<section className="relative flex flex-1 flex-col items-center justify-center">
  {/* Video de fondo con loop automático y sin sonido */}
  <video
    autoPlay
    muted
    loop
    playsInline
    className="absolute inset-0 size-full object-cover"
  >
    <source src="/hotel/videos/vista-lago-drone.mp4" type="video/mp4" />
  </video>
  <div className="absolute inset-0 bg-stone-900/40" />
  
  {/* Contenido sobre el video */}
  <div className="relative z-10 px-5 text-center">
    {/* ... */}
  </div>
</section>
```

## 5. Optimización automática con next/image

El componente `Image` de Next.js optimiza automáticamente:
- **Lazy loading:** las imágenes se cargan cuando entran en el viewport
- **Responsive:** sirve diferentes tamaños según el dispositivo
- **Formatos modernos:** convierte a WebP/AVIF si el navegador lo soporta
- **Placeholder blur:** muestra un blur mientras carga (opcional)

Ejemplo con blur:

```tsx
import Image from 'next/image'
import fotoHero from '@/public/hotel/fotos/hero/portada.jpg'

<Image
  src={fotoHero}
  alt="Blanca Patagonia"
  placeholder="blur"  // Genera blur automático del import
  priority            // Carga inmediata (solo para hero)
/>
```

## Checklist de integración

Una vez que tengas las fotos subidas:

- [ ] Actualizar metadata de `app/page.tsx` con la foto hero real
- [ ] Reemplazar gradiente por imagen de fondo en la portada
- [ ] Agregar sección de servicios con 3-6 fotos destacadas
- [ ] Crear galería para cada tipo de alojamiento en `/alojamientos/[codigo]`
- [ ] Configurar lazy loading para todas las imágenes excepto hero
- [ ] Probar en móvil que las imágenes se vean bien (object-cover, aspect-ratio)
- [ ] Verificar tiempos de carga con Lighthouse (score > 90)

## Herramientas útiles

- **[ImageMagick](https://imagemagick.org/)** — redimensionar batch desde terminal
- **[sharp](https://sharp.pixelplumbing.com/)** — optimización programática (si necesitás un script)
- **[next-image-export-optimizer](https://github.com/Niels-IO/next-image-export-optimizer)** — para static export (no hace falta en Vercel)

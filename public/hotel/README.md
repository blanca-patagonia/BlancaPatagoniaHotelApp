# Medios del Hotel — Fotos y Videos

Carpeta para las imágenes y videos del hotel que se usan en la landing y el portal público.

## Estructura

```
public/
├── hotel/
│   ├── fotos/
│   │   ├── hosteria/       → habitaciones, fachada y espacios de la hostería
│   │   ├── cabanas/        → interiores de las cabañas
│   │   ├── lobby/          → recepción y espacios comunes
│   │   ├── gastronomia/    → desayuno y comedor
│   │   ├── lavanda/        → jardín de lavandas
│   │   └── poster-video.jpg → cuadro fijo del video de portada (y foto del manifiesto)
│   └── videos/
│       ├── blanca-hero.mp4       → video de la portada, 1080p (escritorio)
│       └── blanca-hero-movil.mp4 → la misma toma en 540p, sin audio ni timecode, para
│                                   pantallas de hasta 768 px (6,6 MB contra 18,3)
├── alojamientos/           → una foto por tipo de unidad (la toma el catálogo)
├── sw.js, sin-conexion.html → service worker y pantalla offline del panel (ADR 0028)
└── plantilla-next-sin-uso/ → SVG que trajo la plantilla de Next; nadie los usa
```

⚠️ El master del video institucional (`.mov`, ~550 MB) está en `.gitignore`:
GitHub rechaza archivos de más de 100 MB. El sitio usa `blanca-hero.mp4`.

## Dimensiones recomendadas

### Foto hero (portada principal)
- **Ancho:** 1920-2400 px
- **Alto:** 1080-1350 px (landscape o cuadrado)
- **Peso:** < 500 KB (optimizada con WebP o JPEG de alta calidad)
- **Qué mostrar:** vista panorámica del hotel, lago, o la habitación más representativa

### Fotos de habitaciones y exteriores
- **Ancho:** 1200-1600 px
- **Alto:** 800-1200 px
- **Peso:** < 300 KB cada una
- **Formato:** WebP preferido, JPEG como fallback

### Fotos de servicios y detalles
- **Ancho:** 800-1200 px
- **Alto:** 600-900 px
- **Peso:** < 200 KB cada una

### Videos
- **Duración:** 10-30 segundos (máximo 1 minuto)
- **Resolución:** 1920x1080 (Full HD) o 1280x720 (HD)
- **Peso:** < 5 MB (usar compresión H.264)
- **Formato:** MP4 o WebM

## Nombres de archivo

Usar nombres descriptivos en minúsculas, con guiones en vez de espacios:

✅ Bien:
- `hero-lago-argentino.jpg`
- `suite-principal-vista.jpg`
- `exterior-fachada-atardecer.jpg`
- `hidromasaje-habitacion-doble.jpg`
- `desayuno-buffet.jpg`

❌ Evitar:
- `IMG_1234.jpg`
- `Foto del Hotel.jpg`
- `DCIM0042.JPG`

## Cómo se usan en el código

Las imágenes en `public/hotel/` se referencian desde la raíz:

```tsx
// En componentes de React
<img src="/hotel/fotos/hero/lago-argentino.jpg" alt="..." />

// Con Next.js Image (optimización automática)
import Image from 'next/image'
<Image
  src="/hotel/fotos/habitaciones/suite-principal.jpg"
  alt="Suite principal con vista al lago"
  width={1200}
  height={800}
/>

// En metadata (Open Graph, Twitter)
export const metadata = {
  openGraph: {
    images: ['/hotel/fotos/hero/portada-principal.jpg'],
  },
}
```

## Optimización antes de subir

1. **Redimensionar** a las dimensiones recomendadas (no subir fotos de 4000x3000 px)
2. **Comprimir** con herramientas como:
   - [Squoosh.app](https://squoosh.app/) (web, gratis)
   - [ImageOptim](https://imageoptim.com/) (Mac)
   - [TinyPNG](https://tinypng.com/) (web, gratis)
3. **Convertir a WebP** si es posible (mejor compresión que JPEG)
4. **Verificar el peso** antes de subir (los límites arriba son máximos recomendados)

Para regenerar la versión móvil desde la de escritorio:

```bash
ffmpeg -i blanca-hero.mp4 -map 0:v:0 -vf "scale=-2:540" -c:v libx264 -preset slow \
  -tune film -crf 26 -maxrate 700k -bufsize 1400k -profile:v high -pix_fmt yuv420p \
  -an -dn -sn -map_metadata -1 -write_tmcd 0 -movflags +faststart blanca-hero-movil.mp4
```

Con `-maxrate 400k` pesa 3,8 MB pero el fondo desenfocado se llena de bloques:
se probó y se descartó.

## Dónde se usan

- **Portada** (`src/app/(front-publico)/[idioma]/page.tsx`): video, galería y manifiesto.
- **Catálogo y ficha** (`src/app/(front-publico)/[idioma]/alojamientos/`): las fotos de
  `alojamientos/` y la galería de cada tipo (`fotosDe` en `src/lib/domain/catalogo.ts`).

## Notas

- Las fotos deben ser **del hotel real** (no stock photos)
- Verificar que tengan buena iluminación y estén en foco
- Preferir fotos horizontales (landscape) para portada y habitaciones
- Los videos deben estar estabilizados y con audio opcional
- No subir fotos con datos personales de huéspedes visibles

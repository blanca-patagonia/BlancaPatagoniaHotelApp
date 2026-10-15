# Medios del Hotel — Fotos y Videos

Carpeta para las imágenes y videos del hotel que se usan en la landing y el portal público.

## Estructura

```
public/hotel/
├── fotos/
│   ├── hero/           → Imagen principal de portada (1-2 fotos máximo)
│   ├── habitaciones/   → Habitaciones, suites y cabañas
│   ├── exteriores/     → Fachada, jardín, vistas del lago
│   ├── servicios/      → Hidromasaje, hogar a leña, espacios comunes
│   └── gastronomia/    → Desayuno, comedor, cocina
└── videos/             → Videos cortos para la portada o secciones destacadas
```

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

## Próximos pasos

Una vez subidas las fotos:
1. Actualizar `app/page.tsx` para incluir la sección hero con imagen de fondo
2. Ampliar `/alojamientos` con galerías de cada tipo de unidad
3. Agregar sección "Conocé el hotel" con fotos de servicios y exteriores
4. Configurar lazy loading y responsive images con `next/image`

## Notas

- Las fotos deben ser **del hotel real** (no stock photos)
- Verificar que tengan buena iluminación y estén en foco
- Preferir fotos horizontales (landscape) para portada y habitaciones
- Los videos deben estar estabilizados y con audio opcional
- No subir fotos con datos personales de huéspedes visibles

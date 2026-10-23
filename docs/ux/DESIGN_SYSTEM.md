# Sistema de diseño — COLESCOMEX Field Capture (UX v1)

Interfaz móvil para captura de proveedores en feria: se usa de pie, con una mano, con sol o con poca luz y con prisa.
Todo vive en `src/ui/` y no requiere framework ni dependencias nuevas.

| Archivo | Contenido |
|---|---|
| `styles.css` | Tokens (`:root`), tema oscuro y todos los componentes |
| `theme.ts` | Preferencia de tema: sistema, claro u oscuro (persistida en `localStorage['cx.theme']`) |
| `icons.ts` | Iconografía propia en SVG (trazo de 2 px y 24×24, sin red) |
| `dom.ts` | `h()`, toast accesible, hoja inferior con foco atrapado, `confirmSheet`, URLs de objeto y `LazyThumbs` |
| `components.ts` | Barra superior, navegación inferior, chips, tres etapas, métricas, avisos, `kv`, secciones, segmentado y filtros |
| `model.ts` | Modelo de presentación puro: estado técnico → mensaje para el operador (probado en `tests/ui-design.test.ts`) |
| `features.ts` | Indicadores de funciones futuras, desactivados por defecto |

## Identidad

- **Marca**:
  - azul marino COLESCOMEX `--brand #0f1b2d`;
  - ámbar de acento `--accent #f4b400` (marca de texto y avatar);
  - azul de acción `--primary #1554c6`.
- **Referencia visual**: la imagen de Amigo GPT mencionada en el encargo **no llegó**. Solo se aplicaron los principios descritos en el encargo (acabado, jerarquía, consistencia, claro/oscuro), sin copiar ninguna identidad.

## Tokens

| Grupo | Tokens |
|---|---|
| Superficies | `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--overlay` |
| Texto | `--ink` (principal), `--ink-2` (secundario), `--muted` (atenuado), `--link` (texto interactivo), `--on-brand` |
| Líneas | `--line`, `--line-strong` |
| Acción | `--primary`, `--primary-hover`, `--primary-ink`, `--primary-soft` |
| Estado | `--ok`, `--warn`, `--err`, `--info`, `--neutral`, cada uno con su variante `*-soft` (fondo) |
| Radios | `--r-sm 8`, `--r-md 12`, `--r-lg 16`, `--r-xl 22`, `--r-full` |
| Espaciado | `--s1 4`, `--s2 8`, `--s3 12`, `--s4 16`, `--s5 20`, `--s6 24`, `--s8 32` |
| Tipografía | fuente del sistema con Noto Sans SC o PingFang SC para chino; escala `--t-xs .75rem` … `--t-2xl 1.75rem` |
| Táctil | `--tap 48px`, `--tap-lg 56px`, `--nav-h 64px` |
| Zonas seguras | `--safe-t`, `--safe-b` (`env(safe-area-inset-*)`) |

### Tema oscuro

Se activa de dos formas:

1. **Sistema**: `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])`.
2. **Elección explícita**: `:root[data-theme="dark"]`.

`theme.ts` también actualiza `<meta name="theme-color">`.

### Contraste

Lo verifica `tests/ui-design.test.ts` con WCAG 2.x en los dos temas:

- **Texto principal ≥ 7:1**: `--ink` sobre `--bg` y sobre `--surface`, pensado para uso en exteriores.
- **Texto atenuado, enlaces y texto de estado ≥ 4.5:1**: sobre las superficies, y cada `*-soft` con su color de estado.
- **Texto sobre la barra de marca ≥ 7:1.**

## Componentes

| Componente | Clase o función | Notas |
|---|---|---|
| Barra superior | `appBar()` · `.appbar` | Fija; botón Volver de 48 px; píldora de red «En línea» o «Sin conexión» |
| Navegación inferior | `bottomNav()` · `.bottom-nav` | Cinco destinos. «Nueva captura» es el botón central de 62 px en la zona del pulgar; Revisión lleva un contador |
| Botones | `.btn` + `.primary` / `.ghost` / `.danger` / `.lg` / `.block` / `.sm` | Mínimo 48 px (`.sm` 40 px) |
| Botón de icono | `.icon-btn` | 48×48, siempre con `aria-label` |
| Tarjeta de proveedor | `supplierCard()` · `.supplier` | Miniatura diferida, empresa (o «Empresa pendiente de identificar»), contacto, referencia, fecha, operador y chips de Lectura y Google |
| Chips | `chip()` / `trackChip()` · `.chip.ok/.warn/.err/.info` | Siempre icono + texto (el color nunca es la única señal) |
| Tres etapas | `tracks3()` · `.tracks-3` | Foto (teléfono) · Datos (extracción) · Google (copia en la nube) |
| Métricas | `metric()` · `.metric` | Botones que llevan al filtro correspondiente |
| Avisos | `notice()` · `.notice` | `role="alert"` solo en los de error |
| Campos | `.field`, `.needs-review`, `.search` | Etiqueta visible y estado de revisión con borde grueso |
| Lista clave–valor | `kv()` · `.kv` | Valor vacío = «Sin dato» en cursiva |
| Secciones | `sectionCard()` | Encabezado con acción (Editar) |
| Segmentado y filtros | `segmented()` / `filterChips()` | `aria-pressed` |
| Hojas y diálogos | `sheet()`, `confirmSheet()` | `role="dialog"`, `aria-modal`, foco atrapado, Escape; sustituyen a `window.confirm` |
| Toast | `toast()` | Región persistente `role="status"` y `aria-live="polite"` |
| Vacío y esqueleto | `emptyState()`, `skeletonList()` | |
| Cámara | `.camera`, `.shutter`, `.cam-sheet`, `.queue-pill`, `.step-pill` | Disparador de 78 px abajo en el centro, accesible con el pulgar |
| Documento | `.doc-view`, `.compare`, `.evidence-crop` | Procesado, original y comparación |
| Editor de esquinas | `openCornerEditor()` · `.ce-*` | Arrastre con la esquina más cercana al dedo; teclado con flechas |

## Movimiento

- Animaciones cortas y no bloqueantes: giro de carga y brillo del esqueleto.
- `prefers-reduced-motion: reduce` las desactiva todas.

## Rendimiento visual

- Las miniaturas solo existen como imagen cerca del viewport (`LazyThumbs` con `IntersectionObserver` y margen de 400 px).
- Al salir del viewport se revoca su URL de objeto. Al cambiar de pantalla se revocan todas.
- La lista se renderiza por páginas de 30 con un centinela.
- La pista de cámara analiza un fotograma reducido a 480 px cada ~320 ms en un Worker y descarta fotogramas si el anterior no terminó.

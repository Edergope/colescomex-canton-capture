# Informe de accesibilidad — UX v1

**Alcance:** las 10 pantallas, la cámara, las hojas y diálogos, y el editor de esquinas.

**Referencia:** WCAG 2.2 AA, con criterios más estrictos donde lo exige el uso en exteriores.

## Verificación automática

| Comprobación | Dónde | Resultado |
|---|---|---|
| Contraste de los tokens de texto y estado en ambos temas (40 pares) | `tests/ui-design.test.ts` | ✅ Texto principal ≥ 7:1; atenuado, enlaces y estados ≥ 4.5:1 |
| Elementos interactivos visibles con nombre accesible | `e2e/ux.spec.ts › audit()` en 9 pantallas × 2 tamaños × 2 temas | ✅ Sin hallazgos |
| Objetivos táctiles ≥ 40 px (48 px habitual; obturador 78 px; botón central 62 px) | ídem | ✅ |
| Campos con etiqueta asociada | ídem | ✅ |
| Imágenes con `alt` (decorativas con `alt=""`) | ídem | ✅ |
| Sin desbordamiento horizontal a 360 px y 412 px | ídem | ✅ |
| Movimiento reducido, foco visible y tema oscuro (sistema y explícito) | `tests/ui-design.test.ts` | ✅ |

Una corrección salió de estas pruebas: en el tema oscuro, el azul de acción usado como texto daba 3.5:1. Se separó el token `--link` (`#8db3ff` en oscuro), que ahora da ≥ 4.5:1.

## Criterios cubiertos por diseño

- **El color nunca es la única señal (1.4.1).** Cada estado lleva icono y texto («Revisar 2 datos», «Fallo de lectura», «Confirmado en Google»). Los campos dudosos tienen además el borde grueso y la insignia «Revisar» o «Ilegible».
- **Estados anunciados (4.1.3).**
  - Los toasts van en una región `role="status" aria-live="polite"` persistente.
  - La pista de la cámara solo se anuncia cuando cambia.
  - El recuento de la lista usa `role="status"`.
  - Los avisos de error usan `role="alert"`.
- **Diálogos.** Hojas con `role="dialog"`, `aria-modal`, título asociado, foco atrapado, cierre con Escape y retorno del foco. `window.confirm` se sustituyó por `confirmSheet`.
- **Navegación.**
  - La pantalla actual se marca con `aria-current="page"`.
  - Los pasos de captura usan `aria-current="step"`, con «(hecho)» solo para lectores de pantalla.
  - Los botones de alternancia y los filtros usan `aria-pressed`.
- **Editor de esquinas.** Cada esquina es un `role="slider"` enfocable y se mueve con las flechas (Mayús para pasos largos). No depende solo del arrastre (2.5.7).
- **Errores comprensibles (3.3).** Los mensajes dicen qué pasó y qué hacer, sin códigos técnicos. Por ejemplo: «Sin permiso en Google Drive o Sheets — Pida acceso de edición; no se perdió nada».
- **Texto grande.** Unidades `rem`, sin alturas fijas en el texto, `text-size-adjust: 100%`. El zoom del navegador no está bloqueado.
- **Movimiento.** Con `prefers-reduced-motion: reduce` se desactivan el giro, el brillo del esqueleto y las transiciones.
- **Idioma.** `lang="es"` (permite la partición silábica correcta). Los nombres en chino usan las fuentes Noto Sans SC o PingFang SC.

## Limitaciones y pendientes

1. **Sin pruebas con lectores de pantalla reales.** No se probó con TalkBack ni en un dispositivo físico; se recomienda una pasada antes de la feria.
2. **Sin axe-core.** El repositorio no lo tiene instalado y no se añadieron dependencias. La auditoría propia cubre nombres, etiquetas, alt, tamaño táctil y desbordes, pero no todas las reglas de axe.
3. **Contraste solo sobre tokens.** No se midió sobre las fotos (vista previa y miniaturas). Los textos sobre la cámara llevan fondo oscuro semitransparente.
4. **Objetivos de 40 px.** Los botones `.sm` (40 px) cumplen 2.5.8 (≥ 24 px) pero no la recomendación de 44 px; se usan solo en acciones secundarias.

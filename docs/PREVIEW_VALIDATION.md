# Validación de la vista previa v1.2 en teléfonos Android

Para Eder y Héctor. **Usar solo la URL de vista previa** (`https://colescomex-capture-preview.pages.dev`, con la franja roja «VISTA PREVIA»). Los datos van a los recursos de prueba (`QA_PRIVADO/PREVIEW_QA`), nunca a producción.

Material: 6 tarjetas reales distintas (al menos 1 bilingüe con reverso, 1 con productos en el reverso y 1 oscura si la hay), una mesa y buena conexión Wi-Fi para la primera apertura.

## Preparación (una vez por teléfono, ~3 min)

1. Abrir la URL en **Chrome**. Anotar el modelo del teléfono y la versión de Android.
2. «Soy Eder» / «Soy Héctor» → iniciar sesión con la cuenta propia → aceptar permisos.
3. Menú ⋮ → «Instalar aplicación». Esperar 2 minutos con la app abierta (descarga de 68 MB).
4. Abrir `…/ocr-lab.html` en otra pestaña: la línea superior indica la memoria del dispositivo (`heap`); anotarla.

## D1 / D2 — Escáner (cada teléfono, ~10 min)

En `ocr-lab.html`, con «Smart Document Scanner» marcado, fotografiar la misma tarjeta 5 veces:

| # | Cómo | Anotar |
|---|---|---|
| 1 | Horizontal sobre la mesa | ¿recorte correcto? ¿texto derecho? tiempo total |
| 2 | Vertical (girada 90°) en la mano | ídem |
| 3 | Al revés (180°) | ídem |
| 4 | Inclinada ~30° y con perspectiva | ídem |
| 5 | Sostenida con los dedos sobre los bordes | ídem; ¿quedan dedos dentro del recorte? |

PASS: en las 5, la vista previa muestra solo la tarjeta, derecha y legible.

## D3 — Captura intensiva (cada teléfono, ~10 min)

En la app: 10 proveedores seguidos, cada uno con anverso y reverso, pulsando «Guardar y siguiente» sin esperar.

- ¿Se bloqueó la cámara o «Guardar y siguiente» en algún momento?
- ¿Se recargó sola la pestaña? Si pasó: al volver, ¿aparece el aviso «Modo de bajo consumo» y las capturas siguen ahí?
- Al final, en «Ver capturas»: ¿hay 10, con referencias distintas? ¿Cuánto tardaron todas en pasar a «Datos extraídos» o «Requiere revisión»?

## D4 — Memoria reducida (~10 min)

- Si el aviso «Modo de bajo consumo» aparece solo, repetir D3 con 5 proveedores y anotar el tiempo.
- Si no aparece, comparar el tiempo por proveedor con D3 y anotar si hubo recargas.

## S1–S8 — Google de prueba (un teléfono, ~20 min)

| # | Acción | PASS si |
|---|---|---|
| S1 | 3 proveedores con tarjetas en orientaciones distintas | Las 3 terminan con datos |
| S2 | Abrir `EVIDENCIAS_PRUEBA` en Drive | Cada carpeta tiene `…_card_front_scan.jpg` / `…_card_back_scan.jpg` limpias, sin manos |
| S3 | Abrir `ORIGINALES_PRUEBA` | Están las fotos originales de cada tarjeta |
| S4 | Abrir `COLESCOMEX_CANTON_CAPTURE_QA` | Una fila por proveedor, con empresa, contacto, teléfono, correo, productos, enlaces y estados |
| S5 | Foto con dos tarjetas juntas | «Requiere revisión»; en Drive queda la foto original; «Ajustar esquinas» la corrige |
| S6 | Modo avión → 2 proveedores → quitar el modo avión | Se sincronizan solos («Confirmado en Google») |
| S7 | Tarjeta con lista de productos | Si hay palabras pegadas: «⚠ revisar» y una sugerencia; nada cambia sin tocarla |
| S8 | Abrir la app de **producción** | Sus capturas siguen ahí, sin rastro de las pruebas; en la hoja de Fase 2 no aparecen filas nuevas |

Enviar los resultados (con capturas de pantalla de los fallos) para registrarlos en `docs/TEST_REPORT.md`.

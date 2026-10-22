# Fixtures privados (fotografías y datos reales)

El repositorio es **público**. Las fotografías reales de tarjetas, los datos de contacto y los resultados con valores reales **nunca** se versionan.

## Dónde viven

| Ubicación | Uso |
|---|---|
| `../colescomex-private-fixtures/` (carpeta hermana del repositorio) o la ruta de `CX_PRIVATE_DIR` | Copia de trabajo para las pruebas locales |
| Carpeta restringida de Google Drive, p. ej. `Colescomex/04_LIVE_OPERATIONS/03_SUPPLIERS/2026_CANTON_FAIR/QA_PRIVADO` | Respaldo y fuente para otros equipos (Antigravity). Compartida solo con QA |

Contenido:

```
colescomex-private-fixtures/
  README.md
  cases.json                 # por caso: archivos, SHA-256, esquinas anotadas a mano, orientación y resultado comercial esperado
  sensitive-patterns.txt     # patrones (nombre, teléfonos, correo, IDs de Drive…) que busca el verificador anti-fuga
  real/R1_front.jpg          # originales sin modificar (R1 = CF26F2-EDR-HDHG-0001)
  real/R1_back.jpg
  scanner-fixtures/          # generado: rotaciones exactas 0/90/180/270 de cada foto real
  reports/                   # generado: recortes, antes/después, capturas E2E e informes con valores reales
```

## Preparar el directorio en otra máquina

1. Descargar la carpeta `QA_PRIVADO` de Drive (con una cuenta autorizada) en `../colescomex-private-fixtures`, o en cualquier ruta, exportando `CX_PRIVATE_DIR=/ruta`.
2. Verificar la integridad:
   ```bash
   npx vitest run tests/private-real-cards.test.ts
   ```
   Comprueba el SHA-256 de cada foto contra `cases.json`.
3. Generar las rotaciones:
   ```bash
   npm run scanner:fixtures
   ```

## Qué pruebas lo usan

| Prueba | Sin directorio privado |
|---|---|
| `tests/private-real-cards.test.ts`: integridad y extracción del texto impreso de R1 | Se **omite** con aviso |
| `tests/scanner-detect.test.ts`: casos `real_*` (detección y esquinas) | Se omiten los casos reales; los sintéticos se ejecutan |
| `e2e/capture.spec.ts` › «tarjetas reales (privadas)» | Se **omite** con aviso |
| `npm run scanner:eval`: R1 completo | Se omite R1. Los resultados con valores reales solo se escriben en `reports/` |

Las pruebas públicas equivalentes usan la tarjeta gemela ficticia `tests/fixtures/twin-card.ts`, con la misma estructura y sin datos reales.

> Una prueba omitida **no** cuenta como PASS. El informe de pruebas indica explícitamente si se ejecutó con o sin fixtures privados.

## Antes de subir cualquier rama

```bash
npm run check:private
```

`scripts/check-private-data.mjs` busca los patrones privados en los archivos versionados y en **todos los commits** que se subirían (`origin/main..HEAD`), además de imágenes reales en la historia. Si el directorio privado no está disponible, falla por seguridad. `scripts/deploy-preview.mjs` lo ejecuta antes de publicar.

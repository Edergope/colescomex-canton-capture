// Decisión de recorte en la cámara: la app exige una decisión EXPLÍCITA por cada cara de la tarjeta antes de
// guardar. Las pruebas que no estudian el recorte la toman como lo haría un operador.
import { expect, type Page } from '@playwright/test';

/**
 * - 'full': «Conservar foto completa» (disponible al instante, sin esperar al análisis).
 * - 'auto': «Usar recorte automático» (espera a que exista una propuesta).
 * - 'proposal': espera al análisis; usa el recorte si el detector lo propone con confianza y, si no, la foto completa.
 */
export type CropChoice = 'full' | 'auto' | 'proposal';

export async function resolveCrops(page: Page, choice: CropChoice = 'proposal') {
  const pending = page.locator('.mini-strip .evidence[data-crop="pending"]');
  await expect(page.locator('.mini-strip .evidence').first()).toBeVisible(); // el borrador ya está pintado
  for (let i = 0; i < 4 && (await pending.count()); i++) {
    await pending.first().click();
    let id = choice === 'auto' ? '#btn-crop-auto' : '#btn-crop-full';
    if (choice === 'proposal') {
      const chip = page.locator('.cam-sheet .chip').first();
      await expect(chip).not.toContainText('Analizando', { timeout: 90_000 });
      if (/Recorte propuesto/.test(await chip.innerText())) id = '#btn-crop-auto';
    }
    const b = page.locator(id);
    await expect(b).toBeEnabled({ timeout: 90_000 });
    await b.click();
    await expect(b).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(pending).toHaveCount(0);
}

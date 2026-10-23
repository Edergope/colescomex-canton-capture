// Escenario C: la actualización nunca recarga la app en un momento que pueda perder datos.
import { describe, expect, it } from 'vitest';
import { updateSafety, type SafetyInput } from '../src/pwa/safety';

const idle: SafetyInput = { mode: 'auto', route: 'home', captureBusy: false, pickerOpen: false, dirty: false, overlayOpen: false, ocrBusy: false, syncBusy: false };

describe('momento seguro para aplicar una actualización', () => {
  it('en reposo (Inicio, Proveedores, Ajustes…) se puede aplicar', () => {
    for (const route of ['home', 'list', 'detail', 'settings', 'sync', 'review']) expect(updateSafety({ ...idle, route }).safe, route).toBe(true);
  });
  it.each([
    ['cámara abierta (automático)', { route: 'capture' }, 'hay una captura en curso'],
    ['foto tomándose o guardándose (manual)', { route: 'capture', mode: 'manual', captureBusy: true }, 'se está tomando o guardando una foto'],
    ['cámara del sistema o galería abiertas', { pickerOpen: true }, 'la cámara del sistema o la galería están abiertas'],
    ['edición sin guardar', { dirty: true }, 'hay una edición sin guardar'],
    ['diálogo o editor de esquinas abierto', { overlayOpen: true }, 'hay un diálogo abierto'],
    ['OCR/escáner en curso', { ocrBusy: true }, 'se está procesando un documento'],
    ['envío a Google en curso', { syncBusy: true }, 'se están enviando datos a Google'],
  ] as [string, Partial<SafetyInput>, string][])('bloquea: %s', (_n, patch, reason) => {
    expect(updateSafety({ ...idle, ...patch })).toEqual({ safe: false, reason });
  });
  it('manual con la cámara abierta pero sin disparo en curso: permitido (el borrador ya está en IndexedDB)', () => {
    expect(updateSafety({ ...idle, route: 'capture', mode: 'manual' }).safe).toBe(true);
  });
  it('la cámara del sistema abierta bloquea incluso la actualización manual', () => {
    expect(updateSafety({ ...idle, mode: 'manual', pickerOpen: true }).safe).toBe(false);
  });
});

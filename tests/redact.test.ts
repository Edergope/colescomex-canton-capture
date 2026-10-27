// Depuración de errores para el diagnóstico técnico (regresión): ni correos, ni URL de sesiones de subida, ni tokens,
// ni ids opacos de Google; se conservan las referencias CF26F2-… y los capture_uuid.
import { describe, expect, it } from 'vitest';
import { redactError } from '../src/sync/redact';

describe('redactError', () => {
  it('oculta correos, URL (incl. sesión reanudable), tokens OAuth y parámetros sensibles', () => {
    const raw = 'Google HTTP 403 storageQuotaExceeded: The user hector.demo@example.com has no space; session https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 Bearer ya29.a0AfH6SMBxyz-secret token=abc123 access_token=zzz';
    const r = redactError(raw)!;
    expect(r).toContain('Google HTTP 403 storageQuotaExceeded');
    for (const leak of ['hector.demo@example.com', 'googleapis.com', 'upload_id=ABC', 'ya29.', 'secret', 'abc123', 'zzz']) expect(r).not.toContain(leak);
    expect(r).toMatch(/\[correo\]/); expect(r).toMatch(/\[url\]/); expect(r).toMatch(/Bearer \[token\]/);
  });
  it('oculta ids opacos de Drive pero conserva referencias CF26F2-… y capture_uuid', () => {
    const r = redactError('File 1bqlJA_adbPpd_T4LvsjPtwEZrhys6-tF not found for CF26F2-HCT-CCCB-0001_01_card_front.jpg (capture 3f2b8c1e-9a4d-4b7e-8f21-0c5d6e7f8a9b)')!;
    expect(r).not.toContain('1bqlJA_adbPpd_T4LvsjPtwEZrhys6-tF');
    expect(r).toContain('[id]');
    expect(r).toContain('CF26F2-HCT-CCCB-0001_01_card_front.jpg');
    expect(r).toContain('3f2b8c1e-9a4d-4b7e-8f21-0c5d6e7f8a9b');
  });
  it('conserva los MOTIVOS de Google (palabras largas sin dígitos), necesarios para clasificar el error', () => {
    for (const reason of ['insufficientFilePermissions', 'activeItemCreationLimitExceeded', 'sharingRateLimitExceeded', 'storageQuotaExceeded'])
      expect(redactError(`Google HTTP 403 ${reason}: x`)).toContain(reason);
  });
  it('limita la longitud y respeta mensajes vacíos', () => {
    expect(redactError('x'.repeat(10) + ' '.repeat(400) + 'y', 50)!.length).toBe(51);
    expect(redactError(undefined)).toBeUndefined();
  });
});

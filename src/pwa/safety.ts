// ¿Se puede recargar la app ahora para aplicar una actualización sin perder nada? (función pura, probada)
export interface SafetyInput {
  mode: 'auto' | 'manual';
  route: string;
  /** en pleno disparo o guardado de una foto */
  captureBusy: boolean;
  /** cámara del sistema o galería abiertas (la foto volvería a una página recargada y se perdería) */
  pickerOpen: boolean;
  /** edición sin guardar */
  dirty: boolean;
  /** diálogo, hoja o editor de esquinas abiertos */
  overlayOpen: boolean;
  /** escáner/OCR procesando (una recarga se registraría como cierre por memoria) */
  ocrBusy: boolean;
  /** envío a Google en curso */
  syncBusy: boolean;
}

export function updateSafety(s: SafetyInput): { safe: boolean; reason?: string } {
  if (s.pickerOpen) return { safe: false, reason: 'la cámara del sistema o la galería están abiertas' };
  if (s.route === 'capture') {
    // automático: nunca con la cámara abierta. Manual: el borrador ya está guardado, salvo en pleno disparo/guardado
    if (s.mode === 'auto') return { safe: false, reason: 'hay una captura en curso' };
    if (s.captureBusy) return { safe: false, reason: 'se está tomando o guardando una foto' };
  }
  if (s.dirty) return { safe: false, reason: 'hay una edición sin guardar' };
  if (s.overlayOpen) return { safe: false, reason: 'hay un diálogo abierto' };
  if (s.ocrBusy) return { safe: false, reason: 'se está procesando un documento' };
  if (s.syncBusy) return { safe: false, reason: 'se están enviando datos a Google' };
  return { safe: true };
}

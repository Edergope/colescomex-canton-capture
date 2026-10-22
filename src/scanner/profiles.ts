// Perfiles de documento: parámetros que cambian según el tipo de documento comercial. El motor
// (detección, recorte, orientación, OCR) es el mismo; la interpretación del texto (parser) va aparte.
export interface DocumentProfile {
  id: string;
  label: string;
  detect: {
    /** relación lado largo / lado corto esperada (con tolerancia en la puntuación) */
    aspectRange: [number, number];
    /** fracción mínima de la foto que ocupa el documento */
    minAreaFrac: number;
  };
  /** documento procesado: lado mayor máximo y calidad JPEG */
  output: { maxSide: number; quality: number };
  /** lado mayor de la imagen que se entrega al OCR */
  ocrInputSide: number;
}

export const BUSINESS_CARD: DocumentProfile = {
  id: 'business_card', label: 'Tarjeta comercial',
  detect: { aspectRange: [1.15, 2.4], minAreaFrac: 0.04 },
  output: { maxSide: 2400, quality: 0.9 },
  ocrInputSide: 1600,
};

/**
 * Perfiles previstos para la siguiente fase (fichas técnicas, facturas, catálogos, cotizaciones). Comparten motor;
 * solo cambian geometría y resolución. Su parser específico (entidades de cada documento) está pendiente.
 */
export const A4_DOCUMENT: DocumentProfile = {
  id: 'a4_document', label: 'Documento A4 / Carta (ficha técnica, factura, cotización)',
  detect: { aspectRange: [1.2, 1.6], minAreaFrac: 0.15 },
  output: { maxSide: 3200, quality: 0.88 },
  ocrInputSide: 2400,
};

export const PROFILES: Record<string, DocumentProfile> = { [BUSINESS_CARD.id]: BUSINESS_CARD, [A4_DOCUMENT.id]: A4_DOCUMENT };

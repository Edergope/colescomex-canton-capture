// Indicadores de funciones futuras. Desactivadas por defecto: nunca se presentan como funcionales.
// Activación local de prueba: localStorage `cx.features` = "documentTypes".
function enabled(name: string): boolean {
  try { return (localStorage.getItem('cx.features') ?? '').split(',').map((s) => s.trim()).includes(name); } catch { return false; }
}
export const FEATURES = {
  /** Selector de tipo de documento (fichas técnicas, facturas, cotizaciones, catálogos). Solo diseño. */
  documentTypes: enabled('documentTypes'),
};

export interface DocTypeOption { id: string; label: string; icon: string; available: boolean }
export const DOC_TYPES: DocTypeOption[] = [
  { id: 'business_card', label: 'Tarjeta comercial', icon: 'card', available: true },
  { id: 'spec_sheet', label: 'Ficha técnica', icon: 'file', available: false },
  { id: 'invoice', label: 'Factura', icon: 'file', available: false },
  { id: 'quote', label: 'Cotización', icon: 'file', available: false },
  { id: 'catalog', label: 'Catálogo', icon: 'layers', available: false },
];

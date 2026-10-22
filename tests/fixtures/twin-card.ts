// Tarjeta GEMELA FICTICIA: reproduce la estructura de la tarjeta real R1 (dos empresas con forma jurídica,
// nombre sobre "Mobile:", dirección en dos renglones con ZipCode en la misma fila, Tel/Fax/E-mail/QQ y,
// en el reverso, "WE PRODUCE:" seguido de una lista con espacios anchos y una errata impresa).
// Todos los datos son inventados: las pruebas públicas no contienen información personal real.
export const TWIN_FRONT = [
  'NANHAI BRIGHTPOLE STREET LIGHTING CO.,LTD',
  'HUAXIN DEMO IMP&EXP TRADING CO.,LTD',
  'Laura Demo',
  'Mobile:86-13800000001',
  'Add: 9 Example Road Sample Town Taicang City',
  'Jiangsu Province China  ZipCode:215400',
  'Tel:86-512-80000001',
  'Fax:86-512-80000002',
  'E-mail:laura@brightpole-demo.cc',
  'QQ:100000001',
];
export const TWIN_BACK = [
  'WE PRODUCE:',
  'SOLAR LIGHTING  LED LIGHTING',
  'GARDEN LIGHTING',
  'STEEL POLE (TAPER AND POLYGON POLE)',
  'ALUMINIUM POLE',
  'HIGH MAST POLE',
  'ELECTRIC POLE',
  'COMMUNICATION POLE',
  'FLOOD LIGTH POLE',
  'PLASTIC GARDEN LIGHTS',
];
export const TWIN_PRODUCTS = ['SOLAR LIGHTING', 'LED LIGHTING', 'GARDEN LIGHTING', 'STEEL POLE (TAPER AND POLYGON POLE)', 'ALUMINIUM POLE', 'HIGH MAST POLE',
  'ELECTRIC POLE', 'COMMUNICATION POLE', 'FLOOD LIGTH POLE', 'PLASTIC GARDEN LIGHTS'];
export const TWIN_EXPECTED = {
  company_name: 'NANHAI BRIGHTPOLE STREET LIGHTING CO.,LTD', secondary: 'HUAXIN DEMO IMP&EXP TRADING CO.,LTD', contact_name: 'Laura Demo',
  phone_1: '+8613800000001', phone_2: '+8651280000001', fax: '+8651280000002', email: 'laura@brightpole-demo.cc', qq: '100000001', postal: '215400',
  city: 'Taicang', province: 'Jiangsu',
};

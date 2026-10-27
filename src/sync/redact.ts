// Depuración de mensajes de error antes de guardarlos, mostrarlos o copiarlos en el diagnóstico: nunca deben salir
// correos, URL (p. ej. sesiones de subida reanudable, que funcionan como credencial), tokens OAuth ni identificadores
// opacos de Google. Se conservan las referencias CF26F2-… y los capture_uuid, necesarios para conciliar.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function redactError(msg: string | undefined, max = 300): string | undefined {
  if (!msg) return msg;
  const out = msg
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '[correo]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [token]')
    .replace(/\bya29\.[\w.-]+/g, '[token]')
    .replace(/\b(access_token|refresh_token|id_token|token|key|code|upload_id|client_secret)=[^\s&"']+/gi, '$1=[oculto]')
    // identificadores opacos largos (ids de Drive, claves: mezclan letras y dígitos): fuera, salvo referencias CF26F2-…
    // y UUID de captura. Los motivos de Google (`insufficientFilePermissions`…) son palabras sin dígitos: se conservan.
    .replace(/[A-Za-z0-9_-]{25,}/g, (m) => (/^CF26F2-/.test(m) || UUID.test(m) || !/\d/.test(m) || !/[A-Za-z]/.test(m) ? m : '[id]'));
  return out.length > max ? `${out.slice(0, max)}…` : out;
}

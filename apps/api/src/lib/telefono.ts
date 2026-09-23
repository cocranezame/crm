/**
 * Normaliza un teléfono a E.164 (+5198…). Asume Perú (+51) cuando llegan 9 dígitos
 * empezando en 9. Devuelve null si no parece un teléfono.
 */
export function normalizarTelefono(v: string | null | undefined, paisPorDefecto = '51'): string | null {
  if (!v) return null;
  const limpio = String(v).trim().replace(/[\s\-().]/g, '');
  if (!limpio) return null;
  let digitos = limpio.replace(/^\+/, '').replace(/^00/, '');
  if (!/^\d{6,15}$/.test(digitos)) return null;
  if (!limpio.startsWith('+') && !limpio.startsWith('00') && digitos.length === 9 && digitos.startsWith('9')) {
    digitos = paisPorDefecto + digitos;
  }
  return `+${digitos}`;
}

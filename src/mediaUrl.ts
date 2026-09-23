// Construye la URL de streaming servida por el protocolo `hddmedia://`
// registrado en el proceso main (ver electron/mediaPlayer.cjs), que lee el
// archivo real del HDD conectado con soporte de rango (Range) para
// reproducción de video/audio y visualización de imágenes en alta calidad.
export function hddMediaUrl(driveId: number, entryId: number): string {
  return `hddmedia://${driveId}/${entryId}`;
}

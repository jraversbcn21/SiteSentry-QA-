import { lookup } from 'dns/promises';
import { URL } from 'url';

var PRIVATE_RANGES: Array<{ prefix: number; bits: number }> = [
  { prefix: ipToInt('10.0.0.0'), bits: 8 },
  { prefix: ipToInt('172.16.0.0'), bits: 12 },
  { prefix: ipToInt('192.168.0.0'), bits: 16 },
  { prefix: ipToInt('127.0.0.0'), bits: 8 },
  { prefix: ipToInt('169.254.0.0'), bits: 16 },
  { prefix: ipToInt('0.0.0.0'), bits: 8 },
];

function ipToInt(ip: string): number {
  var parts = ip.split('.');
  return (
    (parseInt(parts[0], 10) << 24) |
    (parseInt(parts[1], 10) << 16) |
    (parseInt(parts[2], 10) << 8) |
    parseInt(parts[3], 10)
  ) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  var ipInt = ipToInt(ip);
  for (var i = 0; i < PRIVATE_RANGES.length; i++) {
    var range = PRIVATE_RANGES[i];
    var mask = ~((1 << (32 - range.bits)) - 1) >>> 0;
    if ((ipInt & mask) === (range.prefix & mask)) {
      return true;
    }
  }
  return false;
}

async function validateUrl(targetUrl: string): Promise<void> {
  var parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error('URL invalida: no se pudo parsear el hostname.');
  }

  var hostname = parsed.hostname;

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    throw new Error('Acceso denegado: no se permite escanear direcciones locales (localhost/loopback).');
  }

  if (/^0+\.0+\.0+\.0+$/.test(hostname)) {
    throw new Error('Acceso denegado: direccion IP no valida (0.0.0.0).');
  }

  var isIpLike = /^\d+\.\d+\.\d+\.\d+$/.test(hostname);

  if (isIpLike) {
    if (isPrivateIp(hostname)) {
      throw new Error('Acceso denegado: no se permite escanear direcciones IP privadas (' + hostname + ').');
    }
    return;
  }

  try {
    var result = await lookup(hostname, { family: 4 });
    var resolvedIp = result.address;

    if (resolvedIp === '127.0.0.1' || resolvedIp === '::1') {
      throw new Error('Acceso denegado: el hostname resuelve a localhost (' + resolvedIp + ').');
    }

    if (isPrivateIp(resolvedIp)) {
      throw new Error('Acceso denegado: el hostname ' + hostname + ' resuelve a una IP privada (' + resolvedIp + '). No se permite escanear destinos internos.');
    }
  } catch (err: any) {
    if (err.message && err.message.startsWith('Acceso denegado')) {
      throw err;
    }
    if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
      throw new Error('No se pudo resolver el hostname: ' + hostname + '. Verifica que la URL sea correcta.');
    }
    throw new Error('Error al validar la URL: ' + (err.message || 'Error desconocido de DNS.'));
  }
}

export { validateUrl, isPrivateIp };

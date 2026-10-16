/**
 * Base64 for the arrays the print lab sends between the app and its worker. Uses the engine's own btoa/atob when it
 * has them (Hermes, browsers, Node — much faster than a loop in an interpreter), a plain loop otherwise.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const G = globalThis as unknown as { btoa?: (s: string) => string; atob?: (s: string) => string };

export function toB64(bytes: Uint8Array) {
  if (typeof G.btoa === 'function') {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]);
    return G.btoa(bin);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = i + 1 < bytes.length ? bytes[i + 1] : 0, c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] + (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=') + (i + 2 < bytes.length ? B64[c & 63] : '=');
  }
  return s;
}

export function fromB64(s: string) {
  if (typeof G.atob === 'function') {
    const bin = G.atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const clean = s.replace(/=+$/, ''), out = new Uint8Array(Math.floor((clean.length * 3) / 4)), lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = lut[clean.charCodeAt(i)], b = lut[clean.charCodeAt(i + 1)], c = i + 2 < clean.length ? lut[clean.charCodeAt(i + 2)] : 0, d = i + 3 < clean.length ? lut[clean.charCodeAt(i + 3)] : 0;
    out[o++] = (a << 2) | (b >> 4); if (o < out.length) out[o++] = ((b & 15) << 4) | (c >> 2); if (o < out.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

// UTF-8-safe base64 helpers. Terminal I/O is base64 over the wire; naive btoa
// throws on multibyte (Thai/CJK/emoji) input, so we go through TextEncoder.

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function strToB64(str: string): string {
  return bytesToB64(encoder.encode(str))
}

export function b64ToStr(b64: string): string {
  return decoder.decode(b64ToBytes(b64))
}

export function bytesToB64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

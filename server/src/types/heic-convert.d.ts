// heic-convert ships no types. Used by services/media-convert.service.ts.
declare module 'heic-convert' {
  export default function convert(options: {
    buffer: Buffer
    format: 'JPEG' | 'PNG'
    quality?: number
  }): Promise<ArrayBuffer>
}

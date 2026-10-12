declare module 'heic-decode' {
  export default function decode(opts: { buffer: Buffer | ArrayBuffer }): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

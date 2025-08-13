declare module 'qrcode' {
  export function toCanvas(canvas: HTMLCanvasElement, text: string, opts?: any): Promise<void> | void
  export function toDataURL(text: string, opts?: any): Promise<string>
}

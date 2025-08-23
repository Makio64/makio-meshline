import type {
  Mesh as ThreeMesh,
  InstancedBufferAttribute,
  Texture,
  Vector2,
  Color,
  BufferGeometry
} from 'three/webgpu'

export type LinePoints = Float32Array | number[] | { x: number; y: number; z?: number }[]
export type MultiLinePoints = Array<LinePoints> | LinePoints

export interface MeshLineJoinOptions {
  type?: 'miter' | 'bevel' | 'round'
  limit?: number
  quality?: 'standard' | 'high'
}

export interface MeshLineDashOptions {
  count?: number
  ratio?: number
  offset?: number
}

export interface MeshLineConfigureOptions {
  // geometry
  lines?: MultiLinePoints
  segments?: number
  closed?: boolean | boolean[]

  // appearance
  color?: number | string | Color
  lineWidth?: number
  widthCallback?: (t: number) => number
  sizeAttenuation?: boolean
  gradientColor?: number | string | Color | null
  map?: Texture | null
  mapOffset?: Vector2 | null
  alphaMap?: Texture | null
  opacity?: number
  alphaTest?: number
  transparent?: boolean
  wireframe?: boolean

  // advanced
  dash?: MeshLineDashOptions
  join?: MeshLineJoinOptions
  dpr?: number
  frustumCulled?: boolean
  verbose?: boolean
  renderWidth?: number
  renderHeight?: number

  // gpu / instancing
  gpuPositionNode?: any
  usage?: any
  instanceCount?: number

  // optional attributes
  needsUV?: boolean
  needsWidth?: boolean
  needsCounter?: boolean
  needsPrevious?: boolean
  needsNext?: boolean
  needsSide?: boolean
}

export class MeshLine extends ThreeMesh {
  constructor()

  configure(options?: MeshLineConfigureOptions): this

  lines(points: MultiLinePoints, closed?: boolean | boolean[]): this
  segments(segments: number): this
  closed(closed: boolean | boolean[]): this

  color(color: number | string | Color): this
  lineWidth(width: number): this
  widthCallback(fn: (t: number) => number): this
  sizeAttenuation(enabled: boolean): this

  opacity(opacity: number): this
  alphaTest(value: number): this
  transparent(enabled: boolean): this
  wireframe(enabled: boolean): this

  join(options?: MeshLineJoinOptions): this
  gradientColor(color: number | string | Color | null): this
  map(tex: Texture | null): this
  mapOffset(offset: Vector2): this
  alphaMap(tex: Texture | null): this
  dash(options?: MeshLineDashOptions): this
  dpr(value: number): this
  dynamic(enable: boolean): this
  frustumCulled(enabled: boolean): this
  verbose(enabled: boolean): this
  renderSize(width?: number, height?: number): this

  gpuPositionNode(node: any): this
  usage(usage: any): this
  instances(count: number): this

  // optional attributes toggles
  needsUV(enabled: boolean): this
  needsWidth(enabled: boolean): this
  needsCounter(enabled: boolean): this
  needsPrevious(enabled: boolean): this
  needsNext(enabled: boolean): this
  needsSide(enabled: boolean): this

  // node hooks (TSL) — kept as any for flexibility
  positionFn(fn: any): this
  previousFn(fn: any): this
  nextFn(fn: any): this
  widthFn(fn: any): this
  normalFn(fn: any): this
  colorFn(fn: any): this
  gradientFn(fn: any): this
  opacityFn(fn: any): this
  dashFn(fn: any): this
  uvFn(fn: any): this
  vertexFn(fn: any): this
  fragmentColorFn(fn: any): this
  fragmentAlphaFn(fn: any): this
  discardFn(fn: any): this

  build(): this
  setPositions(points: MultiLinePoints, updateBounding?: boolean): void

  addInstanceAttribute(name: string, components?: number): InstancedBufferAttribute
  setInstanceValue(name: string, index: number, value: number | number[] | { x: number; y: number; z?: number }): void
  resize(width?: number, height?: number): void
  autoResize(target?: Window): this
  dispose(): void
}

export class MeshLineGeometry extends BufferGeometry {
  buildLine(options?: Partial<MeshLineConfigureOptions>): void
  setLines(points: MultiLinePoints): void
  setPositions(points: MultiLinePoints, updateBounding?: boolean): void
  dispose(): void
}

export class MeshLineNodeMaterial {
  constructor()
  buildLine(options?: Partial<MeshLineConfigureOptions>): void
  dispose(): void
}

export function circlePositions(segments?: number, radius?: number): Float32Array
export function squarePositions(width?: number, segments?: number): Float32Array
export function rectanglePositions(width?: number, height?: number, segments?: number): Float32Array
export function sineWavePositions(wavelengths?: number, segments?: number, amplitude?: number, length?: number): Float32Array
export function straightLine(width?: number, segments?: number, isVertical?: boolean): Float32Array
export function straightLineBetween(start: { x?: number; y?: number; z?: number } | number[], end: { x?: number; y?: number; z?: number } | number[], segments?: number): Float32Array

export default MeshLine



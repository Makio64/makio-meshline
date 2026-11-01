export function circlePositions( segments?: number, radius?: number ): Float32Array
export function squarePositions( width?: number, segments?: number ): Float32Array
export function rectanglePositions( width?: number, height?: number, segments?: number ): Float32Array
export function sineWavePositions( wavelengths?: number, segments?: number, amplitude?: number, length?: number ): Float32Array
export function straightLine( width?: number, segments?: number, isVertical?: boolean ): Float32Array
export function straightLineBetween( start: { x?: number; y?: number; z?: number } | number[], end: { x?: number; y?: number; z?: number } | number[], segments?: number ): Float32Array

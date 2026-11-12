import * as t3 from '@typegpu/three'
import { MeshLine } from 'makio-meshline'
import { Fn, uniform } from 'three/tsl'
import { d, std } from 'typegpu'

// Three.js owns the uniforms. TypeGPU reads their typed GPU accessors.
export const elapsed = uniform( 0 )
export const amplitude = uniform( 0.55 )
const gpuTime = t3.fromTSL( elapsed, d.f32 )
const gpuAmplitude = t3.fromTSL( amplitude, d.f32 )

// MeshLine applies this hook to current, previous and next positions, so its
// joins and screen-facing width follow the deformation without CPU uploads.
const positionHook = Fn( ( [position] ) => {
	const point = t3.fromTSL( position, d.vec3f )
	return t3.toTSL( () => {
		'use gpu'
		const p = point.$
		const phase = p.x * 1.15 + p.y * 1.7 - gpuTime.$ * 0.8
		const wave = std.sin( phase ) * gpuAmplitude.$
		return d.vec3f( p.x, p.y + wave, std.cos( phase * 0.7 ) * 0.35 )
	} )
} )

const colorHook = Fn( ( [color, progress] ) => {
	const tint = t3.fromTSL( color, d.vec4f )
	const along = t3.fromTSL( progress, d.f32 )
	return t3.toTSL( () => {
		'use gpu'
		const phase = along.$ * 18.849556 - gpuTime.$ * 1.2
		const pulse = std.pow( 0.5 + 0.5 * std.sin( phase ), 3 )
		const blue = std.mix( tint.$.xyz, d.vec3f( 0.18, 0.32, 0.95 ), along.$ )
		// Keep a vec4 result: the bridge emits a WGSL function call directly,
		// so the assignment must retain MeshLine's color type and alpha.
		return d.vec4f( std.mix( blue, d.vec3f( 0.85, 0.98, 1 ), pulse ), tint.$.w )
	} )
} )

function createPaths( lineCount = 5, pointCount = 160 ) {
	return Array.from( { length: lineCount }, ( _, lineIndex ) => {
		const points = new Float32Array( pointCount * 3 )
		for ( let i = 0; i < pointCount; i++ ) {
			points[i * 3] = ( i / ( pointCount - 1 ) - 0.5 ) * 9
			points[i * 3 + 1] = ( lineIndex - ( lineCount - 1 ) / 2 ) * 0.62
		}
		return points
	} )
}

export function createRibbons() {
	return new MeshLine()
		.lines( createPaths() )
		.lineWidth( 0.065 )
		.color( 0x27d8ce )
		.positionFn( positionHook )
		.colorFn( colorHook )
		.needsUV( false )
		.build()
}

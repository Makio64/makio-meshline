/**
 * Statue contour rings (pre-baked, see scripts/bake-rings.mjs) and the instanced ring MeshLine
 * that morphs between them on the GPU.
 *
 *   const david = await loadStatueRings( 'david' )   // one ~74 KB fetch, no GLB / BVH / raycasts
 *   const venus = await loadStatueRings( 'venus' )
 *   const stack = createRingStack( [david, venus] )
 *   stage.scene.add( stack.line )
 *   stack.morph.value = 0.5   // 0 = david, 1 = venus (0..shapes-1 for chains)
 *
 * Works on WebGPU and WebGL2 (positions live in a float DataTexture read with textureLoad).
 */
import { MeshLine } from 'makio-meshline'
import { clamp, float, floor, Fn, fract, instanceIndex, int, ivec2, mix, mul, pow, select, sin, smoothstep, sub, texture as textureNode, uniform, uniformArray, varying, vec3 } from 'three/tsl'
import { AdditiveBlending, Color, DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three/webgpu'

import { BAKED_LAYOUTS, BAKED_SIZE, decodeRings, ringFileName, STATUE_NAMES } from './ringData.js'

export const STATUES = STATUE_NAMES

/** Baked layouts: `full` (default, 64 × 96) and `phone` (64 × 64, a third fewer vertices). */
export const RING_LAYOUTS = { full: { rings: 64, samples: 96 }, phone: { rings: 64, samples: 64 } }

/** Base→top colours per statue (venus.js: David red→yellow, Venus magenta→white). */
export const STATUE_PALETTES = {
	david: [0xff0000, 0xffff00],
	venus: [0xff00ff, 0xffffff],
	aurelius: [0xb87333, 0xffe2b0],
	nefertiti: [0x00b3ff, 0xfff1c4],
}

// Vite asset URLs of every baked file (hashed in builds). assets/rings is written by scripts/bake-rings.mjs.
const BAKED = import.meta.glob( '../assets/rings/*.bin', { query: '?url', import: 'default', eager: true } )
const bakedUrl = ( name, rings, samples ) => BAKED[`../assets/rings/${ringFileName( name, rings, samples )}`] ?? null

const cache = new Map()

/** Whether loadStatueRings( name, { rings, samples } ) is served from a baked file (any size). */
export function hasBakedRings( name, { rings = 64, samples = 96 } = {} ) {
	return bakedUrl( name, rings, samples ) !== null
}

/**
 * Trace the rings at runtime (GLB + Draco + BVH + rings × samples raycasts on the main thread:
 * 100–1000 ms). Only the fallback of loadStatueRings() and the re-bake check use it.
 * @returns {Promise<{ name, positions, active, rings, samples, minY, maxY, radius }>}
 */
export async function traceStatueRings( name, { rings = 64, samples = 96, size = BAKED_SIZE } = {} ) {
	const t0 = performance.now()
	const [{ GLTFLoader }, { DRACOLoader }, { traceRings }] = await Promise.all( [
		import( 'three/addons/loaders/GLTFLoader.js' ),
		import( 'three/addons/loaders/DRACOLoader.js' ),
		import( './ringTrace.js' ),
	] )
	const draco = new DRACOLoader()
	draco.setDecoderPath( '/draco/' )
	const loader = new GLTFLoader()
	loader.setDRACOLoader( draco )
	try {
		const gltf = await loader.loadAsync( `/models/${name}.glb` )
		const data = traceRings( gltf.scene, { rings, samples, size, name } )
		gltf.scene.traverse( ( o ) => { if ( o.isMesh ) { o.geometry.dispose(); o.material?.dispose?.() } } )
		console.info( `[showcase] ${name} rings ${rings}x${samples} traced in ${( performance.now() - t0 ).toFixed( 0 )} ms` )
		return data
	} finally {
		draco.dispose()
	}
}

/**
 * Closed contour rings around a statue, bottom→top. Served from the baked files in
 * assets/rings (64 × 96 and 64 × 64; any `size`, the data is scaled); other layouts fall back
 * to traceStatueRings() with a warning. Cached per (name, rings, samples, size).
 * The model is normalized like the demo: max dimension = `size` (12), centred, y up.
 *
 * @param {'david'|'venus'|'aurelius'|'nefertiti'} name
 * @param {{ rings?: number, samples?: number, size?: number }} [opts]
 * @returns {Promise<{ name: string, positions: Float32Array, active: Uint8Array, rings: number, samples: number, minY: number, maxY: number, radius: number }>}
 *   positions: rings * samples * 3 floats, ring r point i at (r * samples + i) * 3, rings bottom→top.
 *   active[r] = 0 when the ring missed the model (draw it invisible).
 */
export function loadStatueRings( name, { rings = 64, samples = 96, size = BAKED_SIZE } = {} ) {
	const key = `${name}:${rings}:${samples}:${size}`
	if ( cache.has( key ) ) return cache.get( key )
	const promise = ( async () => {
		const url = bakedUrl( name, rings, samples )
		if ( url ) {
			const t0 = performance.now()
			const res = await fetch( url )
			if ( res.ok ) {
				const data = decodeRings( await res.arrayBuffer(), name, { scale: size / BAKED_SIZE } )
				console.info( `[showcase] ${name} rings ${rings}x${samples} loaded in ${( performance.now() - t0 ).toFixed( 0 )} ms` )
				return data
			}
			console.warn( `[showcase] ${url}: HTTP ${res.status}` )
		}
		const baked = BAKED_LAYOUTS.map( ( [r, s] ) => `${r}x${s}` ).join( ', ' )
		console.warn( `[showcase] no baked ${name} rings ${rings}x${samples} (baked: ${baked}): tracing at runtime, which blocks the main thread. Add the layout to BAKED_LAYOUTS and run node showcase/scripts/bake-rings.mjs` )
		return traceStatueRings( name, { rings, samples, size } )
	} )()
	cache.set( key, promise )
	promise.catch( () => cache.delete( key ) )
	return promise
}

/**
 * Procedural ring set with the same layout as loadStatueRings (helix, discs, cylinders, glyph slices...).
 * `fn( ringT 0..1, angle 0..2π, out: [x, y, z], ringIndex, sampleIndex )` writes one point.
 */
export function proceduralRings( { rings = 64, samples = 96, name = 'procedural' }, fn ) {
	const positions = new Float32Array( rings * samples * 3 )
	const active = new Uint8Array( rings ).fill( 1 )
	const out = [0, 0, 0]
	let minY = Infinity
	let maxY = -Infinity
	for ( let r = 0; r < rings; r++ ) {
		for ( let i = 0; i < samples; i++ ) {
			out[0] = out[1] = out[2] = 0
			fn( r / Math.max( 1, rings - 1 ), ( i / samples ) * Math.PI * 2, out, r, i )
			const o = ( r * samples + i ) * 3
			positions[o] = out[0]
			positions[o + 1] = out[1]
			positions[o + 2] = out[2]
			minY = Math.min( minY, out[1] )
			maxY = Math.max( maxY, out[1] )
		}
	}
	return { name, positions, active, rings, samples, minY, maxY, radius: 0 }
}

// demo/src/makio/tsl/easing.js backInOut (copied: pure TSL)
const PI = float( Math.PI )
export const backInOut = /*@__PURE__*/ Fn( ( [t] ) => {
	const f = select( t.lessThan( 0.5 ), mul( 2.0, t ), sub( 1.0, mul( 2.0, t ).sub( 1.0 ) ) )
	const g = pow( f, 3.0 ).sub( f.mul( sin( f.mul( PI ) ) ) )
	return select( t.lessThan( 0.5 ), mul( 0.5, g ), mul( 0.5, sub( 1.0, g ) ).add( 0.5 ) )
}, { t: 'float', return: 'float' } )

/**
 * Instanced ring MeshLine (one draw) morphing through `shapes` like the Venus & David demo:
 * the morph front sweeps bottom→top, rings swell (xz) and thicken at the front, colours blend
 * between per-shape base→top palettes.
 *
 * @param {Array<{ positions: Float32Array, active: Uint8Array, rings: number, samples: number, name?: string }>} shapes same rings/samples
 * @param {object} [o]
 * @param {number} [o.lineWidth=0.02] world units
 * @param {Array<[number|string, number|string]>} [o.palettes] per shape [base, top]; defaults from STATUE_PALETTES by name
 * @param {number} [o.swell=0.6] xz swell at the morph front (venus.js 0.6)
 * @param {number} [o.widthSwell=0.1] extra width at the front (venus.js 0.1)
 * @param {number} [o.intensity=1] colour multiplier (>1 feeds bloom)
 * @param {boolean} [o.additive=false]
 * @param {boolean} [o.antialias=false]
 * @returns {{ line: MeshLine, morph, reveal, opacity, intensity, texture: DataTexture, shapes: number, setShape( i, shape ), frontHeight(): number, dispose() }}
 *   morph: uniform 0..shapes-1 · reveal: uniform 0..1 (rings appear bottom→top) · opacity: uniform 0..1
 */
export function createRingStack( shapes, o = {} ) {
	const { lineWidth = 0.02, swell = 0.6, widthSwell = 0.1, additive = false, antialias = false } = o
	const { rings, samples } = shapes[0]
	for ( const s of shapes ) {
		if ( s.rings !== rings || s.samples !== samples ) throw new Error( 'createRingStack: every shape needs the same rings x samples' )
	}
	const n = shapes.length
	const data = new Float32Array( samples * rings * n * 4 )
	const texture = new DataTexture( data, samples, rings * n, RGBAFormat, FloatType )
	texture.magFilter = NearestFilter
	texture.minFilter = NearestFilter
	texture.generateMipmaps = false

	const setShape = ( index, shape ) => {
		for ( let r = 0; r < rings; r++ ) {
			for ( let i = 0; i < samples; i++ ) {
				const src = ( r * samples + i ) * 3
				const dst = ( ( index * rings + r ) * samples + i ) * 4
				data[dst] = shape.positions[src]
				data[dst + 1] = shape.positions[src + 1]
				data[dst + 2] = shape.positions[src + 2]
				data[dst + 3] = shape.active ? shape.active[r] : 1
			}
		}
		texture.needsUpdate = true
	}
	shapes.forEach( ( s, i ) => setShape( i, s ) )

	const palettes = shapes.map( ( s, i ) => o.palettes?.[i] ?? STATUE_PALETTES[s.name] ?? [0xffffff, 0xffffff] )
	const paletteColors = palettes.flat().map( ( c ) => new Color( c ) )
	const uPalette = uniformArray( paletteColors, 'color' )

	const morph = uniform( 0 )
	const reveal = uniform( o.reveal ?? 1 )
	const opacity = uniform( o.opacity ?? 1 )
	const intensity = uniform( o.intensity ?? 1 )

	// one texture binding shared by every .load() (referenceNode), WebGPU + WebGL2 (texelFetch)
	const tex = textureNode( texture )
	const load = ( x, y ) => tex.load( ivec2( x, y ) )
	const lastShape = float( Math.max( 0, n - 1 ) )
	const m = clamp( morph, 0, lastShape )
	const baseShape = int( floor( clamp( m, 0, lastShape.sub( 1 ).max( 0 ) ) ) )
	const nextShape = int( clamp( float( baseShape ).add( 1 ), 0, lastShape ) )
	const localMorph = clamp( m.sub( float( baseShape ) ), 0, 1 )
	const ringY = float( instanceIndex ).div( float( rings ) )
	// per-ring morph percent: front sweeps bottom -> top (venus.js)
	const percentV = backInOut( localMorph.mul( 2 ).sub( ringY ).clamp() )
	const bumpOf = ( p ) => p.clamp().sub( 0.5 ).abs().mul( 2 ).oneMinus().abs()
	const rowA = baseShape.mul( rings ).add( int( instanceIndex ) )
	const rowB = nextShape.mul( rings ).add( int( instanceIndex ) )
	const alphaV = mix( load( 0, rowA ).w, load( 0, rowB ).w, percentV )
	const vPercent = varying( percentV, 'vRingPercent' )
	const vAlpha = varying( alphaV, 'vRingAlpha' )
	const vRingY = varying( ringY, 'vRingY' )

	const line = new MeshLine()
		.instances( rings )
		.segments( samples )
		.closed( true )
		.color( 0xffffff )
		.transparent( true )
		.lineWidth( lineWidth )
		.gpuPositionNode( Fn( ( [progress] ) => {
			const u = fract( progress ).mul( samples )
			const i0 = floor( u )
			const f = u.sub( i0 )
			const c0 = int( i0 )
			const c1 = int( i0.add( 1 ).mod( samples ) )
			const posA = mix( load( c0, rowA ).xyz, load( c1, rowA ).xyz, f )
			const posB = mix( load( c0, rowB ).xyz, load( c1, rowB ).xyz, f )
			const pos = mix( posA, posB, percentV ).toVar()
			const s = bumpOf( percentV ).mul( swell ).add( 1 )
			return vec3( pos.x.mul( s ), pos.y, pos.z.mul( s ) )
		} ) )
		.widthFn( Fn( ( [width] ) => width.add( bumpOf( percentV ).mul( widthSwell ) ).mul( alphaV ) ) )
		.colorFn( Fn( () => {
			const k = smoothstep( 0, 1, vRingY )
			const baseA = uPalette.element( baseShape.mul( 2 ) )
			const topA = uPalette.element( baseShape.mul( 2 ).add( 1 ) )
			const baseB = uPalette.element( nextShape.mul( 2 ) )
			const topB = uPalette.element( nextShape.mul( 2 ).add( 1 ) )
			const cA = mix( baseA, topA, k )
			const cB = mix( baseB, topB, k )
			return mix( cA, cB, smoothstep( 0, 0.5, vPercent ) ).mul( vAlpha ).mul( intensity )
		} ) )
		.opacityFn( Fn( ( [alpha] ) => {
			const v = vRingY.add( 0.5 / rings ).oneMinus()
			return alpha.mul( smoothstep( reveal.oneMinus().sub( 0.1 ), reveal.oneMinus(), v ) ).mul( opacity )
		} ) )
	if ( antialias ) line.antialias( true )
	if ( additive ) {
		line.build()
		line.material.blending = AdditiveBlending
		line.material.depthWrite = false
	}
	line.autoResize()
	line.frustumCulled = false

	return {
		line,
		morph,
		reveal,
		opacity,
		intensity,
		texture,
		shapes: n,
		setShape,
		/** Normalized height (0 bottom .. 1 top) of the swelling morph front for the current morph value. */
		frontHeight() {
			const mm = Math.min( Math.max( morph.value, 0 ), n - 1 )
			const base = Math.min( Math.floor( mm ), Math.max( 0, n - 2 ) )
			const p = mm - base
			return Math.min( 1, Math.max( 0, p * 2 - 0.5 ) )
		},
		dispose() {
			line.removeFromParent()
			line.dispose()
			texture.dispose()
		},
	}
}

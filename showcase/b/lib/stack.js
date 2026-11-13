/**
 * Plan B ring stack: a variant of shared/statues.js createRingStack where the
 * DataTexture `w` channel is a PER-POINT mask (0 hides that stretch of a ring
 * by collapsing its width in the vertex stage, no discard). That lets one
 * closed ring be a flattened scanline loop that only shows where the glyph has
 * ink, then inflate into a statue contour where every point is visible.
 *
 * One instanced, closed MeshLine (one draw). Works on WebGPU and WebGL2.
 */
import { backInOut } from '@shared/statues.js'
import { MeshLine } from 'makio-meshline'
import { clamp, float, floor, Fn, fract, instanceIndex, int, ivec2, mix, select, smoothstep, step, texture as textureNode, uniform, uniformArray, varying, vec3, vec4 } from 'three/tsl'
import { Color, DataTexture, FloatType, NearestFilter, RGBAFormat } from 'three/webgpu'

/**
 * @param {Array<{ positions: Float32Array, mask?: Float32Array, active?: Uint8Array, rings: number, samples: number }>} shapes
 *   positions rings*samples*3; mask rings*samples (per point 0..1) or active rings (per ring)
 * @param {object} [o]
 * @param {number} [o.lineWidth=0.05]
 * @param {Array<[number, number]>} [o.palettes] per shape [base, top]
 * @param {number} [o.swell=0.6]
 * @param {number} [o.widthSwell=0.1]
 * @param {number} [o.intensity=1]
 * @param {number} [o.frontGlow=0] extra intensity at the morph front (bloom burst)
 * @param {number|null} [o.accentRing] ring index drawn in `accent`
 * @param {number} [o.accent=0xff2d1a]
 * @param {'up'|'down'} [o.revealFrom='up'] rings appear from ring 0 (up) or from the last ring (down)
 */
export function createStack( shapes, o = {} ) {
	const { lineWidth = 0.05, widthSwell = 0.1 } = o
	const { rings, samples } = shapes[0]
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
				data[dst + 3] = shape.mask ? shape.mask[r * samples + i] : ( shape.active ? shape.active[r] : 1 )
			}
		}
		texture.needsUpdate = true
	}
	shapes.forEach( ( s, i ) => setShape( i, s ) )

	const palettes = shapes.map( ( s, i ) => o.palettes?.[i] ?? [0xedeae3, 0xedeae3] )
	const uPalette = uniformArray( palettes.flat().map( ( c ) => new Color( c ) ), 'color' )

	const morph = uniform( 0 )
	const reveal = uniform( o.reveal ?? 1 )
	const opacity = uniform( o.opacity ?? 1 )
	const intensity = uniform( o.intensity ?? 1 )
	const frontGlow = uniform( o.frontGlow ?? 0 )
	const width = uniform( 1 ) // global width multiplier
	const draw = uniform( 1 ) // per-ring draw-on along progress (0..1)
	const accentRing = uniform( o.accentRing ?? -1, 'int' )
	const accent = uniform( new Color( o.accent ?? 0xff2d1a ) )
	const accentMix = uniform( 1 )
	const accentWidth = uniform( o.accentWidth ?? 1 )
	const swell = uniform( o.swell ?? 0.6 )
	const maskLag = uniform( o.maskLag ?? 0 ) // 0..1: delay the mask switch toward the end of a ring's morph

	const tex = textureNode( texture )
	const load = ( x, y ) => tex.load( ivec2( x, y ) )
	const lastShape = float( Math.max( 0, n - 1 ) )
	const m = clamp( morph, 0, lastShape )
	const baseShape = int( floor( clamp( m, 0, lastShape.sub( 1 ).max( 0 ) ) ) )
	const nextShape = int( clamp( float( baseShape ).add( 1 ), 0, lastShape ) )
	const localMorph = clamp( m.sub( float( baseShape ) ), 0, 1 )
	const ringY = float( instanceIndex ).div( float( rings - 1 ) )
	const percentV = backInOut( localMorph.mul( 2 ).sub( ringY ).clamp() )
	const bumpOf = ( p ) => p.clamp().sub( 0.5 ).abs().mul( 2 ).oneMinus().abs()
	const rowA = baseShape.mul( rings ).add( int( instanceIndex ) )
	const rowB = nextShape.mul( rings ).add( int( instanceIndex ) )
	const vPercent = varying( percentV, 'vStackPercent' )
	const vRingY = varying( ringY, 'vStackRingY' )
	const isAccent = select( int( instanceIndex ).equal( accentRing ), float( 1 ), float( 0 ) )
	const vAccent = varying( isAccent, 'vStackAccent' )

	const lookup = ( progress, row ) => {
		const u = fract( progress ).mul( samples )
		const i0 = floor( u )
		const f = u.sub( i0 )
		const c0 = int( i0 )
		const c1 = int( i0.add( 1 ).mod( samples ) )
		return mix( load( c0, row ), load( c1, row ), f )
	}

	const revealDown = o.revealFrom === 'down'
	const line = new MeshLine()
		.instances( rings )
		.segments( samples )
		.closed( true )
		.color( 0xffffff )
		.transparent( true )
		.lineWidth( lineWidth )
		.gpuPositionNode( Fn( ( [progress] ) => {
			const a = lookup( progress, rowA )
			const b = lookup( progress, rowB )
			const pos = mix( a.xyz, b.xyz, percentV ).toVar()
			const s = bumpOf( percentV ).mul( swell ).add( 1 )
			return vec3( pos.x.mul( s ), pos.y, pos.z.mul( s ) )
		} ) )
		.widthFn( Fn( ( [w, progress] ) => {
			const a = lookup( progress, rowA ).w
			const b = lookup( progress, rowB ).w
			const k = mix( a, b, smoothstep( maskLag.mul( 0.9 ), maskLag.mul( 0.1 ).add( 0.9 ).min( 1 ), percentV ) )
			// per-ring draw-on: the ring grows along its own progress
			const on = step( fract( progress ), draw.mul( 1.0001 ) )
			const aw = mix( float( 1 ), accentWidth, isAccent )
			return w.add( bumpOf( percentV ).mul( widthSwell ) ).mul( k ).mul( width ).mul( on ).mul( aw )
		} ) )
		.colorFn( Fn( () => {
			const k = smoothstep( 0, 1, vRingY )
			const cA = mix( uPalette.element( baseShape.mul( 2 ) ), uPalette.element( baseShape.mul( 2 ).add( 1 ) ), k )
			const cB = mix( uPalette.element( nextShape.mul( 2 ) ), uPalette.element( nextShape.mul( 2 ).add( 1 ) ), k )
			const c = mix( cA, cB, smoothstep( 0, 0.5, vPercent ) )
			const lit = mix( c, accent, vAccent.mul( accentMix ) )
			const glow = bumpOf( vPercent ).mul( frontGlow ).add( 1 )
			return vec4( lit.mul( intensity ).mul( glow ), 1 )
		} ) )
		.opacityFn( Fn( ( [alpha] ) => {
			const v = revealDown ? vRingY.sub( 0.5 / rings ) : vRingY.add( 0.5 / rings ).oneMinus()
			return alpha.mul( smoothstep( reveal.oneMinus().sub( 0.08 ), reveal.oneMinus(), v ) ).mul( opacity )
		} ) )
	if ( o.antialias ) line.antialias( true )
	line.autoResize()
	line.frustumCulled = false

	return {
		line,
		morph,
		reveal,
		opacity,
		intensity,
		frontGlow,
		width,
		draw,
		accentRing,
		accent,
		accentMix,
		accentWidth,
		swell,
		maskLag,
		texture,
		shapes: n,
		setShape,
		dispose() {
			line.removeFromParent()
			line.dispose()
			texture.dispose()
		},
	}
}

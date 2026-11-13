/**
 * V · The Breath — Nefertiti as a faint ring armature; around her crown flows a veil of
 * MeshLineCompute curves (140 × 64, simulated in WebGPU compute, arc-length pulses) and above her
 * a halo of 64 Lorenz trails written into a GPU ring buffer (storagePositions({ head })).
 * WebGL2: CPU-animated strands stand in, with a 'WebGPU for the full piece' tag.
 */
import { easeOutCubic } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { createRingStack } from '@shared/statues.js'
import { MeshLine, MeshLineCompute, storagePositions } from 'makio-meshline'
import { color, cos, float, Fn, instanceIndex, Loop, mix, mod, smoothstep, storage, uint, uniform, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Group, Plane, Raycaster, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'

import { besideRest, capsText, clamp01, FLOOR_Y, goldCount, goldText, lineText, pinToCamera, plinthLine, restCamWorld, roomRings, spotCone } from '../kit.js'

const curves = num( 'computeCurves' )
const lorenz = num( 'lorenz16k' )

const TRAILS = 64
const TRAIL = 256
const SIGMA = 10
const RHO = 28
const BETA = 8 / 3
const STEP_DT = 0.006
/** One Euler step of the Lorenz system, in place on p = [x, y, z]. */
const lorenzStep = ( p ) => {
	const [x, y, z] = p
	p[0] = x + SIGMA * ( y - x ) * STEP_DT
	p[1] = y + ( x * ( RHO - z ) - y ) * STEP_DT
	p[2] = z + ( x * y - BETA * z ) * STEP_DT
}

export default {
	slug: 'breath',
	title: 'The Breath',
	numeral: 'V',
	// built once behind the loader and only hidden by presence: its compute steps run only while
	// the room is on screen
	// ptheta: the phone framing faces her more (an even step from the rooms either side)
	rest: { radius: 25, theta: -0.1, ptheta: -0.15, phi: 0.1, tx: 4.6, ty: 1.6, ptx: 0, pty: -1.6 },
	footnote: `${( curves.nums[0] * curves.nums[1] ).toLocaleString( 'en-US' )} points simulated per frame · ${lorenz.comparison.split( ',' )[0]}`,

	async create( ctx, root, room ) {
		const { renderer, camera, isWebGPU } = ctx
		const nef = await roomRings( 'nefertiti' )
		const armature = createRingStack( [nef], { lineWidth: 0.02, intensity: 0.5, palettes: [[0x6e5a8a, 0xece4d6]] } )
		root.add( armature.line )
		const plinth = plinthLine( { w: 5.4, h: 1.2, opacity: 0.4 } )
		const cone = spotCone( new Vector3( 0, 18, 2.5 ), new Vector3( 0, FLOOR_Y, 0 ), 5.2, { intensity: 0.3, color: 0xcbb8ff } )
		root.add( plinth, cone )

		const HEAD = new Vector3( 0.3, 3.6, 0 )
		/** WebGL2 stand-in strand `seed` at time t (48 points, in place). */
		const strand = ( pts, seed, t ) => {
			for ( let k = 0; k < 48; k++ ) {
				const u = k / 47
				const a = seed * 0.7 + t * 0.4 + u * 3.2
				const r = 3.2 + Math.sin( seed * 1.3 + u * 6 + t ) * 0.8
				pts[k * 3] = Math.cos( a ) * r
				pts[k * 3 + 1] = HEAD.y + Math.sin( a * 1.7 + seed ) * 1.2 + u * 0.8
				pts[k * 3 + 2] = Math.sin( a ) * r * 0.6
			}
			return pts
		}
		let veil = null
		let integrate = null
		let trails = null
		const head = uniform( 0, 'uint' )
		const steps = uniform( 1, 'uint' )
		let accumulator = 0
		const cpuStrands = []
		const dashPhase = uniform( 0 )

		if ( isWebGPU ) {
			//------------------------------------------------------ compute veil
			veil = new MeshLineCompute( {
				curveCount: curves.nums[0],
				pointsPerCurve: curves.nums[1],
				curveLength: 5,
				bounds: 13,
				damping: 0.94,
				curlStrength: 0.8,
				flowSpeed: 0.45,
				homeStrength: 2.2,
				mouseStrength: 12,
				mouseRadius: 6,
				mode: 'autonomous',
				stiffness: 1,
				lineWidth: 2.6,
				sizeAttenuation: false,
			} )
			const count = curves.nums[0]
			veil
				.widthFn( Fn( ( [width, progress] ) => width.mul( smoothstep( 0, 0.2, progress ).mul( float( 1 ).sub( smoothstep( 0.7, 1, progress ) ) ).mul( 0.9 ).add( 0.1 ) ) ) )
				.colorFn( Fn( ( [, progress] ) => {
					const r = float( instanceIndex ).div( Math.max( count - 1, 1 ) )
					const core = mix( color( 0xfff1d6 ), color( 0xe9c98f ), smoothstep( 0, 0.35, r ) )
					const rim = mix( core, color( 0xb48cff ), smoothstep( 0.35, 0.9, r ) )
					return vec4( rim.mul( float( 1 ).sub( progress.mul( 0.35 ) ) ), 1 )
				} ) )
				.fragmentAlphaFn( Fn( ( [alpha, uvCoords, progress] ) => {
					const arc = veil.arcLengthNode( progress ).toVar()
					const cycle = mod( arc.div( 2.2 ).add( dashPhase ), 1 ).toVar()
					const pulse = smoothstep( 0, 0.1, cycle ).mul( float( 1 ).sub( smoothstep( 0.35, 0.7, cycle ) ) )
					const across = uvCoords.y.sub( 0.5 ).abs().mul( 2 )
					return alpha.mul( float( 1 ).sub( smoothstep( 0.35, 1, across ) ) ).mul( pulse.mul( 0.65 ).add( 0.35 ) )
				} ) )
				.transparent( true )
				.build()
			veil.material.blending = AdditiveBlending
			veil.material.depthWrite = false
			veil.position.copy( HEAD )
			veil.scale.setScalar( 0.52 )
			veil.rotation.set( -0.95, 0, 0.25 )
			veil.frustumCulled = false
			root.add( veil )

			//------------------------------------------------------ Lorenz halo: GPU ring buffer
			const buffer = new StorageBufferAttribute( TRAILS * TRAIL, 3 )
			const arr = buffer.array
			for ( let t = 0; t < TRAILS; t++ ) {
				const p = [1, 1 + t * 0.001, 1]
				for ( let s = 0; s < 400 + t * 97; s++ ) lorenzStep( p )
				for ( let s = 0; s < TRAIL; s++ ) {
					const o = ( t * TRAIL + s ) * 3
					arr[o] = p[0]
					arr[o + 1] = p[1]
					arr[o + 2] = p[2]
					lorenzStep( p )
				}
			}
			head.value = TRAIL - 1
			buffer.needsUpdate = true
			const positions = storage( buffer, 'vec3', TRAILS * TRAIL )
			const len = uint( TRAIL )
			integrate = Fn( () => {
				const base = instanceIndex.mul( len ).toVar()
				const p = positions.element( base.add( head ) ).toVar()
				Loop( { start: uint( 1 ), end: steps.add( 1 ), type: 'uint' }, ( { i } ) => {
					const dx = float( SIGMA ).mul( p.y.sub( p.x ) )
					const dy = p.x.mul( float( RHO ).sub( p.z ) ).sub( p.y )
					const dz = p.x.mul( p.y ).sub( float( BETA ).mul( p.z ) )
					p.addAssign( vec3( dx, dy, dz ).mul( STEP_DT ) )
					positions.element( base.add( head.add( i ).mod( len ) ) ).assign( p )
				} )
			} )().compute( TRAILS )
			trails = new MeshLine()
				.instances( TRAILS )
				.segments( TRAIL - 1 )
				.gpuPositionNode( storagePositions( buffer, { pointsPerLine: TRAIL, head } ) )
				.colorFn( Fn( ( [, progress] ) => {
					const ratio = float( instanceIndex ).div( TRAILS - 1 )
					const hue = vec3( 0.5 ).add( vec3( 0.5 ).mul( cos( vec3( ratio.mul( 0.35 ).add( 0.05 ) ).add( vec3( 0.0, 0.12, 0.3 ) ).mul( Math.PI * 2 ) ) ) )
					const warm = mix( hue, vec3( 0.95, 0.82, 0.55 ), 0.55 )
					return vec4( warm.mul( progress.oneMinus().pow( 1.6 ).mul( 1.6 ).add( 0.05 ) ), 1 )
				} ) )
				.widthFn( Fn( ( [width, progress] ) => width.mul( progress.oneMinus().mul( 0.85 ).add( 0.15 ) ) ) )
				.lineWidth( 1.8 )
				.sizeAttenuation( false )
				.color( 0xffffff )
				.autoResize()
			const halo = new Group()
			halo.position.set( 0.2, 8.4, -0.6 )
			halo.scale.setScalar( 0.085 )
			halo.rotation.x = -Math.PI / 2
			trails.position.set( 0, 0, -25 )
			trails.frustumCulled = false
			halo.add( trails )
			root.add( halo )
		} else {
			//------------------------------------------------------ WebGL2 stand-in: CPU strands
			for ( let i = 0; i < 36; i++ ) {
				const pts = new Float32Array( 48 * 3 )
				strand( pts, i, 0 ) // a real shape from the start: the loader builds and warms it
				const l = new MeshLine().lines( pts, false ).dynamic( true ).lineWidth( 2 ).sizeAttenuation( false ).color( i % 3 ? 0xe9c98f : 0xb48cff ).autoResize()
				l.seed = i
				l.pts = pts
				cpuStrands.push( l )
				root.add( l )
			}
		}

		//---------------------------------------------------------- plaque
		const plaque = new Group()
		const headline = await lineText( renderer, 'The lines now move themselves.', 0.6, { align: 'left' } )
		headline.position.set( 0, 3.5, 0 )
		const curvesN = await goldText( renderer, curves.value, 1.9, { align: 'left', glow: 1.6 } )
		curvesN.position.set( -0.08, 1.75, 0 )
		const curvesL = await capsText( renderer, 'curves × points · GPU', 0.18, { align: 'left' } )
		curvesL.position.set( 0, 0.4, 0 )
		const lorenzN = await goldCount( renderer, '00,000', lorenz.value, 1.25, { align: 'left' } )
		lorenzN.position.set( -0.05, -0.75, 0 )
		const lorenzL = await capsText( renderer, 'Lorenz points · GPU ring buffer', 0.18, { align: 'left' } )
		lorenzL.position.set( 0, -1.75, 0 )
		plaque.add( headline, curvesN, curvesL, lorenzN, lorenzL )
		let tag = null
		if ( !isWebGPU ) {
			tag = await capsText( renderer, 'WebGPU for the full piece · CPU stand-in', 0.17, { align: 'left', tint: 0xb48cff } )
			tag.position.set( 0, -2.6, 0 )
			plaque.add( tag )
		}
		root.add( plaque )

		// compile both compute pipelines now (behind the loader), not on the first visible frame
		if ( veil ) veil.step( renderer, 1 / 60 )
		if ( integrate ) {
			renderer.compute( integrate )
			head.value = ( head.value + 1 ) % TRAIL
		}
		const dimTexts = [curvesL, lorenzL]
		if ( tag ) dimTexts.push( tag )

		const raycaster = new Raycaster()
		const plane = new Plane()
		const hit = new Vector3()
		const ndc = new Vector2()
		const camTarget = new Vector3()
		const headWorld = new Vector3()
		const n = new Vector3()

		return {
			update( f ) {
				const portrait = ctx.portrait()
				if ( portrait ) pinToCamera( plaque, camera, root, { y: -0.53, width: 10, local: f.local } )
				else {
					besideRest( room.def.rest, 6.4, 1.2, plaque.position, 1 )
					plaque.scale.setScalar( 1 )
					plaque.lookAt( restCamWorld( room.def.rest, root, camTarget ) )
				}

				const dt = Math.min( f.dt, 1 / 30 )
				const engaged = Math.abs( f.local ) < 0.98
				if ( veil && engaged ) {
					const pointerFresh = ctx.pointerActive && performance.now() - ctx.lastPointerMove < 2500 && Math.abs( f.local ) < 0.2
					if ( pointerFresh ) {
						headWorld.copy( HEAD ).add( root.position )
						camera.getWorldDirection( n ).negate()
						plane.setFromNormalAndCoplanarPoint( n, headWorld )
						ndc.set( ctx.pointer.x, ctx.pointer.y )
						raycaster.setFromCamera( ndc, camera )
						if ( raycaster.ray.intersectPlane( plane, hit ) ) {
							veil.mode( 'follow' )
							veil.mouse( veil.worldToLocal( hit ) )
						}
					} else {
						veil.mode( 'autonomous' )
					}
					veil.step( renderer, dt )
					dashPhase.value -= dt * 0.35
				}
				if ( integrate && engaged ) {
					accumulator += dt * 1000
					const s = Math.min( 4, Math.floor( accumulator / ( 1000 / 60 ) ) )
					if ( s > 0 ) {
						accumulator = Math.min( accumulator - s * ( 1000 / 60 ), 1000 / 60 )
						steps.value = s
						renderer.compute( integrate )
						head.value = ( head.value + s ) % TRAIL
					}
				}
				for ( const l of cpuStrands ) l.setPositions( strand( l.pts, l.seed, f.t ) )

				const a = Math.pow( f.presence, 1.5 )
				const k = clamp01( ( f.presence - 0.3 ) / 0.7 )
				lorenzN.set( Math.round( lorenz.nums[0] * easeOutCubic( k ) ), k < 0.98 ? 0.35 : 0, k >= 0.98 )
				lorenzN.opacityValue = a
				headline.opacity.value = a
				curvesN.opacity.value = a
				for ( const tx of dimTexts ) tx.opacity.value = a * 0.72
				curvesN.reveal.value = clamp01( f.presence * 1.5 - 0.3 )
				headline.reveal.value = clamp01( f.presence * 1.5 - 0.4 )
				armature.opacity.value = 0.35 + 0.65 * f.presence
				cone.uIntensity.value = 0.3 * f.presence
			},
			dispose() {
				armature.dispose()
				veil?.dispose()
				trails?.dispose()
				integrate?.dispose?.()
				for ( const l of cpuStrands ) l.dispose()
				for ( const o of [plinth, cone] ) o.dispose()
				for ( const tx of [headline, curvesN, curvesL, lorenzL, tag].filter( Boolean ) ) tx.dispose()
				lorenzN.dispose()
			},
		}
	},
}

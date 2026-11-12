/**
 * Wind Tunnel — smoke filaments parted by a hover car. A WebGPU compute shader
 * advects them through a flow field built on the car's 3D signed-distance
 * volume, and each trail is a ring buffer the line reads straight from the GPU.
 * Demonstrates: storagePositions( buffer, { pointsPerLine, head } ), .gpuPositionNode( fn ),
 * .instances( count ), and WebGPU compute integration.
 */
import { MeshLine, storagePositions } from 'makio-meshline'
import { abs, clamp, cos, dot, exp, float, floor, Fn, If, instanceIndex, length, max, min, mix, normalize, sin, smoothstep, sqrt, storage, uint, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, StorageBufferAttribute, Vector2 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { onMove } from '@/makio/utils/input/mouse'
import { createDemoControls } from '@/utils/demoControls'
import { WebGPURequiredError } from '@/utils/demoFailure'
import { createDemoHint } from '@/utils/demoHint'
import { createWindTunnelAudio } from '@/utils/windTunnelAudio'
import {
	createNozzleBuffer,
	FLOW_SPEED,
	INSTANCE_COUNT,
	loadWindTunnelCar,
	NOZZLE_COUNT,
	SDF_CELL_COUNT,
	SDF_MAX_X,
	SDF_MAX_Y,
	SDF_MAX_Z,
	SDF_MIN_X,
	SDF_MIN_Y,
	SDF_MIN_Z,
	SDF_NX,
	SDF_NY,
	SDF_NZ,
	SURFACE_CLEARANCE,
	TOTAL_POINTS,
	TRAIL_LENGTH,
	Z_FADE_IN,
	Z_FADE_OUT,
	Z_RESET,
	Z_SPAWN,
} from '@/utils/windTunnelCar'
import { createLinesPanel } from '@/utils/windTunnelPanel'
import { createTunnelStage, REFLECTED } from '@/utils/windTunnelStage'

const MODES = [
	{ id: 'tunnel', label: 'Full Tunnel', key: '1', mode: 0 },
	{ id: 'rake', label: 'Smoke Rake', key: '2', mode: 1 },
	{ id: 'ground', label: 'Ground Effect', key: '3', mode: 2 },
]

// Milliseconds between two samples of a trail at base wind speed.
const SAMPLE_MS = 10
// Flow seconds a filament takes from the nozzle to the collector.
const TRANSIT = ( Z_SPAWN - Z_RESET ) / FLOW_SPEED

// Height of the rake while the pointer rests mid-screen.
const RAKE_Y = 0.62

// The car as the flow sees it from afar: an ellipsoid, and where its tail ends.
const BODY_CENTER = vec3( 0, 0.72, -0.07 )
const BODY_RADII = vec3( 1, 0.56, 2.4 )
const TAIL_Z = -2.35

export default class WindTunnelExample {
	// Each trail is a ring buffer: `head` is its newest slot, so a frame writes
	// one sample per filament instead of shifting the 128 points down the trail.
	head = uniform( 0, 'uint' )
	uTurn = uniform( 0, 'uint' )
	uStepDt = uniform( 0.012 )
	uTime = uniform( 0 )
	uMode = uniform( 0, 'uint' )
	uRakeX = uniform( 0 )
	uRakeY = uniform( RAKE_Y )
	uCrosswind = uniform( 0 )
	uWind = uniform( 1 )

	// What the Lines panel tunes. Ranges are ( min, max ): each filament draws its
	// own width, length and speed between the two.
	look = {
		density: uniform( 1 ),
		width: uniform( new Vector2( 0.012, 0.019 ) ),
		length: uniform( new Vector2( 0.47, 0.66 ) ),
		speed: uniform( new Vector2( 1.24, 2 ) ),
		halo: uniform( 1 ),
		glow: uniform( 1.02 ),
		cling: uniform( 0 ),
		turbulence: uniform( 0.13 ),
		// Colour by the speed of the air: stalled → free stream → sliding over the body → fastest.
		stalled: uniform( new Color( 0x5b1bbf ) ),
		stream: uniform( new Color( 0xff4d2e ) ),
		sliding: uniform( new Color( 0xffc46b ) ),
		peak: uniform( new Color( 0xfff4d6 ) ),
	}

	targetRakeX = 0
	targetRakeY = RAKE_Y
	targetWind = 1
	crosswindEnabled = false
	sinceSample = 0

	async init() {
		await stage3d.initRender( { background: 0x010204, fov: 32, near: 0.1, far: 160 } )
		if ( !stage3d.isWebGPU ) {
			throw new WebGPURequiredError( 'Wind Tunnel advects its streamlines against a 3D SDF in WebGPU compute shaders, and this browser is running the WebGL2 fallback.' )
		}

		stage3d.orbit( 8.2, {
			target: [0, 0.6, -0.4],
			cameraOffset: [0, 0.6, -0.4],
			theta: 0.95,
			phi: 1.41,
			minRadius: 4.5,
			maxRadius: 18,
			minPhi: 0.35,
			maxPhi: 1.5,
			autoRotate: 0.000018,
		} )

		const { carRoot, sdfBuffer } = await loadWindTunnelCar()
		this.sdfBuffer = stage3d.own( sdfBuffer )
		stage3d.add( carRoot )

		const { group, rakeBar } = createTunnelStage( carRoot )
		this.rakeBar = rakeBar
		stage3d.add( group )

		this.initStreamlines()
		this.initUi()
	}

	initStreamlines() {
		this.nozzleBuffer = stage3d.own( createNozzleBuffer() )
		this.positionBuffer = stage3d.own( new StorageBufferAttribute( TOTAL_POINTS, 4 ) )
		// Every point waits upstream of the nozzle, where smoke is invisible.
		for ( let i = 0; i < TOTAL_POINTS; i++ ) this.positionBuffer.array[i * 4 + 2] = Z_SPAWN + 1

		const sdfVolume = storage( this.sdfBuffer, 'vec4', SDF_CELL_COUNT ).toReadOnly()
		const nozzles = storage( this.nozzleBuffer, 'vec4', INSTANCE_COUNT ).toReadOnly()
		const positions = storage( this.positionBuffer, 'vec4', TOTAL_POINTS )
		const readPositions = storage( this.positionBuffer, 'vec4', TOTAL_POINTS ).toReadOnly()

		const trailLen = uint( TRAIL_LENGTH )
		const trailMask = uint( TRAIL_LENGTH - 1 )
		const { look } = this
		// A number in 0..1 that each filament keeps, one per `seed`.
		const draw = seed => float( instanceIndex ).mul( seed ).fract()

		// Trilinearly sample vec4( nx, ny, nz, signedDistance ) from the baked 3D SDF volume.
		const sampleSdf = Fn( ( [p] ) => {
			const res = vec4( 0, 1, 0, 2 ).toVar()
			const inBox = p.x.greaterThan( SDF_MIN_X ).and( p.x.lessThan( SDF_MAX_X ) )
				.and( p.y.greaterThan( SDF_MIN_Y ) ).and( p.y.lessThan( SDF_MAX_Y ) )
				.and( p.z.greaterThan( SDF_MIN_Z ) ).and( p.z.lessThan( SDF_MAX_Z ) )

			If( inBox, () => {
				const gx = clamp( p.x.sub( SDF_MIN_X ).div( SDF_MAX_X - SDF_MIN_X ).mul( SDF_NX - 1 ), 0, SDF_NX - 1.001 ).toVar()
				const gy = clamp( p.y.sub( SDF_MIN_Y ).div( SDF_MAX_Y - SDF_MIN_Y ).mul( SDF_NY - 1 ), 0, SDF_NY - 1.001 ).toVar()
				const gz = clamp( p.z.sub( SDF_MIN_Z ).div( SDF_MAX_Z - SDF_MIN_Z ).mul( SDF_NZ - 1 ), 0, SDF_NZ - 1.001 ).toVar()

				const ix = floor( gx ).toUint().toVar()
				const iy = floor( gy ).toUint().toVar()
				const iz = floor( gz ).toUint().toVar()
				const fx = gx.sub( floor( gx ) ).toVar()
				const fy = gy.sub( floor( gy ) ).toVar()
				const fz = gz.sub( floor( gz ) ).toVar()
				// Blend Hermite smoothstep with linear weights so normals and distances
				// curve smoothly across grid cell boundaries instead of kinking at voxel faces.
				const wx = mix( fx, fx.mul( fx ).mul( float( 3 ).sub( fx.mul( 2 ) ) ), 0.55 ).toVar()
				const wy = mix( fy, fy.mul( fy ).mul( float( 3 ).sub( fy.mul( 2 ) ) ), 0.55 ).toVar()
				const wz = mix( fz, fz.mul( fz ).mul( float( 3 ).sub( fz.mul( 2 ) ) ), 0.55 ).toVar()

				const strideY = uint( SDF_NX )
				const strideZ = uint( SDF_NX * SDF_NY )
				const b000 = iz.mul( strideZ ).add( iy.mul( strideY ) ).add( ix ).toVar()
				const b100 = b000.add( uint( 1 ) )
				const b010 = b000.add( strideY )
				const b110 = b010.add( uint( 1 ) )
				const b001 = b000.add( strideZ )
				const b101 = b001.add( uint( 1 ) )
				const b011 = b001.add( strideY )
				const b111 = b011.add( uint( 1 ) )

				const c00 = mix( sdfVolume.element( b000 ), sdfVolume.element( b100 ), wx )
				const c10 = mix( sdfVolume.element( b010 ), sdfVolume.element( b110 ), wx )
				const c01 = mix( sdfVolume.element( b001 ), sdfVolume.element( b101 ), wx )
				const c11 = mix( sdfVolume.element( b011 ), sdfVolume.element( b111 ), wx )
				const raw = mix( mix( c00, c10, wy ), mix( c01, c11, wy ), wz ).toVar()
				res.assign( vec4( normalize( raw.xyz.add( vec3( 0, 1e-5, 0 ) ) ), raw.w ) )
			} )
			return res
		} )

		// Where a filament leaves the rake in the active preset.
		const nozzleSpawn = Fn( ( [nozzle, line] ) => {
			const u = nozzle.x
			const v = nozzle.y

			// Full Tunnel (mode 0): an arch of nozzles the shape of the car seen from the front,
			// so every filament meets the body.
			const x = u.mul( float( 1.08 ).sub( v.mul( v ).mul( 0.2 ) ) ).add( this.uRakeX.mul( 0.25 ) ).toVar()
			const y = float( 0.16 ).add( v.mul( float( 1.1 ).sub( u.mul( u ).mul( 0.3 ) ) ) ).add( this.uRakeY.sub( RAKE_Y ).mul( 0.22 ) ).toVar()

			If( this.uMode.equal( uint( 1 ) ), () => {
				// Smoke Rake (mode 1): one comb of thick streams the pointer moves.
				x.assign( u.mul( 1.15 ).add( this.uRakeX.mul( 0.4 ) ) )
				y.assign( this.uRakeY.add( v.sub( 0.5 ).mul( 0.14 ) ) )
			} ).ElseIf( this.uMode.equal( uint( 2 ) ), () => {
				// Ground Effect (mode 2): a low sheet into the splitter and the underbody.
				x.assign( u.mul( 1.15 ).add( this.uRakeX.mul( 0.2 ) ) )
				y.assign( float( 0.08 ).add( v.mul( 0.42 ) ) )
			} )

			// The strands of a bundle sit on a small spiral around its core.
			const angle = float( line ).mul( 2.39996 )
			const strand = vec2( cos( angle ), sin( angle ) ).mul( sqrt( nozzle.w ).mul( 0.02 ) )
			// Lean into the crosswind, so the yawed stream still meets the car.
			const lean = this.uCrosswind.mul( Z_SPAWN / FLOW_SPEED * 0.85 )

			return vec3( x.add( strand.x ).sub( lean ), max( y.add( strand.y ), 0.06 ), Z_SPAWN )
		} )

		// Potential flow around the body ellipsoid: the far field that parts the
		// smoke long before it reaches the car, and speeds it up over the roof.
		const bodyWash = Fn( ( [p, wind, centerY] ) => {
			const q = p.sub( vec3( BODY_CENTER.x, centerY, BODY_CENTER.z ) ).div( BODY_RADII ).toVar()
			const r = max( length( q ), 1 ).toVar()
			const dir = normalize( q.add( vec3( 0, 0, 1e-4 ) ) ).toVar()
			const w = wind.div( BODY_RADII ).toVar()
			const dipole = dir.mul( dot( w, dir ).mul( 3 ) ).sub( w ).div( r.mul( r ).mul( r ).mul( 2 ) )
			return dipole.mul( BODY_RADII ).negate()
		} )

		// vec4( velocity, speed ) of the air at `p`, for a filament that rides `shell`
		// above the bodywork: the smoke slides over the car as a thin layered sheet.
		const airflow = Fn( ( [p, shell] ) => {
			const wind = vec3( this.uCrosswind, 0, -FLOW_SPEED ).mul( this.uWind ).toVar()
			const vel = wind.toVar()

			const sdf = sampleSdf( p ).toVar()
			const gap = max( sdf.w.sub( shell ), 0 ).toVar()

			// The ellipsoid and its mirror under the floor part the outer tunnel air from afar,
			// fading out near the body so the car's actual 3D SDF contours shape the boundary layer.
			const wash = bodyWash( p, wind, BODY_CENTER.y ).add( bodyWash( p, wind, BODY_CENTER.y.negate() ) )
			const farField = smoothstep( 0.08, 0.65, sdf.w ).mul( mix( 0.08, 0.22, smoothstep( -2.6, -0.2, p.z ) ) )
			vel.addAssign( wash.mul( farField ) )

			const alongside = smoothstep( TAIL_Z - 0.05, TAIL_Z + 0.45, p.z ).mul( smoothstep( 0.14, 0.32, p.y ) ).toVar()
			// 1 along the nose, hood, windshield, canopy dome, doors, fenders and wing;
			// 0 only on the blunt rear-facing transom so streamlines detach cleanly at the tail.
			const notTransom = smoothstep( -0.68, -0.2, sdf.z ).toVar()

			// Air passing within reach of the body is drawn onto it…
			const reach = smoothstep( 0.02, 0.14, gap ).mul( smoothstep( 0.52, 0.12, gap ) ).mul( alongside ).mul( notTransom )
			vel.subAssign( sdf.xyz.mul( reach ).mul( this.uWind.mul( look.cling ).mul( FLOW_SPEED * 0.22 ) ) )
			// …cannot go into windward slopes, curving smoothly with the rising nose, fenders & windshield…
			const vn = dot( vel, sdf.xyz ).toVar()
			const near = smoothstep( 0.36, 0, gap ).toVar()
			vel.subAssign( sdf.xyz.mul( min( vn, 0 ) ).mul( near ) )
			// …and follows leeward/concave contours (hood dip, door waist, teardrop canopy back & rear deck)
			// instead of shooting off crests in flat horizontal steps, until the tail lets it go.
			const follow = mix( 0.9, 1, clamp( look.cling, 0, 1 ) )
			const nearOut = smoothstep( 0.34, 0.01, gap ).mul( alongside ).mul( notTransom ).mul( follow ).toVar()
			vel.subAssign( sdf.xyz.mul( max( vn, 0 ) ).mul( nearOut ) )
			// Squeezed against the bodywork, it speeds up.
			vel.mulAssign( near.mul( 0.3 ).add( 1 ) )

			// Behind the tail: slower air in the car's shadow, the pair of
			// counter-rotating wingtip/diffuser vortices it sheds (lifting a rooster-tail
			// upwash in the centre and coiling the flanks around rising cores), and gusts
			// that billow downstream without dragging the top sheet down to the floor.
			const behind = float( TAIL_Z ).sub( p.z ).toVar()
			If( behind.greaterThan( 0 ), () => {
				const drift = this.uCrosswind.mul( behind ).div( FLOW_SPEED ).toVar()
				const x = p.x.sub( drift ).toVar()
				const onset = smoothstep( 0, 1.4, behind ).toVar()
				const shadow = smoothstep( 1.6, 0.7, abs( x ) ).mul( smoothstep( 1.9, 1.05, p.y ) ).mul( onset ).toVar()
				const force = this.uWind.pow( 1.35 ).mul( look.turbulence ).toVar()

				vel.z.mulAssign( shadow.mul( exp( behind.mul( -0.16 ) ) ).mul( 0.42 ).oneMinus() )

				// Vortex cores trail off the wingtips and climb gently down the wake.
				const coreY = float( 0.82 ).add( behind.mul( 0.07 ) ).toVar()
				const dy = p.y.sub( coreY ).toVar()
				const spin = onset.mul( exp( behind.mul( -0.08 ) ) ).mul( force ).mul( 1.45 ).toVar()
				for ( const side of [-1, 1] ) {
					const dx = x.sub( side * 0.62 ).toVar()
					const r2 = dx.mul( dx ).add( dy.mul( dy ) ).add( 0.07 ).toVar()
					// Negated `side` gives upwash between the endplates; outside the core,
					// downward motion is softened and pulled inward so strands coil instead of dropping.
					const turn = spin.div( r2 ).mul( -side ).toVar()
					const lift = dx.mul( turn )
					vel.x.subAssign( dy.mul( turn ).add( dx.mul( spin.div( r2 ).mul( 0.28 ) ) ) )
					vel.y.addAssign( max( lift, lift.mul( 0.25 ) ).sub( dy.mul( spin.div( r2 ).mul( 0.22 ) ) ) )
				}

				const gust = shadow.mul( smoothstep( 0.2, 3.5, behind ) ).mul( force ).mul( 0.75 ).toVar()
				const phase = p.z.mul( 1.7 ).add( this.uTime.mul( 5.2 ) ).toVar()
				const waveY = cos( phase.mul( 0.85 ).sub( x.mul( 2.6 ) ) ).add( cos( phase.mul( 2.1 ).add( x.mul( 3.7 ) ) ).mul( 0.45 ) ).toVar()
				vel.x.addAssign( sin( phase.add( p.y.mul( 2.9 ) ) ).add( sin( phase.mul( 2.3 ).sub( p.y.mul( 4.1 ) ) ).mul( 0.45 ) ).mul( gust ) )
				vel.y.addAssign( max( waveY, waveY.mul( 0.35 ) ).mul( gust ).mul( 0.8 ) )
			} )

			// Speed against the tunnel's own, eased so a gale still shows where the car quickens it.
			return vec4( vel, length( vel ).div( this.uWind.pow( 0.6 ).mul( FLOW_SPEED ) ) )
		} )

		// One thread per filament: move its newest point one RK2 midpoint step down the flow.
		this.integrateNode = stage3d.own( Fn( () => {
			const base = instanceIndex.mul( trailLen ).toVar()
			const nozzle = nozzles.element( instanceIndex ).toVar()

			const p = positions.element( base.add( this.head ) ).xyz.toVar()
			// Each filament keeps its own laminar shell height over the bodywork.
			const shell = float( SURFACE_CLEARANCE ).add( float( instanceIndex ).mul( 0.618034 ).fract().mul( 0.045 ) ).toVar()
			const dt = this.uStepDt.mul( mix( look.speed.x, look.speed.y, draw( 0.754877 ) ) ).toVar()

			const air0 = airflow( p, shell ).toVar()
			const mid = p.add( air0.xyz.mul( dt.mul( 0.5 ) ) ).toVar()
			const sdfMid = sampleSdf( mid ).toVar()
			If( sdfMid.w.lessThan( shell ), () => {
				mid.addAssign( sdfMid.xyz.mul( shell.sub( sdfMid.w ) ) )
			} )
			const air = airflow( mid, shell ).toVar()
			const next = vec4( p.add( air.xyz.mul( dt ) ), air.w ).toVar()

			// Never inside the filament's shell or under the floor.
			const sdfNext = sampleSdf( next.xyz ).toVar()
			If( sdfNext.w.lessThan( shell ), () => {
				next.xyz.addAssign( sdfNext.xyz.mul( shell.sub( sdfNext.w ) ) )
			} )
			next.y.assign( max( next.y, 0.04 ) )

			// Past the collector, go back to the rake. Smoke is invisible at both
			// ends, so the jump never shows and the rest of the trail flows on out.
			// Filaments also wait there for their turn at the start, which staggers them.
			If( next.z.lessThan( Z_RESET ).or( this.uTime.lessThan( nozzle.z.mul( TRANSIT ) ) ), () => {
				next.assign( vec4( nozzleSpawn( nozzle, instanceIndex ), 1 ) )
			} )

			// `uTurn` is 1 on the steps that add a sample; on the others the newest
			// sample is rewritten in place, so the head glides at any refresh rate.
			positions.element( base.add( this.head.add( this.uTurn ).bitAnd( trailMask ) ) ).assign( next )
		} )().compute( INSTANCE_COUNT ) )

		// vec4( position, speed ) stored at `progress` of this instance's trail.
		const trailSample = Fn( ( [progress] ) => {
			const age = progress.mul( TRAIL_LENGTH - 1 ).round().toUint()
			return readPositions.element( instanceIndex.mul( trailLen ).add( this.head.add( trailLen ).sub( age ).bitAnd( trailMask ) ) )
		} )

		// Colour of the smoke at `progress` of this instance's trail, from the speed
		// of the air that carried it: stalled → free stream → white where it slides
		// over the body → gold at the fastest.
		const smokeColor = Fn( ( [progress] ) => {
			const state = trailSample( progress ).toVar()
			const stream = mix( look.stalled, look.stream, smoothstep( 0.5, 0.9, state.w ) )
			const sliding = mix( stream, look.sliding, smoothstep( 1, 1.2, state.w ) )
			const tint = mix( sliding, look.peak, smoothstep( 1.3, 1.55, state.w ) )

			// A bright head and a fading tail over this filament's share of the trail,
			// and nothing at either end of the tunnel.
			const age = progress.mul( 0.68 ).div( mix( look.length.x, look.length.y, draw( 0.56984 ) ) ).toVar()
			const tail = age.oneMinus().max( 0 ).pow( 1.3 )
			const head = smoothstep( 0.04, 0, age )
			const ends = smoothstep( Z_SPAWN, Z_FADE_IN, state.z ).mul( smoothstep( Z_RESET + 0.8, Z_FADE_OUT, state.z ) )
			const energy = mix( 0.55, 1.15, smoothstep( 0.95, 1.25, state.w ) )
			const shown = draw( 0.438579 ).lessThanEqual( look.density ).select( look.glow, 0 )

			return tint.mul( tail.mul( 0.7 ).add( head.mul( 0.8 ) ) ).mul( ends ).mul( energy ).mul( shown )
		} )

		// Two lines read the same trails: a fine wire for every filament, then a
		// wide soft halo on the bundle cores alone, which gives the smoke its body.
		const smoke = ( count, width, gain, profile ) => {
			const line = new MeshLine()
				.instances( count )
				.segments( TRAIL_LENGTH - 1 )
				// progress 0 → head (newest), progress 1 → tail (oldest).
				.gpuPositionNode( storagePositions( this.positionBuffer, { pointsPerLine: TRAIL_LENGTH, head: this.head, snap: true } ) )
				.needsUV( false )
				.transparent( true )
				.colorFn( Fn( ( [, progress] ) => vec4( smokeColor( progress ).mul( gain ), 1 ) ) )
				.fragmentAlphaFn( Fn( ( [alpha, , , side] ) => alpha.mul( profile( abs( side ) ) ) ) )
				.widthFn( Fn( ( [unit, progress] ) => unit.mul( width ).mul( progress.oneMinus().pow( 0.7 ).mul( 0.8 ).add( 0.2 ) ) ) )
				.lineWidth( 1 )
				.setFrustumCulled( false )
				.autoResize()
				.build()

			line.material.blending = AdditiveBlending
			line.material.depthWrite = false
			stage3d.add( line )
			return line
		}

		const isCore = nozzles.element( instanceIndex ).w.equal( 0 )
		const wire = smoke( INSTANCE_COUNT, mix( look.width.x, look.width.y, draw( 0.329127 ) ), isCore.select( 0.5, 0.18 ), edge => smoothstep( 1, 0.15, edge ) )
		smoke( NOZZLE_COUNT, look.halo.mul( 0.15 ), 0.035, edge => exp( edge.mul( edge ).mul( -4.5 ) ) )
		// The car's lacquer mirrors the wire; the wide halo would only smear over it.
		wire.layers.enable( REFLECTED )
	}

	initUi() {
		this.audio = createWindTunnelAudio( active => this.controls?.setPressed( 'sound', active ) )
		this.controls = createDemoControls( [
			...MODES.map( item => ( {
				id: item.id,
				label: item.label,
				key: item.key,
				pressed: item.mode === 0,
				onClick: () => this.setMode( item ),
			} ) ),
			'divider',
			{
				id: 'crosswind',
				label: 'Crosswind',
				key: 'C',
				pressed: false,
				onClick: () => this.toggleCrosswind(),
			},
			{
				id: 'sound',
				label: 'Sound',
				key: 'M',
				pressed: true,
				onClick: () => this.audio.toggle(),
			},
			'divider',
			{
				id: 'wind',
				label: 'Wind',
				min: 80,
				max: 500,
				step: 10,
				value: 200,
				format: speed => `${speed} km/h`,
				onInput: speed => { this.targetWind = speed / 200 },
			},
		], { accent: '#38bdf8', label: 'Wind tunnel controls' } )

		createLinesPanel( this.look )
		createDemoHint( 'Move to steer airflow · drag to orbit', { accent: '#38bdf8', hideAfter: 8000 } )

		stage3d.listen( onMove, mouse => {
			this.targetRakeX = MathUtils.clamp( mouse.normalizedX * 0.85, -0.75, 0.75 )
			this.targetRakeY = MathUtils.clamp( RAKE_Y - mouse.normalizedY * 0.6, 0.16, 1.3 )
		} )
	}

	// Filaments take the new preset as they next leave the rake, so the smoke
	// already in the tunnel flows out while the new pattern flows in behind it.
	setMode( item ) {
		this.uMode.value = item.mode
		for ( const entry of MODES ) {
			this.controls.setPressed( entry.id, entry.id === item.id )
		}
		this.rakeBar.visible = item.mode === 1
	}

	toggleCrosswind() {
		this.crosswindEnabled = !this.crosswindEnabled
		this.controls.setPressed( 'crosswind', this.crosswindEnabled )
	}

	update = dt => {
		const seconds = dt * 0.001
		this.uRakeX.value = MathUtils.damp( this.uRakeX.value, this.targetRakeX, 6, seconds )
		this.uRakeY.value = MathUtils.damp( this.uRakeY.value, this.targetRakeY, 6, seconds )
		this.uCrosswind.value = MathUtils.damp( this.uCrosswind.value, this.crosswindEnabled ? 1.35 : 0, 4, seconds )
		this.uWind.value = MathUtils.damp( this.uWind.value, this.targetWind, 3, seconds )
		this.rakeBar.position.x = this.uRakeX.value * 0.4
		this.rakeBar.position.y = this.uRakeY.value
		this.audio?.update( dt, this.uWind.value, this.targetWind, this.uCrosswind.value, this.uRakeX.value )

		// A sample joins every trail each `sampleMs`, scaled with wind speed so the
		// spatial vertex density along curved bodywork stays fine even at 500 km/h.
		const sampleMs = SAMPLE_MS / Math.max( 1, ( this.uWind.value - 1 ) * 0.65 + 1 )
		this.sinceSample += dt
		const steps = Math.max( 1, Math.floor( this.sinceSample / sampleMs ) )
		this.uStepDt.value = seconds * ( reducedMotion.matches ? 0.45 : 0.72 ) / steps

		for ( let step = 0; step < steps; step++ ) {
			const turn = this.sinceSample >= sampleMs
			this.uTurn.value = turn ? 1 : 0
			this.uTime.value += this.uStepDt.value
			stage3d.renderer.compute( this.integrateNode )
			if ( turn ) {
				this.sinceSample -= sampleMs
				this.head.value = ( this.head.value + 1 ) % TRAIL_LENGTH
			}
		}
	}
}

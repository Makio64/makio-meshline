/**
 * Wind Tunnel — 256 aerodynamic smoke streamlines deflected around a hover car
 * by a 3D signed-distance field in WebGPU compute shaders, stored in a GPU ring buffer.
 * Demonstrates: storagePositions( storageAttr, { pointsPerLine, head } ), .gpuPositionNode( fn ),
 * .instances( count ), and WebGPU compute integration.
 */
import { MeshLine, storagePositions } from 'makio-meshline'
import { abs, clamp, color, cos, dot, float, floor, Fn, If, instanceIndex, length, Loop, max, min, mix, normalize, sin, smoothstep, storage, uint, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, MathUtils, StorageBufferAttribute } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { onMove } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoControls } from '@/utils/demoControls'
import { WebGPURequiredError } from '@/utils/demoFailure'
import { createDemoHint } from '@/utils/demoHint'
import {
	createNozzleBuffer,
	createTunnelStage,
	FLOW_SPEED,
	INSTANCE_COUNT,
	loadWindTunnelCar,
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
	seedStreamlines,
	SURFACE_CLEARANCE,
	TOTAL_POINTS,
	TRAIL_LENGTH,
	Z_FADE_IN,
	Z_FADE_OUT,
	Z_RESET,
	Z_SPAWN,
} from '@/utils/windTunnelCar'

const MODES = [
	{ id: 'tunnel', label: 'Full Tunnel', key: '1', mode: 0 },
	{ id: 'rake', label: 'Smoke Rake', key: '2', mode: 1 },
	{ id: 'ground', label: 'Ground Effect', key: '3', mode: 2 },
]

const backdropNode = Fn( () => {
	const centered = uv().sub( vec2( 0.5 ) )
	const radial = smoothstep( 0.05, 0.85, length( centered.mul( vec2( 0.95, 1.2 ) ) ) )
	const vertical = smoothstep( 0, 1, uv().y )
	const horizon = mix( color( 0x050d1e ), color( 0x02040a ), vertical )
	const glow = mix( color( 0x0b1f3f ), horizon, radial )
	return vec4( glow, 1 )
} )

export default class WindTunnelExample {
	// Each trail is a ring buffer: `head` is the newest slot, so each frame writes
	// only 1 new sample per streamline instead of shifting all 64 points down the trail.
	head = uniform( TRAIL_LENGTH - 1, 'uint' )
	uStepDt = uniform( 0.011 )
	uTime = uniform( 0 )
	uMode = uniform( 0, 'uint' )
	uRakeX = uniform( 0 )
	uRakeY = uniform( 0.72 )
	uCrosswind = uniform( 0 )

	targetRakeX = 0
	targetRakeY = 0.72
	crosswindEnabled = false

	async init() {
		await stage3d.initRender( { background: 0x02040a, fov: 44, near: 0.1, far: 120 } )
		if ( !stage3d.isWebGPU ) {
			throw new WebGPURequiredError( 'Wind Tunnel advects its streamlines against a 3D SDF in WebGPU compute shaders, and this browser is running the WebGL2 fallback.' )
		}

		stage3d.orbit( 6.9, {
			target: [0, 0.62, -0.25],
			cameraOffset: [0, 0.62, -0.25],
			theta: 0.88,
			phi: 1.24,
			minRadius: 3.6,
			maxRadius: 15,
			minPhi: 0.35,
			maxPhi: 1.52,
			autoRotate: 0.000018,
		} )
		stage3d.scene.backgroundNode = backdropNode()

		const { carRoot, sdfBuffer, sdfData } = await loadWindTunnelCar()
		this.sdfBuffer = stage3d.own( sdfBuffer )
		this.sdfData = sdfData
		stage3d.add( carRoot )

		const { group, rakeBar } = createTunnelStage()
		this.rakeBar = rakeBar
		stage3d.add( group )

		this.initStreamlines()
		createBloomPipeline( { strength: 0.28, radius: 0.18, threshold: 0.45 } )
		this.initUi()
	}

	initStreamlines() {
		this.nozzleBuffer = stage3d.own( createNozzleBuffer() )
		this.positionBuffer = stage3d.own( new StorageBufferAttribute( TOTAL_POINTS, 4 ) )
		seedStreamlines( this.positionBuffer, this.nozzleBuffer, this.sdfData, { mode: 0 } )

		const sdfVolume = storage( this.sdfBuffer, 'vec4', SDF_CELL_COUNT ).toReadOnly()
		const nozzles = storage( this.nozzleBuffer, 'vec4', INSTANCE_COUNT ).toReadOnly()
		const positions = storage( this.positionBuffer, 'vec4', TOTAL_POINTS )
		const readPositions = storage( this.positionBuffer, 'vec4', TOTAL_POINTS ).toReadOnly()

		const trailLen = uint( TRAIL_LENGTH )
		const trailMask = uint( TRAIL_LENGTH - 1 )

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

				const c00 = mix( sdfVolume.element( b000 ), sdfVolume.element( b100 ), fx )
				const c10 = mix( sdfVolume.element( b010 ), sdfVolume.element( b110 ), fx )
				const c01 = mix( sdfVolume.element( b001 ), sdfVolume.element( b101 ), fx )
				const c11 = mix( sdfVolume.element( b011 ), sdfVolume.element( b111 ), fx )
				const raw = mix( mix( c00, c10, fy ), mix( c01, c11, fy ), fz ).toVar()
				res.assign( vec4( normalize( raw.xyz.add( vec3( 0, 1e-5, 0 ) ) ), raw.w ) )
			} )
			return res
		} )

		// Compute upstream emitter position for the active tunnel preset.
		const nozzleSpawn = Fn( ( [nozzle] ) => {
			const u = nozzle.x
			const v = nozzle.y
			const jitter = nozzle.z
			const ribbon = nozzle.w

			// Full Tunnel (mode 0, default): arched cross-section sculpted around the car's silhouette.
			const archTop = float( 1.28 ).sub( u.mul( u ).mul( 0.38 ) )
			const x = u.mul( float( 0.94 ).sub( v.mul( v ).mul( 0.14 ) ) ).add( this.uRakeX.mul( 0.22 ) ).add( jitter.sub( 0.5 ).mul( 0.03 ) ).toVar()
			const y = clamp( float( 0.14 ).add( v.mul( archTop ) ).add( this.uRakeY.sub( 0.72 ).mul( 0.22 ) ), 0.1, 1.52 ).toVar()

			If( this.uMode.equal( uint( 1 ) ), () => {
				// Smoke Rake (mode 1): concentrated multi-ribbon sheet steered by pointer.
				x.assign( u.mul( 0.92 ).add( this.uRakeX.mul( 0.38 ) ) )
				y.assign( clamp( this.uRakeY.add( ribbon.mul( 0.16 ) ).add( jitter.sub( 0.5 ).mul( 0.02 ) ), 0.12, 1.58 ) )
			} ).ElseIf( this.uMode.equal( uint( 2 ) ), () => {
				// Ground Effect (mode 2): underbody Venturi channels and low front splitter sheet.
				x.assign( u.mul( 0.96 ).add( this.uRakeX.mul( 0.18 ) ).add( jitter.sub( 0.5 ).mul( 0.03 ) ) )
				y.assign( float( 0.09 ).add( v.mul( 0.46 ) ) )
			} )

			return vec3( x, y, float( Z_SPAWN ).sub( jitter.mul( 0.42 ) ) )
		} )

		// One thread per streamline integrates 1 step from `head` and writes `(head + 1) & mask`.
		this.integrateNode = stage3d.own( Fn( () => {
			const base = instanceIndex.mul( trailLen ).toVar()
			const currentSlot = base.add( this.head ).toVar()
			const nextSlot = base.add( this.head.add( uint( 1 ) ).bitAnd( trailMask ) ).toVar()

			const nozzle = nozzles.element( instanceIndex ).toVar()
			const layerClearance = nozzle.y.mul( 0.18 ).toVar()
			If( this.uMode.equal( uint( 1 ) ), () => {
				layerClearance.assign( nozzle.w.add( 0.5 ).mul( 0.06 ) )
			} ).ElseIf( this.uMode.equal( uint( 2 ) ), () => {
				layerClearance.assign( nozzle.y.mul( 0.05 ) )
			} )

			const p = positions.element( currentSlot ).xyz.toVar()
			const sdf = sampleSdf( p ).toVar()
			const n = sdf.xyz.toVar()
			const d = sdf.w.toVar()
			const dEff = max( float( 0.001 ), d.sub( layerClearance ) ).toVar()
			const windwardGate = smoothstep( -1.6, -0.35, p.z ).toVar()

			const vel = vec3( this.uCrosswind, 0, -FLOW_SPEED ).toVar()

			// Windward boundary-layer slip: deflects oncoming flow around the nose, windshield, and fenders,
			// then separates cleanly past the canopy crest instead of staying attached to the rear slope.
			If( dEff.lessThan( 0.42 ).and( windwardGate.greaterThan( 0 ) ), () => {
				const prox = smoothstep( 0.015, 0.42, dEff ).oneMinus().mul( windwardGate ).toVar()
				const vn = min( dot( vel, n ), 0 ).toVar()
				vel.subAssign( n.mul( vn ).mul( prox.mul( 0.96 ) ) )

				const skim = smoothstep( 0.005, 0.08, dEff ).oneMinus().mul( vn.negate() ).mul( 0.08 ).mul( windwardGate )
				vel.addAssign( vec3( n.x.mul( skim ), n.y.mul( 1.1 ).add( 0.06 ).mul( skim ), 0 ) )

				const venturi = smoothstep( 0.02, 0.28, d ).oneMinus().mul( 0.36 ).mul( windwardGate ).add( 1 )
				vel.mulAssign( venturi )
			} )

			// Smooth aerodynamic carry-over arch as the separated shear layer crests the roof peak.
			const crestArch = smoothstep( -0.45, 0.1, p.z ).oneMinus().mul( smoothstep( -2.1, -0.55, p.z ) ).mul( smoothstep( 1.15, 1.65, p.y ) )
			vel.y.addAssign( crestArch.mul( 0.65 ) )

			// Downstream wake behind the tail (after flow has cleared the car).
			If( p.z.lessThan( -2.0 ), () => {
				const wake = smoothstep( -3.2, -2.0, p.z ).oneMinus().mul( smoothstep( -8.0, -3.0, p.z ) ).toVar()
				const wakeHeightMask = smoothstep( 0.22, 0.55, p.y ).toVar()
				const lx = p.x.add( 0.58 ).sub( this.uCrosswind.mul( 0.16 ) ).toVar()
				const rx = p.x.sub( 0.58 ).sub( this.uCrosswind.mul( 0.16 ) ).toVar()
				const vyOff = p.y.sub( 0.78 ).toVar()
				const rLeft = lx.mul( lx ).add( vyOff.mul( vyOff ) ).add( 0.45 )
				const rRight = rx.mul( rx ).add( vyOff.mul( vyOff ) ).add( 0.45 )
				const swirl = wake.mul( wakeHeightMask ).mul( 0.38 )

				vel.x.addAssign( vyOff.div( rLeft ).sub( vyOff.div( rRight ) ).mul( swirl ) )
				vel.y.addAssign( rx.div( rRight ).sub( lx.div( rLeft ) ).mul( swirl ) )

				const coreEnv = smoothstep( 0.12, 1.05, abs( p.x ) ).oneMinus().mul( smoothstep( 0.25, 1.55, p.y ).oneMinus() ).mul( wake ).mul( wakeHeightMask )
				const phase = p.z.mul( 2.3 ).add( this.uTime.mul( 4.6 ) )
				vel.x.addAssign( sin( phase.add( p.y.mul( 3.1 ) ) ).mul( 0.34 ).mul( coreEnv ) )
				vel.y.addAssign( cos( phase.mul( 0.85 ).sub( p.x.mul( 2.7 ) ) ).mul( 0.24 ).mul( coreEnv ) )
			} )

			const pNext = p.add( vel.mul( this.uStepDt ) ).toVar()
			const sdfNext = sampleSdf( pNext ).toVar()
			If( sdfNext.w.lessThan( SURFACE_CLEARANCE ), () => {
				pNext.addAssign( sdfNext.xyz.mul( float( SURFACE_CLEARANCE ).sub( sdfNext.w ) ) )
			} )
			pNext.y.assign( max( pNext.y, 0.04 ) )

			const speedRatio = length( vel ).div( FLOW_SPEED )
			const surfaceBoost = smoothstep( 0.02, 0.26, sdfNext.w ).oneMinus().mul( 0.48 ).mul( windwardGate )
			const metric = clamp( speedRatio.sub( 0.82 ).mul( 1.15 ).add( surfaceBoost ), 0, 1 )

			// Once the entire trail has faded past the downstream outlet, reset all 64 slots
			// to the upstream smoke nozzle so no wrap-around line ever crosses the tunnel.
			If( pNext.z.lessThan( Z_RESET ), () => {
				const spawn = nozzleSpawn( nozzle ).toVar()
				Loop( { start: uint( 0 ), end: trailLen, type: 'uint' }, ( { i } ) => {
					positions.element( base.add( i ) ).assign( vec4( spawn, 0.2 ) )
				} )
			} ).Else( () => {
				positions.element( nextSlot ).assign( vec4( pNext, metric ) )
			} )
		} )().compute( INSTANCE_COUNT ) )

		// Sample the ring buffer in colorFn for velocity coloring and tunnel entry/exit fade.
		const sampleTrailState = Fn( ( [progress] ) => {
			const lastPoint = float( TRAIL_LENGTH - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot )
			const base = instanceIndex.mul( trailLen )
			const headOffset = this.head.add( trailLen ).sub( pivot.toUint() ).toVar()
			const first = base.add( headOffset.bitAnd( trailMask ) )
			const second = base.add( headOffset.sub( uint( 1 ) ).bitAnd( trailMask ) )
			return mix( readPositions.element( first ), readPositions.element( second ), t )
		} )

		this.line = new MeshLine()
			.instances( INSTANCE_COUNT )
			.segments( TRAIL_LENGTH - 1 )
			// progress 0 → head (newest), progress 1 → tail (oldest).
			.gpuPositionNode( storagePositions( this.positionBuffer, { pointsPerLine: TRAIL_LENGTH, head: this.head } ) )
			.needsUV( false )
			.transparent( true )
			.colorFn( Fn( ( [, progress] ) => {
				const state = sampleTrailState( progress ).toVar()
				const metric = state.w.toVar()

				// Sleek aerodynamic palette: deep glacier blue → electric cyan → pearl white → champagne/rose Venturi peak.
				const laminarCol = mix( color( 0x2563eb ), color( 0x38bdf8 ), smoothstep( 0, 0.35, metric ) )
				const slipCol = mix( laminarCol, color( 0xa5f3fc ), smoothstep( 0.3, 0.62, metric ) )
				const venturiCol = mix( slipCol, color( 0xfde68a ), smoothstep( 0.58, 0.84, metric ) )
				const peakCol = mix( venturiCol, color( 0xf472b6 ), smoothstep( 0.78, 1, metric ) ).toVar()

				// Subtle traveling flow pulse along each filament + luminous tip.
				const phase = progress.mul( 9 ).sub( this.uTime.mul( 3.5 ) ).add( float( instanceIndex ).mul( 0.37 ) )
				const pulse = sin( phase ).mul( 0.12 ).add( 0.92 )
				const tipGlow = smoothstep( 0, 0.08, progress ).oneMinus()
				const finalRgb = mix( peakCol.mul( pulse ), color( 0xf0f9ff ), tipGlow.mul( 0.55 ) )

				// Smooth entry at the nozzle, exit in the wake, and tail decay.
				const fadeIn = smoothstep( Z_FADE_IN, Z_SPAWN, state.z ).oneMinus()
				const fadeOut = smoothstep( Z_RESET + 0.8, Z_FADE_OUT, state.z )
				const tailFade = progress.oneMinus().pow( 1.2 ).mul( 0.88 ).add( 0.06 )
				const intensity = fadeIn.mul( fadeOut ).mul( tailFade )

				return vec4( finalRgb.mul( intensity ), 1 )
			} ) )
			.fragmentAlphaFn( Fn( ( [alpha, , progress, side] ) => {
				// Crisp bright core with soft silk-feathered edges across each filament.
				const core = smoothstep( 1, 0.1, abs( side ) )
				const tail = progress.oneMinus().pow( 0.9 ).mul( 0.85 ).add( 0.15 )
				return alpha.mul( core ).mul( tail )
			} ) )
			.widthFn( Fn( ( [width, progress] ) => {
				const tip = smoothstep( 0, 0.05, progress )
				const tail = progress.oneMinus().pow( 0.82 )
				return width.mul( tip.mul( tail ).mul( 0.82 ).add( 0.18 ) )
			} ) )
			.lineWidth( 0.018 )
			.setFrustumCulled( false )
			.autoResize()
			.build()

		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false
		this.line.material.depthTest = true
		this.line.renderOrder = 2
		stage3d.add( this.line )
	}

	initUi() {
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
		], { accent: '#38bdf8', label: 'Wind tunnel controls' } )

		createDemoHint( 'Move to steer airflow · drag to orbit', { accent: '#38bdf8', hideAfter: 8000 } )

		stage3d.listen( onMove, mouse => {
			this.targetRakeX = clampNumber( mouse.normalizedX * 0.85, -0.75, 0.75 )
			this.targetRakeY = clampNumber( 0.78 - mouse.normalizedY * 0.65, 0.16, 1.55 )
		} )
	}

	setMode( item ) {
		this.uMode.value = item.mode
		for ( const entry of MODES ) {
			this.controls.setPressed( entry.id, entry.id === item.id )
		}
		this.rakeBar.visible = item.mode === 1
		seedStreamlines( this.positionBuffer, this.nozzleBuffer, this.sdfData, {
			mode: item.mode,
			rakeX: this.uRakeX.value,
			rakeY: this.uRakeY.value,
			crosswind: this.uCrosswind.value,
		} )
		this.head.value = TRAIL_LENGTH - 1
	}

	toggleCrosswind() {
		this.crosswindEnabled = !this.crosswindEnabled
		this.controls.setPressed( 'crosswind', this.crosswindEnabled )
	}

	update = dt => {
		const delta = Math.min( dt * 0.001, 0.033 )
		const simDt = reducedMotion.matches ? delta * 0.45 : delta * 0.72

		this.uRakeX.value = MathUtils.damp( this.uRakeX.value, this.targetRakeX, 6, delta )
		this.uRakeY.value = MathUtils.damp( this.uRakeY.value, this.targetRakeY, 6, delta )
		this.uCrosswind.value = MathUtils.damp( this.uCrosswind.value, this.crosswindEnabled ? 1.35 : 0, 4, delta )

		this.rakeBar.position.x = this.uRakeX.value * 0.38
		this.rakeBar.position.y = this.uRakeY.value

		this.uStepDt.value = MathUtils.clamp( simDt, 0.004, 0.018 )
		this.uTime.value += simDt

		stage3d.renderer.compute( this.integrateNode )
		this.head.value = ( this.head.value + 1 ) % TRAIL_LENGTH
	}
}

function clampNumber( value, minVal, maxVal ) {
	return Math.max( minVal, Math.min( maxVal, value ) )
}

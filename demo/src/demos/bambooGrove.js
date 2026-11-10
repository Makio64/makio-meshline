/**
 * Bamboo Grove — four instanced MeshLine layers (culms, nodes, twigs, leaves) with shadows and wind.
 * Demonstrates: .instances( count ), .addInstanceAttributes( spec ), billboard shadow casting & receiving,
 * .widthCallback( fn ), and TSL position/width/color hooks sharing one wind offset.
 */
import { MeshLine, straightLine } from 'makio-meshline'
import { attribute, cameraPosition, color, cos, dot, Fn, fract, max, mix, normalize, positionWorldDirection, pow, sin, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { DirectionalLight, Fog, HemisphereLight, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { createGround } from '@/utils/bambooGroveGround'
import { growBamboo } from '@/utils/bambooGroveGrowth'
import { createDemoControls } from '@/utils/demoControls'
import { linePoints } from '@/utils/points'

// A misty grove: deep greens fading into a sage haze, a bright canopy overhead.
const MIST = 0x93AC82
const CANOPY_LIGHT = 0xEEF2D2
// Horizontal sway at 12 m; it grows with the square of the height.
const SWAY = 0.34
const SWAY_REFERENCE_HEIGHT = 12

const BAMBOO_PARTS = [
	{ id: 'stalks', label: 'Culms', key: '1' },
	{ id: 'nodes', label: 'Nodes', key: '2' },
	{ id: 'twigs', label: 'Twigs', key: '3' },
	{ id: 'leaves', label: 'Leaves', key: '4' },
]

// Botanical bamboo leaf silhouette: narrow petiole at the base swelling into a
// lanceolate blade around 28% of its length, then tapering to an acuminate tip.
const bambooLeafWidth = progress => {
	const petiole = 0.08
	if ( progress < petiole ) {
		const u = progress / petiole
		return 0.08 + 0.14 * u * u
	}
	const bladeT = ( progress - petiole ) / ( 1 - petiole )
	const belly = Math.sin( Math.PI * Math.pow( bladeT, 0.62 ) )
	const taper = Math.pow( 1 - bladeT, 0.42 )
	return Math.max( 0, belly * taper )
}

const leafVeins = Fn( ( [leafColor, , progress, side] ) => {
	const absSide = side.abs()
	// Central midrib vein: crisp warm ridge along side = 0, tapering toward the tip.
	const midribWidth = mix( 0.14, 0.035, progress )
	const midrib = smoothstep( midribWidth, 0, absSide ).mul( progress.mul( 0.65 ).oneMinus() )
	// Monocot parallel lateral veins and V-fold camber across the two blade halves.
	const parallelVeins = sin( absSide.mul( 28 ) ).mul( 0.5 ).add( 0.5 ).mul( 0.045 )
	const halfFold = smoothstep( -0.08, 0.08, side ).mul( 0.11 ).sub( 0.055 )
	const edgeMargin = smoothstep( 0.68, 0.98, absSide ).mul( 0.14 )
	const shaded = leafColor.rgb
		.mul( halfFold.add( 1 ).add( parallelVeins ).sub( edgeMargin ) )
		.add( color( 0xC6D86B ).mul( midrib.mul( 0.22 ) ) )
	return vec4( shaded, leafColor.a )
} )

const hash = Fn( ( [value] ) => fract( sin( value.mul( 12.9898 ).add( 7.13 ) ).mul( 43758.5453 ) ) )

const pack = ( items, read ) => new Float32Array( items.flatMap( read ) )

export default class BambooGroveExample {
	time = 0
	wireframeEnabled = false
	swayTime = uniform( 0 )
	sunDirection = uniform( new Vector3( 0.6, 0.7, 0.4 ).normalize() )

	// Shared by every layer: culms, rings, twigs and leaves sway together
	// because they evaluate the same offset for the same stalk and height.
	swayOffset = Fn( ( [phase, height] ) => {
		const reach = height.div( SWAY_REFERENCE_HEIGHT )
		const amount = reach.mul( reach ).mul( SWAY )
		return vec3(
			sin( this.swayTime.add( phase ) ),
			0,
			cos( this.swayTime.mul( 0.83 ).add( phase.mul( 1.37 ) ) ),
		).mul( amount )
	} )

	async init() {
		await stage3d.initRender( { background: MIST } )
		stage3d.renderer.shadowMap.enabled = true
		stage3d.renderer.shadowMap.transmitted = true

		// Standing among the culms at eye height, looking up into the leaves. The
		// control orbits `cameraOffset` and only aims at `target`, so the orbit
		// centre is lifted to eye level and phi keeps the camera above the moss.
		stage3d.orbit( 14, {
			target: [0, 4.6, 0],
			cameraOffset: [0, 2.2, 0],
			phi: 1.62,
			minPhi: 1.25,
			maxPhi: 1.68,
			minRadius: 6,
			maxRadius: 20,
			autoRotate: 0.00003,
		} )

		this.initAtmosphere()
		this.initLights()
		stage3d.add( createGround() )

		const { stalks, nodes, twigs, leaves } = growBamboo()
		this.parts = {
			stalks: this.createStalks( stalks ),
			nodes: this.createNodes( nodes ),
			twigs: this.createTwigs( twigs ),
			leaves: this.createLeaves( leaves ),
		}
		stage3d.add( ...Object.values( this.parts ) )

		this.controls = createDemoControls( [
			...BAMBOO_PARTS.map( part => ( { ...part, pressed: true, onClick: () => this.togglePart( part.id ) } ) ),
			'divider',
			{ id: 'wireframe', label: 'Wireframe', key: 'W', pressed: false, onClick: () => this.toggleWireframe() },
		], { accent: '#a3e635', label: 'Bamboo parts and wireframe' } )
	}

	initAtmosphere() {
		stage3d.scene.backgroundNode = Fn( () => {
			const direction = positionWorldDirection.normalize()
			const sky = mix( color( MIST ), color( CANOPY_LIGHT ), smoothstep( -0.05, 0.6, direction.y ) )
			const sunGlow = pow( max( dot( direction, this.sunDirection ), 0 ), 10 ).mul( 0.3 )
			return vec4( sky.add( color( 0xFFF1C8 ).mul( sunGlow ) ), 1 )
		} )()
		stage3d.scene.fog = new Fog( MIST, 9, 44 )
	}

	initLights() {
		stage3d.add( new HemisphereLight( 0xE4F0CC, 0x2E3A1E, 1.6 ) )

		this.light = new DirectionalLight( 0xFFEBC8, 3.4 )
		this.light.position.set( 8, 16, 8 )
		this.light.target.position.set( 0, 3, 0 )
		this.light.castShadow = true

		const { shadow } = this.light
		shadow.mapSize.set( 2048, 2048 )
		Object.assign( shadow, { bias: -0.002, normalBias: 0.02, radius: 3 } )
		Object.assign( shadow.camera, { far: 60, left: -16, right: 16, top: 16, bottom: -16 } )

		stage3d.add( this.light.target, this.light )
	}

	createStalks( stalks ) {
		const transform = attribute( 'instanceTransform', 'vec4' )
		const lean = attribute( 'instanceLean', 'vec4' )

		const mesh = new MeshLine()
			.lines( straightLine( 1, 29, true ) )
			.instances( stalks.length )
			.lineWidth( 0.1 )
			.shadow( true, true )
			.positionFn( Fn( ( [position] ) => {
				const fraction = position.y
				const y = fraction.mul( transform.z )
				const leanAmount = lean.x.mul( fraction.mul( fraction ) )
				const px = transform.x.add( lean.y.mul( leanAmount ) )
				const pz = transform.y.add( lean.z.mul( leanAmount ) )
				return vec3( px, y, pz ).add( this.swayOffset( lean.w, y ) )
			} ) )
			.widthFn( Fn( ( [width] ) => width.mul( transform.w ) ) )
			.colorFn( Fn( ( [, progress, side] ) => {
				// Culms range from deep green to a sunnier yellow-green; a subtle
				// contour darkening and dusty sheath at the base sell the cylinder.
				const culm = mix( color( 0x355F25 ), color( 0x86973A ), hash( lean.w ).mul( 0.7 ) )
				const contour = side.mul( side ).mul( -0.14 ).add( 1.04 )
				const sheath = smoothstep( 0.03, 0.12, progress ).oneMinus().mul( 0.45 )
				return vec4( mix( culm.mul( contour ), color( 0x8F8566 ), sheath ), 1 )
			} ) )
			.autoResize()

		mesh.material.castShadowNode = vec4( 0.25, 0.27, 0.22, 1 )
		mesh.addInstanceAttributes( { instanceTransform: 4, instanceLean: 4 } )
		mesh.setInstanceValues( 'instanceTransform', pack( stalks, s => [s.x, s.z, s.height, s.width / 0.1] ) )
		mesh.setInstanceValues( 'instanceLean', pack( stalks, s => [s.lean, s.leanDirX, s.leanDirZ, s.phase] ) )
		return mesh
	}

	createNodes( nodes ) {
		const center = attribute( 'instancePosition', 'vec3' )
		const shape = attribute( 'instanceShape', 'vec3' )
		const unitRing = linePoints( 8, t => [Math.cos( t * Math.PI * 2 ), 0, Math.sin( t * Math.PI * 2 )], { closed: true } )

		const mesh = new MeshLine()
			.lines( unitRing, true )
			.instances( nodes.length )
			.needsProgress( false )
			.color( 0x2d4a2d )
			.lineWidth( 0.05 )
			.shadow( true, true )
			.positionFn( Fn( ( [position] ) => {
				const point = vec3( position.x.mul( shape.x ).add( center.x ), center.y, position.z.mul( shape.x ).add( center.z ) )
				return point.add( this.swayOffset( shape.z, center.y ) )
			} ) )
			.widthFn( Fn( ( [width] ) => width.mul( shape.y ) ) )
			.autoResize()

		mesh.material.castShadowNode = vec4( 0.25, 0.27, 0.22, 1 )
		mesh.addInstanceAttributes( { instancePosition: 3, instanceShape: 3 } )
		mesh.setInstanceValues( 'instancePosition', pack( nodes, n => n.position ) )
		mesh.setInstanceValues( 'instanceShape', pack( nodes, n => [n.size, n.widthMult, n.phase] ) )
		return mesh
	}

	createTwigs( twigs ) {
		const start = attribute( 'twigStart', 'vec3' )
		const end = attribute( 'twigEnd', 'vec4' )

		const mesh = new MeshLine()
			.lines( straightLine( 1, 2 ) )
			.instances( twigs.length )
			.color( 0x4F6A2C )
			.lineWidth( 0.035 )
			.widthCallback( progress => 1 - progress * 0.6 )
			.shadow( true, true )
			.positionFn( Fn( ( [position] ) => {
				const point = mix( start, end.xyz, position.x )
				return point.add( this.swayOffset( end.w, point.y ) )
			} ) )
			.autoResize()

		mesh.material.castShadowNode = vec4( 0.35, 0.37, 0.3, 1 )
		mesh.addInstanceAttributes( { twigStart: 3, twigEnd: 4 } )
		mesh.setInstanceValues( 'twigStart', pack( twigs, t => t.start ) )
		mesh.setInstanceValues( 'twigEnd', pack( twigs, t => [...t.end, t.phase] ) )
		return mesh
	}

	createLeaves( leaves ) {
		const origin = attribute( 'leafOrigin', 'vec3' )
		const direction = attribute( 'leafDirection', 'vec3' )
		const shape = attribute( 'leafShape', 'vec4' )

		const bladePosition = Fn( ( [position] ) => {
			const t = position.x
			// Travelling wind wave along the blade so the tip ripples with phase lag.
			const wavePhase = this.swayTime.mul( 2.4 ).add( shape.y ).sub( t.mul( 2.1 ) )
			const flutter = sin( wavePhase ).mul( 0.16 )
				.add( sin( wavePhase.mul( 1.85 ).add( shape.z ) ).mul( 0.06 ) )
			const sideVec = normalize( vec3( direction.z.negate(), 0.0001, direction.x ) )
			const curl = hash( shape.y.add( 3.7 ) ).sub( 0.5 ).mul( 0.24 )
			const lateral = sideVec.mul( t.mul( t.mul( 0.35 ).oneMinus() ).mul( curl ).add( flutter.mul( t ) ) )
			// Lift slightly out of the petiole, then arch into a catenary droop.
			const arch = t.mul( t.oneMinus() ).mul( 0.14 )
				.sub( pow( t, 2.15 ).mul( shape.w ) )
				.add( flutter.mul( 0.22 ).mul( t ) )
			const bladeOffset = direction.mul( t.mul( shape.x ) )
				.add( lateral.mul( shape.x ) )
				.add( vec3( 0, arch.mul( shape.x ), 0 ) )
			return origin.add( bladeOffset ).add( this.swayOffset( shape.z, origin.y ) )
		} )

		const bladeColor = Fn( ( [, progress] ) => {
			const seed = hash( shape.y )
			const baseGreen = mix( color( 0x264E17 ), color( 0x6E9A2F ), seed )
			const sunTip = mix( baseGreen, color( 0x9FB444 ), smoothstep( 0.35, 0.92, progress ).mul( 0.55 ) )
			const dryTip = mix( sunTip, color( 0xB89F52 ), smoothstep( 0.82, 1.0, progress ).mul( seed.mul( 0.45 ) ) )
			// Leaves backlit between camera and sun glow with warm chlorophyll transmission.
			const viewRay = normalize( origin.sub( cameraPosition ) )
			const towardSun = max( dot( viewRay, this.sunDirection ), 0 )
			const skyFacing = max( dot( direction, this.sunDirection ), 0 ).mul( 0.18 )
			const glow = color( 0xCBE678 ).mul( pow( towardSun, 3 ).mul( 0.48 ).add( skyFacing ) )
			return vec4( dryTip.add( glow ), 1 )
		} )

		const mesh = new MeshLine()
			.lines( straightLine( 1, 10 ) )
			.instances( leaves.length )
			// Fragment hooks add a uv stream by default. These never read it, and it
			// would be the 9th vertex buffer, past WebGPU's portable limit of 8.
			.needsUV( false )
			.lineWidth( 0.165 )
			.widthCallback( bambooLeafWidth )
			.shadow( true, true )
			.positionFn( bladePosition )
			.widthFn( Fn( ( [width] ) => width.mul( shape.x.mul( 0.75 ).add( 0.45 ) ) ) )
			.colorFn( bladeColor )
			.fragmentColorFn( leafVeins )
			.autoResize()

		// Leaves let a little green light through, so their shadows stay soft.
		mesh.material.castShadowNode = vec4( 0.3, 0.38, 0.22, 1 )
		mesh.addInstanceAttributes( { leafOrigin: 3, leafDirection: 3, leafShape: 4 } )
		mesh.setInstanceValues( 'leafOrigin', pack( leaves, leaf => leaf.origin ) )
		mesh.setInstanceValues( 'leafDirection', pack( leaves, leaf => leaf.direction ) )
		mesh.setInstanceValues( 'leafShape', pack( leaves, leaf => [leaf.length, leaf.flutter, leaf.phase, leaf.droop] ) )
		return mesh
	}

	togglePart( partKey ) {
		const mesh = this.parts[partKey]
		mesh.visible = !mesh.visible
		this.controls.setPressed( partKey, mesh.visible )
	}

	toggleWireframe() {
		this.wireframeEnabled = !this.wireframeEnabled
		Object.values( this.parts ).forEach( mesh => mesh.wireframe( this.wireframeEnabled ) )
		this.controls.setPressed( 'wireframe', this.wireframeEnabled )
	}

	update = dt => {
		const seconds = dt * 0.001
		this.time += seconds
		this.swayTime.value += seconds * ( reducedMotion.matches ? 0.2 : 0.9 )

		// The sun drifts slowly around the grove so the dappled shadows move.
		const angle = this.time * 0.05 + 0.6
		this.light.position.set( Math.cos( angle ) * 12, 16, Math.sin( angle ) * 12 )
		this.sunDirection.value.copy( this.light.position ).sub( this.light.target.position ).normalize()
	}
}

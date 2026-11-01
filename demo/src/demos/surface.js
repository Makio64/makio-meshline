/**
 * Surface Studio — one S-shaped route drawn as two world-space, lit ribbons.
 * Demonstrates: .surface( { frame, bank, uvMode, uvScale, normalMap, roughnessMap, metalnessMap, roughness, metalness, side } ),
 * .join( { type: 'round', limit } ), .cap( { type: 'round', segments } ) and .wireframe().
 */
import { MeshLine } from 'makio-meshline'
import { DirectionalLight, DoubleSide, HemisphereLight, PointLight } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { createDemoControls } from '@/utils/demoControls'
import { createDemoHint } from '@/utils/demoHint'
import { linePoints } from '@/utils/points'
import { createStudio, createTextures, FLOOR_Y, SKY_TOP } from '@/utils/surfaceStudio'

const POINT_COUNT = 96
const BASE_CAMERA_RADIUS = 12.5
const PORTRAIT_FIT_ASPECT = 0.66
const ROUTE_HALF_LENGTH = 6.2
const ROUTE_SWING = 1.55
const ACCENT = '#73e2ff'

// Both ribbons follow the same S-shaped route seen from above: the fixed-up road
// stays level on the floor while the transported flyover arches over it and
// banks into each bend, so the two frames read as one comparison.
const routePoints = ( halfLength, height ) => linePoints( POINT_COUNT, t => [
	( t * 2 - 1 ) * halfLength,
	height( t ),
	Math.sin( t * Math.PI * 2 ) * ROUTE_SWING,
] )

export default class SurfaceExample {
	wireframeEnabled = false
	time = 0

	async init() {
		await stage3d.initRender( { background: SKY_TOP, near: 0.1, far: 80 } )
		// Three-quarter view from the front: the flyover reads above the road
		// along its whole length instead of collapsing end-on.
		stage3d.orbit( BASE_CAMERA_RADIUS, {
			target: [0, -0.2, 0],
			theta: Math.PI * 0.5 - 0.5,
			phi: 1,
			minPhi: 0.55,
			maxPhi: 1.42,
			minRadius: 8,
			maxRadius: 24,
			autoRotate: 0.00002,
		} )
		this.onResize()

		createStudio()
		this.createSurfaces()
		this.createLights()

		this.controls = createDemoControls(
			[{ id: 'wireframe', label: 'Wireframe', key: 'W', pressed: false, onClick: this.toggleWireframe }],
			{ accent: ACCENT },
		)
		createDemoHint( 'Fixed-up · distance UV vs Transport · banked · stretch UV', {
			accent: ACCENT,
			hideAfter: 0,
			attributes: { role: 'complementary', 'aria-label': 'Surface rendering comparison' },
		} )
	}

	createSurfaces() {
		const { distanceMap, stretchMap, normalMap, roughnessMap, metalnessMap } = createTextures()
		const finish = { normalMap, roughnessMap, metalnessMap, side: DoubleSide }

		const planar = new MeshLine()
			.lines( routePoints( ROUTE_HALF_LENGTH, () => FLOOR_Y + 0.04 ) )
			.lineWidth( 1.18 )
			.map( distanceMap )
			.surface( {
				...finish,
				frame: 'fixed-up',
				uvMode: 'distance',
				uvScale: 1.45,
				roughness: 0.72,
				metalness: 0.24,
			} )
			.join( { type: 'round', limit: 3 } )
			.cap( { type: 'round', segments: 10 } )
			.build()

		const transport = new MeshLine()
			.lines( routePoints( ROUTE_HALF_LENGTH - 0.3, t => 0.5 + Math.sin( t * Math.PI ) * 1.25 ) )
			.lineWidth( 1.3 )
			.widthCallback( progress => 0.72 + Math.sin( progress * Math.PI ) * 0.28 )
			.map( stretchMap )
			.surface( {
				...finish,
				frame: 'transport',
				// Tilted toward the viewer, then rolled one way and back through the S.
				bank: progress => 0.5 + Math.sin( progress * Math.PI * 2 ) * 0.75,
				uvMode: 'stretch',
				roughness: 0.5,
				metalness: 0.38,
			} )
			.join( { type: 'round', limit: 3 } )
			.cap( { type: 'round', segments: 10 } )
			.build()

		this.lines = [planar, transport]
		stage3d.add( ...this.lines )
	}

	createLights() {
		const key = new DirectionalLight( 0xffe7c2, 3.2 )
		key.position.set( -4, 8, 7 )
		this.accent = new PointLight( 0x7d6cff, 34, 18, 2 )
		stage3d.add( new HemisphereLight( 0xbadfff, 0x170c2b, 1.2 ), key, this.accent )
	}

	toggleWireframe = () => {
		this.wireframeEnabled = !this.wireframeEnabled
		this.lines.forEach( line => line.wireframe( this.wireframeEnabled ) )
		this.controls.setPressed( 'wireframe', this.wireframeEnabled )
	}

	update = dt => {
		this.time += dt * 0.001
		this.accent.position.set(
			Math.cos( this.time * 0.55 ) * 5,
			1.2 + Math.sin( this.time * 0.7 ) * 1.5,
			2.5 + Math.sin( this.time * 0.55 ) * 2.4,
		)
	}

	// Portrait windows pull the camera back so the whole route stays in frame.
	onResize = () => {
		const { control } = stage3d
		const fitScale = Math.max( 1, PORTRAIT_FIT_ASPECT / stage3d.camera.aspect )
		control.snapRadius( Math.min( control.maxRadius, BASE_CAMERA_RADIUS * fitScale ) )
	}
}

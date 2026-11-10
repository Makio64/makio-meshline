/**
 * Metallic Tube — one camera-facing ribbon shaded as a chrome cylinder: an analytic 3D
 * normal rebuilt across the line, lit by the standard PBR stages and a studio PMREM.
 * Demonstrates: lineCoord.y, .join( { type: 'round' } ) for exact round silhouettes at
 * projected folds, .normalFn( fn ), and a MeshLineNodeMaterial subclass.
 */
import { lineCoord, MeshLine, MeshLineNodeMaterial } from 'makio-meshline'
import { attribute, Fn, mix, modelViewMatrix, positionViewDirection, uniform, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { HemisphereLight, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, NodeMaterial, PointLight, SphereGeometry } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { createDemoControls } from '@/utils/demoControls'
import { createFloor, createStudioEnvironment } from '@/utils/metallicTubeStudio'
import { linePoints } from '@/utils/points'

const ACCENT = '#38bdf8'

// Each light circles the knot at `height` and bobs up and down by `bob`.
const LIGHTS = [
	{ hex: 0x36d9ff, radius: 4.6, speed: 0.72, phase: 0, height: 1.5, bob: 1.4, bobSpeed: 1.15, bobPhase: 0 },
	{ hex: 0xff477e, radius: 3.8, speed: -0.54, phase: 2.1, height: 0.4, bob: 2.2, bobSpeed: 0.86, bobPhase: 1.2 },
	{ hex: 0xffc857, radius: 5.2, speed: 0.43, phase: 4.2, height: 2.4, bob: 0.8, bobSpeed: 0.67, bobPhase: 3.4 },
]

const tubeFrame = varyingProperty( 'vec3', 'vTubeFrame' )

// Capture the 2D cross-section perpendicular (from the unsplit screen-space bisector
// dir1 + dir2 with smooth fallback to direction) and the 3D axial tilt dot(T, V) so
// foreshortened turns tilt the tube crest normal smoothly in depth without creases.
const captureTubeFrame = Fn( ( [normal, direction, dir1, dir2] ) => {
	const bisector = dir1.add( dir2 )
	const bisectorLength = bisector.length()
	const smoothDirection = mix( direction, bisector.div( bisectorLength.max( 1e-4 ) ), bisectorLength.smoothstep( 0.05, 0.2 ) )
	const perp = vec2( smoothDirection.y.negate(), smoothDirection.x )
	const viewTangent = modelViewMatrix.mul( vec4( attribute( 'next', 'vec3' ).sub( attribute( 'previous', 'vec3' ) ), 0 ) ).xyz.normalize()
	tubeFrame.assign( vec3( perp, viewTangent.dot( positionViewDirection ) ) )
	return normal
} )

const createKnotPoints = () => linePoints( 384, t => {
	const angle = t * Math.PI * 2
	const radius = 2.55 + Math.cos( angle * 3 ) * 0.8
	return [Math.cos( angle * 2 ) * radius, Math.sin( angle * 3 ) * 0.8, Math.sin( angle * 2 ) * radius]
}, { closed: true } )

// Preserve MeshLine's camera-facing vertex extrusion, then borrow the standard
// material stages that evaluate the analytic tube normal against scene lights.
class MetallicTubeNodeMaterial extends MeshLineNodeMaterial {
	static get type() {
		return 'MetallicTubeNodeMaterial'
	}

	constructor( envMap ) {
		super()

		this.lights = true
		this.metalnessNode = uniform( 0.88 )
		this.roughnessNode = uniform( 0.16 )
		// MeshLineNodeMaterial has no env-map fields of its own; the borrowed
		// standard environment stage reads these two.
		this.envMap = envMap
		this.envMapIntensity = 1

		// `lineCoord.y` runs -1..+1 across the ribbon without allocating UVs. Lift the
		// 2D perpendicular into the plane orthogonal to the view ray and tilt the arch
		// axis by sin(gamma) = dot(T, V) to form an orthonormal 3D cylinder frame.
		const across = lineCoord.y.clamp( -1, 1 )
		const arch = across.mul( across ).oneMinus().max( 0 ).sqrt()
		const viewDir = positionViewDirection
		const perp = tubeFrame.xy.normalize()
		const acrossAxis = vec3( perp.mul( viewDir.z ), perp.dot( viewDir.xy ).negate() ).normalize()
		const sinGamma = tubeFrame.z.clamp( -1, 1 )
		const cosGamma = sinGamma.mul( sinGamma ).oneMinus().max( 0 ).sqrt()
		const archAxis = viewDir.cross( acrossAxis ).mul( sinGamma ).add( viewDir.mul( cosGamma ) )
		this.normalNode = acrossAxis.mul( across ).add( archAxis.mul( arch ) )
	}

	// MeshLineNodeMaterial is unlit: take back the stages MeshBasicNodeMaterial replaces...
	setupOutgoingLight( builder ) { return NodeMaterial.prototype.setupOutgoingLight.call( this, builder ) }
	setupLightMap( builder ) { return NodeMaterial.prototype.setupLightMap.call( this, builder ) }

	// ...and light the result with the standard material's PBR stages.
	setupEnvironment( builder ) { return MeshStandardNodeMaterial.prototype.setupEnvironment.call( this, builder ) }
	setupLightingModel( builder ) { return MeshStandardNodeMaterial.prototype.setupLightingModel.call( this, builder ) }
	setupSpecular() { return MeshStandardNodeMaterial.prototype.setupSpecular.call( this ) }
	setupVariants( builder ) { return MeshStandardNodeMaterial.prototype.setupVariants.call( this, builder ) }
}

export default class MetallicTubeExample {
	time = 0

	async init() {
		await stage3d.initRender( { background: 0x04060c } )
		stage3d.orbit( 10, { minRadius: 6, maxRadius: 15 } )

		this.createTube( createStudioEnvironment() )
		this.createLights()
		createFloor()

		this.controls = createDemoControls(
			[{ id: 'wireframe', label: 'Wireframe', key: 'W', pressed: false, onClick: this.toggleWireframe }],
			{ accent: ACCENT },
		)
	}

	createTube( envMap ) {
		this.line = new MeshLine()
		this.line.material = new MetallicTubeNodeMaterial( envMap )
		this.line
			.lines( createKnotPoints(), true )
			.lineWidth( 0.62 )
			.color( 0xc8d6e8 )
			// A tube's silhouette is round wherever the knot turns toward the camera,
			// so clip those folded joins exactly instead of approximating them.
			.join( { type: 'round' } )
			.normalFn( captureTubeFrame )
			.autoResize()

		stage3d.add( this.line )
	}

	createLights() {
		stage3d.add( new HemisphereLight( 0x7c9ae0, 0x140918, 0.75 ) )

		const markerGeometry = new SphereGeometry( 0.09, 12, 8 )
		this.lights = LIGHTS.map( ( { hex } ) => {
			const light = new PointLight( hex, 62, 16, 2 )
			light.add( new Mesh( markerGeometry, new MeshBasicNodeMaterial( { color: hex } ) ) )
			stage3d.add( light )
			return light
		} )
	}

	update = dt => {
		this.time += dt * 0.001

		for ( let i = 0; i < LIGHTS.length; i++ ) {
			const { radius, speed, phase, height, bob, bobSpeed, bobPhase } = LIGHTS[i]
			const angle = this.time * speed + phase
			const y = height + Math.sin( this.time * bobSpeed + bobPhase ) * bob
			this.lights[i].position.set( Math.cos( angle ) * radius, y, Math.sin( angle ) * radius )
		}

		this.line.rotation.y = this.time * 0.08
		this.line.rotation.x = Math.sin( this.time * 0.22 ) * 0.08
	}

	toggleWireframe = () => {
		const enabled = !this.line.material.wireframe
		this.line.wireframe( enabled )
		this.controls.setPressed( 'wireframe', enabled )
	}
}

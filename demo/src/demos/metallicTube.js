import { lineCoord, MeshLine, MeshLineNodeMaterial } from 'makio-meshline'
import { float, Fn, uniform, varyingProperty, vec2, vec3 } from 'three/tsl'
import {
	HemisphereLight,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	NodeMaterial,
	PlaneGeometry,
	PointLight,
	SphereGeometry,
} from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const POINT_COUNT = 256
const LIGHT_COLORS = [0x36d9ff, 0xff477e, 0xffc857]
const tubePerpendicular = varyingProperty( 'vec2', 'vTubePerpendicular' )

const captureTubeFrame = Fn( ( [normal, direction] ) => {
	tubePerpendicular.assign( vec2( direction.y.negate(), direction.x ) )
	return normal
} )

const createKnotPoints = () => {
	const points = new Float32Array( POINT_COUNT * 3 )

	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const t = i / POINT_COUNT * Math.PI * 2
		const radius = 2.55 + Math.cos( t * 3 ) * 0.8
		const offset = i * 3

		points[offset] = Math.cos( t * 2 ) * radius
		points[offset + 1] = Math.sin( t * 3 ) * 0.8
		points[offset + 2] = Math.sin( t * 2 ) * radius
	}

	return points
}

// Preserve MeshLine's camera-facing vertex extrusion, then borrow the standard
// material stages that evaluate the analytic tube normal against scene lights.
class MetallicTubeNodeMaterial extends MeshLineNodeMaterial {
	static get type() {
		return 'MetallicTubeNodeMaterial'
	}

	constructor( { metalness = 0.82, roughness = 0.2 } = {} ) {
		super()

		this.lights = true
		this.flatShading = true
		this.metalnessNode = uniform( metalness )
		this.roughnessNode = uniform( roughness )

		// `lineCoord.y` runs -1..+1 across the emitted cross-section, so it is the
		// tube's own across-axis. Reading it directly drops the `needsUV( true )`
		// this used to need just to recover the same number from `uv().y`.
		const across = lineCoord.y
		const arch = float( 1 ).sub( across.mul( across ) ).max( 0 ).sqrt()
		// `lineCoord` carries no direction, so the screen-space perpendicular still
		// has to come across from the normalFn hook.
		this.normalNode = vec3( tubePerpendicular.mul( across ), arch ).normalize()
	}

	setupNormal( builder ) {
		return NodeMaterial.prototype.setupNormal.call( this, builder )
	}

	setupOutgoingLight( builder ) {
		return NodeMaterial.prototype.setupOutgoingLight.call( this, builder )
	}

	setupLightMap( builder ) {
		return NodeMaterial.prototype.setupLightMap.call( this, builder )
	}

	setupEnvironment( builder ) {
		return MeshStandardNodeMaterial.prototype.setupEnvironment.call( this, builder )
	}

	setupLightingModel( builder ) {
		return MeshStandardNodeMaterial.prototype.setupLightingModel.call( this, builder )
	}

	setupSpecular() {
		return MeshStandardNodeMaterial.prototype.setupSpecular.call( this )
	}

	setupVariants( builder ) {
		return MeshStandardNodeMaterial.prototype.setupVariants.call( this, builder )
	}
}

class MetallicTubeExample {
	constructor() {
		this.line = null
		this.control = null
		this.hemisphereLight = null
		this.lights = []
		this.lightMarkers = []
		this.markerGeometry = null
		this.floor = null
		this.time = 0
		this.wireframeEnabled = false
	}

	async init() {
		await stage3d.initRender( { background: 0x04060c } )

		stage3d.camera.position.set( 0, 3.2, 9.5 )
		stage3d.camera.lookAt( 0, 0, 0 )
		this.control = new OrbitControl( stage3d.camera, 10 )
		this.control.autoRotate = true
		this.control.autoRotateSpeed = 0.12
		this.control.minRadius = 6
		this.control.maxRadius = 15
		stage3d.control = this.control

		this.createTube()
		this.createLights()
		this.createFloor()

		stage.onUpdate.add( this.update )
		keyboard.onDown.add( this.onKeyDown )
		window.addEventListener( 'resize', this.onResize )
	}

	createTube() {
		this.line = new MeshLine()
		const defaultMaterial = this.line.material
		this.line.material = new MetallicTubeNodeMaterial()
		defaultMaterial.dispose()

		this.line
			.lines( createKnotPoints(), true )
			.lineWidth( 0.62 )
			.color( 0xb8c7d9 )
			.normalFn( captureTubeFrame )
			.build()

		stage3d.add( this.line )
	}

	createLights() {
		this.hemisphereLight = new HemisphereLight( 0x6c88c7, 0x120812, 0.65 )
		stage3d.add( this.hemisphereLight )

		this.markerGeometry = new SphereGeometry( 0.09, 12, 8 )
		LIGHT_COLORS.forEach( color => {
			const light = new PointLight( color, 55, 16, 2 )
			const marker = new Mesh(
				this.markerGeometry,
				new MeshBasicNodeMaterial( { color } )
			)

			stage3d.add( light )
			stage3d.add( marker )
			this.lights.push( light )
			this.lightMarkers.push( marker )
		} )
	}

	createFloor() {
		this.floor = new Mesh(
			new PlaneGeometry( 24, 24 ),
			new MeshStandardNodeMaterial( {
				color: 0x111622,
				roughness: 0.78,
				metalness: 0.08,
			} )
		)
		this.floor.rotation.x = -Math.PI * 0.5
		this.floor.position.y = -2.7
		stage3d.add( this.floor )
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		const positions = [
			[
				Math.cos( this.time * 0.72 ) * 4.6,
				1.5 + Math.sin( this.time * 1.15 ) * 1.4,
				Math.sin( this.time * 0.72 ) * 4.6,
			],
			[
				Math.cos( this.time * -0.54 + 2.1 ) * 3.8,
				0.4 + Math.sin( this.time * 0.86 + 1.2 ) * 2.2,
				Math.sin( this.time * -0.54 + 2.1 ) * 3.8,
			],
			[
				Math.cos( this.time * 0.43 + 4.2 ) * 5.2,
				2.4 + Math.sin( this.time * 0.67 + 3.4 ) * 0.8,
				Math.sin( this.time * 0.43 + 4.2 ) * 5.2,
			],
		]

		this.lights.forEach( ( light, index ) => {
			light.position.set( ...positions[index] )
			this.lightMarkers[index].position.copy( light.position )
		} )

		this.line.rotation.y = this.time * 0.08
		this.line.rotation.x = Math.sin( this.time * 0.22 ) * 0.08
	}

	onResize = () => {
		this.line?.resize()
	}

	onKeyDown = ( key, event ) => {
		const target = event?.target
		const isEditable = target?.matches?.( 'input, textarea, select, [contenteditable="true"]' )
		if (
			event?.repeat || event?.defaultPrevented || event?.altKey || event?.ctrlKey || event?.metaKey ||
			menuOpen.value || isEditable
		) return

		if ( key === 'w' || key === 'W' ) this.toggleWireframe()
	}

	toggleWireframe() {
		this.wireframeEnabled = !this.wireframeEnabled
		this.line?.wireframe( this.wireframeEnabled )
		return this.wireframeEnabled
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		keyboard.onDown.remove( this.onKeyDown )
		window.removeEventListener( 'resize', this.onResize )

		stage3d.remove( this.line )
		this.line?.dispose()

		this.lights.forEach( light => {
			stage3d.remove( light )
			light.dispose()
		} )
		this.lightMarkers.forEach( marker => {
			stage3d.remove( marker )
			marker.material.dispose()
		} )
		this.markerGeometry?.dispose()

		if ( this.hemisphereLight ) {
			stage3d.remove( this.hemisphereLight )
			this.hemisphereLight.dispose()
		}

		if ( this.floor ) {
			stage3d.remove( this.floor )
			this.floor.geometry.dispose()
			this.floor.material.dispose()
		}

		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.control = null
		this.hemisphereLight = null
		this.lights = []
		this.lightMarkers = []
		this.markerGeometry = null
		this.floor = null
		this.wireframeEnabled = false
	}
}

export default MetallicTubeExample

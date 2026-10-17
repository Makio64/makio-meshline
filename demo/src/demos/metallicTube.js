import { lineCoord, MeshLine, MeshLineNodeMaterial } from 'makio-meshline'
import { color, float, Fn, mix, positionLocal, smoothstep, uniform, uv, varyingProperty, vec2, vec3 } from 'three/tsl'
import {
	AdditiveBlending,
	BackSide,
	HemisphereLight,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	NodeMaterial,
	PlaneGeometry,
	PMREMGenerator,
	PointLight,
	Scene,
	SphereGeometry,
} from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const POINT_COUNT = 384
const LIGHT_COLORS = [0x36d9ff, 0xff477e, 0xffc857]
const tubePerpendicular = varyingProperty( 'vec2', 'vTubePerpendicular' )

// Compute the cross-section perpendicular from the unsplit screen-space bisector
// (dir1 + dir2) whenever available so both sides of a round/bevel join share a
// C0-continuous normal frame without a specular crease at foreshortened turns.
const captureTubeFrame = Fn( ( [normal, direction, dir1, dir2] ) => {
	const bisector = dir1.add( dir2 )
	const bisectorLength = bisector.length()
	const smoothDirection = bisectorLength.greaterThan( 0.001 ).select(
		bisector.div( bisectorLength ),
		direction
	)
	tubePerpendicular.assign( vec2( smoothDirection.y.negate(), smoothDirection.x ) )
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

// Softboxes for the reflection studio: [x, y, z, width, height, color, intensity].
const STUDIO_SOFTBOXES = [
	[0, 9, 1.5, 14, 7, 0xe8f0ff, 2.4],
	[-9, 1.8, -2.5, 2.4, 10, 0x36d9ff, 1.2],
	[9, 2.2, 2.5, 2.4, 10, 0xff477e, 1.1],
	[1.5, 1.2, -10, 9, 2, 0xffc857, 0.9],
]

// Bake a small studio (dark floor, soft horizon, softboxes tinted like the
// orbiting lights) into a PMREM once. Reflecting it through the standard
// environment pipeline keeps the highlights anchored in the world, blurred by
// roughness and tinted by the metal, so they slide over the chrome as the view
// orbits instead of painting fixed bands onto the screen.
const createStudioEnvironment = ( renderer ) => {
	const scene = new Scene()

	const direction = positionLocal.normalize()
	const domeMaterial = new MeshBasicNodeMaterial( { side: BackSide } )
	const below = mix( vec3( 0.03, 0.022, 0.035 ), vec3( 0.012, 0.014, 0.022 ), smoothstep( -0.05, -0.6, direction.y ) )
	const above = mix( vec3( 0.12, 0.15, 0.22 ), vec3( 0.025, 0.035, 0.07 ), smoothstep( 0.02, 0.7, direction.y ) )
	domeMaterial.colorNode = mix( below, above, smoothstep( -0.04, 0.04, direction.y ) )
	scene.add( new Mesh( new SphereGeometry( 20, 48, 24 ), domeMaterial ) )

	// Feathered panels add onto the dome, so their reflections fall off softly
	// instead of reading as hard-edged neon strips on a thin tube.
	const edge = uv().sub( 0.5 ).abs().mul( 2 )
	const feather = float( 1 ).sub( smoothstep( 0.35, 1, edge.x ) ).mul( float( 1 ).sub( smoothstep( 0.35, 1, edge.y ) ) )
	STUDIO_SOFTBOXES.forEach( ( [x, y, z, width, height, hex, intensity] ) => {
		const material = new MeshBasicNodeMaterial( { blending: AdditiveBlending, depthWrite: false } )
		material.colorNode = color( hex ).mul( intensity ).mul( feather )
		const panel = new Mesh( new PlaneGeometry( width, height ), material )
		panel.position.set( x, y, z )
		panel.lookAt( 0, 0, 0 )
		scene.add( panel )
	} )

	const pmrem = new PMREMGenerator( renderer )
	const target = pmrem.fromScene( scene, 0.04 )
	pmrem.dispose()
	scene.traverse( object => {
		object.geometry?.dispose()
		object.material?.dispose()
	} )

	return target
}

// Preserve MeshLine's camera-facing vertex extrusion, then borrow the standard
// material stages that evaluate the analytic tube normal against scene lights.
class MetallicTubeNodeMaterial extends MeshLineNodeMaterial {
	static get type() {
		return 'MetallicTubeNodeMaterial'
	}

	constructor( { metalness = 0.88, roughness = 0.16, envMap = null, envMapIntensity = 1 } = {} ) {
		super()

		this.lights = true
		this.metalnessNode = uniform( metalness )
		this.roughnessNode = uniform( roughness )
		// MeshLineNodeMaterial has no env-map fields of its own; the borrowed
		// standard environment stage reads these two.
		this.envMap = envMap
		this.envMapIntensity = envMapIntensity

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
		this.envTarget = null
		this.hud = null
		this.hudButton = null
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

		this.envTarget = createStudioEnvironment( stage3d.renderer )
		this.createTube()
		this.createLights()
		this.createFloor()
		if ( !new URLSearchParams( window.location.search ).has( 'noUI' ) ) {
			this.createHud()
		}

		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
		keyboard.onDown.add( this.onKeyDown )
		window.addEventListener( 'resize', this.onResize )
		this.onResize()
	}

	createTube() {
		this.line = new MeshLine()
		const defaultMaterial = this.line.material
		this.line.material = new MetallicTubeNodeMaterial( { envMap: this.envTarget.texture } )
		defaultMaterial.dispose()

		// A tube's silhouette is round wherever the knot turns toward the camera,
		// so clip those folded joins exactly instead of approximating them.
		this.line
			.lines( createKnotPoints(), true )
			.lineWidth( 0.62 )
			.color( 0xc8d6e8 )
			.join( { type: 'round' } )
			.normalFn( captureTubeFrame )
			.build()

		stage3d.add( this.line )
	}

	createLights() {
		this.hemisphereLight = new HemisphereLight( 0x7c9ae0, 0x140918, 0.75 )
		stage3d.add( this.hemisphereLight )

		this.markerGeometry = new SphereGeometry( 0.09, 12, 8 )
		LIGHT_COLORS.forEach( color => {
			const light = new PointLight( color, 62, 16, 2 )
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
				color: 0x0e1320,
				roughness: 0.72,
				metalness: 0.14,
			} )
		)
		this.floor.rotation.x = -Math.PI * 0.5
		this.floor.position.y = -2.7
		stage3d.add( this.floor )
	}

	createHud() {
		const hud = document.createElement( 'div' )
		hud.style.cssText = [
			'position:fixed',
			'top:calc(14px + var(--sait, 0px))',
			'left:calc(14px + var(--sail, 0px))',
			'z-index:20',
			'display:flex',
			'align-items:center',
			'gap:10px',
			'padding:7px 11px',
			'border:1px solid rgba(148,163,184,0.18)',
			'border-radius:999px',
			'background:rgba(4,6,12,0.72)',
			'backdrop-filter:blur(10px)',
			'color:#e2e8f0',
			'font:600 11px/1 system-ui,sans-serif',
			'letter-spacing:0.06em',
			'user-select:none',
		].join( ';' )

		const label = document.createElement( 'span' )
		label.textContent = 'ANALYTIC CYLINDER NORMAL · ROUND JOIN'
		label.style.opacity = '0.78'

		const button = document.createElement( 'button' )
		button.type = 'button'
		button.textContent = 'Wireframe (W)'
		button.style.cssText = [
			'padding:4px 9px',
			'border:1px solid rgba(148,163,184,0.28)',
			'border-radius:999px',
			'background:rgba(30,41,59,0.65)',
			'color:#f8fafc',
			'font:600 10px/1 system-ui,sans-serif',
			'letter-spacing:0.05em',
			'cursor:pointer',
		].join( ';' )
		button.addEventListener( 'click', () => this.toggleWireframe() )

		hud.append( label, button )
		document.body.appendChild( hud )
		this.hud = hud
		this.hudButton = button
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
		if ( this.hudButton ) {
			this.hudButton.style.background = this.wireframeEnabled
				? 'rgba(56,189,248,0.28)'
				: 'rgba(30,41,59,0.65)'
			this.hudButton.style.borderColor = this.wireframeEnabled
				? 'rgba(56,189,248,0.65)'
				: 'rgba(148,163,184,0.28)'
		}
		return this.wireframeEnabled
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )
		keyboard.onDown.remove( this.onKeyDown )
		window.removeEventListener( 'resize', this.onResize )

		this.hud?.remove()
		this.hud = null
		this.hudButton = null

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
		this.envTarget?.dispose()

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
		this.envTarget = null
		this.wireframeEnabled = false
	}
}

export default MetallicTubeExample

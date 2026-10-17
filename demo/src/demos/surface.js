import { MeshLine } from 'makio-meshline'
import { color, float, Fn, fract, fwidth, min, mix, positionLocal, positionWorldDirection, reflector, smoothstep, uv, vec4 } from 'three/tsl'
import {
	BackSide,
	BoxGeometry,
	CanvasTexture,
	ClampToEdgeWrapping,
	Color,
	DirectionalLight,
	DoubleSide,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	MeshBasicNodeMaterial,
	PlaneGeometry,
	PMREMGenerator,
	PointLight,
	RepeatWrapping,
	Scene,
	SRGBColorSpace,
} from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const POINT_COUNT = 96
const BASE_CAMERA_RADIUS = 12.5
const PORTRAIT_FIT_ASPECT = 0.66
const AUTO_ROTATE_SPEED = 0.00002
const FLOOR_Y = -1.7
const ROUTE_HALF_LENGTH = 6.2
const ROUTE_SWING = 1.55
const SKY_TOP = 0x03060C
const SKY_HORIZON = 0x10213A
const FLOOR_BASE = 0x060B14

// Both ribbons follow the same S-shaped route seen from above: the fixed-up road
// stays level on the floor while the transported flyover arches over it and
// banks into each bend, so the two frames read as one comparison.
const routeZ = progress => Math.sin( progress * Math.PI * 2 ) * ROUTE_SWING

function createPlanarPath() {
	const points = new Float32Array( POINT_COUNT * 3 )

	for ( let pointIndex = 0; pointIndex < POINT_COUNT; pointIndex++ ) {
		const progress = pointIndex / ( POINT_COUNT - 1 )
		const offset = pointIndex * 3

		points[offset] = ( progress * 2 - 1 ) * ROUTE_HALF_LENGTH
		points[offset + 1] = FLOOR_Y + 0.04
		points[offset + 2] = routeZ( progress )
	}

	return points
}

function createTransportPath() {
	const points = new Float32Array( POINT_COUNT * 3 )

	for ( let pointIndex = 0; pointIndex < POINT_COUNT; pointIndex++ ) {
		const progress = pointIndex / ( POINT_COUNT - 1 )
		const offset = pointIndex * 3

		points[offset] = ( progress * 2 - 1 ) * ( ROUTE_HALF_LENGTH - 0.3 )
		points[offset + 1] = 0.5 + Math.sin( progress * Math.PI ) * 1.25
		points[offset + 2] = routeZ( progress )
	}

	return points
}

function createTexture( width, height, draw, colorSpace = null ) {
	const canvas = document.createElement( 'canvas' )
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext( '2d' )
	draw( context, width, height )

	const texture = new CanvasTexture( canvas )
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	if ( colorSpace ) texture.colorSpace = colorSpace
	texture.needsUpdate = true
	return texture
}

function createDistanceTexture() {
	return createTexture( 256, 64, ( context, width, height ) => {
		const gradient = context.createLinearGradient( 0, 0, 0, height )
		gradient.addColorStop( 0, '#14344b' )
		gradient.addColorStop( 0.5, '#0b1728' )
		gradient.addColorStop( 1, '#14344b' )
		context.fillStyle = gradient
		context.fillRect( 0, 0, width, height )

		context.fillStyle = 'rgba(115, 226, 255, .85)'
		context.fillRect( 0, 3, width, 3 )
		context.fillRect( 0, height - 6, width, 3 )
		context.fillStyle = 'rgba(255, 255, 255, .14)'
		for ( let x = 0; x < width; x += 32 ) context.fillRect( x, 0, 2, height )
		context.fillStyle = 'rgba(242, 200, 96, .88)'
		for ( let x = 5; x < width; x += 24 ) context.fillRect( x, height * 0.47, 12, 4 )
	}, SRGBColorSpace )
}

function createStretchTexture() {
	const texture = createTexture( 512, 64, ( context, width, height ) => {
		const gradient = context.createLinearGradient( 0, 0, width, 0 )
		gradient.addColorStop( 0, '#ff8a5b' )
		gradient.addColorStop( 0.28, '#ff5db1' )
		gradient.addColorStop( 0.62, '#8c68ff' )
		gradient.addColorStop( 1, '#55d9ff' )
		context.fillStyle = gradient
		context.fillRect( 0, 0, width, height )

		context.fillStyle = 'rgba(255, 255, 255, .38)'
		context.fillRect( 0, 3, width, 3 )
		context.fillRect( 0, height - 6, width, 3 )
		for ( let x = 30; x < width; x += 64 ) {
			context.beginPath()
			context.moveTo( x - 13, height * 0.5 )
			context.lineTo( x, height * 0.28 )
			context.lineTo( x + 13, height * 0.5 )
			context.lineTo( x, height * 0.72 )
			context.closePath()
			context.fill()
		}
	}, SRGBColorSpace )
	// Stretch UVs cover the path exactly once and the caps sit on u = 0 and 1.
	// Repeat wrapping would blend the gradient's two ends into both caps.
	texture.wrapS = ClampToEdgeWrapping
	return texture
}

function createNormalTexture() {
	return createTexture( 64, 64, ( context, width, height ) => {
		context.fillStyle = '#8080ff'
		context.fillRect( 0, 0, width, height )
		context.fillStyle = '#9b80f4'
		for ( let x = 0; x < width; x += 8 ) context.fillRect( x, 0, 3, height )
		context.fillStyle = '#6580f4'
		for ( let x = 4; x < width; x += 8 ) context.fillRect( x, 0, 2, height )
	} )
}

function createRoughnessTexture() {
	return createTexture( 64, 64, ( context, width, height ) => {
		context.fillStyle = '#b8b8b8'
		context.fillRect( 0, 0, width, height )
		context.fillStyle = '#686868'
		for ( let x = 0; x < width; x += 16 ) context.fillRect( x, 0, 5, height )
	} )
}

function createMetalnessTexture() {
	return createTexture( 64, 64, ( context, width, height ) => {
		context.fillStyle = '#292929'
		context.fillRect( 0, 0, width, height )
		context.fillStyle = '#d8d8d8'
		context.fillRect( 0, 0, width, 7 )
		context.fillRect( 0, height - 7, width, 7 )
	} )
}

class SurfaceExample {
	constructor() {
		this.lines = []
		this.control = null
		this.lights = []
		this.floor = null
		this.reflection = null
		this.environmentMap = null
		this.textures = []
		this.hudStyle = null
		this.hud = null
		this.hudButton = null
		this.wireframeEnabled = false
		this.time = 0
		this.motionQuery = window.matchMedia( '(prefers-reduced-motion: reduce)' )
		this.reducedMotion = this.motionQuery.matches
	}

	async init() {
		await stage3d.initRender( { background: SKY_TOP } )

		stage3d.camera.near = 0.1
		stage3d.camera.far = 80
		stage3d.camera.updateProjectionMatrix()
		this.control = new OrbitControl( stage3d.camera, BASE_CAMERA_RADIUS )
		// Three-quarter view from the front: the flyover reads above the road
		// along its whole length instead of collapsing end-on.
		this.control._phi = 1.0
		this.control._theta = Math.PI * 0.5 - 0.5
		this.control.target.y = -0.2
		this.control.minRadius = 8
		this.control.maxRadius = 24
		this.control.minPhi = 0.55
		this.control.maxPhi = 1.42
		stage3d.control = this.control
		this.fitCamera()

		this.createBackdrop()
		this.createEnvironment()
		this.createSurfaces()
		this.createLights()
		this.createFloor()
		this.createHud()
		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
		keyboard.onDown.add( this.onKeyDown )
		if ( this.motionQuery.addEventListener ) this.motionQuery.addEventListener( 'change', this.onMotionPreferenceChange )
		else this.motionQuery.addListener?.( this.onMotionPreferenceChange )
	}

	createBackdrop() {
		// A studio cyclorama: a soft glow on the horizon fading to near black above.
		stage3d.scene.backgroundNode = Fn( () => {
			const elevation = positionWorldDirection.y
			const glow = float( 1 ).sub( smoothstep( -0.05, 0.42, elevation ) )
			return vec4( mix( color( SKY_TOP ), color( SKY_HORIZON ), glow.mul( glow ) ), 1 )
		} )()
	}

	createEnvironment() {
		// Three soft boxes in a dark room, baked once into a PMREM: the metallic
		// edges and normal-mapped grooves get studio highlights to reflect.
		const studio = new Scene()
		studio.add( new Mesh( new BoxGeometry( 12, 12, 12 ), new MeshBasicMaterial( { color: 0x0A1322, side: BackSide } ) ) )
		const addSoftbox = ( hex, intensity, width, height, x, y, z ) => {
			const material = new MeshBasicMaterial( { color: new Color( hex ).multiplyScalar( intensity ), side: DoubleSide } )
			const softbox = new Mesh( new PlaneGeometry( width, height ), material )
			softbox.position.set( x, y, z )
			softbox.lookAt( 0, 0, 0 )
			studio.add( softbox )
		}
		addSoftbox( 0xFFE7C2, 5, 6, 2.4, -2, 5.4, 3 )
		addSoftbox( 0x7D6CFF, 3, 3, 3, 5.4, 1, -2 )
		addSoftbox( 0x73E2FF, 2.5, 8, 1, 0, 0.5, -5.6 )

		const pmrem = new PMREMGenerator( stage3d.renderer )
		this.environmentMap = pmrem.fromScene( studio, 0.04 ).texture
		stage3d.scene.environment = this.environmentMap
		stage3d.scene.environmentIntensity = 0.45
		pmrem.dispose()
		studio.traverse( object => {
			object.geometry?.dispose()
			object.material?.dispose()
		} )
	}

	createSurfaces() {
		const distanceTexture = createDistanceTexture()
		const stretchTexture = createStretchTexture()
		const normalTexture = createNormalTexture()
		const roughnessTexture = createRoughnessTexture()
		const metalnessTexture = createMetalnessTexture()
		this.textures = [distanceTexture, stretchTexture, normalTexture, roughnessTexture, metalnessTexture]

		const planar = new MeshLine()
			.lines( createPlanarPath() )
			.lineWidth( 1.18 )
			.color( 0xffffff )
			.map( distanceTexture )
			.surface( {
				frame: 'fixed-up',
				up: [0, 1, 0],
				uvMode: 'distance',
				uvScale: 1.45,
				normalMap: normalTexture,
				roughnessMap: roughnessTexture,
				metalnessMap: metalnessTexture,
				roughness: 0.72,
				metalness: 0.24,
				side: DoubleSide,
			} )
			.join( { type: 'round', limit: 3, segments: 8 } )
			.cap( { type: 'round', segments: 10 } )
			.build()

		const transport = new MeshLine()
			.lines( createTransportPath() )
			.lineWidth( 1.3 )
			.widthCallback( progress => 0.72 + Math.sin( progress * Math.PI ) * 0.28 )
			.color( 0xffffff )
			.map( stretchTexture )
			.surface( {
				frame: 'transport',
				// Tilted toward the viewer, then rolled one way and back through the S.
				bank: progress => 0.5 + Math.sin( progress * Math.PI * 2 ) * 0.75,
				uvMode: 'stretch',
				normalMap: normalTexture,
				roughnessMap: roughnessTexture,
				metalnessMap: metalnessTexture,
				roughness: 0.5,
				metalness: 0.38,
				side: DoubleSide,
			} )
			.join( { type: 'round', limit: 3, segments: 8 } )
			.cap( { type: 'round', segments: 10 } )
			.build()

		this.lines = [planar, transport]
		this.lines.forEach( line => stage3d.add( line ) )
	}

	createLights() {
		const hemisphere = new HemisphereLight( 0xbadfff, 0x170c2b, 1.2 )
		const key = new DirectionalLight( 0xffe7c2, 3.2 )
		const accent = new PointLight( 0x7d6cff, 34, 18, 2 )
		key.position.set( -4, 8, 7 )
		accent.position.set( 4, 2, 3 )
		this.lights = [hemisphere, key, accent]
		this.lights.forEach( light => stage3d.add( light ) )
	}

	createFloor() {
		// A glossy studio floor: a softly blurred reflection of both ribbons, a
		// faint one-unit grid for scale, and a radial fade into the backdrop.
		const reflection = reflector( {
			resolutionScale: isMobile ? 0.35 : 0.5,
			generateMipmaps: true,
			bounces: false,
			samples: 0,
		} )
		reflection.levelNode = float( 2.4 )
		this.reflection = reflection

		const coordinate = positionLocal.xy
		const gridDistance = fract( coordinate.sub( 0.5 ) ).sub( 0.5 ).abs().div( fwidth( coordinate ) )
		const gridLine = float( 1 ).sub( min( min( gridDistance.x, gridDistance.y ), 1 ) )
		const radial = uv().sub( 0.5 ).length()
		const reach = float( 1 ).sub( smoothstep( 0.08, 0.44, radial ) )
		const gridReach = float( 1 ).sub( smoothstep( 0.04, 0.3, radial ) )

		const material = new MeshBasicNodeMaterial( { transparent: true, depthWrite: false } )
		material.colorNode = Fn( () => {
			const mirrored = mix( color( FLOOR_BASE ), reflection.rgb, 0.3 )
			const grid = color( 0x5D8BC0 ).mul( gridLine.mul( gridReach ).mul( 0.07 ) )
			return vec4( mirrored.add( grid ), 1 )
		} )()
		material.opacityNode = reach

		this.floor = new Mesh( new PlaneGeometry( 44, 44 ), material )
		this.floor.renderOrder = -1
		this.floor.rotation.x = -Math.PI * 0.5
		this.floor.position.y = FLOOR_Y
		this.floor.add( reflection.target )
		stage3d.add( this.floor )
	}

	createHud() {
		if ( new URLSearchParams( window.location.search ).has( 'noUI' ) ) return
		this.hudStyle = document.createElement( 'style' )
		this.hudStyle.textContent = `
			.SurfaceStudioHud {
				position: fixed;
				left: calc(18px + var(--sail, 0px));
				top: calc(18px + var(--sait, 0px));
				z-index: 20;
				display: inline-flex;
				flex-wrap: wrap;
				align-items: center;
				gap: 10px;
				min-height: 36px;
				max-width: min(440px, calc(100vw - 96px));
				padding: 6px 14px;
				border: 1px solid rgba(255, 255, 255, .1);
				border-radius: 999px;
				background: rgba(8, 9, 12, .7);
				box-shadow: 0 12px 30px rgba(0, 0, 0, .28);
				backdrop-filter: blur(14px);
				-webkit-backdrop-filter: blur(14px);
				color: rgba(244, 245, 247, .82);
				font: 600 10px/1.25 'Inter', system-ui, -apple-system, sans-serif;
				letter-spacing: .05em;
				text-transform: uppercase;
				pointer-events: none;
			}
			.SurfaceStudioHud__title { display: none; }
			.SurfaceStudioHud__row { display: inline-flex; gap: 6px; align-items: center; }
			.SurfaceStudioHud__dot { width: 6px; height: 6px; flex: none; border-radius: 50%; box-shadow: 0 0 10px currentColor; }
			.SurfaceStudioHud__row:nth-child(2) .SurfaceStudioHud__dot { color: #73e2ff; background: currentColor; }
			.SurfaceStudioHud__row:nth-child(3) .SurfaceStudioHud__dot { color: #ff70b6; background: currentColor; }
			.SurfaceStudioHud strong { color: rgba(255, 255, 255, .94); font-weight: 680; }
			.SurfaceStudioHud__row span { display: none; }
			.SurfaceStudioWireframe {
				appearance: none;
				position: fixed;
				top: calc(18px + var(--sait, 0px));
				left: 50%;
				transform: translateX(-50%);
				z-index: 20;
				display: inline-flex;
				align-items: center;
				gap: 6px;
				height: 38px;
				padding: 4px 14px;
				border: 1px solid rgba(255, 255, 255, .12);
				border-radius: 999px;
				background: rgba(8, 9, 12, .72);
				box-shadow: 0 12px 30px rgba(0, 0, 0, .3);
				backdrop-filter: blur(14px);
				-webkit-backdrop-filter: blur(14px);
				color: rgba(244, 245, 247, .86);
				font: 650 11px/1 'Inter', system-ui, -apple-system, sans-serif;
				letter-spacing: .06em;
				text-transform: uppercase;
				cursor: pointer;
				user-select: none;
				transition: border-color .16s ease, background .16s ease, color .16s ease;
			}
			.SurfaceStudioWireframe:hover {
				border-color: rgba(115, 226, 255, .48);
				background: rgba(16, 24, 38, .84);
				color: #ffffff;
			}
			.SurfaceStudioWireframe:focus-visible {
				outline: 2px solid #73e2ff;
				outline-offset: 2px;
			}
			.SurfaceStudioWireframe[aria-pressed="true"] {
				border-color: rgba(115, 226, 255, .64);
				background: rgba(34, 152, 214, .22);
				color: #fff;
			}
			.SurfaceStudioWireframe__dot {
				width: 6px;
				height: 6px;
				border-radius: 50%;
				background: rgba(148, 163, 184, .65);
				transition: background .16s ease, box-shadow .16s ease;
			}
			.SurfaceStudioWireframe[aria-pressed="true"] .SurfaceStudioWireframe__dot {
				background: #73e2ff;
				box-shadow: 0 0 10px #73e2ff;
			}
			.SurfaceStudioWireframe__key {
				padding: 2px 5px;
				border: 1px solid rgba(255, 255, 255, .2);
				border-radius: 4px;
				font: 700 9px/1 system-ui, sans-serif;
				color: rgba(235, 246, 255, .68);
			}
			@media (max-width: 720px) {
				.SurfaceStudioHud { left: calc(12px + var(--sail, 0px)); top: calc(58px + var(--sait, 0px)); min-height: 30px; padding: 4px 11px; font-size: 9px; }
				.SurfaceStudioWireframe { top: calc(12px + var(--sait, 0px)); height: 34px; padding: 0 12px; font-size: 10px; }
				.SurfaceStudioWireframe__key { display: none; }
			}
			@media (prefers-reduced-motion: reduce) {
				.SurfaceStudioWireframe,
				.SurfaceStudioWireframe__dot { transition: none; }
			}
		`
		document.head.appendChild( this.hudStyle )

		this.hud = document.createElement( 'aside' )
		this.hud.className = 'SurfaceStudioHud'
		this.hud.setAttribute( 'aria-label', 'Surface rendering comparison' )
		this.hud.innerHTML = `
			<span class="SurfaceStudioHud__title">Surface studio · one route, two frames</span>
			<span class="SurfaceStudioHud__row"><i class="SurfaceStudioHud__dot"></i><strong>Fixed-up · distance UV</strong><span>level road, repeats stay physical</span></span>
			<span class="SurfaceStudioHud__row"><i class="SurfaceStudioHud__dot"></i><strong>Transport · banked · stretch UV</strong><span>one mapped span</span></span>
		`
		document.body.appendChild( this.hud )

		const button = document.createElement( 'button' )
		button.type = 'button'
		button.className = 'SurfaceStudioWireframe'
		button.setAttribute( 'aria-pressed', String( this.wireframeEnabled ) )
		button.innerHTML = `
			<span class="SurfaceStudioWireframe__dot" aria-hidden="true"></span>
			<span>Wireframe</span>
			<kbd class="SurfaceStudioWireframe__key" aria-hidden="true">W</kbd>
		`
		button.addEventListener( 'pointerdown', event => event.stopPropagation() )
		button.addEventListener( 'click', () => this.toggleWireframe() )
		document.body.appendChild( button )
		this.hudButton = button
	}

	update = ( dt ) => {
		this.time += Math.min( dt, 100 ) * 0.001
		if ( this.control && !this.control._isDown && !this.reducedMotion ) {
			this.control._theta += Math.min( dt, 100 ) * AUTO_ROTATE_SPEED
		}
		const accent = this.lights[2]
		if ( accent ) {
			accent.position.x = Math.cos( this.time * 0.55 ) * 5
			accent.position.y = 1.2 + Math.sin( this.time * 0.7 ) * 1.5
			accent.position.z = 2.5 + Math.sin( this.time * 0.55 ) * 2.4
		}
	}

	fitCamera() {
		if ( !this.control ) return
		const fitScale = Math.max( 1, PORTRAIT_FIT_ASPECT / stage3d.camera.aspect )
		const radius = Math.min( this.control.maxRadius, BASE_CAMERA_RADIUS * fitScale )
		this.control.radius = radius
		this.control._radius = radius
		this.control.update()
	}

	onResize = () => {
		this.lines.forEach( line => line.resize() )
		this.fitCamera()
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
		this.lines.forEach( line => line.wireframe( this.wireframeEnabled ) )
		this.hudButton?.setAttribute( 'aria-pressed', String( this.wireframeEnabled ) )
		return this.wireframeEnabled
	}

	onMotionPreferenceChange = ( event ) => {
		this.reducedMotion = event.matches
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )
		keyboard.onDown.remove( this.onKeyDown )
		if ( this.motionQuery.removeEventListener ) this.motionQuery.removeEventListener( 'change', this.onMotionPreferenceChange )
		else this.motionQuery.removeListener?.( this.onMotionPreferenceChange )
		this.hudButton?.remove()
		this.hud?.remove()
		this.hudStyle?.remove()

		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.lights.forEach( light => {
			stage3d.remove( light )
			light.dispose()
		} )
		this.textures.forEach( texture => texture.dispose() )

		if ( this.floor ) {
			stage3d.remove( this.floor )
			this.floor.geometry.dispose()
			this.floor.material.dispose()
		}
		this.reflection?.target.removeFromParent()
		this.reflection?.dispose()
		stage3d.scene.backgroundNode = null
		stage3d.scene.environment = null
		this.environmentMap?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.lines = []
		this.control = null
		this.lights = []
		this.floor = null
		this.reflection = null
		this.environmentMap = null
		this.textures = []
		this.hud = null
		this.hudButton = null
		this.hudStyle = null
		this.wireframeEnabled = false
	}
}

export default SurfaceExample

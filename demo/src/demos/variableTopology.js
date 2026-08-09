import { MeshLine } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import {
	DirectionalLight,
	HemisphereLight,
	Mesh,
	MeshStandardNodeMaterial,
	PlaneGeometry,
} from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const SURFACE_Y = 0.08
const SURFACE_WIDTH = 0.9
const FAN_SEGMENTS = 12

const JOIN_PATH = [
	[-2.1, -1.05],
	[0, 1.15],
	[2.1, -1.05],
]

const CAP_PATH = [
	[-1.75, 0],
	[1.75, 0],
]

const REVERSAL_PATH = [
	[-3.1, -0.75],
	[1.15, -0.75],
	[-2.25, -0.75],
	[-2.25, 0.95],
	[2.15, 0.95],
]

const SURFACE_EXAMPLES = [
	{
		label: 'MITER JOIN',
		kind: 'join',
		center: [-6, 1.45],
		points: JOIN_PATH,
		color: 0xF59E0B,
		join: { type: 'miter', limit: 12, segments: FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
		labelOffset: [0, -1.75],
	},
	{
		label: 'TRUE BEVEL',
		kind: 'join',
		center: [0, 1.45],
		points: JOIN_PATH,
		color: 0xF97316,
		join: { type: 'bevel', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
		labelOffset: [0, -1.75],
	},
	{
		label: 'TRUE ROUND FAN',
		kind: 'join',
		center: [6, 1.45],
		points: JOIN_PATH,
		color: 0xFB7185,
		join: { type: 'round', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
		labelOffset: [0, -1.75],
	},
	{
		label: 'BUTT CAP',
		kind: 'cap',
		center: [-6, -2.55],
		points: CAP_PATH,
		color: 0x22C55E,
		join: { type: 'miter', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'butt', segments: FAN_SEGMENTS },
		labelOffset: [0, -1.05],
	},
	{
		label: 'SQUARE CAP',
		kind: 'cap',
		center: [0, -2.55],
		points: CAP_PATH,
		color: 0x14B8A6,
		join: { type: 'miter', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'square', segments: FAN_SEGMENTS },
		labelOffset: [0, -1.05],
	},
	{
		label: 'TRUE ROUND CAP',
		kind: 'cap',
		center: [6, -2.55],
		points: CAP_PATH,
		color: 0x06B6D4,
		join: { type: 'miter', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'round', segments: FAN_SEGMENTS },
		labelOffset: [0, -1.05],
	},
	{
		label: '180° REVERSAL · 2 RUNS',
		kind: 'reversal',
		center: [0, -6.35],
		points: REVERSAL_PATH,
		color: 0xA78BFA,
		width: 0.68,
		join: { type: 'round', limit: 4, segments: FAN_SEGMENTS },
		cap: { type: 'round', segments: FAN_SEGMENTS },
		labelOffset: [4.6, 0.1],
	},
]

const SCREEN_PATH = new Float32Array( [
	[-8.2, 3.15, 5.8],
	[-5.4, 4.35, 5.8],
	[-2.7, 2.95, 5.8],
	[0, 4.45, 5.8],
	[2.7, 2.95, 5.8],
	[5.4, 4.35, 5.8],
	[8.2, 3.15, 5.8],
].flat() )

const toSurfacePoints = ( points, center, y = SURFACE_Y ) => {
	const result = new Float32Array( points.length * 3 )

	for ( let index = 0; index < points.length; index++ ) {
		const offset = index * 3
		result[offset] = points[index][0] + center[0]
		result[offset + 1] = y
		result[offset + 2] = points[index][1] + center[1]
	}

	return result
}

const createSurface = ( points, config, wireframe = false ) => {
	return new MeshLine()
		.lines( points )
		.lineWidth( config.width ?? SURFACE_WIDTH )
		.color( wireframe ? 0x111827 : config.color )
		.surface( {
			frame: 'fixed-up',
			up: [0, 1, 0],
			uvMode: 'distance',
			uvScale: 1,
			roughness: wireframe ? 1 : 0.68,
			metalness: wireframe ? 0 : 0.08,
		} )
		.join( config.join )
		.cap( config.cap )
		.wireframe( wireframe )
		.build()
}

const createLabelElement = ( text, accent = '#94a3b8' ) => {
	const element = document.createElement( 'div' )
	element.textContent = text
	element.style.color = '#f8fafc'
	element.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, monospace'
	element.style.fontSize = '11px'
	element.style.fontWeight = '700'
	element.style.letterSpacing = '0.06em'
	element.style.whiteSpace = 'nowrap'
	element.style.background = 'rgba(2, 6, 23, 0.82)'
	element.style.border = `1px solid ${accent}`
	element.style.borderRadius = '999px'
	element.style.padding = '4px 8px'
	element.style.boxShadow = '0 4px 18px rgba(2, 6, 23, 0.35)'
	return element
}

class VariableTopologyExample {
	constructor() {
		this.text = 'Drag to orbit · inspect true surface fans, caps, and reversal splitting'
		this.surfaces = []
		this.labels = []
		this.lights = []
		this.ground = null
		this.screenPath = null
		this.control = null
		this.cssRenderer = null
		this.metrics = null
		this.cameraState = null
	}

	async init() {
		const reportMetrics = new URLSearchParams( window.location.search ).get( 'metrics' ) === '1'
		await stage3d.initRender( { background: 0x07101E } )
		stage3d.renderer.setClearColor( 0x07101E )

		this.cameraState = {
			near: stage3d.camera.near,
			far: stage3d.camera.far,
		}
		stage3d.camera.near = 0.1
		stage3d.camera.far = 180
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, 24 )
		this.control.minRadius = 15
		this.control.maxRadius = 38
		this.control.minPhi = 0.42
		this.control.maxPhi = 1.25
		this.control._phi = 0.72
		this.control._theta = 1.25
		this.control.target.set( 0, 0.5, -1.3 )
		this.control.update()
		stage3d.control = this.control

		this.createCssRenderer()
		this.createScene()
		await this.createScreenTopology()

		stage.onResize.add( this.onResize )
		stage.onUpdate.add( this.update )
		this.onResize()

		if ( reportMetrics ) console.info( `[variableTopology] ${JSON.stringify( this.metrics )}` )
	}

	createCssRenderer() {
		this.cssRenderer = new CSS2DRenderer()
		this.cssRenderer.domElement.style.position = 'absolute'
		this.cssRenderer.domElement.style.inset = '0'
		this.cssRenderer.domElement.style.pointerEvents = 'none'
		document.body.appendChild( this.cssRenderer.domElement )
	}

	createScene() {
		this.ground = new Mesh(
			new PlaneGeometry( 22, 18 ),
			new MeshStandardNodeMaterial( {
				color: 0x111C2E,
				roughness: 0.96,
				metalness: 0.02,
			} )
		)
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.set( 0, 0, -1.4 )
		stage3d.add( this.ground )

		const examples = []
		for ( const config of SURFACE_EXAMPLES ) {
			const points = toSurfacePoints( config.points, config.center )
			const wirePoints = toSurfacePoints( config.points, config.center, SURFACE_Y + 0.018 )
			const surface = createSurface( points, config )
			const wire = createSurface( wirePoints, config, true )
			stage3d.add( surface )
			stage3d.add( wire )
			this.surfaces.push( surface, wire )

			const labelPosition = [
				config.center[0] + config.labelOffset[0],
				0.38,
				config.center[1] + config.labelOffset[1],
			]
			this.addLabel( config.label, labelPosition, `#${config.color.toString( 16 ).padStart( 6, '0' )}` )

			const sourcePointCount = points.length / 3
			const vertexCount = surface.geometry.getAttribute( 'position' ).count
			const triangleCount = surface.geometry.getIndex().count / 3
			examples.push( {
				label: config.label,
				kind: config.kind,
				join: config.join.type,
				cap: config.cap.type,
				sourcePointCount,
				vertexCount,
				triangleCount,
				variableTopology: vertexCount > sourcePointCount * 2,
			} )
		}

		const hemisphere = new HemisphereLight( 0xD9F1FF, 0x182033, 2.35 )
		const sun = new DirectionalLight( 0xFFF1D6, 4.2 )
		sun.position.set( -7, 15, 9 )
		stage3d.add( hemisphere )
		stage3d.add( sun )
		this.lights.push( hemisphere, sun )

		this.metrics = {
			surface: {
				exampleCount: examples.length,
				joinTypes: ['miter', 'bevel', 'round'],
				capTypes: ['butt', 'square', 'round'],
				reversalSplits: 1,
				roundHalfTurnSegments: FAN_SEGMENTS,
				examples,
			},
			screen: {
				requested: true,
				active: false,
				reason: 'preparing',
			},
		}
		window.__meshLineVariableTopologyMetrics = this.metrics
	}

	async createScreenTopology() {
		const path = new MeshLineGPUPath( {
			lines: SCREEN_PATH,
			lineWidth: 0.44,
			sizeAttenuation: true,
			color: 0x38BDF8,
			join: { type: 'round', limit: 4, segments: FAN_SEGMENTS },
			cap: { type: 'round', segments: FAN_SEGMENTS },
		}, {
			chunkSegments: 32,
			simplify: { localTolerance: 0.01 },
		} )
		path.resize( stage.width, stage.height )
		const prepared = await path.prepare( stage3d.renderer, stage3d.camera )

		if ( !prepared ) {
			this.metrics.screen = {
				...path.status,
				requested: true,
				active: false,
			}
			path.dispose()
			this.text = `Drag to orbit · surface topology gallery · screen GPU skipped: ${this.metrics.screen.reason}`
			return
		}

		this.screenPath = path
		stage3d.add( path )
		this.metrics.screen = path.status
		this.addLabel( 'NATIVE GPU · SCREEN ROUND FANS + CAPS', [0, 5.05, 5.8], '#38bdf8' )
		this.text = 'Drag to orbit · true surface topology · cyan = homogeneous-clipped native GPU screen path'
	}

	addLabel( text, position, accent ) {
		const label = new CSS2DObject( createLabelElement( text, accent ) )
		label.position.set( position[0], position[1], position[2] )
		stage3d.add( label )
		this.labels.push( label )
	}

	onResize = () => {
		this.cssRenderer?.setSize( stage.width, stage.height )
		this.screenPath?.resize( stage.width, stage.height )
	}

	update = () => {
		this.screenPath?.update( stage3d.camera )
		this.cssRenderer?.render( stage3d.scene, stage3d.camera )
	}

	dispose() {
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.update )

		for ( const surface of this.surfaces ) {
			stage3d.remove( surface )
			surface.dispose()
		}
		this.surfaces = []

		if ( this.screenPath ) {
			stage3d.remove( this.screenPath )
			this.screenPath.dispose()
			this.screenPath = null
		}

		for ( const label of this.labels ) {
			stage3d.remove( label )
			label.element?.remove()
		}
		this.labels = []

		if ( this.ground ) {
			stage3d.remove( this.ground )
			this.ground.geometry.dispose()
			this.ground.material.dispose()
			this.ground = null
		}

		for ( const light of this.lights ) {
			stage3d.remove( light )
			light.dispose()
		}
		this.lights = []

		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.control = null

		if ( this.cssRenderer?.domElement.parentNode ) this.cssRenderer.domElement.remove()
		this.cssRenderer = null

		if ( this.cameraState ) {
			stage3d.camera.near = this.cameraState.near
			stage3d.camera.far = this.cameraState.far
			stage3d.camera.updateProjectionMatrix()
			this.cameraState = null
		}

		stage3d.renderer.setClearColor( 0x000000 )
		if ( window.__meshLineVariableTopologyMetrics === this.metrics ) {
			window.__meshLineVariableTopologyMetrics = null
		}
		this.metrics = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new VariableTopologyExample()

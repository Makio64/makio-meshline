import { MeshLine } from 'makio-meshline'
import {
	CanvasTexture,
	DirectionalLight,
	Fog,
	HemisphereLight,
	Mesh,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	RepeatWrapping,
	SRGBColorSpace,
} from 'three/webgpu'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINT_COUNT = 192
const ROAD_WIDTH = 3.2

// Float32Array keeps the path compact and can be reused by setPositions().
const createRoadPath = ( pointCount = POINT_COUNT ) => {
	const points = new Float32Array( pointCount * 3 )

	for ( let i = 0; i < pointCount; i++ ) {
		const progress = i / ( pointCount - 1 )
		const x = ( progress - 0.5 ) * 34
		const z = Math.sin( progress * Math.PI * 2 ) * 4
			+ Math.sin( progress * Math.PI * 5 ) * 0.75
		const y = 0.2 + Math.sin( progress * Math.PI ) * 0.15
		const offset = i * 3

		points[offset] = x
		points[offset + 1] = y
		points[offset + 2] = z
	}

	return points
}

// The texture runs along U (path distance) and across V (road width).
const createRoadTexture = () => {
	const canvas = document.createElement( 'canvas' )
	canvas.width = 512
	canvas.height = 128
	const context = canvas.getContext( '2d' )

	context.fillStyle = '#252a2f'
	context.fillRect( 0, 0, canvas.width, canvas.height )

	// Deterministic asphalt grain keeps the example self-contained.
	let seed = 0xA53C9E17
	for ( let i = 0; i < 1200; i++ ) {
		seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0
		const x = seed % canvas.width
		seed = ( Math.imul( seed, 1664525 ) + 1013904223 ) >>> 0
		const y = seed % canvas.height
		const lightness = 38 + ( seed % 20 )

		context.fillStyle = `rgb(${lightness}, ${lightness + 2}, ${lightness + 3})`
		context.fillRect( x, y, 2, 2 )
	}

	context.fillStyle = '#f4f0dc'
	context.fillRect( 0, 8, canvas.width, 5 )
	context.fillRect( 0, canvas.height - 13, canvas.width, 5 )
	context.fillStyle = '#f3c74f'
	context.fillRect( 48, canvas.height / 2 - 3, 300, 6 )

	const texture = new CanvasTexture( canvas )
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.colorSpace = SRGBColorSpace
	texture.anisotropy = 8
	return texture
}

const createSurface = ( points, options ) => {
	return new MeshLine()
		.lines( points )
		.lineWidth( options.width )
		.color( options.color )
		.map( options.map ?? null )
		.surface( {
			frame: 'transport',
			up: [0, 1, 0],
			bank: options.bank ?? 0,
			uvMode: 'distance',
			uvScale: options.uvScale ?? 5,
			roughness: options.roughness ?? 0.9,
			metalness: options.metalness ?? 0,
		} )
		.join( { type: 'miter', limit: 3, segments: 8 } )
		.build()
}

class SurfaceRoadExample {
	constructor() {
		this.text = 'Drag to orbit · world-space road surface'
		this.road = null
		this.shoulder = null
		this.ground = null
		this.roadTexture = null
		this.lights = []
		this.control = null
	}

	async init() {
		await stage3d.initRender( { background: 0x9ab6c5 } )
		stage3d.renderer.setClearColor( 0x9ab6c5 )
		stage3d.scene.fog = new Fog( 0x9ab6c5, 28, 62 )

		this.control = new OrbitControl( stage3d.camera, 25 )
		this.control._phi = 0.78
		this.control._theta = 0.9
		this.control.minRadius = 12
		this.control.maxRadius = 42
		this.control.update()
		stage3d.control = this.control

		this.createScene()
	}

	createScene() {
		const points = createRoadPath()
		const bank = progress => Math.sin( progress * Math.PI * 2 ) * 0.045
		this.roadTexture = createRoadTexture()

		this.shoulder = createSurface( points, {
			width: ROAD_WIDTH + 0.65,
			color: 0xB69B73,
			bank,
			roughness: 1,
		} )
		this.shoulder.position.y = -0.035
		stage3d.add( this.shoulder )

		this.road = createSurface( points, {
			width: ROAD_WIDTH,
			color: 0xFFFFFF,
			map: this.roadTexture,
			bank,
			uvScale: 5,
			roughness: 0.88,
		} )
		stage3d.add( this.road )

		this.ground = new Mesh(
			new PlaneGeometry( 70, 52 ),
			new MeshStandardNodeMaterial( { color: 0x5C7548, roughness: 1 } )
		)
		this.ground.rotation.x = -Math.PI / 2
		this.ground.position.y = 0
		stage3d.add( this.ground )

		const hemisphere = new HemisphereLight( 0xEAF5FF, 0x3D482C, 2.2 )
		const sun = new DirectionalLight( 0xFFF2D2, 3.2 )
		sun.position.set( -8, 18, 10 )
		stage3d.add( hemisphere )
		stage3d.add( sun )
		this.lights.push( hemisphere, sun )
	}

	dispose() {
		for ( const surface of [this.road, this.shoulder] ) {
			if ( !surface ) continue
			stage3d.remove( surface )
			surface.dispose()
		}

		if ( this.ground ) {
			stage3d.remove( this.ground )
			this.ground.geometry.dispose()
			this.ground.material.dispose()
		}

		this.lights.forEach( light => {
			stage3d.remove( light )
			light.dispose()
		} )

		this.roadTexture?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		stage3d.scene.fog = null
		stage3d.renderer.setClearColor( 0x000000 )

		this.road = null
		this.shoulder = null
		this.ground = null
		this.roadTexture = null
		this.lights = []
		this.control = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new SurfaceRoadExample()

/**
 * Staging of the Surface Studio demo: the backdrop, the baked soft-box environment,
 * the reflective floor and the canvas-painted textures its ribbons map.
 */
import { color, float, Fn, fract, fwidth, min, mix, positionLocal, positionWorldDirection, reflector, smoothstep, uv, vec4 } from 'three/tsl'
import {
	BackSide,
	BoxGeometry,
	CanvasTexture,
	ClampToEdgeWrapping,
	Color,
	DoubleSide,
	Mesh,
	MeshBasicMaterial,
	MeshBasicNodeMaterial,
	NoColorSpace,
	PlaneGeometry,
	PMREMGenerator,
	RepeatWrapping,
	Scene,
	SRGBColorSpace,
} from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'

export const FLOOR_Y = -1.7
export const SKY_TOP = 0x03060C
const SKY_HORIZON = 0x10213A
const FLOOR_BASE = 0x060B14

// The room around the ribbons: backdrop, baked reflections and reflective floor.
export function createStudio() {
	createBackdrop()
	createEnvironment()
	createFloor()
}

// A studio cyclorama: a soft glow on the horizon fading to near black above.
function createBackdrop() {
	stage3d.scene.backgroundNode = Fn( () => {
		const elevation = positionWorldDirection.y
		const glow = smoothstep( -0.05, 0.42, elevation ).oneMinus()
		return vec4( mix( color( SKY_TOP ), color( SKY_HORIZON ), glow.mul( glow ) ), 1 )
	} )()
}

// Three soft boxes in a dark room, baked once into a PMREM: the metallic
// edges and normal-mapped grooves get studio highlights to reflect.
function createEnvironment() {
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
	stage3d.scene.environment = stage3d.own( pmrem.fromScene( studio, 0.04 ) ).texture
	stage3d.scene.environmentIntensity = 0.45
	pmrem.dispose()
	studio.traverse( object => {
		object.geometry?.dispose()
		object.material?.dispose()
	} )
}

// A glossy studio floor: a softly blurred reflection of both ribbons, a
// faint one-unit grid for scale, and a radial fade into the backdrop.
function createFloor() {
	const reflection = stage3d.own( reflector( {
		resolutionScale: isMobile ? 0.35 : 0.5,
		generateMipmaps: true,
		bounces: false,
		samples: 0,
	} ) )
	reflection.levelNode = float( 2.4 )

	const coordinate = positionLocal.xy
	const gridDistance = fract( coordinate.sub( 0.5 ) ).sub( 0.5 ).abs().div( fwidth( coordinate ) )
	const gridLine = min( gridDistance.x, gridDistance.y, 1 ).oneMinus()
	const radial = uv().sub( 0.5 ).length()
	const reach = smoothstep( 0.08, 0.44, radial ).oneMinus()
	const gridReach = smoothstep( 0.04, 0.3, radial ).oneMinus()

	const material = new MeshBasicNodeMaterial( { transparent: true, depthWrite: false } )
	material.colorNode = Fn( () => {
		const mirrored = mix( color( FLOOR_BASE ), reflection.rgb, 0.3 )
		const grid = color( 0x5D8BC0 ).mul( gridLine.mul( gridReach ).mul( 0.07 ) )
		return vec4( mirrored.add( grid ), 1 )
	} )()
	material.opacityNode = reach

	const floor = new Mesh( new PlaneGeometry( 44, 44 ), material )
	floor.renderOrder = -1
	floor.rotation.x = -Math.PI * 0.5
	floor.position.y = FLOOR_Y
	floor.add( reflection.target )
	stage3d.add( floor )
}

// The canvas-painted maps of both ribbons.
export const createTextures = () => ( {
	distanceMap: createDistanceTexture(),
	stretchMap: createStretchTexture(),
	normalMap: createNormalTexture(),
	roughnessMap: createRoughnessTexture(),
	metalnessMap: createMetalnessTexture(),
} )

function createTexture( width, height, draw, colorSpace = NoColorSpace ) {
	const canvas = document.createElement( 'canvas' )
	canvas.width = width
	canvas.height = height
	draw( canvas.getContext( '2d' ), width, height )

	const texture = stage3d.own( new CanvasTexture( canvas ) )
	texture.wrapS = RepeatWrapping
	texture.wrapT = RepeatWrapping
	texture.colorSpace = colorSpace
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

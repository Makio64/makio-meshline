import { MeshLine } from 'makio-meshline'
import { attribute, Fn, vec4 } from 'three/tsl'
import { Color, MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import { mouse, onMove } from '@/makio/utils/input/mouse'
import random from '@/makio/utils/random'

const NUM_POINTS = 20
const NUM_LINES = 4
const GREEN_PALETTE = [0x00FF88, 0x88FF00, 0x00AA44, 0x44FF88]
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const pointerNDC = new Vector2()
const targetOffset = new Vector3()
const force3 = new Vector3()

class FollowExample {
	constructor() {
		this.text = isMobile ? `touch & move` : `move your mouse`
		this.lines = []
		this.lineArrays = []
		this.line = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0

		for ( let index = 0; index < NUM_LINES; index++ ) {
			const angle = index / NUM_LINES * Math.PI * 2
			const radius = 0.2 + random( -0.1, 0.1 )
			const offset = new Vector3(
				Math.cos( angle ) * radius,
				Math.sin( angle ) * radius,
				0
			)
			const points = Array.from( { length: NUM_POINTS }, () => offset.clone() )
			const positions = new Float32Array( NUM_POINTS * 3 )

			writePointsToArray( points, positions )

			this.lines.push( {
				points,
				positions,
				offset,
				velocity: new Vector3(),
				spring: 0.06 + random( -0.02, 0.02 ),
				friction: 0.85 + random( -0.05, 0.05 )
			} )
			this.lineArrays.push( positions )
		}
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		this.createLine()

		onMove.add( this.onMouseMove )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createLine() {
		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 0.01 )
			.widthCallback( ( t ) => {
				const edge = 0.1
				if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
				if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
				return 1
			} )
			.colorFn( Fn( ( [, progress] ) => {
				const vertexColor = attribute( 'lineColor', 'vec3' )
				return vec4( vertexColor.add( progress.smoothstep( 0.5, 1 ).mul( .2 ) ), 1 )
			} ) )

		this.line.build()

		const colorArray = new Float32Array( NUM_LINES * NUM_POINTS * 2 * 3 )
		for ( let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++ ) {
			const color = new Color( GREEN_PALETTE[lineIndex % GREEN_PALETTE.length] )
			const startVertex = lineIndex * NUM_POINTS * 2

			for ( let i = 0; i < NUM_POINTS * 2; i++ ) {
				colorArray.set( [color.r, color.g, color.b], ( startVertex + i ) * 3 )
			}
		}

		this.line.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )
		stage3d.add( this.line )
	}

	update = ( dt ) => {
		this.lines.forEach( line => {
			for ( let i = NUM_POINTS - 1; i >= 0; i-- ) {
				if ( i === 0 ) {
					targetOffset.copy( this.target ).add( line.offset )
					force3.copy( targetOffset ).sub( line.points[i] ).multiplyScalar( line.spring )
					line.velocity.add( force3 ).multiplyScalar( line.friction )
					line.points[i].add( line.velocity )
				} else {
					line.points[i].lerp( line.points[i - 1], 0.9 )
				}
			}

			writePointsToArray( line.points, line.positions )
		} )

		this.line.setPositions( this.lineArrays )

		const speed = Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) / ( dt / 16 || 1 ) * 0.01
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, speed, 0.15 )
		this.line.material.lineWidth.value = MathUtils.lerp( 
			this.line.material.lineWidth.value, 
			MathUtils.clamp( this.mouseSpeed, 0.01, 1 ), 
			0.15 
		)
	}

	onMouseMove = ( mouseData ) => {
		pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.raycaster.setFromCamera( pointerNDC, stage3d.camera )

		if ( this.raycaster.ray.intersectPlane( interactionPlane, this.target ) === null ) {
			const { origin, direction } = this.raycaster.ray
			this.target.copy( origin ).addScaledVector( direction, 10 )
		}
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		onMove.remove( this.onMouseMove )
		stage3d.remove( this.line )
		stage3d.control.dispose()
		this.line?.dispose()
		this.line = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

function writePointsToArray( points, positions ) {
	for ( let i = 0; i < NUM_POINTS; i++ ) {
		const point = points[i]
		positions[i * 3] = point.x
		positions[i * 3 + 1] = point.y
		positions[i * 3 + 2] = point.z
	}
}

export default new FollowExample()
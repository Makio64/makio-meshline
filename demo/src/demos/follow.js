import { Vector3, MathUtils, Raycaster, Color } from 'three/webgpu'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import { MeshLine } from 'meshline'
import { mouse, onMove } from '@/makio/utils/input/mouse'
import { Fn, vec4, attribute } from 'three/tsl'
import random from '@/makio/utils/random'
import { isMobile } from '@/makio/utils/detect'

const NUM_POINTS = 20
const NUM_LINES = 4

class FollowExample {
	constructor() {
		this.text = isMobile ? `touch & move` : `move your mouse`
		this.lines = []
		this.lineArrays = []
		
		// Generate lines with circular offsets and varied physics
		for ( let i = 0; i < NUM_LINES; i++ ) {
			const angle = ( i / NUM_LINES ) * Math.PI * 2
			const radius = 0.2 + random( -0.1, 0.1 )
			const offset = new Vector3( 
				Math.cos( angle ) * radius,
				Math.sin( angle ) * radius,
				0 
			)
			
			// Initialize points and positions array
			const points = Array( NUM_POINTS ).fill().map( () => offset.clone() )
			const positionsF32 = new Float32Array( NUM_POINTS * 3 )
			
			// Set initial positions
			points.forEach( ( p, j ) => {
				positionsF32.set( [p.x, p.y, p.z], j * 3 )
			} )
			
			this.lines.push( {
				points,
				positionsF32,
				offset,
				velocity: new Vector3(),
				spring: 0.06 + random( -0.02, 0.02 ),
				friction: 0.85 + random( -0.05, 0.05 )
			} )
			this.lineArrays.push( positionsF32 )
		}
		
		this.line = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0
		this.targetMouseSpeed = 0
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		
		this.initLine()

		onMove.add( this.onMouseMove )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	initLine() {
		const greenPalette = [0x00FF88, 0x88FF00, 0x00AA44, 0x44FF88]
		
		// Create meshline with multiple segments
		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 0.01 )
			.widthCallback( ( t ) => {
				const edge = 0.1
				if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
				if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
				return 1
			} )
			.verbose( true )
			.colorFn( Fn( ( [, counters] ) => {
				const vertexColor = attribute( 'lineColor', 'vec3' )
				return vec4( vertexColor.add( counters.smoothstep( 0.5, 1 ).mul( .2 ) ), 1 )
			} ) )
		
		this.line.build()
		
		// Create color attribute for each line
		const totalVertices = NUM_LINES * NUM_POINTS * 2
		const colorArray = new Float32Array( totalVertices * 3 )
		
		for ( let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++ ) {
			const color = new Color( greenPalette[lineIdx % greenPalette.length] )
			const startVertex = lineIdx * NUM_POINTS * 2
			
			for ( let i = 0; i < NUM_POINTS * 2; i++ ) {
				colorArray.set( [color.r, color.g, color.b], ( startVertex + i ) * 3 )
			}
		}
		
		this.line.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )
		stage3d.add( this.line )
	}

	// -------------------------------------------------- UPDATE LOOP
	update = ( dt ) => {
		// Update each line
		this.lines.forEach( line => {
			const targetWithOffset = this.target.clone().add( line.offset )
			
			// Update points from tail to head
			for ( let i = NUM_POINTS - 1; i >= 0; i-- ) {
				if ( i === 0 ) {
					// Head follows target with spring physics
					const force = targetWithOffset.clone().sub( line.points[i] ).multiplyScalar( line.spring )
					line.velocity.add( force ).multiplyScalar( line.friction )
					line.points[i].add( line.velocity )
				} else {
					// Rest follow previous point
					line.points[i].lerp( line.points[i - 1], 0.9 )
				}
			}
			
			// Update positions array
			line.points.forEach( ( p, i ) => {
				line.positionsF32.set( [p.x, p.y, p.z], i * 3 )
			} )
		} )
		
		this.line.setPositions( this.lineArrays )

		// Update width based on mouse speed
		const speed = Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) / ( dt / 16 || 1 )
		this.targetMouseSpeed = speed * 0.01
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, this.targetMouseSpeed, 0.15 )
		this.line.material.lineWidth.value = MathUtils.lerp( 
			this.line.material.lineWidth.value, 
			MathUtils.clamp( this.mouseSpeed, 0.01, 1 ), 
			0.15 
		)
	}

	// -------------------------------------------------- HELPERS
	onMouseMove = ( mouseData ) => {
		// Set raycaster from mouse position
		this.raycaster.setFromCamera( 
			new Vector3( mouseData.normalizedX, -mouseData.normalizedY, 0 ), 
			stage3d.camera 
		)
		
		// Calculate intersection with z=0 plane
		const { origin, direction } = this.raycaster.ray
		const t = -origin.z / direction.z
		
		// Set target based on intersection or default distance
		if ( Math.abs( direction.z ) < 0.0001 || t < 0 ) {
			this.target.copy( origin ).addScaledVector( direction, 10 )
		} else {
			this.target.set(
				origin.x + t * direction.x,
				origin.y + t * direction.y,
				0
			)
		}
	}

	onResize = () => {
		this.line?.resize()
	}

	// -------------------------------------------------- CLEANUP
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

export default new FollowExample()
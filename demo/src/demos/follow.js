import { Vector3, MathUtils, Raycaster, Color } from 'three/webgpu'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import { MeshLine } from 'meshline'
import { mouse, onMove } from '@/makio/utils/input/mouse'
import { Fn, vec4, attribute } from 'three/tsl'
import random from '@/makio/utils/random'

const NUM_POINTS = 20
const NUM_LINES = 4 // Can be any number now
// Temporary vector for calculations
const tmp = new Vector3()

class FollowExample {
	constructor() {
		// Create arrays for multiple lines
		this.lines = []
		this.lineArrays = []
		
		// Generate dynamic offsets and lerp factors
		const offsets = []
		const lerpFactors = []
		for ( let i = 0; i < NUM_LINES; i++ ) {
			// Circular distribution for offsets
			const angle = ( i / NUM_LINES ) * Math.PI * 2
			const radius = 0.2 + random( -0.1, 0.1 )
			offsets.push( {
				x: Math.cos( angle ) * radius,
				y: Math.sin( angle ) * radius
			} )
			// Varied lerp factors
			lerpFactors.push( 0.25 + ( i % 4 ) * 0.05 )
		}
		
		for ( let i = 0; i < NUM_LINES; i++ ) {
			// Each line has its own set of points with an initial offset
			const points = new Array( NUM_POINTS ).fill( null ).map( () => new Vector3( offsets[i].x, offsets[i].y, 0 ) )
			const positionsF32 = new Float32Array( NUM_POINTS * 3 )
			
			// Initialize the Float32Array with offset positions
			for ( let j = 0; j < NUM_POINTS; j++ ) {
				positionsF32[j * 3] = offsets[i].x
				positionsF32[j * 3 + 1] = offsets[i].y
				positionsF32[j * 3 + 2] = 0
			}
			
			this.lines.push( { 
				points, 
				positionsF32, 
				offset: offsets[i], 
				lerpFactor: lerpFactors[i],
				velocity: new Vector3(), // Velocity for spring physics
				spring: 0.06 + random( -0.02, 0.02 ), // Randomized spring factor
				friction: 0.85 + random( -0.05, 0.05 ) // Randomized friction factor
			} )
			this.lineArrays.push( positionsF32 )
		}
		
		this.line = null
		this.target = new Vector3()
		this.prevTarget = new Vector3()
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
		const greenPalette = [0x00FF88,  0x88FF00, 0x00AA44, 0x44FF88]
		
		// Create a single line with multiple line segments
		this.line = new MeshLine()
			.lines( this.lineArrays, false ) // Pass array of Float32Arrays
			.lineWidth( 0.01 )
			.widthCallback( ( t ) => {
				const edge = 0.1
				if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
				if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
				return 1 // full width in the middle
			} )
			.verbose( true )
			.colorFn( Fn( ( [baseColor, counters, side] ) => {
				const vertexColor = attribute( 'lineColor', 'vec3' )
				// add a slight glow effect along the lines
				return vec4( vertexColor.add( counters.smoothstep( 0.5, 1 ).mul( .2 ) ), 1 )
			} ) )
		
		// Build the mesh line first
		this.line.build()
		
		// Create custom color attribute after build
		// Calculate total vertices needed (each line has NUM_POINTS * 2 vertices)
		const totalVertices = NUM_LINES * NUM_POINTS * 2
		const colorArray = new Float32Array( totalVertices * 3 )
		
		let vertexIndex = 0
		for ( let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++ ) {
			const color = new Color( greenPalette[lineIdx % greenPalette.length] )
			// Each point in the line has 2 vertices (left and right side)
			for ( let pointIdx = 0; pointIdx < NUM_POINTS * 2; pointIdx++ ) {
				colorArray[vertexIndex * 3] = color.r
				colorArray[vertexIndex * 3 + 1] = color.g
				colorArray[vertexIndex * 3 + 2] = color.b
				vertexIndex++
			}
		}
		
		// Use setOrUpdateAttribute to add the custom color attribute
		// We use 'lineColor' instead of 'color' to avoid conflicts
		this.line.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )

		stage3d.add( this.line )
	}

	// -------------------------------------------------- UPDATE LOOP
	update = ( dt ) => {
		
		// Update each line independently
		for ( let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++ ) {
			const line = this.lines[lineIdx]
			
			// Target position with offset
			const targetWithOffset = this.target.clone().add( new Vector3( line.offset.x, line.offset.y, 0 ) )
			
			// Update points from tail to head (reverse order)
			for ( let i = NUM_POINTS - 1; i >= 0; i-- ) {
				if ( i === 0 ) {
					// First point uses spring physics
					tmp.copy( targetWithOffset ).sub( line.points[i] ).multiplyScalar( line.spring )
					line.velocity.add( tmp ).multiplyScalar( line.friction )
					line.points[i].add( line.velocity )
				} else {
					// Other points follow with lerp
					line.points[i].lerp( line.points[i - 1], 0.9 )
				}
			}
			
			// Update the Float32Array for this line
			this.updatePosition( line.positionsF32, line.points )
		}
		
		// Update all lines at once
		this.line.setPositions( this.lineArrays )

		// ------------------------------------------------ width based on mouse speed
		// Use mouse.moveX and mouse.moveY for speed calculation
		const distance = Math.sqrt( mouse.moveX * mouse.moveX + mouse.moveY * mouse.moveY )
		this.targetMouseSpeed = distance / ( dt / 16 || 1 )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, this.targetMouseSpeed * 0.01, 0.15 )
		const targetWidth = MathUtils.clamp( this.mouseSpeed, 0.01, 1 )

		// Smooth interpolation to avoid jitter
		this.line.material.lineWidth.value = MathUtils.lerp( this.line.material.lineWidth.value, targetWidth, 0.15 )
	}

	// -------------------------------------------------- HELPERS
	updatePosition( arr, points ) {
		for ( let i = 0; i < NUM_POINTS; i++ ) {
			const p = points[i]
			arr[i * 3] = p.x
			arr[i * 3 + 1] = p.y
			arr[i * 3 + 2] = p.z
		}
		return arr
	}

	onMouseMove = ( mouseData ) => {
		// Use normalized coordinates from mouse.js
		const mouse3D = new Vector3( mouseData.normalizedX, -mouseData.normalizedY, 0 )
		
		// Update the raycaster with the camera and mouse position
		this.raycaster.setFromCamera( mouse3D, stage3d.camera )
		
		// Get ray origin and direction
		const origin = this.raycaster.ray.origin
		const direction = this.raycaster.ray.direction
		
		// Calculate intersection with z=0 plane
		if ( Math.abs( direction.z ) < 0.0001 ) {
			// Ray is nearly parallel to the plane, use a default distance
			this.target.copy( origin ).add( direction.multiplyScalar( 10 ) )
			return
		}
		
		const t = -origin.z / direction.z
		
		// If t is negative, the intersection is behind the camera
		if ( t < 0 ) {
			// Project forward anyway with a reasonable distance
			this.target.copy( origin ).add( direction.multiplyScalar( 10 ) )
			return
		}
		
		// Calculate intersection point
		this.target.set(
			origin.x + t * direction.x,
			origin.y + t * direction.y,
			0 // z = 0 by definition
		)
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
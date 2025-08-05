import { Vector3, MathUtils, Raycaster, Color } from 'three/webgpu'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import { MeshLine } from 'meshline'
import { mouse, onDown, onMove, onUp } from '@/makio/utils/input/mouse'
import { Fn, vec4, attribute } from 'three/tsl'
import random from '@/makio/utils/random'
// import simplify from 'simplify-js'
import { smoothstep } from '@/makio/utils/math'

const NUM_POINTS = 20
const NUM_LINES = 1000
const LINES_FOLLOWING_MOUSE = 5
const LINES_BY_PATH = 10
const force3 = new Vector3()

class DrawLinesExample {
	constructor() {
		this.linePath = []
		this.lines = []
		this.lineArrays = []
		this.meshline = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0
		this.targetMouseSpeed = 0
		this.timespeed = 1

		// Generate lines with circular offsets and varied physics
		for ( let i = 0; i < NUM_LINES; i++ ) {
			const angle = ( i / NUM_LINES ) * Math.PI * 2
			const radius = 0.2 + random( -0.1, 0.1 ) * .5
			const offset = new Vector3( 
				Math.cos( angle ) * radius,
				Math.sin( angle ) * radius,
				0 
			)
			
			// Initialize points and positions array
			const points = Array( NUM_POINTS ).fill().map( () => offset.clone() )
			const positionsF32 = new Float32Array( NUM_POINTS * 3 )
						
			this.lines.push( {
				points,
				positionsF32,
				offset,
				speed: 0.00000001,
				target: new Vector3(),
				velocity: new Vector3(),
				spring: 0.06 + random( -0.02, 0.02 ),
				friction: 0.85 + random( -0.05, 0.05 ),
				pathTime: random( 0, 10000 ), // Track actual time for this line's path
				justTeleported: false // Flag to skip physics after teleport
			} )
			this.lineArrays.push( positionsF32 )
		}
		
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		
		this.initLine()

		onDown.add( this.onDown )
		onMove.add( this.onMouseMove )
		onUp.add( this.onUp )

		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	initLine() {
		const greenPalette = [0x00FF88, 0x88FF00, 0x00AA44, 0x44FF88]
		
		// Create meshline with multiple segments
		this.meshline = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 1 )
			.needsWidth( true ) // Enable per-vertex width
			.widthCallback( this.widthFactor )
			.verbose( true )
			.colorFn( Fn( ( [, counters] ) => {
				const vertexColor = attribute( 'lineColor', 'vec3' )
				return vec4( vertexColor.add( counters.smoothstep( 0.5, 1 ).mul( .2 ) ), 1 )
			} ) )
		
		this.meshline.build()
		
		// Create color attribute for each line
		const totalVertices = NUM_LINES * NUM_POINTS * 2
		const colorArray = new Float32Array( totalVertices * 3 )
		
		// Initialize width array (2 vertices per point)
		this.widthArray = new Float32Array( NUM_LINES * NUM_POINTS * 2 )
		
		for ( let lineIdx = 0; lineIdx < NUM_LINES; lineIdx++ ) {
			const color = new Color( greenPalette[lineIdx % greenPalette.length] )
			const startVertex = lineIdx * NUM_POINTS * 2
			
			for ( let i = 0; i < NUM_POINTS * 2; i++ ) {
				colorArray.set( [color.r, color.g, color.b], ( startVertex + i ) * 3 )
			}
			
			// Initialize widths to default (2 vertices per point)
			for ( let i = 0; i < NUM_POINTS; i++ ) {
				const widthIndex = lineIdx * NUM_POINTS * 2 + i * 2
				this.widthArray[widthIndex] = 0.01
				this.widthArray[widthIndex + 1] = 0.01
			}
		}
		
		this.meshline.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )
		stage3d.add( this.meshline )
	}

	// -------------------------------------------------- UPDATE LOOP
	update = ( dt ) => {
		// Update width based on mouse speed
		this.targetMouseSpeed = Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) / ( dt / 16 || 1 ) * 0.01
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, this.targetMouseSpeed, 0.15 )

		// basically here its same than follow.js 
		for ( let i = 0; i < LINES_FOLLOWING_MOUSE; i++ ) {
			this.updateFollowingLine( this.lines[i] )
		}
		
		// with the rest of the lines 
		for ( let i = LINES_FOLLOWING_MOUSE; i < NUM_LINES; i++ ) {
			let line = this.lines[i]
			let linepath = this.linePath[Math.floor( ( i - LINES_FOLLOWING_MOUSE ) / LINES_BY_PATH )]
			if ( linepath ) {
				this.updateLineOnPath( line, linepath, dt )
			} else {
				break
			}
		}

		for ( let i = 0; i < NUM_LINES; i++ ) {
			let line = this.lines[i]
		
			// Update width array for all points in this line (2 vertices per point)
			for ( let k = 0; k < NUM_POINTS; k++ ) {
				const t = k / ( NUM_POINTS - 1 ) // Calculate t value for this point (0 to 1)
				let widthWithCallback = this.widthFactor( t ) * line.speed
				if ( line.pathTime > 0 ) {
					widthWithCallback *= smoothstep( 0, 100, line.pathTime )
				}
				const widthIndex = i * NUM_POINTS * 2 + k * 2
				this.widthArray[widthIndex] = widthWithCallback
				this.widthArray[widthIndex + 1] = widthWithCallback
			}
		
			// Update points from tail to head
			if ( line.justTeleported ) {
				line.justTeleported = false
			} else {
				// Normal "spring" update
				for ( let k = NUM_POINTS - 1; k >= 0; k-- ) {
					if ( k === 0 ) {
					// Head follows target with spring physics
						const force = force3.copy( line.target ).sub( line.points[k] ).multiplyScalar( line.spring * this.timespeed )
						line.velocity.add( force ).multiplyScalar( line.friction )
						line.points[k].add( line.velocity )
					} else {
					// Rest follow previous point
						line.points[k].lerp( line.points[k - 1], 0.9 )
					}
				}
			}
		
			// Update positions array
			line.points.forEach( ( p, idx ) => {
				line.positionsF32.set( [p.x, p.y, p.z], idx * 3 )
			} )
		} 
		
		
		this.meshline.setPositions( this.lineArrays )
		
		// Update the width buffer
		this.meshline.geometry.setOrUpdateAttribute( 'width', this.widthArray, 1 )
	}

	updateFollowingLine( line ) {
		line.speed = MathUtils.lerp( line.speed, this.mouseSpeed, 0.15 )
		line.target.set( this.target.x, this.target.y, 0 ).add( line.offset )
	}

	updateLineOnPath( line, linePath, dt ) {
		let startTime = linePath.startTime
		let endTime = linePath.endTime
		let range = endTime - startTime
			
		// Update path time
		line.pathTime += dt * this.timespeed
		let percent = ( line.pathTime / range ) % 1
			
		// Check if we've completed a full cycle
		if ( line.pathTime >= range ) {
			// Check if the tail has caught up
			const tailDistance = this.getDistanceFromEnd( line, linePath )
			if ( tailDistance < 0.3 ) {
				line.pathTime = 0
				line.justTeleported = true
				line.velocity.set( 0, 0, 0 )

				// Get starting position
				const startPt = this.getPointAt( linePath, 0 )
					
				// Teleport all points to the starting position
				for ( let i = 0; i < NUM_POINTS; i++ ) {
					line.points[i].set( startPt.x + line.offset.x, startPt.y + line.offset.y, 0 )
				}
			} else {
				percent = 1
			}
		}
			
		let pts = this.getPointAt( linePath, percent )
		let moveX = line.target.x - pts.x
		let moveY = line.target.y - pts.y
		let speed = Math.sqrt( moveX ** 2 + moveY ** 2 ) * 0.5
		line.speed = MathUtils.lerp( line.speed, speed, 0.15 )
		line.target.set( pts.x, pts.y, 0 ).add( line.offset )
	}

	getPointAt( line, percent ) {
		const { points, startTime, endTime } = line
				
		// Calculate target time based on percent
		const targetTime = startTime + ( endTime - startTime ) * percent
		
		// Find the two points to interpolate between
		let p1 = points[0]
		let p2 = points[points.length - 1]
		
		for ( let i = 0; i < points.length - 1; i++ ) {
			if ( targetTime >= points[i].time && targetTime <= points[i + 1].time ) {
				p1 = points[i]
				p2 = points[i + 1]
				break
			}
		}
		
		// Calculate interpolation factor between the two points
		const segmentDuration = p2.time - p1.time
		const t = segmentDuration > 0 ? ( targetTime - p1.time ) / segmentDuration : 0
		
		// Interpolate position
		return {
			x: MathUtils.lerp( p1.x, p2.x, t ),
			y: MathUtils.lerp( p1.y, p2.y, t ),
			
		}
	}

	widthFactor = ( t ) => {
		const edge = 0.1
		if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
		if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
		return 1
	}

	getDistanceFromEnd( line, linepath ) {
		const endPoint = linepath.points[linepath.points.length - 1]
		const endVector = new Vector3( endPoint.x, endPoint.y, 0 )
		
		const tailPoint = line.points[line.points.length - 1]
		return endVector.distanceTo( tailPoint )
	}

	// -------------------------------------------------- HELPERS
	onDown = ( mouseData ) => {
		// Start recording when mouse is pressed
		this.updateTarget( mouseData )
		this.points = [] // Start new path
		this.addPoint( this.target )
	}
	onMouseMove = ( mouseData ) => {
		this.updateTarget( mouseData )
		// Only add points if mouse is down
		if ( mouse.isDown && this.points ) {
			this.addPoint( this.target )
		}
	}
	onUp = () => {
		// Save the recorded path if we have points
		if ( this.points && this.points.length > 1 ) {
			let points = this.points // Could use simplify here if needed
			this.linePath.push( { points, startTime: this.points[0].time, endTime: this.points[this.points.length - 1].time } )
		}
		this.points = null
	}
	updateTarget( mouseData ) {
		// Set raycaster from mouse position
		this.raycaster.setFromCamera(  new Vector3( mouseData.normalizedX, -mouseData.normalizedY, 0 ),  stage3d.camera  )
		
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

	addPoint( point ) {
		
		const currentTime = performance.now()
		// Store the actual width value being used for drawing
		const currentWidth = MathUtils.clamp( this.mouseSpeed, 0.01, 1 )
		
		const x = point.x
		const y = point.y
		
		if ( !this.points || this.points.length === 0 ) {
			this.points = []
			this.points.push( { x, y, time: currentTime, width: currentWidth } )
		} else {
			let lastPoint = this.points[this.points.length - 1]
			const dx = x - lastPoint.x
			const dy = y - lastPoint.y
			const distance = Math.sqrt( dx * dx + dy * dy )
			
			// ignore point to close from last point
			if ( distance > 0.01 ) {
				this.points.push( { x, y, time: currentTime, width: currentWidth } )
			}
		}
	}


	onResize = () => {
		this.line?.resize()
	}

	// -------------------------------------------------- CLEANUP
	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		onDown.remove( this.onDown )
		onMove.remove( this.onMouseMove )
		onUp.remove( this.onUp )
		
		stage3d.remove( this.meshline )
		stage3d.control.dispose()
		this.meshline?.dispose()
		this.meshline = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new DrawLinesExample()
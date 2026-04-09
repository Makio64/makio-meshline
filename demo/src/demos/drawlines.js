import { MeshLine } from 'makio-meshline'
import { attribute, Fn, vec4 } from 'three/tsl'
import { Color, MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { mouse, onDown, onMove, onUp } from '@/makio/utils/input/mouse'
import { smoothstep } from '@/makio/utils/math'
import random from '@/makio/utils/random'

const NUM_POINTS = 20
const NUM_LINES = 1000
const LINES_FOLLOWING_MOUSE = 5
const LINES_BY_PATH = 10
const GREEN_PALETTE = [0x00FF88, 0x88FF00, 0x00AA44, 0x44FF88]
const force3 = new Vector3()
const pathPoint3 = new Vector3()
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const pointerNDC = new Vector2()

class DrawLinesExample {
	constructor() {
		this.text = 'Click & drag to draw lines'
		this.paths = []
		this.activeStroke = null
		this.lines = []
		this.lineArrays = []
		this.meshline = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0
		this.timespeed = 1

		for ( let i = 0; i < NUM_LINES; i++ ) {
			const angle = random() * Math.PI * 2
			const radius = 0.2 + random( -.3, .3 )
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
				speed: 0.00000001,
				target: new Vector3(),
				velocity: new Vector3(),
				spring: 0.06 + random( -0.02, 0.02 ),
				friction: 0.85 + random( -0.05, 0.05 ),
				pathTime: random( 0, 10000 ),
				justTeleported: false
			} )
			this.lineArrays.push( positions )
		}
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		this.createLine()

		onDown.add( this.onDown )
		onMove.add( this.onMouseMove )
		onUp.add( this.onUp )

		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createLine() {
		this.meshline = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 1 )
			.needsWidth( true )
			.widthCallback( getWidthFactor )
			.colorFn( Fn( ( [, progress] ) => {
				const vertexColor = attribute( 'lineColor', 'vec3' )
				return vec4( vertexColor.add( progress.smoothstep( 0.5, 1 ).mul( .2 ) ), 1 )
			} ) )

		this.meshline.build()

		this.widthArray = new Float32Array( NUM_LINES * NUM_POINTS * 2 )
		for ( let i = 0; i < this.widthArray.length; i++ ) {
			this.widthArray[i] = 0.01
		}

		const colorArray = new Float32Array( NUM_LINES * NUM_POINTS * 2 * 3 )
		for ( let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++ ) {
			const color = new Color( GREEN_PALETTE[lineIndex % GREEN_PALETTE.length] )
			const startVertex = lineIndex * NUM_POINTS * 2

			for ( let i = 0; i < NUM_POINTS * 2; i++ ) {
				colorArray.set( [color.r, color.g, color.b], ( startVertex + i ) * 3 )
			}
		}

		this.meshline.geometry.setOrUpdateAttribute( 'lineColor', colorArray, 3 )
		stage3d.add( this.meshline )
	}

	update = ( dt ) => {
		const nextMouseSpeed = Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) / ( dt / 16 || 1 ) * 0.01
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, nextMouseSpeed, 0.15 )

		for ( let i = 0; i < LINES_FOLLOWING_MOUSE; i++ ) {
			this.updateFollowingLine( this.lines[i] )
		}

		for ( let i = LINES_FOLLOWING_MOUSE; i < NUM_LINES; i++ ) {
			const line = this.lines[i]
			const path = this.paths[Math.floor( ( i - LINES_FOLLOWING_MOUSE ) / LINES_BY_PATH )]
			if ( path ) {
				this.updateLineOnPath( line, path, dt )
			} else {
				break
			}
		}

		for ( let i = 0; i < NUM_LINES; i++ ) {
			const line = this.lines[i]
			this.updateWidthArray( i, line )

			if ( line.justTeleported ) {
				line.justTeleported = false
			} else {
				for ( let k = NUM_POINTS - 1; k >= 0; k-- ) {
					if ( k === 0 ) {
						const force = force3.copy( line.target ).sub( line.points[k] ).multiplyScalar( line.spring * this.timespeed )
						line.velocity.add( force ).multiplyScalar( line.friction )
						line.points[k].add( line.velocity )
					} else {
						line.points[k].lerp( line.points[k - 1], 0.9 )
					}
				}
			}

			writePointsToArray( line.points, line.positions )
		}

		this.meshline.setPositions( this.lineArrays )
		this.meshline.geometry.setOrUpdateAttribute( 'width', this.widthArray, 1 )
	}

	updateWidthArray( lineIndex, line ) {
		for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
			let width = getWidthFactor( pointIndex / ( NUM_POINTS - 1 ) ) * line.speed
			if ( line.pathTime > 0 ) {
				width *= smoothstep( 0, 100, line.pathTime )
			}

			const attributeIndex = lineIndex * NUM_POINTS * 2 + pointIndex * 2
			this.widthArray[attributeIndex] = width
			this.widthArray[attributeIndex + 1] = width
		}
	}

	updateFollowingLine( line ) {
		line.speed = MathUtils.lerp( line.speed, this.mouseSpeed, 0.15 )
		line.target.set( this.target.x, this.target.y, 0 ).add( line.offset )
	}

	updateLineOnPath( line, path, dt ) {
		const range = path.endTime - path.startTime
		line.pathTime += dt * this.timespeed
		let percent = ( line.pathTime / range ) % 1

		if ( line.pathTime >= range ) {
			const endPoint = path.points[path.points.length - 1]
			pathPoint3.set( endPoint.x, endPoint.y, 0 )
			const tailDistance = pathPoint3.distanceTo( line.points[line.points.length - 1] )
			if ( tailDistance < 0.3 ) {
				line.pathTime = 0
				line.justTeleported = true
				line.velocity.set( 0, 0, 0 )
				samplePathPoint( path, 0, pathPoint3 )

				for ( let i = 0; i < NUM_POINTS; i++ ) {
					line.points[i].set( pathPoint3.x + line.offset.x, pathPoint3.y + line.offset.y, 0 )
				}
			} else {
				percent = 1
			}
		}

		samplePathPoint( path, percent, pathPoint3 )
		const moveX = line.target.x - pathPoint3.x
		const moveY = line.target.y - pathPoint3.y
		const speed = Math.sqrt( moveX ** 2 + moveY ** 2 ) * 0.5
		line.speed = MathUtils.lerp( line.speed, speed, 0.15 )
		line.target.set( pathPoint3.x, pathPoint3.y, 0 ).add( line.offset )
	}
	onDown = ( mouseData ) => {
		this.updateTarget( mouseData )
		this.activeStroke = []
		this.addPoint( this.target )
	}

	onMouseMove = ( mouseData ) => {
		this.updateTarget( mouseData )
		if ( mouse.isDown && this.activeStroke ) {
			this.addPoint( this.target )
		}
	}

	onUp = () => {
		if ( this.activeStroke && this.activeStroke.length > 1 ) {
			this.paths.push( {
				points: this.activeStroke,
				startTime: this.activeStroke[0].time,
				endTime: this.activeStroke[this.activeStroke.length - 1].time
			} )
		}
		this.activeStroke = null
	}

	updateTarget( mouseData ) {
		pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.raycaster.setFromCamera( pointerNDC, stage3d.camera )

		if ( this.raycaster.ray.intersectPlane( interactionPlane, this.target ) === null ) {
			const { origin, direction } = this.raycaster.ray
			this.target.copy( origin ).addScaledVector( direction, 10 )
		}
	}

	addPoint( point ) {
		const currentTime = performance.now()
		const x = point.x
		const y = point.y

		if ( !this.activeStroke || this.activeStroke.length === 0 ) {
			this.activeStroke = []
			this.activeStroke.push( { x, y, time: currentTime } )
		} else {
			const lastPoint = this.activeStroke[this.activeStroke.length - 1]
			const dx = x - lastPoint.x
			const dy = y - lastPoint.y
			const distance = Math.sqrt( dx * dx + dy * dy )

			if ( distance > 0.01 ) {
				this.activeStroke.push( { x, y, time: currentTime } )
			}
		}
	}

	onResize = () => {
		this.meshline?.resize()
	}

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

function getWidthFactor( t ) {
	const edge = 0.1
	if ( t < edge ) return MathUtils.lerp( 0.1, 1, t / edge )
	if ( t > 1 - edge ) return MathUtils.lerp( 0.1, 1, ( 1 - t ) / edge )
	return 1
}

function writePointsToArray( points, positions ) {
	for ( let i = 0; i < NUM_POINTS; i++ ) {
		const point = points[i]
		positions[i * 3] = point.x
		positions[i * 3 + 1] = point.y
		positions[i * 3 + 2] = point.z
	}
}

function samplePathPoint( path, percent, target ) {
	const { points, startTime, endTime } = path
	const targetTime = startTime + ( endTime - startTime ) * percent
	let pointA = points[0]
	let pointB = points[points.length - 1]

	for ( let i = 0; i < points.length - 1; i++ ) {
		if ( targetTime >= points[i].time && targetTime <= points[i + 1].time ) {
			pointA = points[i]
			pointB = points[i + 1]
			break
		}
	}

	const segmentDuration = pointB.time - pointA.time
	const interpolation = segmentDuration > 0 ? ( targetTime - pointA.time ) / segmentDuration : 0
	target.set(
		MathUtils.lerp( pointA.x, pointB.x, interpolation ),
		MathUtils.lerp( pointA.y, pointB.y, interpolation ),
		0
	)
	return target
}

export default new DrawLinesExample()
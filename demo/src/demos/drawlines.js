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
const BILLBOARD_VERTICES_PER_POINT = 4
const LINES_FOLLOWING_MOUSE = 5
const LINES_BY_PATH = 10
// Keep resting trails non-degenerate so their dynamic buffers retain capacity.
const TOPOLOGY_EPSILON = 0.0001
const GREEN_PALETTE = [0x00FF88, 0x88FF00, 0x00AA44, 0x44FF88]
const force3 = new Vector3()
const pathPoint3 = new Vector3()
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const pointerNDC = new Vector2()

class DrawLinesExample {
	constructor() {
		this.text = ''
		this.paths = []
		this.activeStroke = null
		this.lines = []
		this.lineArrays = []
		this.meshline = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0
		this.timeScale = 1
		this.hasInteracted = false
		this.instructionElement = null
		this.instructionStyle = null
		this.instructionTimer = 0

		for ( let i = 0; i < NUM_LINES; i++ ) {
			const angle = random() * Math.PI * 2
			const radius = 0.2 + random( -0.3, 0.3 )
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
				speed: 0,
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
		this.createInstruction()

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
				return vec4( vertexColor.add( progress.smoothstep( 0.5, 1 ).mul( 0.2 ) ), 1 )
			} ) )

		this.meshline.build()

		const verticesPerLine = NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
		this.widthArray = new Float32Array( NUM_LINES * verticesPerLine )

		this.meshline.addVertexAttribute( 'lineColor', 3 )
		const colors = new Float32Array( NUM_LINES * verticesPerLine * 3 )
		for ( let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++ ) {
			const color = new Color( GREEN_PALETTE[lineIndex % GREEN_PALETTE.length] )
			const startVertex = lineIndex * verticesPerLine

			for ( let i = 0; i < verticesPerLine; i++ ) {
				color.toArray( colors, ( startVertex + i ) * 3 )
			}
		}

		this.meshline.setVertexValues( 'lineColor', colors )
		this.meshline.setVertexValues( 'width', this.widthArray )
		this.meshline.visible = false
		stage3d.add( this.meshline )
	}

	createInstruction() {
		this.instructionStyle = document.createElement( 'style' )
		this.instructionStyle.textContent = `
			.DrawLinesHint {
				position: fixed;
				top: calc(16px + var(--sait, 0px));
				left: calc(16px + var(--sail, 0px));
				z-index: 20;
				padding: 8px 11px;
				border: 1px solid rgba(118, 255, 178, .28);
				border-radius: 999px;
				background: rgba(3, 12, 8, .7);
				box-shadow: 0 8px 28px rgba(0, 0, 0, .28);
				backdrop-filter: blur(8px);
				font: 650 11px/1 system-ui, sans-serif;
				letter-spacing: .06em;
				text-transform: uppercase;
				color: rgba(224, 255, 235, .9);
				pointer-events: none;
				user-select: none;
				transition: opacity .24s ease, transform .24s ease;
			}
			@media (max-width: 600px) {
				.DrawLinesHint {
					top: calc(10px + var(--sait, 0px));
					left: calc(10px + var(--sail, 0px));
					font-size: 10px;
				}
			}
			@media (prefers-reduced-motion: reduce) {
				.DrawLinesHint { transition: none; }
			}
		`
		document.head.appendChild( this.instructionStyle )

		this.instructionElement = document.createElement( 'div' )
		this.instructionElement.className = 'DrawLinesHint'
		this.instructionElement.textContent = 'Drag anywhere to draw'
		document.body.appendChild( this.instructionElement )
	}

	dismissInstruction() {
		if ( !this.instructionElement ) return

		this.instructionElement.style.opacity = '0'
		this.instructionElement.style.transform = 'translateY(-4px)'
		window.clearTimeout( this.instructionTimer )
		this.instructionTimer = window.setTimeout( () => {
			this.instructionElement?.remove()
			this.instructionElement = null
		}, 260 )
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
						const force = force3.copy( line.target ).sub( line.points[k] ).multiplyScalar( line.spring * this.timeScale )
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
		this.meshline.setVertexValues( 'width', this.widthArray )
	}

	updateWidthArray( lineIndex, line ) {
		for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
			let width = getWidthFactor( pointIndex / ( NUM_POINTS - 1 ) ) * line.speed
			if ( line.pathTime > 0 ) {
				width *= smoothstep( 0, 100, line.pathTime )
			}

			const attributeIndex = ( lineIndex * NUM_POINTS + pointIndex ) * BILLBOARD_VERTICES_PER_POINT
			for ( let copyIndex = 0; copyIndex < BILLBOARD_VERTICES_PER_POINT; copyIndex++ ) {
				this.widthArray[attributeIndex + copyIndex] = width
			}
		}
	}

	updateFollowingLine( line ) {
		line.speed = MathUtils.lerp( line.speed, this.mouseSpeed, 0.15 )
		line.target.set( this.target.x, this.target.y, 0 ).add( line.offset )
	}

	updateLineOnPath( line, path, dt ) {
		const range = path.endTime - path.startTime
		line.pathTime += dt * this.timeScale
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
		if ( !this.hasInteracted ) {
			this.hasInteracted = true
			this.meshline.visible = true
			this.dismissInstruction()
		}
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
		window.clearTimeout( this.instructionTimer )
		this.instructionElement?.remove()
		this.instructionStyle?.remove()
		this.instructionElement = null
		this.instructionStyle = null
		
		stage3d.remove( this.meshline )
		stage3d.control.dispose()
		this.meshline?.dispose()
		this.meshline = null
	}

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
		const offset = i * 3
		positions[offset] = point.x - i * TOPOLOGY_EPSILON
		positions[offset + 1] = point.y
		positions[offset + 2] = point.z
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

export default DrawLinesExample

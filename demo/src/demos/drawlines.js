import { MeshLine } from 'makio-meshline'
import { attribute, Fn, mix, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { mouse, onDown, onMove, onUp } from '@/makio/utils/input/mouse'
import { smoothstep } from '@/makio/utils/math'
import random from '@/makio/utils/random'
import { createBloomPipeline } from '@/utils/bloomPipeline'

const NUM_POINTS = 32
// How strongly each trail point chases the one ahead: lower is a longer brush.
const TRAIL_FOLLOW = 0.34
const NUM_LINES = 1000
const BILLBOARD_VERTICES_PER_POINT = 4
const VERTICES_PER_LINE = NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
const LINES_FOLLOWING_MOUSE = 5
const LINES_BY_PATH = 10
const PREVIEW_POINT_COUNT = 120
const PREVIEW_PATH_DURATION = 5600
// Brush width: path bristles keep a base width and swell with speed.
const BRUSH_BASE = 0.05
const BRUSH_SPEED = 1.5
const BRUSH_MAX = 0.28
// Keep resting trails non-degenerate so their dynamic buffers retain capacity.
const TOPOLOGY_EPSILON = 0.0001
// Every stroke gets its own pair; its followers are spread between the two.
const STROKE_PALETTES = [
	[0x00FFA3, 0x36E6FF],
	[0xFF4FD8, 0xFFB86B],
	[0x7C9CFF, 0xD08CFF],
	[0xB7F34A, 0xFDE047],
	[0xFF6B8B, 0xFFD36B],
	[0x22D3EE, 0x818CF8],
]
const strokeColor = new Color()
const strokeColorEnd = new Color()
const force3 = new Vector3()
const pathPoint3 = new Vector3()
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const pointerNDC = new Vector2()

class DrawLinesExample {
	constructor() {
		this.text = ''
		this.paths = []
		this.activeLineCount = LINES_FOLLOWING_MOUSE
		this.activeWidthValues = null
		this.activeStroke = null
		this.lines = []
		this.lineArrays = []
		this.meshline = null
		this.bloom = null
		this.colorArray = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0
		// Strokes replay a little slower than they were drawn, which keeps fast
		// flicks smooth instead of jumping between frames.
		this.timeScale = 0.6
		this.hasInteracted = false
		this.hudElement = null
		this.clearButton = null
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
				positionRangeOptions: { lineIndex: i },
				offset,
				speed: 0,
				endFade: 1,
				finishing: false,
				target: new Vector3(),
				velocity: new Vector3(),
				spring: 0.06 + random( -0.02, 0.02 ),
				friction: 0.85 + random( -0.05, 0.05 ),
				pathTime: random( 0, 10000 ),
				justTeleported: false
			} )
			this.lineArrays.push( positions )
		}

		this.addPath( createPreviewPath() )
		this.seedPreviewFollowers()
	}

	async init() {
		await stage3d.initRender( { background: 0x03040B } )
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		this.createLine()
		this.bloom = createBloomPipeline( { strength: 0.7, radius: 0.4, threshold: 0.1 } )
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
			.dynamic( true )
			.needsWidth( true )
			// Bevel joins keep hairpin turns from spiking into long miters.
			.join( { type: 'bevel' } )
			.colorFn( Fn( ( [, progress] ) => {
				const vertexColor = attribute( 'lineColor', 'vec3' )
				const hot = mix( vec3( 1 ), vertexColor, progress.smoothstep( 0, 0.06 ) )
				// Additive blending: ten bristles stack, and fading to black is the tail.
				return vec4( hot.mul( progress.oneMinus().pow( 0.6 ).mul( 0.55 ) ), 1 )
			} ) )

		this.meshline.build()
		this.meshline.material.blending = AdditiveBlending
		this.meshline.material.depthWrite = false

		this.widthArray = new Float32Array( NUM_LINES * VERTICES_PER_LINE )
		for ( let lineIndex = 0; lineIndex < this.activeLineCount; lineIndex++ ) {
			this.updateWidthArray( lineIndex, this.lines[lineIndex] )
		}
		this.refreshActiveWidthValues()

		this.meshline.addVertexAttribute( 'lineColor', 3 )
		this.colorArray = new Float32Array( NUM_LINES * VERTICES_PER_LINE * 3 )
		for ( let lineIndex = 0; lineIndex < LINES_FOLLOWING_MOUSE; lineIndex++ ) {
			this.writeLineColor( lineIndex, STROKE_PALETTES[0], lineIndex / ( LINES_FOLLOWING_MOUSE - 1 ) )
		}
		for ( let pathIndex = 0; pathIndex < this.paths.length; pathIndex++ ) {
			this.writePathColors( pathIndex )
		}

		this.meshline.setVertexValues( 'lineColor', this.colorArray )
		// Zero the inactive capacity once; subsequent frames upload only the active prefix.
		this.meshline.setVertexValues( 'width', this.widthArray )
		stage3d.add( this.meshline )
	}

	createInstruction() {
		this.instructionStyle = document.createElement( 'style' )
		this.instructionStyle.textContent = `
			.DrawLinesHud {
				position: fixed;
				top: calc(18px + var(--sait, 0px));
				left: 50%;
				transform: translateX(-50%);
				z-index: 20;
				display: inline-flex;
				align-items: center;
				padding: 4px;
				border: 1px solid rgba(255, 255, 255, .12);
				border-radius: 999px;
				background: rgba(8, 12, 10, .72);
				box-shadow: 0 12px 30px rgba(0, 0, 0, .28);
				backdrop-filter: blur(14px);
				-webkit-backdrop-filter: blur(14px);
				user-select: none;
			}
			.DrawLinesClear {
				appearance: none;
				display: inline-flex;
				align-items: center;
				gap: 6px;
				min-height: 30px;
				padding: 0 12px;
				border: 1px solid rgba(118, 255, 178, .34);
				border-radius: 999px;
				background: rgba(118, 255, 178, .12);
				font: 650 11px/1 'Inter', system-ui, -apple-system, sans-serif;
				letter-spacing: .06em;
				text-transform: uppercase;
				color: rgba(232, 255, 242, .94);
				pointer-events: auto;
				cursor: pointer;
				transition: border-color .16s ease, background .16s ease, color .16s ease, transform .16s ease;
			}
			.DrawLinesClear::before {
				content: '';
				width: 6px;
				height: 6px;
				border-radius: 50%;
				background: #76ffb2;
				box-shadow: 0 0 8px #76ffb2;
			}
			.DrawLinesClear:hover,
			.DrawLinesClear:focus-visible {
				border-color: rgba(118, 255, 178, .68);
				background: rgba(118, 255, 178, .22);
				color: #ffffff;
				outline: none;
			}
			.DrawLinesClear:focus-visible {
				outline: 2px solid rgba(118, 255, 178, .85);
				outline-offset: 2px;
			}
			.DrawLinesClear:active {
				transform: scale(.97);
			}
			.DrawLinesHint {
				position: fixed;
				top: calc(18px + var(--sait, 0px));
				left: calc(18px + var(--sail, 0px));
				z-index: 20;
				display: inline-flex;
				align-items: center;
				gap: 8px;
				min-height: 36px;
				padding: 6px 14px;
				border: 1px solid rgba(255, 255, 255, .1);
				border-radius: 999px;
				background: rgba(8, 9, 12, .7);
				box-shadow: 0 12px 30px rgba(0, 0, 0, .28);
				backdrop-filter: blur(14px);
				-webkit-backdrop-filter: blur(14px);
				font: 600 10px/1.25 'Inter', system-ui, -apple-system, sans-serif;
				letter-spacing: .06em;
				text-transform: uppercase;
				color: rgba(244, 245, 247, .88);
				pointer-events: none;
				user-select: none;
				transition: opacity .24s ease, transform .24s ease;
			}
			.DrawLinesHint::before {
				content: '';
				width: 6px;
				height: 6px;
				border-radius: 50%;
				background: #76ffb2;
				box-shadow: 0 0 10px #76ffb2;
			}
			@media (max-width: 720px) {
				.DrawLinesHud {
					top: calc(12px + var(--sait, 0px));
					padding: 3px;
				}
				.DrawLinesClear {
					min-height: 27px;
					padding: 0 10px;
					font-size: 10px;
				}
				.DrawLinesHint {
					top: calc(58px + var(--sait, 0px));
					left: calc(12px + var(--sail, 0px));
					min-height: 30px;
					padding: 4px 11px;
					font-size: 9px;
				}
			}
			@media (prefers-reduced-motion: reduce) {
				.DrawLinesClear,
				.DrawLinesHint { transition: none; }
			}
		`
		document.head.appendChild( this.instructionStyle )

		this.hudElement = document.createElement( 'div' )
		this.hudElement.className = 'DrawLinesHud'

		this.clearButton = document.createElement( 'button' )
		this.clearButton.type = 'button'
		this.clearButton.className = 'DrawLinesClear'
		this.clearButton.textContent = 'Clean up'
		this.clearButton.setAttribute( 'aria-label', 'Clean up drawn lines' )
		this.clearButton.addEventListener( 'pointerdown', this.stopPointerPropagation )
		this.clearButton.addEventListener( 'click', this.onClearClick )

		this.instructionElement = document.createElement( 'div' )
		this.instructionElement.className = 'DrawLinesHint'
		this.instructionElement.textContent = 'Drag to add your own stroke'

		this.hudElement.append( this.clearButton )
		document.body.append( this.hudElement, this.instructionElement )
	}

	stopPointerPropagation = ( event ) => {
		event.stopPropagation()
	}

	onClearClick = ( event ) => {
		event.stopPropagation()
		this.clearLines()
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

		for ( let i = LINES_FOLLOWING_MOUSE; i < this.activeLineCount; i++ ) {
			const line = this.lines[i]
			const path = this.paths[Math.floor( ( i - LINES_FOLLOWING_MOUSE ) / LINES_BY_PATH )]
			this.updateLineOnPath( line, path, dt )
		}

		for ( let i = 0; i < this.activeLineCount; i++ ) {
			const line = this.lines[i]

			if ( line.justTeleported ) {
				line.justTeleported = false
			} else {
				for ( let k = NUM_POINTS - 1; k >= 0; k-- ) {
					if ( k === 0 ) {
						if ( line.finishing ) {
							line.velocity.set( 0, 0, 0 )
							line.points[k].lerp( line.target, TRAIL_FOLLOW )
						} else {
							const force = force3.copy( line.target ).sub( line.points[k] ).multiplyScalar( line.spring )
							line.velocity.add( force ).multiplyScalar( line.friction )
							line.points[k].add( line.velocity )
						}
					} else {
						line.points[k].lerp( line.points[k - 1], TRAIL_FOLLOW )
					}
				}
			}

			this.updateWidthArray( i, line )
			writePointsToArray( line.points, line.positions )
			this.meshline.setPositionRange( line.positions, 0, line.positionRangeOptions )
		}

		this.meshline.setVertexValues( 'width', this.activeWidthValues, 0 )
	}

	updateWidthArray( lineIndex, line ) {
		const isMouseFollower = lineIndex < LINES_FOLLOWING_MOUSE
		const strokeEnvelope = isMouseFollower
			? 1
			: smoothstep( 0, 260, line.pathTime ) * line.endFade

		for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
			const prevPoint = line.points[Math.max( 0, pointIndex - 1 )]
			const nextPoint = line.points[Math.min( NUM_POINTS - 1, pointIndex + 1 )]
			const spacingFade = smoothstep( 0.0008, 0.015, prevPoint.distanceTo( nextPoint ) )
			let width = lineIndex < LINES_FOLLOWING_MOUSE && !this.hasInteracted
				? 0
				: getWidthFactor( pointIndex / ( NUM_POINTS - 1 ) ) * Math.min( isMouseFollower ? line.speed * 1.6 : BRUSH_BASE + line.speed * BRUSH_SPEED, BRUSH_MAX )
			width *= strokeEnvelope * spacingFade

			const attributeIndex = ( lineIndex * NUM_POINTS + pointIndex ) * BILLBOARD_VERTICES_PER_POINT
			for ( let copyIndex = 0; copyIndex < BILLBOARD_VERTICES_PER_POINT; copyIndex++ ) {
				this.widthArray[attributeIndex + copyIndex] = width
			}
		}
	}

	updateFollowingLine( line ) {
		line.speed = MathUtils.lerp( line.speed, this.mouseSpeed, 0.15 )
		if ( this.mouseSpeed < 0.005 ) {
			line.velocity.multiplyScalar( 0.7 )
		}
		line.target.set( this.target.x, this.target.y, 0 ).add( line.offset )
	}

	updateLineOnPath( line, path, dt ) {
		const range = Math.max( 1, path.endTime - path.startTime )
		const stepDt = Number.isFinite( dt ) && dt > 0 ? dt : 16
		line.pathTime += stepDt * this.timeScale
		let percent = line.pathTime / range

		if ( line.pathTime >= range ) {
			line.finishing = true
			const endPoint = path.points[path.points.length - 1]
			// Each bristle rests at the end plus its own offset; measuring from the bare
			// end point left wide bristles waiting there forever.
			pathPoint3.set( endPoint.x, endPoint.y, 0 ).add( line.offset )
			const tailDistance = pathPoint3.distanceTo( line.points[line.points.length - 1] )
			const timeFade = 1 - smoothstep( range, range + 340, line.pathTime )
			const tailFade = smoothstep( 0.04, 0.45, tailDistance )
			line.endFade = Math.min( timeFade, tailFade )

			if ( tailDistance < 0.04 || line.endFade <= 0.001 ) {
				line.pathTime = 0
				line.speed = 0
				line.endFade = 0
				line.finishing = false
				line.justTeleported = true
				line.velocity.set( 0, 0, 0 )
				samplePathPoint( path, 0, pathPoint3 )
				line.target.set( pathPoint3.x, pathPoint3.y, 0 ).add( line.offset )

				for ( let i = 0; i < NUM_POINTS; i++ ) {
					line.points[i].copy( line.target )
				}
				return
			}
			percent = 1
		} else {
			line.finishing = false
			line.endFade = 1
		}

		samplePathPoint( path, percent, pathPoint3 )
		pathPoint3.add( line.offset )
		const moveX = line.target.x - pathPoint3.x
		const moveY = line.target.y - pathPoint3.y
		const speed = Math.sqrt( moveX ** 2 + moveY ** 2 ) * 0.5
		line.speed = MathUtils.lerp( line.speed, speed, 0.15 )
		line.target.copy( pathPoint3 )
	}

	addPath( path ) {
		this.paths.push( path )
		this.activeLineCount = Math.min(
			NUM_LINES,
			LINES_FOLLOWING_MOUSE + this.paths.length * LINES_BY_PATH
		)
		this.refreshActiveWidthValues()

		// Upload only the new stroke's followers: a contiguous block of vertices.
		const firstLine = this.writePathColors( this.paths.length - 1 )
		this.startPathFollowers( path, firstLine )
		if ( this.meshline && firstLine < NUM_LINES ) {
			const start = firstLine * VERTICES_PER_LINE
			const end = Math.min( firstLine + LINES_BY_PATH, NUM_LINES ) * VERTICES_PER_LINE
			this.meshline.setVertexValues( 'lineColor', this.colorArray.subarray( start * 3, end * 3 ), start )
		}
	}

	// New bristles start writing from the first point of their stroke instead of
	// dashing there from wherever their idle buffers left them.
	startPathFollowers( path, firstLine ) {
		if ( !this.meshline ) return
		const start = path.points[0]
		for ( let lineIndex = firstLine; lineIndex < Math.min( firstLine + LINES_BY_PATH, NUM_LINES ); lineIndex++ ) {
			const line = this.lines[lineIndex]
			line.pathTime = 0
			line.speed = 0
			line.endFade = 0
			line.finishing = false
			line.velocity.set( 0, 0, 0 )
			line.justTeleported = true
			line.target.set( start.x, start.y, 0 ).add( line.offset )
			for ( const point of line.points ) point.copy( line.target )
			writePointsToArray( line.points, line.positions )
		}
	}

	writePathColors( pathIndex ) {
		const firstLine = LINES_FOLLOWING_MOUSE + pathIndex * LINES_BY_PATH
		const palette = STROKE_PALETTES[pathIndex % STROKE_PALETTES.length]
		for ( let follower = 0; follower < LINES_BY_PATH && firstLine + follower < NUM_LINES; follower++ ) {
			this.writeLineColor( firstLine + follower, palette, follower / ( LINES_BY_PATH - 1 ) )
		}
		return firstLine
	}

	writeLineColor( lineIndex, palette, mixValue ) {
		if ( !this.colorArray ) return
		strokeColor.setHex( palette[0] ).lerp( strokeColorEnd.setHex( palette[1] ), mixValue )
		const startVertex = lineIndex * VERTICES_PER_LINE
		for ( let i = 0; i < VERTICES_PER_LINE; i++ ) {
			strokeColor.toArray( this.colorArray, ( startVertex + i ) * 3 )
		}
	}

	refreshActiveWidthValues() {
		if ( !this.widthArray ) return
		this.activeWidthValues = this.widthArray.subarray( 0, this.activeLineCount * VERTICES_PER_LINE )
		const index = this.meshline?.geometry?.getIndex()
		if ( !index ) return
		// Every line has the same point count, so each owns an equal slice of the
		// index buffer; billboard joins make that more than six indices per segment.
		this.meshline.geometry.setDrawRange( 0, this.activeLineCount * ( index.count / NUM_LINES ) )
	}

	seedPreviewFollowers() {
		const path = this.paths[0]
		const range = path.endTime - path.startTime

		for ( let followerIndex = 0; followerIndex < LINES_BY_PATH; followerIndex++ ) {
			const line = this.lines[LINES_FOLLOWING_MOUSE + followerIndex]
			const angle = followerIndex / LINES_BY_PATH * Math.PI * 2
			const radius = 0.08 + followerIndex % 3 * 0.05
			const phase = 0.1 + followerIndex / LINES_BY_PATH * 0.8
			line.offset.set( Math.cos( angle ) * radius, Math.sin( angle ) * radius, 0 )
			line.spring = 0.055 + followerIndex * 0.001
			line.friction = 0.88
			line.pathTime = phase * range
			line.speed = 0.22 + followerIndex % 4 * 0.03
			line.velocity.set( 0, 0, 0 )

			samplePathPoint( path, phase, pathPoint3 )
			line.target.set( pathPoint3.x, pathPoint3.y, 0 ).add( line.offset )
			for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
				const trailProgress = Math.max( 0, phase - pointIndex / ( NUM_POINTS - 1 ) * 0.18 )
				samplePathPoint( path, trailProgress, pathPoint3 )
				line.points[pointIndex].set(
					pathPoint3.x + line.offset.x,
					pathPoint3.y + line.offset.y,
					0
				)
			}
			writePointsToArray( line.points, line.positions )
		}
	}

	seedPointerFollowers() {
		for ( let lineIndex = 0; lineIndex < LINES_FOLLOWING_MOUSE; lineIndex++ ) {
			const line = this.lines[lineIndex]
			line.speed = 0
			line.target.copy( this.target ).add( line.offset )
			line.velocity.set( 0, 0, 0 )
			for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
				line.points[pointIndex].copy( line.target )
			}
			writePointsToArray( line.points, line.positions )
		}
	}

	clearLines = () => {
		const previousActiveLineCount = this.activeLineCount
		this.paths.length = 0
		this.activeStroke = null
		this.activeLineCount = LINES_FOLLOWING_MOUSE
		this.mouseSpeed = 0

		this.seedPointerFollowers()
		for ( let lineIndex = 0; lineIndex < LINES_FOLLOWING_MOUSE; lineIndex++ ) {
			const line = this.lines[lineIndex]
			this.meshline?.setPositionRange( line.positions, 0, line.positionRangeOptions )
		}

		if ( this.widthArray ) {
			this.widthArray.fill( 0, 0, previousActiveLineCount * VERTICES_PER_LINE )
		}
		this.refreshActiveWidthValues()
		if ( this.meshline && this.activeWidthValues ) {
			this.meshline.setVertexValues( 'width', this.activeWidthValues, 0 )
		}
	}

	onDown = ( mouseData ) => {
		this.updateTarget( mouseData )
		if ( !this.hasInteracted ) {
			this.hasInteracted = true
			this.seedPointerFollowers()
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
			retimeFastStroke( this.activeStroke )
			this.addPath( {
				points: this.activeStroke,
				startTime: this.activeStroke[0].time,
				endTime: this.activeStroke[this.activeStroke.length - 1].time
			} )
		}
		this.activeStroke = null
	}

	updateTarget( mouseData = mouse ) {
		if ( !mouseData ) return
		const nx = Number.isFinite( mouseData.normalizedX ) ? mouseData.normalizedX : 0
		const ny = Number.isFinite( mouseData.normalizedY ) ? mouseData.normalizedY : 0
		pointerNDC.set( nx, -ny )
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
		this.clearButton?.removeEventListener( 'pointerdown', this.stopPointerPropagation )
		this.clearButton?.removeEventListener( 'click', this.onClearClick )
		this.hudElement?.remove()
		this.instructionElement?.remove()
		this.instructionStyle?.remove()
		this.hudElement = null
		this.clearButton = null
		this.instructionElement = null
		this.instructionStyle = null
		this.bloom?.dispose()
		this.bloom = null

		stage3d.remove( this.meshline )
		stage3d.control?.dispose()
		this.meshline?.dispose()
		this.meshline = null
	}

}

// Point 0 leads: a short rounded head, then a brush-like taper to the tail.
function getWidthFactor( t ) {
	const head = Math.sqrt( Math.min( t / 0.08, 1 ) )
	return head * ( 1 - t ) ** 0.9
}

// A flick can arrive as a couple of samples with almost no elapsed time; give it
// a plausible duration from its length so the followers can still replay it.
function retimeFastStroke( stroke ) {
	const duration = stroke[stroke.length - 1].time - stroke[0].time
	if ( duration >= 120 ) return
	let distance = 0
	for ( let i = 1; i < stroke.length; i++ ) {
		distance += Math.hypot( stroke[i].x - stroke[i - 1].x, stroke[i].y - stroke[i - 1].y )
		stroke[i].time = stroke[0].time + distance * 90
	}
}

function writePointsToArray( points, positions ) {
	for ( let i = 0; i < NUM_POINTS; i++ ) {
		const point = points[i]
		const offset = i * 3
		positions[offset] = point.x - i * TOPOLOGY_EPSILON
		positions[offset + 1] = point.y
		positions[offset + 2] = point.z
		// A trail drifting left closes its x gap through exactly the epsilon, and
		// Float32 rounding can then fold this point onto the previous one.
		if (
			i > 0 &&
			positions[offset] === positions[offset - 3] &&
			positions[offset + 1] === positions[offset - 2] &&
			positions[offset + 2] === positions[offset - 1]
		) {
			positions[offset] -= TOPOLOGY_EPSILON
		}
	}
}

function createPreviewPath() {
	// A cursive flourish: loops written left to right, like a signature.
	const points = Array.from( { length: PREVIEW_POINT_COUNT }, ( _, index ) => {
		const progress = index / ( PREVIEW_POINT_COUNT - 1 )
		const loops = progress * Math.PI * 2 * 3.5
		return {
			x: ( progress - 0.5 ) * 7.6 - Math.sin( loops ) * 0.9,
			y: Math.cos( loops ) * 1.15 + Math.sin( progress * Math.PI * 2 ) * 0.45,
			time: progress * PREVIEW_PATH_DURATION,
		}
	} )

	return {
		points,
		startTime: points[0].time,
		endTime: points[points.length - 1].time,
	}
}

function samplePathPoint( path, percent, target ) {
	const { points, startTime, endTime } = path
	const targetTime = startTime + ( endTime - startTime ) * percent
	let low = 0
	let high = points.length - 2

	while ( low <= high ) {
		const mid = ( low + high ) >>> 1
		if ( targetTime < points[mid].time ) {
			high = mid - 1
		} else if ( targetTime > points[mid + 1].time ) {
			low = mid + 1
		} else {
			low = mid
			break
		}
	}

	const index = Math.max( 0, Math.min( points.length - 2, low ) )
	const pointA = points[index]
	const pointB = points[index + 1]

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

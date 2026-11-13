/**
 * Draw Lines — interactive brush-trail ribbon with partial vertex and position uploads.
 * Demonstrates: .dynamic( true ), .needsWidth( true ), .join( { type: 'bevel' } ),
 * .setPositionRange( points, 0, { lineIndex } ), .setVertexValues( 'width', slice ),
 * and geometry.setDrawRange() to draw only the lines in use.
 */
import { MeshLine } from 'makio-meshline'
import { attribute, Fn, mix, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { mouse, onDown, onMove, onUp } from '@/makio/utils/input/mouse'
import { smoothstep } from '@/makio/utils/math'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoControls } from '@/utils/demoControls'
import { createDemoHint } from '@/utils/demoHint'
import {
	advanceTrail,
	collapseLine,
	createLineState,
	NUM_POINTS,
	restartLine,
	seedPreviewFollowers,
	updateLineOnPath,
	updateLineOnPointer,
	writePointsToArray,
} from '@/utils/drawlinesBristles'
import { addStrokePoint, createPreviewPath, createStrokePath } from '@/utils/drawlinesStrokes'
import { times } from '@/utils/points'

const ACCENT = '#76ffb2'
const NUM_LINES = 1000
const BILLBOARD_VERTICES_PER_POINT = 4
const VERTICES_PER_LINE = NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
const LINES_FOLLOWING_MOUSE = 5
const LINES_BY_PATH = 10
// Brush width: path bristles keep a base width and swell with speed.
const BRUSH_BASE = 0.05
const BRUSH_SPEED = 1.5
const BRUSH_MAX = 0.28
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
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const pointerNDC = new Vector2()
const raycaster = new Raycaster()

export default class DrawLinesExample {
	lines = times( NUM_LINES, createLineState )
	paths = [createPreviewPath()]
	activeLineCount = LINES_FOLLOWING_MOUSE + LINES_BY_PATH
	widthArray = new Float32Array( NUM_LINES * VERTICES_PER_LINE )
	colorArray = new Float32Array( NUM_LINES * VERTICES_PER_LINE * 3 )
	target = new Vector3()
	mouseSpeed = 0
	hasInteracted = false

	async init() {
		await stage3d.initRender( { background: 0x03040B } )
		stage3d.camera.position.z = 12
		// A press can land before the first frame, and raycasts read the world matrix.
		stage3d.camera.updateMatrixWorld()

		seedPreviewFollowers( this.lines.slice( LINES_FOLLOWING_MOUSE, this.activeLineCount ), this.paths[0] )
		this.createLine()
		createBloomPipeline( { strength: 0.7, radius: 0.4, threshold: 0.1 } )

		createDemoControls( [{ id: 'clear', label: 'Clean up', ariaLabel: 'Clean up drawn lines', onClick: this.clearLines }], { accent: ACCENT } )
		this.hint = createDemoHint( 'Drag to add your own stroke', { accent: ACCENT, hideAfter: 0 } )

		stage3d.listen( onDown, this.onDown )
		stage3d.listen( onMove, this.onMouseMove )
		stage3d.listen( onUp, this.onUp )
	}

	createLine() {
		this.meshline = new MeshLine()
			.lines( this.lines.map( line => line.positions ) )
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
			.autoResize()
			.build()

		this.meshline.material.blending = AdditiveBlending
		this.meshline.material.depthWrite = false
		this.applyActiveLineCount()

		this.meshline.addVertexAttribute( 'lineColor', 3 )
		this.writeLineColors( 0, LINES_FOLLOWING_MOUSE, STROKE_PALETTES[0] )
		this.writeLineColors( LINES_FOLLOWING_MOUSE, LINES_BY_PATH, STROKE_PALETTES[0] )

		this.meshline.setVertexValues( 'lineColor', this.colorArray )
		// Zero the inactive capacity once; subsequent frames upload only the active prefix.
		this.meshline.setVertexValues( 'width', this.widthArray )
		stage3d.add( this.meshline )
	}

	update = ( dt ) => {
		const nextMouseSpeed = Math.hypot( mouse.moveX, mouse.moveY ) / ( dt / 16 || 1 ) * 0.01
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, nextMouseSpeed, 0.15 )

		// The mouse trails have no width until the first press: skip moving them and uploading their points.
		const firstLine = this.hasInteracted ? 0 : LINES_FOLLOWING_MOUSE

		for ( let i = firstLine; i < LINES_FOLLOWING_MOUSE; i++ ) {
			updateLineOnPointer( this.lines[i], this.target, this.mouseSpeed )
		}

		for ( let i = LINES_FOLLOWING_MOUSE; i < this.activeLineCount; i++ ) {
			const path = this.paths[Math.floor( ( i - LINES_FOLLOWING_MOUSE ) / LINES_BY_PATH )]
			updateLineOnPath( this.lines[i], path, dt )
		}

		for ( let i = firstLine; i < this.activeLineCount; i++ ) {
			const line = this.lines[i]
			advanceTrail( line )
			this.updateWidthArray( i, line )
			writePointsToArray( line.points, line.positions )
			this.meshline.setPositionRange( line.positions, 0, line.positionRangeOptions )
		}

		this.meshline.setVertexValues( 'width', this.activeWidthValues, 0 )
	}

	updateWidthArray( lineIndex, line ) {
		const isMouseFollower = lineIndex < LINES_FOLLOWING_MOUSE
		const envelope = isMouseFollower ? 1 : smoothstep( 0, 260, line.pathTime ) * line.endFade
		const brush = Math.min( isMouseFollower ? line.speed * 1.6 : BRUSH_BASE + line.speed * BRUSH_SPEED, BRUSH_MAX )

		for ( let pointIndex = 0; pointIndex < NUM_POINTS; pointIndex++ ) {
			const prevPoint = line.points[Math.max( 0, pointIndex - 1 )]
			const nextPoint = line.points[Math.min( NUM_POINTS - 1, pointIndex + 1 )]
			const spacingFade = smoothstep( 0.0008, 0.015, prevPoint.distanceTo( nextPoint ) )
			const width = getWidthFactor( pointIndex / ( NUM_POINTS - 1 ) ) * brush * envelope * spacingFade

			const attributeIndex = ( lineIndex * NUM_POINTS + pointIndex ) * BILLBOARD_VERTICES_PER_POINT
			for ( let copy = 0; copy < BILLBOARD_VERTICES_PER_POINT; copy++ ) this.widthArray[attributeIndex + copy] = width
		}
	}

	addPath( path ) {
		const firstLine = this.activeLineCount
		if ( firstLine === NUM_LINES ) return

		this.writeLineColors( firstLine, LINES_BY_PATH, STROKE_PALETTES[this.paths.length % STROKE_PALETTES.length] )
		this.paths.push( path )
		this.activeLineCount = Math.min( NUM_LINES, firstLine + LINES_BY_PATH )
		this.applyActiveLineCount()

		// New bristles start writing from the first point of their stroke instead of
		// dashing there from wherever their idle buffers left them.
		for ( let lineIndex = firstLine; lineIndex < this.activeLineCount; lineIndex++ ) {
			restartLine( this.lines[lineIndex], path.points[0] )
		}

		// Upload only the new stroke's followers: a contiguous block of vertices.
		const start = firstLine * VERTICES_PER_LINE
		const end = this.activeLineCount * VERTICES_PER_LINE
		this.meshline.setVertexValues( 'lineColor', this.colorArray.subarray( start * 3, end * 3 ), start )
	}

	writeLineColors( firstLine, count, palette ) {
		for ( let index = 0; index < count && firstLine + index < NUM_LINES; index++ ) {
			strokeColor.setHex( palette[0] ).lerp( strokeColorEnd.setHex( palette[1] ), index / ( count - 1 ) )
			const startVertex = ( firstLine + index ) * VERTICES_PER_LINE
			for ( let i = 0; i < VERTICES_PER_LINE; i++ ) strokeColor.toArray( this.colorArray, ( startVertex + i ) * 3 )
		}
	}

	applyActiveLineCount() {
		this.activeWidthValues = this.widthArray.subarray( 0, this.activeLineCount * VERTICES_PER_LINE )
		const { geometry } = this.meshline
		// Every line has the same point count, so each owns an equal slice of the
		// index buffer; billboard joins make that more than six indices per segment.
		geometry.setDrawRange( 0, this.activeLineCount * ( geometry.getIndex().count / NUM_LINES ) )
	}

	// Gather the mouse trails under the pointer, so they never streak in from where they rested.
	seedPointerFollowers() {
		for ( let i = 0; i < LINES_FOLLOWING_MOUSE; i++ ) collapseLine( this.lines[i], this.target )
	}

	clearLines = () => {
		this.paths.length = 0
		this.activeStroke = null
		this.activeLineCount = LINES_FOLLOWING_MOUSE
		this.mouseSpeed = 0

		this.seedPointerFollowers()
		this.applyActiveLineCount()
	}

	onDown = () => {
		this.updateTarget()
		if ( !this.hasInteracted ) {
			this.hasInteracted = true
			this.seedPointerFollowers()
			this.hint.hide()
		}
		this.activeStroke = []
		addStrokePoint( this.activeStroke, this.target )
	}

	onMouseMove = () => {
		this.updateTarget()
		if ( mouse.isDown && this.activeStroke ) addStrokePoint( this.activeStroke, this.target )
	}

	onUp = () => {
		if ( this.activeStroke?.length > 1 ) this.addPath( createStrokePath( this.activeStroke ) )
		this.activeStroke = null
	}

	updateTarget() {
		pointerNDC.set( mouse.normalizedX, -mouse.normalizedY )
		raycaster.setFromCamera( pointerNDC, stage3d.camera )
		raycaster.ray.intersectPlane( interactionPlane, this.target )
	}
}

// Point 0 leads: a short rounded head, then a brush-like taper to the tail.
function getWidthFactor( t ) {
	const head = Math.sqrt( Math.min( t / 0.08, 1 ) )
	return head * ( 1 - t ) ** 0.9
}

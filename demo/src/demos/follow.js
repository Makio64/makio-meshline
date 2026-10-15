import { MeshLine } from 'makio-meshline'
import { attribute, color, float, Fn, mix, smoothstep, uv, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { isMobile } from '@/makio/utils/detect'
import { mouse, onMove } from '@/makio/utils/input/mouse'
import random from '@/makio/utils/random'
import { createBloomPipeline } from '@/utils/bloomPipeline'

const NUM_POINTS = 64
const NUM_LINES = 14
const BILLBOARD_VERTICES_PER_POINT = 4
// Keep a resting trail non-degenerate so its dynamic buffers retain capacity.
const TOPOLOGY_EPSILON = 0.0001
const AURORA_PALETTE = [0x00FFB2, 0x36E6FF, 0x7C9CFF, 0xC084FC, 0x5BFFD0, 0x9DFF5B, 0x22D3EE]
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const pointerNDC = new Vector2()
const targetOffset = new Vector3()
const force3 = new Vector3()

class FollowExample {
	constructor() {
		this.text = ''
		this.lines = []
		this.lineArrays = []
		this.line = null
		this.bloom = null
		this.target = new Vector3()
		this.raycaster = new Raycaster()
		this.mouseSpeed = 0
		this.currentLineWidth = 0.05
		this.hasInteracted = false
		this.pointerActiveUntil = 0
		this.time = 0
		this.autoAmplitudeX = 4.2
		this.autoAmplitudeY = 2.4
		this.motionQuery = window.matchMedia( '(prefers-reduced-motion: reduce)' )
		this.reducedMotion = this.motionQuery.matches
		this.instructionElement = null
		this.instructionStyle = null
		this.instructionTimer = 0

		for ( let index = 0; index < NUM_LINES; index++ ) {
			const angle = index / NUM_LINES * Math.PI * 2
			const points = Array.from( { length: NUM_POINTS }, ( _, pointIndex ) => {
				const progress = pointIndex / ( NUM_POINTS - 1 )
				return new Vector3(
					( progress - 0.5 ) * 3.6,
					Math.sin( progress * Math.PI ) * 0.5,
					0
				)
			} )
			const positions = new Float32Array( NUM_POINTS * 3 )

			writePointsToArray( points, positions )

			// Each trail orbits the leader on its own radius and spin, so the bundle
			// braids into a rope of light instead of a single smeared stroke.
			this.lines.push( {
				points,
				positions,
				angle,
				orbitRadius: 0.28 + random( 0, 0.5 ),
				orbitSpeed: random( 1.1, 2.2 ) * ( index % 2 ? 1 : -1 ),
				phase: random( 0, Math.PI * 2 ),
				offset: new Vector3(),
				velocity: new Vector3(),
				spring: 0.06 + random( -0.02, 0.02 ),
				friction: 0.85 + random( -0.05, 0.05 )
			} )
			this.lineArrays.push( positions )
		}
	}

	async init() {
		await stage3d.initRender( { background: 0x01040A } )
		stage3d.control = new OrbitControl( stage3d.camera, 12 )
		stage3d.control.disable()
		this.updateAutoBounds()
		this.createBackground()
		this.createLine()
		this.bloom = createBloomPipeline( { strength: 0.75, radius: 0.45, threshold: 0.12 } )
		this.createInstruction()

		onMove.add( this.onMouseMove )
		if ( this.motionQuery.addEventListener ) this.motionQuery.addEventListener( 'change', this.onMotionPreferenceChange )
		else this.motionQuery.addListener?.( this.onMotionPreferenceChange )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createBackground() {
		stage3d.scene.backgroundNode = Fn( () => {
			const glow = float( 1 ).sub( smoothstep( 0.1, 0.9, uv().sub( 0.5 ).length() ) )
			return vec4( mix( color( 0x010208 ), color( 0x061226 ), glow ), 1 )
		} )()
	}

	createLine() {
		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 0.05 )
			.dynamic( true )
			// Bevel joins keep fast, tight turns from spiking into long miters.
			.join( { type: 'bevel' } )
			// Point 0 leads: a short rounded head, then a long fading tail.
			.widthCallback( ( t ) => {
				const head = Math.sqrt( Math.min( t / 0.05, 1 ) )
				return Math.max( head * ( 1 - t ) ** 1.25, 0.02 )
			} )
			.colorFn( Fn( ( [, progress] ) => {
				const lineColor = attribute( 'lineColor', 'vec3' )
				const hot = mix( vec3( 1 ), lineColor, smoothstep( 0, 0.08, progress ) )
				// Additive blending: fading to black is the transparency.
				return vec4( hot.mul( progress.oneMinus().pow( 0.9 ).mul( 0.85 ) ), 1 )
			} ) )

		this.line.build()
		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false

		this.line.addVertexAttribute( 'lineColor', 3 )
		const verticesPerLine = NUM_POINTS * BILLBOARD_VERTICES_PER_POINT
		const colors = new Float32Array( NUM_LINES * verticesPerLine * 3 )
		for ( let lineIndex = 0; lineIndex < NUM_LINES; lineIndex++ ) {
			const color = new Color( AURORA_PALETTE[lineIndex % AURORA_PALETTE.length] )
			const startVertex = lineIndex * verticesPerLine

			for ( let i = 0; i < verticesPerLine; i++ ) {
				color.toArray( colors, ( startVertex + i ) * 3 )
			}
		}

		this.line.setVertexValues( 'lineColor', colors )
		stage3d.add( this.line )
	}

	createInstruction() {
		this.instructionStyle = document.createElement( 'style' )
		this.instructionStyle.textContent = `
			.FollowHint {
				position: fixed;
				left: calc(16px + var(--sail, 0px));
				top: calc(16px + var(--sait, 0px));
				z-index: 20;
				padding: 8px 11px;
				border: 1px solid rgba(118, 255, 178, .25);
				border-radius: 999px;
				background: rgba(3, 15, 11, .68);
				box-shadow: 0 10px 30px rgba(0, 0, 0, .26);
				backdrop-filter: blur(8px);
				color: rgba(225, 255, 237, .9);
				font: 650 10px/1 system-ui, sans-serif;
				letter-spacing: .07em;
				text-transform: uppercase;
				pointer-events: none;
				user-select: none;
				transition: opacity .24s ease, transform .24s ease;
			}
			.FollowHint::before {
				content: '';
				display: inline-block;
				width: 6px;
				height: 6px;
				margin-right: 8px;
				border-radius: 50%;
				background: #76ffb2;
				box-shadow: 0 0 10px rgba(118, 255, 178, .65);
				vertical-align: 1px;
			}
			@media (max-width: 600px) {
				.FollowHint { left: calc(10px + var(--sail, 0px)); top: calc(10px + var(--sait, 0px)); font-size: 9px; }
			}
			@media (prefers-reduced-motion: reduce) { .FollowHint { transition: none; } }
		`
		document.head.appendChild( this.instructionStyle )

		this.instructionElement = document.createElement( 'div' )
		this.instructionElement.className = 'FollowHint'
		this.instructionElement.textContent = isMobile
			? 'Touch and move · speed controls width'
			: 'Move to lead · speed controls width'
		document.body.appendChild( this.instructionElement )
		this.instructionTimer = window.setTimeout( this.dismissInstruction, 7000 )
	}

	dismissInstruction = () => {
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
		const frameScale = Math.min( dt, 100 ) / 16.67
		const follow = 1 - Math.pow( 1 - 0.26, frameScale )
		this.time += Math.min( dt, 100 ) * 0.001
		const pointerActive = performance.now() < this.pointerActiveUntil
		if ( this.reducedMotion && !pointerActive ) return
		// Autopilot traces a slow figure eight until the visitor takes over.
		if ( !pointerActive ) {
			this.target.set(
				Math.sin( this.time * 0.9 ) * this.autoAmplitudeX,
				Math.sin( this.time * 1.8 ) * this.autoAmplitudeY,
				0
			)
		}

		this.lines.forEach( line => {
			const orbit = line.angle + this.time * line.orbitSpeed
			const radius = line.orbitRadius * ( 0.65 + Math.sin( this.time * 0.8 + line.phase ) * 0.35 )
			line.offset.set( Math.cos( orbit ) * radius, Math.sin( orbit ) * radius, Math.sin( orbit * 0.5 + line.phase ) * 0.4 )

			for ( let i = NUM_POINTS - 1; i >= 0; i-- ) {
				if ( i === 0 ) {
					targetOffset.copy( this.target ).add( line.offset )
					force3.copy( targetOffset ).sub( line.points[i] ).multiplyScalar( line.spring * frameScale )
					line.velocity.add( force3 ).multiplyScalar( Math.pow( line.friction, frameScale ) )
					line.points[i].addScaledVector( line.velocity, frameScale )
				} else {
					line.points[i].lerp( line.points[i - 1], follow )
				}
			}

			writePointsToArray( line.points, line.positions )
		} )

		this.line.setPositions( this.lineArrays )

		const speed = pointerActive
			? Math.sqrt( mouse.moveX ** 2 + mouse.moveY ** 2 ) / ( dt / 16 || 1 ) * 0.003
			: 0.045 + Math.sin( this.time * 0.9 ) ** 2 * 0.04
		const smoothing = 1 - Math.pow( 1 - 0.15, frameScale )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, speed, smoothing )
		this.currentLineWidth = MathUtils.lerp(
			this.currentLineWidth,
			MathUtils.clamp( this.mouseSpeed, 0.035, 0.2 ),
			smoothing
		)
		this.line.lineWidth( this.currentLineWidth )
	}

	onMouseMove = ( mouseData ) => {
		this.pointerActiveUntil = performance.now() + 1800
		if ( !this.hasInteracted ) {
			this.hasInteracted = true
			this.dismissInstruction()
		}
		pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.raycaster.setFromCamera( pointerNDC, stage3d.camera )

		if ( this.raycaster.ray.intersectPlane( interactionPlane, this.target ) === null ) {
			const { origin, direction } = this.raycaster.ray
			this.target.copy( origin ).addScaledVector( direction, 10 )
		}
	}

	onResize = () => {
		this.line?.resize()
		this.updateAutoBounds()
	}

	updateAutoBounds() {
		const distance = stage3d.camera.position.length()
		const halfHeight = Math.tan( stage3d.camera.fov * Math.PI / 360 ) * distance
		const halfWidth = halfHeight * stage3d.camera.aspect
		this.autoAmplitudeX = Math.min( 4.2, halfWidth * 0.72 )
		this.autoAmplitudeY = Math.min( 2.4, halfHeight * 0.5 )
	}

	onMotionPreferenceChange = ( event ) => {
		this.reducedMotion = event.matches
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		onMove.remove( this.onMouseMove )
		if ( this.motionQuery.removeEventListener ) this.motionQuery.removeEventListener( 'change', this.onMotionPreferenceChange )
		else this.motionQuery.removeListener?.( this.onMotionPreferenceChange )
		window.clearTimeout( this.instructionTimer )
		this.instructionElement?.remove()
		this.instructionStyle?.remove()
		this.bloom?.dispose()
		this.bloom = null
		stage3d.scene.backgroundNode = null
		stage3d.remove( this.line )
		stage3d.control?.dispose()
		this.line?.dispose()
		this.line = null
		this.instructionElement = null
		this.instructionStyle = null
	}

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

export default FollowExample

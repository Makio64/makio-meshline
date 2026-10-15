import { MeshLine } from 'makio-meshline'
import { abs, clamp, cos, float, floor, Fn, instanceIndex, length, Loop, max, min, mix, sin, smoothstep, storage, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Plane, Raycaster, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { onClick, onDown, onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'

const ROPE_COUNT = 28
const POINTS_PER_ROPE = 44
const TOTAL_POINTS = ROPE_COUNT * POINTS_PER_ROPE

const ANCHOR_SPAN = 18.5
const ANCHOR_Y = 5.55
// Every rope hangs clear of the floor: anything longer than the drop piles up
// and crumples into zigzags at the tips.
const SHORTEST_ROPE = 4.6
const LONGEST_ROPE = 8.4
const FLOOR_Y = -5.15

const FIXED_DT = 1 / 120
const MAX_SIMULATION_STEPS = 6
const VELOCITY_DAMPING = 0.994
const GRAVITY = -18
const CONSTRAINT_STIFFNESS = 0.94
const MIN_BEND_RATIO = 1.25
const BEND_STIFFNESS = 0.35
const CONSTRAINT_ITERATIONS = 8
const WIND_ACCELERATION = 1.2

const POINTER_FORCE_RADIUS = 2.4
const POINTER_COLLIDER_RADIUS = 0.8
const GRAB_RADIUS = 1.8
const HOVER_ACCELERATION = 110
const GRAB_ACCELERATION = 240
const SWISH_ACCELERATION = 6
const GRAB_PROJECTION = 0.02
const PLUCK_RADIUS = 2.2
const PLUCK_ACCELERATION = 180
const PLUCK_DECAY = 16
const POINTER_VELOCITY_DECAY = 7
const MAX_POINTER_SPEED = 24

const FLOOR_FRICTION = 0.03
// Thin glowing fibers that swell into a bead at the very tip.
const FIBER_WIDTH = 0.45
const BEAD_SWELL = 1.9

const _pointerNDC = new Vector2()
const _pointerWorld = new Vector3()
const _pointerVelocityTarget = new Vector3()
const _interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )

// Lengths follow a soft swag across the curtain with a small ripple, so the
// beads at the tips draw a wave.
function getRestLength( ropeIndex ) {
	const ratio = ropeIndex / ( ROPE_COUNT - 1 )
	const swag = Math.sin( ratio * Math.PI ) ** 1.4
	const ripple = Math.sin( ( ropeIndex + 0.5 ) * 1.73 ) * 0.22
	const length = SHORTEST_ROPE + ( LONGEST_ROPE - SHORTEST_ROPE ) * swag + ripple
	return length / ( POINTS_PER_ROPE - 1 )
}

function beadWidth( progress ) {
	const swell = smoothstepValue( 0.93, 0.975, progress ) * ( 1 - smoothstepValue( 0.985, 1, progress ) )
	return FIBER_WIDTH + swell * BEAD_SWELL
}

function smoothstepValue( edge0, edge1, value ) {
	const t = Math.max( 0, Math.min( 1, ( value - edge0 ) / ( edge1 - edge0 ) ) )
	return t * t * ( 3 - 2 * t )
}

class VerletRopesExample {
	constructor() {
		this.line = null
		this.rail = null
		this.bloom = null
		this.control = null
		this.positionBuffer = null
		this.prevBuffer = null
		this.ropeDataBuffer = null
		this.computeNode = null
		this.cpuPositions = null
		this.cpuPrevious = null
		this.cpuLines = null
		this.cpuColors = null
		this.ropeData = null
		this.isGpuSimulation = false
		this.uTime = uniform( 0 )
		this.uPointer = uniform( new Vector3() )
		this.uPointerVelocity = uniform( new Vector3() )
		this.uPointerActive = uniform( 0 )
		this.uGrab = uniform( 0 )
		this.uPluck = uniform( 0 )
		this.raycaster = new Raycaster()
		this.lastPointerWorld = new Vector3()
		this.lastPointerTime = 0
		this.hasPointerPosition = false
		this.accumulator = 0
		this.instructionStyle = null
		this.instructionElement = null
		this.instructionTimer = null
		this.pluckRipples = new Set()
	}

	async init() {
		await stage3d.initRender( { background: 0x050817 } )

		this.control = new OrbitControl( stage3d.camera, 16 )
		this.control._phi = Math.PI * 0.5
		this.control._theta = Math.PI * 0.5
		this.control.target.y = 0.2
		this.control.minRadius = 11
		this.control.maxRadius = 24
		this.control.blockThetaMouse = true
		this.control.blockPhiMouse = true
		this.control.blockPan = true
		this.control.extraThetaMouse = false
		this.control.extraPhiMouse = false
		stage3d.control = this.control

		this.initScene()
		this.bloom = createBloomPipeline( { strength: 0.6, radius: 0.3, threshold: 0.18 } )
		this.createInstruction()
		onMove.add( this.onPointerMove )
		onDown.add( this.onPointerDown )
		onUp.add( this.onPointerUp )
		onClick.add( this.onPointerClick )
		onLeave.add( this.onPointerLeave )
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		this._seedRopes()
		this.isGpuSimulation = stage3d.isWebGPU

		if ( this.isGpuSimulation ) this.initGpuSimulation()
		else this.initCpuSimulation()

		this.initPresentation()
		stage3d.add( this.rail )
		stage3d.add( this.line )
	}

	initGpuSimulation() {
		const positionRecords = new Float32Array( TOTAL_POINTS * 4 )
		const previousRecords = new Float32Array( TOTAL_POINTS * 4 )
		for ( let pointIndex = 0; pointIndex < TOTAL_POINTS; pointIndex++ ) {
			const cpuOffset = pointIndex * 3
			const gpuOffset = pointIndex * 4
			positionRecords[gpuOffset] = this.cpuPositions[cpuOffset]
			positionRecords[gpuOffset + 1] = this.cpuPositions[cpuOffset + 1]
			positionRecords[gpuOffset + 2] = this.cpuPositions[cpuOffset + 2]
			positionRecords[gpuOffset + 3] = 1
			previousRecords[gpuOffset] = this.cpuPrevious[cpuOffset]
			previousRecords[gpuOffset + 1] = this.cpuPrevious[cpuOffset + 1]
			previousRecords[gpuOffset + 2] = this.cpuPrevious[cpuOffset + 2]
			previousRecords[gpuOffset + 3] = 1
		}

		// Explicit vec4 records avoid backend padding surprises if the storage is
		// rebound after its first upload.
		this.positionBuffer = new StorageBufferAttribute( positionRecords, 4 )
		this.prevBuffer = new StorageBufferAttribute( previousRecords, 4 )
		this.ropeDataBuffer = new StorageBufferAttribute( this.ropeData, 4 )

		const positions = storage( this.positionBuffer, 'vec4', TOTAL_POINTS )
		const prevPositions = storage( this.prevBuffer, 'vec4', TOTAL_POINTS )
		const ropeData = storage( this.ropeDataBuffer, 'vec4', ROPE_COUNT )

		// Each invocation owns one complete, disjoint rope. This serial-per-rope
		// solver is native-WebGPU only; WebGL2 uses the CPU fallback below because
		// transform feedback cannot perform these arbitrary indexed writes.
		this.computeNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const data = ropeData.element( instanceIndex ).toVar()
			const anchor = data.xyz.toVar()
			const restLength = data.w.toVar()
			const anchorIndex = baseOffset.toUint().toVar()
			const dtSq = float( FIXED_DT * FIXED_DT )

			positions.element( anchorIndex ).assign( vec4( anchor, 1 ) )
			prevPositions.element( anchorIndex ).assign( vec4( anchor, 1 ) )

			Loop( { start: 0, end: POINTS_PER_ROPE - 1, name: 'point' }, ( { point } ) => {
				const pointNumber = float( point ).add( 1 ).toVar()
				const idx = baseOffset.add( pointNumber ).toUint().toVar()
				const progress = pointNumber.div( POINTS_PER_ROPE - 1 ).toVar()
				const cur = positions.element( idx ).xyz.toVar()
				const prev = prevPositions.element( idx ).xyz.toVar()
				const velocity = cur.sub( prev ).mul( VELOCITY_DAMPING ).toVar()

				// Nearby ropes share nearly the same phase, producing broad waves across
				// the curtain instead of independent, low-mass-looking flutter.
				const phase = this.uTime.mul( 0.78 )
					.add( anchor.x.mul( 0.23 ) )
					.add( progress.mul( 2.6 ) )
				const gust = sin( this.uTime.mul( 0.28 ).add( anchor.x.mul( 0.12 ) ) )
					.mul( 0.175 ).add( 0.825 )
				const wind = vec3(
					sin( phase ),
					sin( phase.mul( 0.73 ) ).mul( 0.08 ),
					cos( phase.mul( 0.81 ) ).mul( 0.38 ),
				).mul( progress.mul( gust ).mul( WIND_ACCELERATION ) )

				const fromPointer = cur.sub( this.uPointer ).toVar()
				const pointerDistance = max( length( fromPointer ), float( 0.0001 ) ).toVar()
				const pointerDirection = fromPointer.div( pointerDistance ).toVar()
				const pointerFalloff = float( 1 )
					.sub( smoothstep( 0, POINTER_FORCE_RADIUS, pointerDistance ) )
					.mul( this.uPointerActive )
				const hoverForce = pointerDirection.mul(
					pointerFalloff.mul( this.uGrab.oneMinus() ).mul( HOVER_ACCELERATION )
				)
				const grabForce = pointerDirection.mul(
					pointerFalloff.mul( this.uGrab ).mul( -GRAB_ACCELERATION )
				)
				const swishForce = this.uPointerVelocity.mul(
					pointerFalloff.mul( SWISH_ACCELERATION )
				)
				const pluckFalloff = float( 1 )
					.sub( smoothstep( 0, PLUCK_RADIUS, pointerDistance ) )
				const pluckForce = pointerDirection.mul(
					pluckFalloff.mul( this.uPluck ).mul( PLUCK_ACCELERATION )
				)
				const acceleration = vec3( 0, GRAVITY, 0 )
					.add( wind ).add( hoverForce ).add( grabForce ).add( swishForce ).add( pluckForce )
				const next = cur.add( velocity ).add( acceleration.mul( dtSq ) ).toVar()

				prevPositions.element( idx ).assign( vec4( cur, 1 ) )
				positions.element( idx ).assign( vec4( next, 1 ) )
			} )

			// Apply direct manipulation before the constraint solve. The link passes
			// can then redistribute a hard grab without briefly stretching the rope.
			Loop( { start: 0, end: POINTS_PER_ROPE - 1, name: 'interactionPoint' }, ( { interactionPoint } ) => {
				const idx = baseOffset.add( float( interactionPoint ).add( 1 ) ).toUint().toVar()
				const cur = positions.element( idx ).xyz.toVar()
				const fromPointer = cur.sub( this.uPointer ).toVar()
				const pointerDistance = max( length( fromPointer ), float( 0.0001 ) ).toVar()
				const pointerDirection = fromPointer.div( pointerDistance ).toVar()
				const hoverCorrection = pointerDirection.mul(
					max( float( POINTER_COLLIDER_RADIUS ).sub( pointerDistance ), float( 0 ) )
						.mul( this.uPointerActive ).mul( this.uGrab.oneMinus() )
				)
				const pushed = cur.add( hoverCorrection ).toVar()
				const grabFalloff = float( 1 ).sub( smoothstep( 0, GRAB_RADIUS, pointerDistance ) )
				const grabAmount = grabFalloff.mul( this.uPointerActive ).mul( this.uGrab ).mul( GRAB_PROJECTION )
				const grabTarget = this.uPointer.add( this.uPointerVelocity.mul( FIXED_DT * 0.35 ) )
				const interacted = mix( pushed, grabTarget, grabAmount ).toVar()

				const clamped = vec3( interacted.x, max( interacted.y, float( FLOOR_Y ) ), interacted.z ).toVar()
				positions.element( idx ).assign( vec4( clamped, 1 ) )
			} )

			Loop( { start: 0, end: CONSTRAINT_ITERATIONS, name: 'iteration' }, () => {
				positions.element( anchorIndex ).assign( vec4( anchor, 1 ) )

				const firstIndex = baseOffset.add( 1 ).toUint().toVar()
				const first = positions.element( firstIndex ).xyz.toVar()
				const firstDelta = first.sub( anchor ).toVar()
				const firstDistance = max( length( firstDelta ), float( 0.0001 ) ).toVar()
				const firstCorrection = firstDelta.mul(
					firstDistance.sub( restLength ).div( firstDistance ).mul( CONSTRAINT_STIFFNESS )
				)
				positions.element( firstIndex ).assign( vec4( first.sub( firstCorrection ), 1 ) )

				Loop( { start: 0, end: POINTS_PER_ROPE - 2, name: 'link' }, ( { link } ) => {
					const aIndex = baseOffset.add( float( link ).add( 1 ) ).toUint().toVar()
					const bIndex = aIndex.add( 1 ).toUint().toVar()
					const a = positions.element( aIndex ).xyz.toVar()
					const b = positions.element( bIndex ).xyz.toVar()
					const delta = b.sub( a ).toVar()
					const distance = max( length( delta ), float( 0.0001 ) ).toVar()
					const correction = delta.mul(
						distance.sub( restLength ).div( distance ).mul( CONSTRAINT_STIFFNESS * 0.5 )
					)

					positions.element( aIndex ).assign( vec4( a.add( correction ), 1 ) )
					positions.element( bIndex ).assign( vec4( b.sub( correction ), 1 ) )
				} )

				// A soft two-link distance constraint adds just enough bend resistance to
				// stop compressed rope from folding into single-segment spikes.
				const secondIndex = baseOffset.add( 2 ).toUint().toVar()
				const second = positions.element( secondIndex ).xyz.toVar()
				const firstBendDelta = second.sub( anchor ).toVar()
				const firstBendDistance = max( length( firstBendDelta ), float( 0.0001 ) ).toVar()
				const firstBendCorrection = firstBendDelta.mul(
					min( firstBendDistance.sub( restLength.mul( MIN_BEND_RATIO ) ), float( 0 ) )
						.div( firstBendDistance ).mul( BEND_STIFFNESS )
				)
				positions.element( secondIndex ).assign( vec4( second.sub( firstBendCorrection ), 1 ) )

				Loop( { start: 1, end: POINTS_PER_ROPE - 2, name: 'bend' }, ( { bend } ) => {
					const aIndex = baseOffset.add( bend ).toUint().toVar()
					const cIndex = aIndex.add( 2 ).toUint().toVar()
					const a = positions.element( aIndex ).xyz.toVar()
					const c = positions.element( cIndex ).xyz.toVar()
					const delta = c.sub( a ).toVar()
					const distance = max( length( delta ), float( 0.0001 ) ).toVar()
					const correction = delta.mul(
						min( distance.sub( restLength.mul( MIN_BEND_RATIO ) ), float( 0 ) )
							.div( distance ).mul( BEND_STIFFNESS * 0.5 )
					)
					positions.element( aIndex ).assign( vec4( a.add( correction ), 1 ) )
					positions.element( cIndex ).assign( vec4( c.sub( correction ), 1 ) )
				} )

				// Alternate contact projection with link projection so long ropes settle
				// onto the floor without accumulating length error.
				Loop( { start: 0, end: POINTS_PER_ROPE - 1, name: 'solverPoint' }, ( { solverPoint } ) => {
					const idx = baseOffset.add( float( solverPoint ).add( 1 ) ).toUint().toVar()
					const cur = positions.element( idx ).xyz.toVar()
					positions.element( idx ).assign( vec4( cur.x, max( cur.y, float( FLOOR_Y ) ), cur.z, 1 ) )
				} )
			} )

			// Use a deliberately inelastic floor: constraints can create new resting
			// contacts, and this single pass removes downward velocity and adds friction.
			Loop( { start: 0, end: POINTS_PER_ROPE - 1, name: 'contactPoint' }, ( { contactPoint } ) => {
				const idx = baseOffset.add( float( contactPoint ).add( 1 ) ).toUint().toVar()
				const cur = positions.element( idx ).xyz.toVar()
				const previous = prevPositions.element( idx ).xyz.toVar()
				const floorContact = cur.y.lessThan( float( FLOOR_Y + 0.0001 ) )
				const contactPrevious = vec3(
					mix( previous.x, cur.x, FLOOR_FRICTION ),
					cur.y,
					mix( previous.z, cur.z, FLOOR_FRICTION ),
				)

				prevPositions.element( idx ).assign( vec4( floorContact.select( contactPrevious, previous ), 1 ) )
			} )
		} )().compute( ROPE_COUNT )

		const positionNode = Fn( ( [progress] ) => {
			const lastPoint = float( POINTS_PER_ROPE - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const i0 = baseOffset.add( pivot ).toUint().toVar()
			const i1 = baseOffset.add( pivot.add( 1 ) ).toUint().toVar()
			return mix( positions.element( i0 ).xyz, positions.element( i1 ).xyz, t )
		} )

		const colorNode = Fn( ( [color, progress] ) => {
			const lastPoint = float( POINTS_PER_ROPE - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const i0 = baseOffset.add( pivot ).toUint().toVar()
			const i1 = baseOffset.add( pivot.add( 1 ) ).toUint().toVar()
			const p0 = positions.element( i0 ).xyz.toVar()
			const p1 = positions.element( i1 ).xyz.toVar()
			const samplePosition = mix( p0, p1, t ).toVar()
			const restLength = ropeData.element( instanceIndex ).w.toVar()

			// Fiber optics: dim near the rail, brightening down the strand to a
			// white-hot bead. Additive blending turns that into the glow.
			const ropeRatio = float( instanceIndex ).div( ROPE_COUNT - 1 )
			const cyan = vec3( 0.12, 0.78, 1.0 )
			const violet = vec3( 0.55, 0.36, 1.0 )
			const pink = vec3( 1.0, 0.3, 0.62 )
			const fiber = mix( mix( cyan, violet, smoothstep( 0, 0.5, ropeRatio ) ), pink, smoothstep( 0.5, 1, ropeRatio ) )
			const brightness = progress.pow( 2.2 ).mul( 0.85 ).add( 0.12 )
			const bead = smoothstep( 0.92, 0.975, progress )
			const baseColor = mix( fiber.mul( brightness ), vec3( 1.0, 0.95, 0.88 ), bead.mul( 0.8 ) ).toVar()
			const strain = clamp(
				abs( length( p1.sub( p0 ) ).div( restLength ).sub( 1 ) ).mul( 7 ),
				0,
				1,
			).toVar()
			const strainedColor = mix( baseColor, vec3( 1.0, 0.42, 0.08 ), strain.mul( 0.72 ) ).toVar()
			const pointerGlow = float( 1 )
				.sub( smoothstep( 0, GRAB_RADIUS * 1.25, length( samplePosition.sub( this.uPointer ) ) ) )
				.mul( max( this.uPointerActive, this.uPluck ) )
			const highlight = pointerGlow.mul(
				this.uGrab.mul( 0.55 ).add( this.uPluck.mul( 0.75 ) ).add( 0.22 )
			)
			return vec4( mix( strainedColor, vec3( 1.0, 0.94, 0.64 ), highlight ), 1 )
		} )

		const widthNode = Fn( ( [width, progress] ) => {
			const swell = smoothstep( 0.93, 0.975, progress ).mul( float( 1 ).sub( smoothstep( 0.985, 1, progress ) ) )
			return width.mul( swell.mul( BEAD_SWELL ).add( FIBER_WIDTH ) )
		} )

		this.line = new MeshLine()
			.instances( ROPE_COUNT )
			.segments( POINTS_PER_ROPE - 1 )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.widthFn( widthNode )
			.lineWidth( 0.3 )
			.join( { type: 'bevel', limit: 1.4 } )
			.color( 0xffffff )
			.setFrustumCulled( false )
	}

	initCpuSimulation() {
		this.line = new MeshLine()
			.lines( this.cpuLines, false )
			.vertexColors( this.cpuColors )
			.widthCallback( beadWidth )
			.lineWidth( 0.3 )
			.join( { type: 'bevel', limit: 1.4 } )
			.color( 0xffffff )
			.setFrustumCulled( false )
	}

	initPresentation() {
		this.rail = new MeshLine()
			.lines( new Float32Array( [
				-ANCHOR_SPAN * 0.56,
				ANCHOR_Y + 0.25,
				-0.12,
				ANCHOR_SPAN * 0.56,
				ANCHOR_Y + 0.25,
				-0.12,
			] ), false )
			.lineWidth( 0.15 )
			.color( 0xffd27a )
			.gradientColor( 0x85dfff )
			.antialias( true )
			.transparent( true )
			.opacity( 0.72 )

		this.line.build()
		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false

		stage3d.scene.backgroundNode = Fn( () => {
			const centered = uv().sub( vec2( 0.5 ) ).toVar()
			const vignette = smoothstep( 0.2, 0.78, length( centered.mul( vec2( 0.78, 1.2 ) ) ) )
			const vertical = smoothstep( 0, 1, uv().y )
			const base = mix( vec3( 0.0015, 0.003, 0.012 ), vec3( 0.01, 0.005, 0.026 ), vertical )
			const centerGlow = float( 1 ).sub( smoothstep( 0.06, 0.68, length( centered ) ) )
			const grabGlow = vec3( 0.12, 0.018, 0.03 )
				.mul( this.uGrab.mul( 0.55 ).add( this.uPluck.mul( 0.24 ) ) )
			const color = base.add( vec3( 0.01, 0.008, 0.03 ).mul( centerGlow ) ).add( grabGlow )
			return vec4( color.mul( float( 1 ).sub( vignette.mul( 0.48 ) ) ), 1 )
		} )()
	}

	_seedRopes() {
		this.cpuPositions = new Float32Array( TOTAL_POINTS * 3 )
		this.cpuPrevious = new Float32Array( TOTAL_POINTS * 3 )
		this.cpuColors = new Float32Array( TOTAL_POINTS * 3 )
		this.ropeData = new Float32Array( ROPE_COUNT * 4 )

		for ( let ropeIndex = 0; ropeIndex < ROPE_COUNT; ropeIndex++ ) {
			const ratio = ropeIndex / ( ROPE_COUNT - 1 )
			const anchorX = ( ratio - 0.5 ) * ANCHOR_SPAN
			const anchorY = ANCHOR_Y
			const anchorZ = 0
			const restLength = getRestLength( ropeIndex )
			const dataOffset = ropeIndex * 4

			this.ropeData[dataOffset] = anchorX
			this.ropeData[dataOffset + 1] = anchorY
			this.ropeData[dataOffset + 2] = anchorZ
			this.ropeData[dataOffset + 3] = restLength

			for ( let pointIndex = 0; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const pointRatio = pointIndex / ( POINTS_PER_ROPE - 1 )
				const bow = Math.sin( pointRatio * Math.PI )
				const offset = ( ropeIndex * POINTS_PER_ROPE + pointIndex ) * 3
				const x = anchorX + bow * Math.sin( ropeIndex * 1.9 ) * 0.11
				const y = anchorY - pointIndex * restLength
				const z = anchorZ + bow * Math.cos( ropeIndex * 1.37 ) * 0.16
				const brightness = pointRatio ** 2.2 * 0.85 + 0.12
				const bead = smoothstepValue( 0.92, 0.975, pointRatio ) * 0.8

				this.cpuPositions[offset] = x
				this.cpuPositions[offset + 1] = y
				this.cpuPositions[offset + 2] = z
				this.cpuPrevious[offset] = x
				this.cpuPrevious[offset + 1] = y
				this.cpuPrevious[offset + 2] = z
				this.cpuColors[offset] = ( 0.12 + 0.88 * ratio ) * brightness * ( 1 - bead ) + bead
				this.cpuColors[offset + 1] = ( 0.78 - 0.48 * ratio ) * brightness * ( 1 - bead ) + bead * 0.95
				this.cpuColors[offset + 2] = ( 1 - 0.38 * ratio ) * brightness * ( 1 - bead ) + bead * 0.88
			}
		}

		const floatsPerRope = POINTS_PER_ROPE * 3
		this.cpuLines = Array.from( { length: ROPE_COUNT }, ( value, ropeIndex ) => {
			const start = ropeIndex * floatsPerRope
			return this.cpuPositions.subarray( start, start + floatsPerRope )
		} )
	}

	simulateCpu() {
		const positions = this.cpuPositions
		const previous = this.cpuPrevious
		const pointer = this.uPointer.value
		const pointerVelocity = this.uPointerVelocity.value
		const pointerActive = this.uPointerActive.value
		const grab = this.uGrab.value
		const pluck = this.uPluck.value
		const dtSq = FIXED_DT * FIXED_DT
		const time = this.uTime.value

		for ( let ropeIndex = 0; ropeIndex < ROPE_COUNT; ropeIndex++ ) {
			const dataOffset = ropeIndex * 4
			const anchorX = this.ropeData[dataOffset]
			const anchorY = this.ropeData[dataOffset + 1]
			const anchorZ = this.ropeData[dataOffset + 2]
			const restLength = this.ropeData[dataOffset + 3]
			const basePoint = ropeIndex * POINTS_PER_ROPE
			const anchorOffset = basePoint * 3

			positions[anchorOffset] = previous[anchorOffset] = anchorX
			positions[anchorOffset + 1] = previous[anchorOffset + 1] = anchorY
			positions[anchorOffset + 2] = previous[anchorOffset + 2] = anchorZ

			for ( let pointIndex = 1; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const offset = ( basePoint + pointIndex ) * 3
				const x = positions[offset]
				const y = positions[offset + 1]
				const z = positions[offset + 2]
				const velocityX = ( x - previous[offset] ) * VELOCITY_DAMPING
				const velocityY = ( y - previous[offset + 1] ) * VELOCITY_DAMPING
				const velocityZ = ( z - previous[offset + 2] ) * VELOCITY_DAMPING
				const progress = pointIndex / ( POINTS_PER_ROPE - 1 )
				const phase = time * 0.78 + anchorX * 0.23 + progress * 2.6
				const gust = Math.sin( time * 0.28 + anchorX * 0.12 ) * 0.175 + 0.825
				const windScale = progress * gust * WIND_ACCELERATION

				const pointerX = x - pointer.x
				const pointerY = y - pointer.y
				const pointerZ = z - pointer.z
				const pointerDistance = Math.max( Math.hypot( pointerX, pointerY, pointerZ ), 0.0001 )
				const pointerFalloff = ( 1 - smoothstepValue( 0, POINTER_FORCE_RADIUS, pointerDistance ) ) * pointerActive
				const directionX = pointerX / pointerDistance
				const directionY = pointerY / pointerDistance
				const directionZ = pointerZ / pointerDistance
				const radialForce = pointerFalloff * (
					( 1 - grab ) * HOVER_ACCELERATION - grab * GRAB_ACCELERATION
				)
				const pluckForce = ( 1 - smoothstepValue( 0, PLUCK_RADIUS, pointerDistance ) )
					* pluck * PLUCK_ACCELERATION

				const accelerationX = Math.sin( phase ) * windScale
					+ directionX * ( radialForce + pluckForce )
					+ pointerVelocity.x * pointerFalloff * SWISH_ACCELERATION
				const accelerationY = GRAVITY + Math.sin( phase * 0.73 ) * 0.08 * windScale
					+ directionY * ( radialForce + pluckForce )
					+ pointerVelocity.y * pointerFalloff * SWISH_ACCELERATION
				const accelerationZ = Math.cos( phase * 0.81 ) * 0.38 * windScale
					+ directionZ * ( radialForce + pluckForce )
					+ pointerVelocity.z * pointerFalloff * SWISH_ACCELERATION

				previous[offset] = x
				previous[offset + 1] = y
				previous[offset + 2] = z
				positions[offset] = x + velocityX + accelerationX * dtSq
				positions[offset + 1] = y + velocityY + accelerationY * dtSq
				positions[offset + 2] = z + velocityZ + accelerationZ * dtSq
			}

			// Resolve pointer interaction before the distance constraints so a fast
			// grab moves the whole rope instead of stretching a handful of links.
			for ( let pointIndex = 1; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const offset = ( basePoint + pointIndex ) * 3
				const x = positions[offset]
				const y = positions[offset + 1]
				const z = positions[offset + 2]
				const pointerX = x - pointer.x
				const pointerY = y - pointer.y
				const pointerZ = z - pointer.z
				const pointerDistance = Math.max( Math.hypot( pointerX, pointerY, pointerZ ), 0.0001 )
				const hoverCorrection = Math.max( POINTER_COLLIDER_RADIUS - pointerDistance, 0 )
					* pointerActive * ( 1 - grab )
				const pushedX = x + pointerX / pointerDistance * hoverCorrection
				const pushedY = y + pointerY / pointerDistance * hoverCorrection
				const pushedZ = z + pointerZ / pointerDistance * hoverCorrection
				const grabFalloff = 1 - smoothstepValue( 0, GRAB_RADIUS, pointerDistance )
				const grabAmount = grabFalloff * pointerActive * grab * GRAB_PROJECTION
				const grabTargetX = pointer.x + pointerVelocity.x * FIXED_DT * 0.35
				const grabTargetY = pointer.y + pointerVelocity.y * FIXED_DT * 0.35
				const grabTargetZ = pointer.z + pointerVelocity.z * FIXED_DT * 0.35
				const interactedX = pushedX + ( grabTargetX - pushedX ) * grabAmount
				const interactedY = pushedY + ( grabTargetY - pushedY ) * grabAmount
				const interactedZ = pushedZ + ( grabTargetZ - pushedZ ) * grabAmount

				positions[offset] = interactedX
				positions[offset + 1] = Math.max( interactedY, FLOOR_Y )
				positions[offset + 2] = interactedZ
			}

			for ( let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration++ ) {
				positions[anchorOffset] = anchorX
				positions[anchorOffset + 1] = anchorY
				positions[anchorOffset + 2] = anchorZ

				const firstOffset = ( basePoint + 1 ) * 3
				let deltaX = positions[firstOffset] - anchorX
				let deltaY = positions[firstOffset + 1] - anchorY
				let deltaZ = positions[firstOffset + 2] - anchorZ
				let distance = Math.max( Math.hypot( deltaX, deltaY, deltaZ ), 0.0001 )
				let correction = ( distance - restLength ) / distance * CONSTRAINT_STIFFNESS
				positions[firstOffset] -= deltaX * correction
				positions[firstOffset + 1] -= deltaY * correction
				positions[firstOffset + 2] -= deltaZ * correction

				for ( let linkIndex = 1; linkIndex < POINTS_PER_ROPE - 1; linkIndex++ ) {
					const aOffset = ( basePoint + linkIndex ) * 3
					const bOffset = aOffset + 3
					deltaX = positions[bOffset] - positions[aOffset]
					deltaY = positions[bOffset + 1] - positions[aOffset + 1]
					deltaZ = positions[bOffset + 2] - positions[aOffset + 2]
					distance = Math.max( Math.hypot( deltaX, deltaY, deltaZ ), 0.0001 )
					correction = ( distance - restLength ) / distance * CONSTRAINT_STIFFNESS * 0.5
					const correctionX = deltaX * correction
					const correctionY = deltaY * correction
					const correctionZ = deltaZ * correction

					positions[aOffset] += correctionX
					positions[aOffset + 1] += correctionY
					positions[aOffset + 2] += correctionZ
					positions[bOffset] -= correctionX
					positions[bOffset + 1] -= correctionY
					positions[bOffset + 2] -= correctionZ
				}

				const secondOffset = anchorOffset + 6
				deltaX = positions[secondOffset] - anchorX
				deltaY = positions[secondOffset + 1] - anchorY
				deltaZ = positions[secondOffset + 2] - anchorZ
				distance = Math.max( Math.hypot( deltaX, deltaY, deltaZ ), 0.0001 )
				correction = Math.min( distance - restLength * MIN_BEND_RATIO, 0 )
					/ distance * BEND_STIFFNESS
				positions[secondOffset] -= deltaX * correction
				positions[secondOffset + 1] -= deltaY * correction
				positions[secondOffset + 2] -= deltaZ * correction

				for ( let bendIndex = 1; bendIndex < POINTS_PER_ROPE - 2; bendIndex++ ) {
					const aOffset = ( basePoint + bendIndex ) * 3
					const cOffset = aOffset + 6
					deltaX = positions[cOffset] - positions[aOffset]
					deltaY = positions[cOffset + 1] - positions[aOffset + 1]
					deltaZ = positions[cOffset + 2] - positions[aOffset + 2]
					distance = Math.max( Math.hypot( deltaX, deltaY, deltaZ ), 0.0001 )
					correction = Math.min( distance - restLength * MIN_BEND_RATIO, 0 )
						/ distance * BEND_STIFFNESS * 0.5
					const correctionX = deltaX * correction
					const correctionY = deltaY * correction
					const correctionZ = deltaZ * correction

					positions[aOffset] += correctionX
					positions[aOffset + 1] += correctionY
					positions[aOffset + 2] += correctionZ
					positions[cOffset] -= correctionX
					positions[cOffset + 1] -= correctionY
					positions[cOffset + 2] -= correctionZ
				}

				for ( let pointIndex = 1; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
					const offset = ( basePoint + pointIndex ) * 3
					positions[offset + 1] = Math.max( positions[offset + 1], FLOOR_Y )
				}
			}

			for ( let pointIndex = 1; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const offset = ( basePoint + pointIndex ) * 3
				if ( positions[offset + 1] < FLOOR_Y + 0.0001 ) {
					previous[offset] += ( positions[offset] - previous[offset] ) * FLOOR_FRICTION
					previous[offset + 1] = positions[offset + 1]
					previous[offset + 2] += ( positions[offset + 2] - previous[offset + 2] ) * FLOOR_FRICTION
				}
			}
		}
	}

	createInstruction() {
		if ( new URL( location.href ).searchParams.has( 'noUI' ) ) return

		this.instructionStyle = document.createElement( 'style' )
		this.instructionStyle.textContent = `
			.VerletRopesHint {
				position: fixed;
				top: calc(16px + var(--sait, 0px));
				left: calc(16px + var(--sail, 0px));
				z-index: 20;
				padding: 9px 12px;
				border: 1px solid rgba(125, 219, 255, .25);
				border-radius: 999px;
				background: rgba(5, 9, 28, .68);
				box-shadow: 0 10px 32px rgba(0, 0, 0, .26), inset 0 0 18px rgba(133, 100, 255, .06);
				backdrop-filter: blur(9px);
				font: 650 10px/1 system-ui, sans-serif;
				letter-spacing: .075em;
				text-transform: uppercase;
				color: rgba(226, 245, 255, .88);
				pointer-events: none;
				user-select: none;
				transition: opacity .24s ease, transform .24s ease;
			}
			.VerletRopesHint::before {
				content: '';
				display: inline-block;
				width: 6px;
				height: 6px;
				margin-right: 8px;
				border-radius: 50%;
				background: #7de3ff;
				box-shadow: 0 0 10px rgba(125, 227, 255, .72);
				vertical-align: 1px;
			}
			.VerletRopesPulse {
				position: fixed;
				z-index: 18;
				width: 22px;
				height: 22px;
				border: 1.5px solid rgba(125, 227, 255, .92);
				border-radius: 50%;
				box-shadow: 0 0 14px rgba(125, 227, 255, .42), inset 0 0 8px rgba(255, 205, 105, .26);
				pointer-events: none;
				transform: translate(-50%, -50%) scale(.35);
				animation: VerletRopesPulse .52s cubic-bezier(.15, .7, .25, 1) forwards;
			}
			@keyframes VerletRopesPulse {
				0% { opacity: .95; transform: translate(-50%, -50%) scale(.35); }
				100% { opacity: 0; transform: translate(-50%, -50%) scale(3.4); }
			}
			@media (max-width: 600px) {
				.VerletRopesHint {
					top: calc(10px + var(--sait, 0px));
					left: calc(10px + var(--sail, 0px));
					font-size: 9px;
				}
			}
			@media (prefers-reduced-motion: reduce) {
				.VerletRopesHint { transition: none; }
				.VerletRopesPulse { display: none; }
			}
		`
		document.head.appendChild( this.instructionStyle )

		this.instructionElement = document.createElement( 'div' )
		this.instructionElement.className = 'VerletRopesHint'
		this.updateInstructionText()
		document.body.appendChild( this.instructionElement )
		this.instructionTimer = window.setTimeout( this.dismissInstruction, 7000 )
	}

	updateInstructionText() {
		if ( !this.instructionElement ) return
		const useCompactHint = matchMedia( '(pointer: coarse)' ).matches || window.innerWidth <= 600
		this.instructionElement.textContent = useCompactHint
			? 'Drag to swing · tap to pluck'
			: 'Move to brush · hold to grab · flick to throw'
	}

	createPluckRipple( mouseData ) {
		if ( !this.instructionStyle || matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) return

		const ripple = document.createElement( 'div' )
		ripple.className = 'VerletRopesPulse'
		ripple.style.left = `${mouseData.x}px`
		ripple.style.top = `${mouseData.y}px`
		document.body.appendChild( ripple )
		this.pluckRipples.add( ripple )

		const remove = () => {
			ripple.remove()
			this.pluckRipples.delete( ripple )
		}
		ripple.addEventListener( 'animationend', remove, { once: true } )
		window.setTimeout( remove, 620 )
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

	refreshPointerWorld( trackVelocity ) {
		this.raycaster.setFromCamera( _pointerNDC, stage3d.camera )
		if ( !this.raycaster.ray.intersectPlane( _interactionPlane, _pointerWorld ) ) {
			this.onPointerLeave()
			return false
		}

		const now = performance.now()
		const elapsed = ( now - this.lastPointerTime ) * 0.001
		if ( trackVelocity && this.hasPointerPosition && elapsed > 0 && elapsed < 0.12 ) {
			_pointerVelocityTarget.copy( _pointerWorld ).sub( this.lastPointerWorld )
				.multiplyScalar( 1 / elapsed ).clampLength( 0, MAX_POINTER_SPEED )
			this.uPointerVelocity.value.lerp( _pointerVelocityTarget, 0.42 )
		} else if ( trackVelocity && !this.hasPointerPosition ) {
			this.uPointerVelocity.value.set( 0, 0, 0 )
		}

		this.lastPointerWorld.copy( _pointerWorld )
		this.lastPointerTime = now
		this.hasPointerPosition = true
		this.uPointer.value.copy( _pointerWorld )
		this.uPointerActive.value = 1
		return true
	}

	onPointerMove = ( mouseData ) => {
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		return this.refreshPointerWorld( true )
	}

	onPointerDown = ( mouseData ) => {
		if ( mouseData?.e?.target?.closest?.( 'button, a, input, select, .lil-gui' ) ) return
		if ( this.onPointerMove( mouseData ) ) this.uGrab.value = 1
		this.dismissInstruction()
	}

	onPointerUp = () => {
		this.uGrab.value = 0
		if ( matchMedia( '(pointer: coarse)' ).matches ) {
			this.uPointerActive.value = 0
			this.uPointerVelocity.value.set( 0, 0, 0 )
			this.hasPointerPosition = false
		}
	}

	onPointerClick = ( mouseData ) => {
		if ( mouseData?.e?.target?.closest?.( 'button, a, input, select, .lil-gui' ) ) return
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		if ( !this.refreshPointerWorld( false ) ) return

		this.uPluck.value = 1
		this.createPluckRipple( mouseData )
		if ( matchMedia( '(pointer: coarse)' ).matches ) {
			this.uPointerActive.value = 0
			this.hasPointerPosition = false
		}
	}

	onPointerLeave = () => {
		this.uPointerActive.value = 0
		this.uGrab.value = 0
		this.uPointerVelocity.value.set( 0, 0, 0 )
		this.hasPointerPosition = false
	}

	update = ( dt ) => {
		if ( !this.line || !stage3d.renderer ) return

		const frameDt = Math.min( Math.max( dt, 0 ) * 0.001, 0.05 )
		if ( this.hasPointerPosition ) this.refreshPointerWorld( false )
		this.uPointerVelocity.value.multiplyScalar( Math.exp( -POINTER_VELOCITY_DECAY * frameDt ) )
		this.accumulator = Math.min(
			this.accumulator + frameDt,
			FIXED_DT * MAX_SIMULATION_STEPS,
		)

		let steps = 0
		while ( this.accumulator >= FIXED_DT && steps < MAX_SIMULATION_STEPS ) {
			this.uTime.value += FIXED_DT
			if ( this.isGpuSimulation ) stage3d.renderer.compute( this.computeNode )
			else this.simulateCpu()
			this.uPluck.value *= Math.exp( -PLUCK_DECAY * FIXED_DT )
			if ( this.uPluck.value < 0.0001 ) this.uPluck.value = 0
			this.accumulator -= FIXED_DT
			steps++
		}

		if ( !this.isGpuSimulation && steps > 0 ) this.line.setPositions( this.cpuLines )
	}

	onResize = () => {
		this.line?.resize()
		this.rail?.resize()
		this.updateInstructionText()
	}

	show() {
		this.accumulator = 0
		stage.onUpdate.add( this.update )
	}

	hide( cb ) {
		stage.onUpdate.remove( this.update )
		if ( cb ) cb()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		onMove.remove( this.onPointerMove )
		onDown.remove( this.onPointerDown )
		onUp.remove( this.onPointerUp )
		onClick.remove( this.onPointerClick )
		onLeave.remove( this.onPointerLeave )
		window.removeEventListener( 'resize', this.onResize )
		window.clearTimeout( this.instructionTimer )
		this.instructionElement?.remove()
		this.instructionStyle?.remove()
		for ( const ripple of this.pluckRipples ) ripple.remove()
		this.pluckRipples.clear()

		stage3d.remove( this.line )
		stage3d.remove( this.rail )
		this.computeNode?.dispose()
		this.line?.dispose()
		this.rail?.dispose()
		this.bloom?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null

		this.line = null
		this.rail = null
		this.bloom = null
		this.control = null
		this.positionBuffer = null
		this.prevBuffer = null
		this.ropeDataBuffer = null
		this.computeNode = null
		this.cpuPositions = null
		this.cpuPrevious = null
		this.cpuLines = null
		this.cpuColors = null
		this.ropeData = null
		this.instructionElement = null
		this.instructionStyle = null
	}
}

export default VerletRopesExample

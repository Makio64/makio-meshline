import { MeshLine } from 'makio-meshline'
import { abs, clamp, cos, dot, float, floor, Fn, instanceIndex, length, Loop, max, min, mix, sin, smoothstep, sqrt, storage, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { Plane, Raycaster, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { onDown, onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'

// 3D pavilion layout: 4 parallel overhead rails in Z × 13 ropes across X.
const ROW_COUNT = 4
const ROPES_PER_ROW = 13
const ROPE_COUNT = ROW_COUNT * ROPES_PER_ROW
const POINTS_PER_ROPE = 14
const RENDER_SEGMENTS = 38
const TOTAL_POINTS = ROPE_COUNT * POINTS_PER_ROPE

const ANCHOR_SPAN_X = 14.8
const ANCHOR_SPAN_Z = 7.8
const ANCHOR_Y = 5.45
const SHORTEST_ROPE = 5.2
const LONGEST_ROPE = 8.9
const FLOOR_Y = -5.15

// Fixed-ceiling substepping keeps the pendulum period identical across 60–240 Hz.
const MAX_STEP_DT = 1 / 220
const MAX_SUBSTEPS = 8
const MAX_FRAME_DT = 0.05
const FRAME_DT_SMOOTHING = 0.15

// Momentum-conserving 14-point chain under strong downward gravity:
// zero vertical bounce, < 0.05% stretch, and natural pendulum weight.
const AIR_DRAG = 0.58
const GRAVITY = -42
const MIN_BEND_RATIO = 1.99
const BEND_STIFFNESS = 0.45
const CONSTRAINT_ITERATIONS = 10
const WIND_ACCELERATION = 1.8
const AUTO_ROTATE_SPEED = 0.000035

// Whole-rope pendulum wake: brushing any part of a cord swings the whole
// weighted pendant smoothly in (X, Z) with a strict acceleration ceiling.
const POINTER_WAKE_RADIUS = 1.65
const WAKE_PUSH_ACCELERATION = 2.4
const WAKE_SWISH_ACCELERATION = 3.6
const MAX_BRUSH_ACCELERATION = 38
const PLUCK_RADIUS = 3.3
const PLUCK_ACCELERATION = 40
const PLUCK_DECAY = 10
const POINTER_VELOCITY_DECAY = 9
const POINTER_ENGAGE_DECAY = 5
const MAX_POINTER_SPEED = 15
const MAX_POINT_SPEED = 3.4

const FLOOR_FRICTION = 0.12
const FIBER_WIDTH = 0.48
const BEAD_SWELL = 1.65

const _pointerNDC = new Vector2()
const _pointerWorld = new Vector3()
const _pointerVelocityTarget = new Vector3()
const _planeNormal = new Vector3()
const _rayDelta = new Vector3()
const _closestOnRay = new Vector3()
const _fromRay = new Vector3()
const _ropePushDir = new Vector3()
const _interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )

function getAnchorData( ropeIndex ) {
	const rowIndex = Math.floor( ropeIndex / ROPES_PER_ROW )
	const colIndex = ropeIndex % ROPES_PER_ROW
	const rowRatio = ROW_COUNT > 1 ? rowIndex / ( ROW_COUNT - 1 ) : 0.5
	const colRatio = ROPES_PER_ROW > 1 ? colIndex / ( ROPES_PER_ROW - 1 ) : 0.5

	// Stagger alternate rows slightly in X so every rope is clearly visible in 3D.
	const stagger = ( rowIndex % 2 === 0 ? -0.5 : 0.5 ) * ( ANCHOR_SPAN_X / ( ROPES_PER_ROW - 1 ) ) * 0.28
	const anchorX = ( colRatio - 0.5 ) * ANCHOR_SPAN_X + stagger
	const anchorZ = ( rowRatio - 0.5 ) * ANCHOR_SPAN_Z
	const archLift = Math.cos( ( rowRatio - 0.5 ) * Math.PI * 0.9 ) * 0.22
	const anchorY = ANCHOR_Y + archLift

	// Sculpted 3D canopy: longer in the center dome, shorter toward the outer corners.
	const radialX = ( colRatio - 0.5 ) * 2
	const radialZ = ( rowRatio - 0.5 ) * 2
	const radial = Math.min( 1, Math.hypot( radialX * 0.85, radialZ * 0.75 ) )
	const dome = Math.cos( radial * Math.PI * 0.5 ) ** 1.25
	const wave = Math.sin( colIndex * 1.15 + rowIndex * 1.4 ) * 0.28
	const totalLength = SHORTEST_ROPE + ( LONGEST_ROPE - SHORTEST_ROPE ) * dome + wave
	const restLength = totalLength / ( POINTS_PER_ROPE - 1 )

	return { anchorX, anchorY, anchorZ, restLength, rowRatio, colRatio }
}

function beadWidth( progress ) {
	const taper = 0.82 + 0.18 * progress
	const swell = smoothstepValue( 0.92, 0.972, progress ) * ( 1 - smoothstepValue( 0.985, 1, progress ) )
	return FIBER_WIDTH * taper + swell * BEAD_SWELL
}

function smoothstepValue( edge0, edge1, value ) {
	const t = Math.max( 0, Math.min( 1, ( value - edge0 ) / ( edge1 - edge0 ) ) )
	return t * t * ( 3 - 2 * t )
}

function projectCpuLink( positions, basePoint, aPoint, span, targetLength, stiffness, aWeight, bWeight, compressOnly = false ) {
	const bPoint = aPoint + span
	const aOffset = ( basePoint + aPoint ) * 3
	const bOffset = ( basePoint + bPoint ) * 3
	const deltaX = positions[bOffset] - positions[aOffset]
	const deltaY = positions[bOffset + 1] - positions[aOffset + 1]
	const deltaZ = positions[bOffset + 2] - positions[aOffset + 2]
	const distance = Math.max( Math.hypot( deltaX, deltaY, deltaZ ), 0.0001 )
	const error = compressOnly ? Math.min( distance - targetLength, 0 ) : distance - targetLength
	const correction = error / distance * stiffness

	positions[aOffset] += deltaX * correction * aWeight
	positions[aOffset + 1] += deltaY * correction * aWeight
	positions[aOffset + 2] += deltaZ * correction * aWeight
	positions[bOffset] -= deltaX * correction * bWeight
	positions[bOffset + 1] -= deltaY * correction * bWeight
	positions[bOffset + 2] -= deltaZ * correction * bWeight
}

class VerletRopesExample {
	constructor() {
		this.line = null
		this.rail = null
		this.floorGrid = null
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
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true

		this.uTime = uniform( 0 )
		this.uVelocityScale = uniform( 1 )
		this.uAccelerationScale = uniform( 0 )
		this.uMaxStepDisplacement = uniform( 0.011 )
		this.uRayOrigin = uniform( new Vector3( 0, 0, 18 ) )
		this.uRayDir = uniform( new Vector3( 0, 0, -1 ) )
		this.uPointerVelocity = uniform( new Vector3() )
		this.uPointerEngage = uniform( 0 )
		this.uPluckOrigin = uniform( new Vector3() )
		this.uPluck = uniform( 0 )

		this.raycaster = new Raycaster()
		this.rayOriginFrom = new Vector3( 0, 0, 18 )
		this.rayOriginTarget = new Vector3( 0, 0, 18 )
		this.rayDirFrom = new Vector3( 0, 0, -1 )
		this.rayDirTarget = new Vector3( 0, 0, -1 )
		this.lastPointerWorld = new Vector3()
		this.lastPointerTime = 0
		this.hasPointerPosition = false
		this.pointerEngage = 0
		this.downScreenPos = new Vector2()
		this.pointerDragged = false
		this.smoothFrameDt = 1 / 60
		this.lastStepDt = 1 / 240
		this.instructionStyle = null
		this.instructionElement = null
		this.instructionTimer = null
		this.pluckRipples = new Set()
	}

	async init() {
		await stage3d.initRender( { background: 0x050817 } )

		// Oblique 3D perspective angle with full camera orbit enabled.
		this.control = new OrbitControl( stage3d.camera, 18.5 )
		this.control._phi = 1.18
		this.control._theta = 1.04
		this.control.target.set( 0, -0.35, 0 )
		this.control.minRadius = 10.5
		this.control.maxRadius = 28
		this.control.minPhi = 0.48
		this.control.maxPhi = 1.82
		stage3d.control = this.control

		this.initScene()
		this.bloom = createBloomPipeline( { strength: 0.42, radius: 0.28, threshold: 0.32 } )
		this.createInstruction()
		onMove.add( this.onPointerMove )
		onDown.add( this.onPointerDown )
		onUp.add( this.onPointerUp )
		onLeave.add( this.onPointerLeave )
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		this._seedRopes()
		this.isGpuSimulation = stage3d.isWebGPU

		if ( this.isGpuSimulation ) this.initGpuSimulation()
		else this.initCpuSimulation()

		this.initPresentation()
		stage3d.add( this.floorGrid )
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

		this.positionBuffer = new StorageBufferAttribute( positionRecords, 4 )
		this.prevBuffer = new StorageBufferAttribute( previousRecords, 4 )
		this.ropeDataBuffer = new StorageBufferAttribute( this.ropeData, 4 )

		const positions = storage( this.positionBuffer, 'vec4', TOTAL_POINTS )
		const prevPositions = storage( this.prevBuffer, 'vec4', TOTAL_POINTS )
		const ropeData = storage( this.ropeDataBuffer, 'vec4', ROPE_COUNT )

		this.computeNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const data = ropeData.element( instanceIndex ).toVar()
			const anchor = data.xyz.toVar()
			const restLength = data.w.toVar()
			const anchorIndex = baseOffset.toUint().toVar()

			positions.element( anchorIndex ).assign( vec4( anchor, 1 ) )
			prevPositions.element( anchorIndex ).assign( vec4( anchor, 1 ) )

			// 1. Find the closest approach of the 3D cursor ray to this entire rope
			// so brushing anywhere along the cord swings the whole pendulum coherently.
			const minRayDist = float( 1e5 ).toVar()
			const ropePushDir = vec3( 0, 0, 0 ).toVar()
			const hitProgress = float( 0.7 ).toVar()
			Loop( { start: 2, end: POINTS_PER_ROPE, name: 'scanPoint' }, ( { scanPoint } ) => {
				const scanNum = float( scanPoint ).toVar()
				const scanIdx = baseOffset.add( scanNum ).toUint().toVar()
				const pos = positions.element( scanIdx ).xyz.toVar()
				const toPos = pos.sub( this.uRayOrigin ).toVar()
				const along = clamp( dot( toPos, this.uRayDir ), float( 2 ), float( 42 ) ).toVar()
				const onRay = this.uRayOrigin.add( this.uRayDir.mul( along ) ).toVar()
				const diff = pos.sub( onRay ).toVar()
				const dist = length( diff ).toVar()
				const closer = dist.lessThan( minRayDist )
				const horizDiff = vec3( diff.x, float( 0 ), diff.z )
				const horizNorm = horizDiff.div( max( length( horizDiff ), float( 0.001 ) ) )
				minRayDist.assign( closer.select( dist, minRayDist ) )
				ropePushDir.assign( closer.select( horizNorm, ropePushDir ) )
				hitProgress.assign( closer.select( scanNum.div( POINTS_PER_ROPE - 1 ), hitProgress ) )
			} )

			const ropeWake = float( 1 )
				.sub( smoothstep( 0, POINTER_WAKE_RADIUS, minRayDist ) )
				.mul( this.uPointerEngage )
				.toVar()
			const horizPointerVel = vec3( this.uPointerVelocity.x, float( 0 ), this.uPointerVelocity.z ).toVar()
			const pointerSpeed = length( horizPointerVel ).toVar()
			const rawBrushForce = horizPointerVel.mul( WAKE_SWISH_ACCELERATION )
				.add( ropePushDir.mul( pointerSpeed.add( 0.6 ).mul( WAKE_PUSH_ACCELERATION ) ) )
				.mul( ropeWake )
				.toVar()
			const brushMag = max( length( rawBrushForce ), float( 0.0001 ) ).toVar()
			const ropeForce = rawBrushForce.mul( min( float( MAX_BRUSH_ACCELERATION ).div( brushMag ), float( 1 ) ) ).toVar()

			// Whole-rope horizontal pluck impulse.
			const tipIdx = baseOffset.add( POINTS_PER_ROPE - 1 ).toUint().toVar()
			const midIdx = baseOffset.add( Math.floor( POINTS_PER_ROPE * 0.6 ) ).toUint().toVar()
			const samplePos = mix( positions.element( midIdx ).xyz, positions.element( tipIdx ).xyz, 0.5 ).toVar()
			const fromPluck = samplePos.sub( this.uPluckOrigin ).toVar()
			const pluckDist = max( length( fromPluck ), float( 0.0001 ) ).toVar()
			const horizPluckDir = vec3( fromPluck.x, float( 0 ), fromPluck.z )
				.div( max( length( vec2( fromPluck.x, fromPluck.z ) ), float( 0.001 ) ) )
			const ropePluckForce = horizPluckDir.mul(
				float( 1 ).sub( smoothstep( 0, PLUCK_RADIUS, pluckDist ) ).mul( this.uPluck ).mul( PLUCK_ACCELERATION )
			).toVar()

			// 2. Time-corrected Verlet integration.
			Loop( { start: 1, end: POINTS_PER_ROPE, name: 'point' }, ( { point } ) => {
				const pointNumber = float( point ).toVar()
				const idx = baseOffset.add( pointNumber ).toUint().toVar()
				const progress = pointNumber.div( POINTS_PER_ROPE - 1 ).toVar()

				const cur = positions.element( idx ).xyz.toVar()
				const prev = prevPositions.element( idx ).xyz.toVar()
				const rawVel = cur.sub( prev ).mul( this.uVelocityScale ).toVar()
				const speed = max( length( rawVel ), float( 0.0001 ) ).toVar()
				const velocity = rawVel.mul( min( this.uMaxStepDisplacement.div( speed ), float( 1 ) ) ).toVar()

				// Gentle 3D breeze in X and Z.
				const phaseX = this.uTime.mul( 0.9 )
					.add( anchor.x.mul( 0.24 ) )
					.add( anchor.z.mul( 0.31 ) )
					.add( progress.mul( 1.4 ) )
				const phaseZ = this.uTime.mul( 0.78 )
					.sub( anchor.x.mul( 0.19 ) )
					.add( anchor.z.mul( 0.29 ) )
					.add( progress.mul( 1.6 ) )
				const gust = sin( this.uTime.mul( 0.3 ).add( anchor.x.mul( 0.14 ) ).sub( anchor.z.mul( 0.18 ) ) )
					.mul( 0.2 ).add( 0.8 )
				const wind = vec3(
					sin( phaseX ),
					float( 0 ),
					cos( phaseZ ).mul( 0.9 ),
				).mul( progress.mul( gust ).mul( WIND_ACCELERATION ) )

				const distToHit = abs( progress.sub( hitProgress ) )
				const localFlex = float( 1 ).sub( smoothstep( 0, 0.5, distToHit ) ).mul( 0.2 )
				const pendulumGain = progress.mul( float( 0.85 ).add( localFlex ) )

				const acceleration = vec3( 0, GRAVITY, 0 )
					.add( wind )
					.add( ropeForce.mul( pendulumGain ) )
					.add( ropePluckForce.mul( progress ) )
				const next = cur.add( velocity ).add( acceleration.mul( this.uAccelerationScale ) ).toVar()

				prevPositions.element( idx ).assign( vec4( cur, 1 ) )
				positions.element( idx ).assign( vec4( next.x, max( next.y, float( FLOOR_Y ) ), next.z, 1 ) )
			} )

			// 3. Momentum-conserving symmetric Gauss-Seidel solver (0.5 / 0.5 weights,
			// 0 / 1 at the ceiling anchor) reproduces exact circular pendulum arcs.
			Loop( { start: 0, end: CONSTRAINT_ITERATIONS, name: 'iteration' }, () => {
				Loop( { start: 0, end: POINTS_PER_ROPE - 2, name: 'upLink' }, ( { upLink } ) => {
					const aPoint = float( POINTS_PER_ROPE - 2 ).sub( float( upLink ) ).toVar()
					const aIndex = baseOffset.add( aPoint ).toUint().toVar()
					const bIndex = aIndex.add( 1 ).toUint().toVar()
					const a = positions.element( aIndex ).xyz.toVar()
					const b = positions.element( bIndex ).xyz.toVar()
					const delta = b.sub( a ).toVar()
					const distance = max( length( delta ), float( 0.0001 ) ).toVar()
					const correction = delta.mul( distance.sub( restLength ).div( distance ).mul( 0.5 ) ).toVar()

					positions.element( aIndex ).assign( vec4( a.add( correction ), 1 ) )
					positions.element( bIndex ).assign( vec4( b.sub( correction ), 1 ) )
				} )

				Loop( { start: 0, end: POINTS_PER_ROPE - 1, name: 'downLink' }, ( { downLink } ) => {
					const aPoint = float( downLink ).toVar()
					const aIndex = baseOffset.add( aPoint ).toUint().toVar()
					const bIndex = aIndex.add( 1 ).toUint().toVar()
					const isAnchor = aPoint.equal( 0 )
					const aWeight = isAnchor.select( float( 0 ), float( 0.5 ) )
					const bWeight = isAnchor.select( float( 1 ), float( 0.5 ) )
					const a = positions.element( aIndex ).xyz.toVar()
					const b = positions.element( bIndex ).xyz.toVar()
					const delta = b.sub( a ).toVar()
					const distance = max( length( delta ), float( 0.0001 ) ).toVar()
					const correction = delta.mul( distance.sub( restLength ).div( distance ) ).toVar()

					positions.element( aIndex ).assign( vec4( a.add( correction.mul( aWeight ) ), 1 ) )
					positions.element( bIndex ).assign( vec4( b.sub( correction.mul( bWeight ) ), 1 ) )
				} )

				Loop( { start: 0, end: POINTS_PER_ROPE - 2, name: 'bend' }, ( { bend } ) => {
					const aPoint = float( bend ).toVar()
					const aIndex = baseOffset.add( aPoint ).toUint().toVar()
					const cIndex = aIndex.add( 2 ).toUint().toVar()
					const isAnchor = aPoint.equal( 0 )
					const aWeight = isAnchor.select( float( 0 ), float( 0.5 ) )
					const cWeight = isAnchor.select( float( 1 ), float( 0.5 ) )
					const a = positions.element( aIndex ).xyz.toVar()
					const c = positions.element( cIndex ).xyz.toVar()
					const delta = c.sub( a ).toVar()
					const distance = max( length( delta ), float( 0.0001 ) ).toVar()
					const correction = delta.mul(
						min( distance.sub( restLength.mul( MIN_BEND_RATIO ) ), float( 0 ) )
							.div( distance ).mul( BEND_STIFFNESS )
					).toVar()
					positions.element( aIndex ).assign( vec4( a.add( correction.mul( aWeight ) ), 1 ) )
					positions.element( cIndex ).assign( vec4( c.sub( correction.mul( cWeight ) ), 1 ) )
				} )

				Loop( { start: 1, end: POINTS_PER_ROPE, name: 'solverPoint' }, ( { solverPoint } ) => {
					const idx = baseOffset.add( float( solverPoint ) ).toUint().toVar()
					const cur = positions.element( idx ).xyz.toVar()
					positions.element( idx ).assign( vec4( cur.x, max( cur.y, float( FLOOR_Y ) ), cur.z, 1 ) )
				} )
			} )

			Loop( { start: 1, end: POINTS_PER_ROPE, name: 'contactPoint' }, ( { contactPoint } ) => {
				const idx = baseOffset.add( float( contactPoint ) ).toUint().toVar()
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

		// Smooth Catmull-Rom spline evaluation across the 14 physics points.
		const positionNode = Fn( ( [progress] ) => {
			const lastPoint = float( POINTS_PER_ROPE - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const i0 = baseOffset.add( max( pivot.sub( 1 ), float( 0 ) ) ).toUint().toVar()
			const i1 = baseOffset.add( pivot ).toUint().toVar()
			const i2 = baseOffset.add( min( pivot.add( 1 ), lastPoint ) ).toUint().toVar()
			const i3 = baseOffset.add( min( pivot.add( 2 ), lastPoint ) ).toUint().toVar()
			const p0 = positions.element( i0 ).xyz.toVar()
			const p1 = positions.element( i1 ).xyz.toVar()
			const p2 = positions.element( i2 ).xyz.toVar()
			const p3 = positions.element( i3 ).xyz.toVar()
			const t2 = t.mul( t ).toVar()
			const t3 = t2.mul( t ).toVar()
			return p1.mul( 2 )
				.add( p2.sub( p0 ).mul( t ) )
				.add( p0.mul( 2 ).sub( p1.mul( 5 ) ).add( p2.mul( 4 ) ).sub( p3 ).mul( t2 ) )
				.add( p1.mul( 3 ).sub( p0 ).sub( p2.mul( 3 ) ).add( p3 ).mul( t3 ) )
				.mul( 0.5 )
		} )

		const colorNode = Fn( ( [color, progress, side] ) => {
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
			const data = ropeData.element( instanceIndex ).toVar()
			const anchor = data.xyz.toVar()
			const restLength = data.w.toVar()

			const xRatio = clamp( anchor.x.div( ANCHOR_SPAN_X ).add( 0.5 ), 0, 1 )
			const zRatio = clamp( anchor.z.div( ANCHOR_SPAN_Z ).add( 0.5 ), 0, 1 )
			const cyan = vec3( 0.16, 0.82, 1.0 )
			const violet = vec3( 0.54, 0.38, 1.0 )
			const coral = vec3( 1.0, 0.38, 0.62 )
			const gold = vec3( 1.0, 0.76, 0.34 )
			const spanTint = mix( mix( cyan, violet, smoothstep( 0, 0.55, xRatio ) ), coral, smoothstep( 0.45, 1, xRatio ) )
			const fiber = mix( spanTint, gold, zRatio.mul( 0.38 ) )

			const edgeDist = clamp( side.abs(), 0, 1 )
			const cylinderProfile = sqrt( max( float( 1 ).sub( edgeDist.mul( edgeDist ) ), float( 0.04 ) ) )
			const cylinderShade = cylinderProfile.mul( 0.72 ).add( 0.28 )
			const depthCue = mix( float( 0.72 ), float( 1.12 ), zRatio )
			const verticalGradient = progress.pow( 1.35 ).mul( 0.76 ).add( 0.28 )
			const bead = smoothstep( 0.91, 0.975, progress )
			const cordColor = fiber.mul( verticalGradient ).mul( cylinderShade ).mul( depthCue )
			const baseColor = mix( cordColor, vec3( 1.0, 0.95, 0.86 ), bead.mul( 0.85 ) ).toVar()

			const strain = clamp(
				abs( length( p1.sub( p0 ) ).div( restLength ).sub( 1 ) ).mul( 6.5 ),
				0,
				1,
			).toVar()
			const strainedColor = mix( baseColor, vec3( 1.0, 0.52, 0.16 ), strain.mul( 0.65 ) ).toVar()

			const toPoint = samplePosition.sub( this.uRayOrigin ).toVar()
			const alongRay = clamp( dot( toPoint, this.uRayDir ), float( 2 ), float( 42 ) )
			const closestOnRay = this.uRayOrigin.add( this.uRayDir.mul( alongRay ) )
			const rayDist = length( samplePosition.sub( closestOnRay ) )
			const pointerGlow = float( 1 )
				.sub( smoothstep( 0, POINTER_WAKE_RADIUS, rayDist ) )
				.mul( this.uPointerEngage )
			const pluckGlow = float( 1 )
				.sub( smoothstep( 0, PLUCK_RADIUS, length( samplePosition.sub( this.uPluckOrigin ) ) ) )
				.mul( this.uPluck )
			const highlight = max( pointerGlow.mul( 0.55 ), pluckGlow.mul( 0.8 ) )
			return vec4( mix( strainedColor, vec3( 1.0, 0.94, 0.72 ), highlight ), 1 )
		} )

		const widthNode = Fn( ( [width, progress] ) => {
			const taper = progress.mul( 0.18 ).add( 0.82 )
			const swell = smoothstep( 0.92, 0.972, progress ).mul( float( 1 ).sub( smoothstep( 0.985, 1, progress ) ) )
			return width.mul( swell.mul( BEAD_SWELL ).add( taper.mul( FIBER_WIDTH ) ) )
		} )

		this.line = new MeshLine()
			.instances( ROPE_COUNT )
			.segments( RENDER_SEGMENTS )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.widthFn( widthNode )
			.lineWidth( 0.28 )
			.join( { type: 'bevel', limit: 1.4 } )
			.color( 0xffffff )
			.setFrustumCulled( false )
	}

	initCpuSimulation() {
		this.line = new MeshLine()
			.lines( this.cpuLines, false )
			.dynamic( true )
			.vertexColors( this.cpuColors )
			.widthCallback( beadWidth )
			.lineWidth( 0.28 )
			.join( { type: 'bevel', limit: 1.4 } )
			.color( 0xffffff )
			.setFrustumCulled( false )
	}

	initPresentation() {
		// 3D overhead trellis: 4 parallel rails in Z plus 2 connecting side beams.
		const railLines = []
		const halfSpanX = ANCHOR_SPAN_X * 0.54
		for ( let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++ ) {
			const rowRatio = ROW_COUNT > 1 ? rowIndex / ( ROW_COUNT - 1 ) : 0.5
			const z = ( rowRatio - 0.5 ) * ANCHOR_SPAN_Z
			const y = ANCHOR_Y + Math.cos( ( rowRatio - 0.5 ) * Math.PI * 0.9 ) * 0.22 + 0.12
			railLines.push( new Float32Array( [-halfSpanX, y, z, halfSpanX, y, z] ) )
		}
		for ( const sideSign of [-1, 1] ) {
			const sidePoints = new Float32Array( ROW_COUNT * 3 )
			const x = sideSign * halfSpanX
			for ( let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++ ) {
				const rowRatio = ROW_COUNT > 1 ? rowIndex / ( ROW_COUNT - 1 ) : 0.5
				const z = ( rowRatio - 0.5 ) * ANCHOR_SPAN_Z
				const y = ANCHOR_Y + Math.cos( ( rowRatio - 0.5 ) * Math.PI * 0.9 ) * 0.22 + 0.12
				const offset = rowIndex * 3
				sidePoints[offset] = x
				sidePoints[offset + 1] = y
				sidePoints[offset + 2] = z
			}
			railLines.push( sidePoints )
		}

		this.rail = new MeshLine()
			.lines( railLines, false )
			.lineWidth( 0.11 )
			.color( 0xffd27a )
			.gradientColor( 0x7ddfff )
			.antialias( true )
			.transparent( true )
			.opacity( 0.78 )

		// Subtle 3D ground frame at FLOOR_Y so perspective depth and height are immediately legible.
		const floorHalfX = ANCHOR_SPAN_X * 0.56
		const floorHalfZ = ANCHOR_SPAN_Z * 0.58
		const floorLines = [
			new Float32Array( [
				-floorHalfX,
				FLOOR_Y,
				-floorHalfZ,
				floorHalfX,
				FLOOR_Y,
				-floorHalfZ,
				floorHalfX,
				FLOOR_Y,
				floorHalfZ,
				-floorHalfX,
				FLOOR_Y,
				floorHalfZ,
				-floorHalfX,
				FLOOR_Y,
				-floorHalfZ,
			] ),
		]
		for ( let rowIndex = 0; rowIndex < ROW_COUNT; rowIndex++ ) {
			const rowRatio = ROW_COUNT > 1 ? rowIndex / ( ROW_COUNT - 1 ) : 0.5
			const z = ( rowRatio - 0.5 ) * ANCHOR_SPAN_Z
			floorLines.push( new Float32Array( [-floorHalfX, FLOOR_Y, z, floorHalfX, FLOOR_Y, z] ) )
		}

		this.floorGrid = new MeshLine()
			.lines( floorLines, false )
			.lineWidth( 0.055 )
			.color( 0x3b689c )
			.gradientColor( 0x6247aa )
			.antialias( true )
			.transparent( true )
			.opacity( 0.28 )

		this.line.build()

		stage3d.scene.backgroundNode = Fn( () => {
			const centered = uv().sub( vec2( 0.5 ) ).toVar()
			const vignette = smoothstep( 0.2, 0.82, length( centered.mul( vec2( 0.82, 1.15 ) ) ) )
			const vertical = smoothstep( 0, 1, uv().y )
			const base = mix( vec3( 0.004, 0.008, 0.024 ), vec3( 0.014, 0.008, 0.036 ), vertical )
			const centerGlow = float( 1 ).sub( smoothstep( 0.05, 0.68, length( centered ) ) )
			const pulseGlow = vec3( 0.08, 0.03, 0.05 )
				.mul( this.uPointerEngage.mul( 0.25 ).add( this.uPluck.mul( 0.35 ) ) )
			const color = base.add( vec3( 0.012, 0.01, 0.036 ).mul( centerGlow ) ).add( pulseGlow )
			return vec4( color.mul( float( 1 ).sub( vignette.mul( 0.46 ) ) ), 1 )
		} )()
	}

	_seedRopes() {
		this.cpuPositions = new Float32Array( TOTAL_POINTS * 3 )
		this.cpuPrevious = new Float32Array( TOTAL_POINTS * 3 )
		this.cpuColors = new Float32Array( TOTAL_POINTS * 3 )
		this.ropeData = new Float32Array( ROPE_COUNT * 4 )

		for ( let ropeIndex = 0; ropeIndex < ROPE_COUNT; ropeIndex++ ) {
			const { anchorX, anchorY, anchorZ, restLength, rowRatio, colRatio } = getAnchorData( ropeIndex )
			const dataOffset = ropeIndex * 4

			this.ropeData[dataOffset] = anchorX
			this.ropeData[dataOffset + 1] = anchorY
			this.ropeData[dataOffset + 2] = anchorZ
			this.ropeData[dataOffset + 3] = restLength

			const depthCue = 0.74 + 0.36 * rowRatio
			const baseR = ( 0.16 + 0.84 * colRatio ) * ( 1 - 0.28 * rowRatio ) + 0.28 * rowRatio
			const baseG = ( 0.82 - 0.44 * colRatio ) * ( 1 - 0.28 * rowRatio ) + 0.76 * 0.28 * rowRatio
			const baseB = ( 1.0 - 0.38 * colRatio ) * ( 1 - 0.28 * rowRatio ) + 0.34 * 0.28 * rowRatio

			for ( let pointIndex = 0; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const pointRatio = pointIndex / ( POINTS_PER_ROPE - 1 )
				const bow = Math.sin( pointRatio * Math.PI )
				const offset = ( ropeIndex * POINTS_PER_ROPE + pointIndex ) * 3
				const x = anchorX + bow * Math.sin( ropeIndex * 1.7 ) * 0.06
				const y = anchorY - pointIndex * restLength
				const z = anchorZ + bow * Math.cos( ropeIndex * 1.31 ) * 0.08
				const brightness = ( pointRatio ** 1.35 * 0.76 + 0.28 ) * depthCue
				const bead = smoothstepValue( 0.91, 0.975, pointRatio ) * 0.85

				this.cpuPositions[offset] = x
				this.cpuPositions[offset + 1] = y
				this.cpuPositions[offset + 2] = z
				this.cpuPrevious[offset] = x
				this.cpuPrevious[offset + 1] = y
				this.cpuPrevious[offset + 2] = z
				this.cpuColors[offset] = baseR * brightness * ( 1 - bead ) + bead
				this.cpuColors[offset + 1] = baseG * brightness * ( 1 - bead ) + bead * 0.95
				this.cpuColors[offset + 2] = baseB * brightness * ( 1 - bead ) + bead * 0.86
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
		const rayOrigin = this.uRayOrigin.value
		const rayDir = this.uRayDir.value
		const pointerVelocity = this.uPointerVelocity.value
		const horizPointerSpeed = Math.hypot( pointerVelocity.x, pointerVelocity.z )
		const pointerEngage = this.uPointerEngage.value
		const pluckOrigin = this.uPluckOrigin.value
		const pluck = this.uPluck.value
		const velocityScale = this.uVelocityScale.value
		const accelerationScale = this.uAccelerationScale.value
		const maxStepDisp = this.uMaxStepDisplacement.value
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

			// 1. Closest approach of the 3D cursor ray to this rope.
			let minRayDist = 1e5
			let hitProgress = 0.7
			_ropePushDir.set( 0, 0, 0 )
			for ( let pointIndex = 2; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const offset = ( basePoint + pointIndex ) * 3
				_rayDelta.set(
					positions[offset] - rayOrigin.x,
					positions[offset + 1] - rayOrigin.y,
					positions[offset + 2] - rayOrigin.z,
				)
				const along = Math.max( 2, Math.min( 42, _rayDelta.dot( rayDir ) ) )
				_closestOnRay.copy( rayDir ).multiplyScalar( along ).add( rayOrigin )
				_fromRay.set(
					positions[offset] - _closestOnRay.x,
					positions[offset + 1] - _closestOnRay.y,
					positions[offset + 2] - _closestOnRay.z,
				)
				const dist = _fromRay.length()
				if ( dist < minRayDist ) {
					minRayDist = dist
					const horizLen = Math.max( Math.hypot( _fromRay.x, _fromRay.z ), 0.001 )
					_ropePushDir.set( _fromRay.x / horizLen, 0, _fromRay.z / horizLen )
					hitProgress = pointIndex / ( POINTS_PER_ROPE - 1 )
				}
			}

			const ropeWake = ( 1 - smoothstepValue( 0, POINTER_WAKE_RADIUS, minRayDist ) ) * pointerEngage
			const pushScale = ( horizPointerSpeed + 0.6 ) * WAKE_PUSH_ACCELERATION
			let ropeForceX = ( pointerVelocity.x * WAKE_SWISH_ACCELERATION + _ropePushDir.x * pushScale ) * ropeWake
			let ropeForceZ = ( pointerVelocity.z * WAKE_SWISH_ACCELERATION + _ropePushDir.z * pushScale ) * ropeWake
			const brushMag = Math.max( Math.hypot( ropeForceX, ropeForceZ ), 0.0001 )
			const brushClamp = Math.min( MAX_BRUSH_ACCELERATION / brushMag, 1 )
			ropeForceX *= brushClamp
			ropeForceZ *= brushClamp

			const tipOffset = ( basePoint + POINTS_PER_ROPE - 1 ) * 3
			const midOffset = ( basePoint + Math.floor( POINTS_PER_ROPE * 0.6 ) ) * 3
			const sampleX = 0.5 * ( positions[midOffset] + positions[tipOffset] ) - pluckOrigin.x
			const sampleY = 0.5 * ( positions[midOffset + 1] + positions[tipOffset + 1] ) - pluckOrigin.y
			const sampleZ = 0.5 * ( positions[midOffset + 2] + positions[tipOffset + 2] ) - pluckOrigin.z
			const pluckDist = Math.max( Math.hypot( sampleX, sampleY, sampleZ ), 0.0001 )
			const horizPluckLen = Math.max( Math.hypot( sampleX, sampleZ ), 0.001 )
			const pluckMagnitude = ( 1 - smoothstepValue( 0, PLUCK_RADIUS, pluckDist ) ) * pluck * PLUCK_ACCELERATION
			const ropePluckX = sampleX / horizPluckLen * pluckMagnitude
			const ropePluckZ = sampleZ / horizPluckLen * pluckMagnitude

			// 2. Time-corrected Verlet integration.
			for ( let pointIndex = 1; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
				const offset = ( basePoint + pointIndex ) * 3
				const x = positions[offset]
				const y = positions[offset + 1]
				const z = positions[offset + 2]

				let velocityX = ( x - previous[offset] ) * velocityScale
				let velocityY = ( y - previous[offset + 1] ) * velocityScale
				let velocityZ = ( z - previous[offset + 2] ) * velocityScale
				const speed = Math.max( Math.hypot( velocityX, velocityY, velocityZ ), 0.0001 )
				const clampFactor = Math.min( maxStepDisp / speed, 1 )
				velocityX *= clampFactor
				velocityY *= clampFactor
				velocityZ *= clampFactor

				const progress = pointIndex / ( POINTS_PER_ROPE - 1 )
				const phaseX = time * 0.9 + anchorX * 0.24 + anchorZ * 0.31 + progress * 1.4
				const phaseZ = time * 0.78 - anchorX * 0.19 + anchorZ * 0.29 + progress * 1.6
				const gust = Math.sin( time * 0.3 + anchorX * 0.14 - anchorZ * 0.18 ) * 0.2 + 0.8
				const windScale = progress * gust * WIND_ACCELERATION

				const localFlex = ( 1 - smoothstepValue( 0, 0.5, Math.abs( progress - hitProgress ) ) ) * 0.2
				const pendulumGain = progress * ( 0.85 + localFlex )

				const accelerationX = Math.sin( phaseX ) * windScale + ropeForceX * pendulumGain + ropePluckX * progress
				const accelerationY = GRAVITY
				const accelerationZ = Math.cos( phaseZ ) * 0.9 * windScale + ropeForceZ * pendulumGain + ropePluckZ * progress

				previous[offset] = x
				previous[offset + 1] = y
				previous[offset + 2] = z
				positions[offset] = x + velocityX + accelerationX * accelerationScale
				positions[offset + 1] = Math.max( y + velocityY + accelerationY * accelerationScale, FLOOR_Y )
				positions[offset + 2] = z + velocityZ + accelerationZ * accelerationScale
			}

			// 3. Momentum-conserving symmetric Gauss-Seidel solver.
			for ( let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration++ ) {
				for ( let linkIndex = POINTS_PER_ROPE - 2; linkIndex >= 1; linkIndex-- ) {
					projectCpuLink( positions, basePoint, linkIndex, 1, restLength, 1, 0.5, 0.5 )
				}
				for ( let linkIndex = 0; linkIndex < POINTS_PER_ROPE - 1; linkIndex++ ) {
					const isAnchor = linkIndex === 0
					projectCpuLink( positions, basePoint, linkIndex, 1, restLength, 1, isAnchor ? 0 : 0.5, isAnchor ? 1 : 0.5 )
				}
				for ( let bendIndex = 0; bendIndex < POINTS_PER_ROPE - 2; bendIndex++ ) {
					const isAnchor = bendIndex === 0
					projectCpuLink( positions, basePoint, bendIndex, 2, restLength * MIN_BEND_RATIO, BEND_STIFFNESS, isAnchor ? 0 : 0.5, isAnchor ? 1 : 0.5, true )
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
			? 'Drag to orbit · tap to pluck'
			: 'Move to brush · drag to orbit · click to pluck'
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

	refreshPointerRay( trackVelocity ) {
		stage3d.camera.getWorldDirection( _planeNormal )
		_interactionPlane.setFromNormalAndCoplanarPoint( _planeNormal, this.control.target )

		this.raycaster.setFromCamera( _pointerNDC, stage3d.camera )
		if ( !this.raycaster.ray.intersectPlane( _interactionPlane, _pointerWorld ) ) {
			this.onPointerLeave()
			return false
		}

		const now = performance.now()
		const elapsed = ( now - this.lastPointerTime ) * 0.001
		const isOrbiting = Boolean( this.control?._isDown && this.pointerDragged )

		if ( trackVelocity && !isOrbiting && this.hasPointerPosition && elapsed > 0 && elapsed < 0.12 ) {
			_pointerVelocityTarget.copy( _pointerWorld ).sub( this.lastPointerWorld )
				.multiplyScalar( 1 / elapsed ).clampLength( 0, MAX_POINTER_SPEED )
			this.uPointerVelocity.value.lerp( _pointerVelocityTarget, 0.45 )
			const speedFactor = Math.min( 1, this.uPointerVelocity.value.length() / 1.6 )
			this.pointerEngage = Math.max( this.pointerEngage, speedFactor )
		} else if ( trackVelocity && !this.hasPointerPosition ) {
			this.uPointerVelocity.value.set( 0, 0, 0 )
		}

		this.lastPointerWorld.copy( _pointerWorld )
		this.lastPointerTime = now
		if ( !this.hasPointerPosition ) {
			this.rayOriginFrom.copy( this.raycaster.ray.origin )
			this.rayDirFrom.copy( this.raycaster.ray.direction )
		}
		this.hasPointerPosition = true
		this.rayOriginTarget.copy( this.raycaster.ray.origin )
		this.rayDirTarget.copy( this.raycaster.ray.direction )
		return true
	}

	onPointerMove = ( mouseData ) => {
		if ( this.control?._isDown ) {
			const dx = ( mouseData.x ?? 0 ) - this.downScreenPos.x
			const dy = ( mouseData.y ?? 0 ) - this.downScreenPos.y
			if ( Math.hypot( dx, dy ) > 6 ) {
				this.pointerDragged = true
				this.dismissInstruction()
			}
		}
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		return this.refreshPointerRay( true )
	}

	onPointerDown = ( mouseData ) => {
		if ( mouseData?.e?.target?.closest?.( 'button, a, input, select, .lil-gui' ) ) return
		this.downScreenPos.set( mouseData.x ?? 0, mouseData.y ?? 0 )
		this.pointerDragged = false
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.refreshPointerRay( false )
	}

	onPointerUp = ( mouseData ) => {
		if ( !this.pointerDragged && mouseData && !mouseData?.e?.target?.closest?.( 'button, a, input, select, .lil-gui' ) ) {
			_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
			if ( this.refreshPointerRay( false ) ) {
				this.uPluckOrigin.value.copy( _pointerWorld )
				this.uPluck.value = 1
				this.createPluckRipple( mouseData )
				this.dismissInstruction()
			}
		}
		this.pointerDragged = false
		if ( matchMedia( '(pointer: coarse)' ).matches ) {
			this.pointerEngage = 0
			this.uPointerEngage.value = 0
			this.uPointerVelocity.value.set( 0, 0, 0 )
			this.hasPointerPosition = false
		}
	}

	onPointerLeave = () => {
		this.pointerEngage = 0
		this.uPointerEngage.value = 0
		this.uPointerVelocity.value.set( 0, 0, 0 )
		this.hasPointerPosition = false
	}

	update = ( dt ) => {
		if ( !this.line || !stage3d.renderer ) return

		const frameDt = Math.min( Math.max( dt, 0 ) * 0.001, MAX_FRAME_DT )
		this.smoothFrameDt += ( frameDt - this.smoothFrameDt ) * FRAME_DT_SMOOTHING

		if ( this.control && !this.control._isDown && !this.reducedMotion ) {
			this.control._theta += Math.min( dt, 100 ) * AUTO_ROTATE_SPEED
		}

		if ( this.hasPointerPosition ) this.refreshPointerRay( false )
		this.uPointerVelocity.value.multiplyScalar( Math.exp( -POINTER_VELOCITY_DECAY * frameDt ) )
		if ( this.control?._isDown && this.pointerDragged ) {
			this.pointerEngage = 0
			this.uPointerVelocity.value.set( 0, 0, 0 )
		} else {
			this.pointerEngage *= Math.exp( -POINTER_ENGAGE_DECAY * frameDt )
			if ( this.pointerEngage < 0.001 ) this.pointerEngage = 0
		}
		this.uPointerEngage.value = this.pointerEngage

		const steps = Math.min( Math.max( Math.ceil( this.smoothFrameDt / MAX_STEP_DT ), 1 ), MAX_SUBSTEPS )
		const stepDt = this.smoothFrameDt / steps
		for ( let substep = 0; substep < steps; substep++ ) {
			const alpha = ( substep + 1 ) / steps
			this.uVelocityScale.value = stepDt / this.lastStepDt * Math.exp( -AIR_DRAG * stepDt )
			this.uAccelerationScale.value = stepDt * ( stepDt + this.lastStepDt ) * 0.5
			this.uMaxStepDisplacement.value = MAX_POINT_SPEED * stepDt
			this.lastStepDt = stepDt
			this.uRayOrigin.value.lerpVectors( this.rayOriginFrom, this.rayOriginTarget, alpha )
			this.uRayDir.value.lerpVectors( this.rayDirFrom, this.rayDirTarget, alpha ).normalize()
			this.uTime.value += stepDt
			if ( this.isGpuSimulation ) stage3d.renderer.compute( this.computeNode )
			else this.simulateCpu()
			this.uPluck.value *= Math.exp( -PLUCK_DECAY * stepDt )
			if ( this.uPluck.value < 0.0001 ) this.uPluck.value = 0
		}
		this.rayOriginFrom.copy( this.rayOriginTarget )
		this.rayDirFrom.copy( this.rayDirTarget )

		if ( !this.isGpuSimulation ) this.line.setPositions( this.cpuLines )
	}

	onResize = () => {
		this.line?.resize()
		this.rail?.resize()
		this.floorGrid?.resize()
		this.updateInstructionText()
	}

	show() {
		this.rayOriginFrom.copy( this.rayOriginTarget )
		this.rayDirFrom.copy( this.rayDirTarget )
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
		onLeave.remove( this.onPointerLeave )
		window.removeEventListener( 'resize', this.onResize )
		window.clearTimeout( this.instructionTimer )
		this.instructionElement?.remove()
		this.instructionStyle?.remove()
		for ( const ripple of this.pluckRipples ) ripple.remove()
		this.pluckRipples.clear()

		stage3d.remove( this.line )
		stage3d.remove( this.rail )
		stage3d.remove( this.floorGrid )
		this.computeNode?.dispose()
		this.line?.dispose()
		this.rail?.dispose()
		this.floorGrid?.dispose()
		this.bloom?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		stage3d.scene.backgroundNode = null

		this.line = null
		this.rail = null
		this.floorGrid = null
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

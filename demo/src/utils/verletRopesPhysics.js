/**
 * Rope layout and physics of the Verlet Ropes demo: time-corrected Verlet integration
 * plus a position-based constraint solver, written twice. createRopeCompute() is the
 * WebGPU compute shader; stepRopesCpu() mirrors it line for line for the WebGL2 fallback.
 * createRopeStepper() runs either one at a fixed ceiling on the step size.
 */
import { abs, clamp, cos, dot, float, Fn, instanceIndex, length, Loop, max, min, mix, sin, smoothstep, storage, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { MathUtils, StorageBufferAttribute, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { times } from '@/utils/points'

// 3D pavilion layout: 4 parallel overhead rails in Z × 13 ropes across X.
const ROW_COUNT = 4
const ROPES_PER_ROW = 13
export const ROPE_COUNT = ROW_COUNT * ROPES_PER_ROW
export const POINTS_PER_ROPE = 14
const TOTAL_POINTS = ROPE_COUNT * POINTS_PER_ROPE

export const ANCHOR_SPAN_X = 14.8
export const ANCHOR_SPAN_Z = 7.8
const ANCHOR_Y = 5.45
const SHORTEST_ROPE = 5.2
const LONGEST_ROPE = 8.9
export const FLOOR_Y = -5.15

// Fixed-ceiling substepping keeps the pendulum period identical across 60–240 Hz.
const MAX_STEP_DT = 1 / 220
const MAX_SUBSTEPS = 8
const FRAME_DT_SMOOTHING = 0.15

// Momentum-conserving 14-point chain under strong downward gravity:
// zero vertical bounce, < 0.05% stretch, and natural pendulum weight.
const AIR_DRAG = 0.58
const GRAVITY = -42
const MIN_BEND_RATIO = 1.99
const BEND_STIFFNESS = 0.45
const CONSTRAINT_ITERATIONS = 10
const WIND_ACCELERATION = 1.8

// Whole-rope pendulum wake: brushing any part of a cord swings the whole
// weighted pendant smoothly in (X, Z) with a strict acceleration ceiling.
export const POINTER_WAKE_RADIUS = 1.65
const WAKE_PUSH_ACCELERATION = 2.4
const WAKE_SWISH_ACCELERATION = 3.6
const MAX_BRUSH_ACCELERATION = 38
export const PLUCK_RADIUS = 3.3
const PLUCK_ACCELERATION = 40
const PLUCK_DECAY = 10
const MAX_POINT_SPEED = 3.4

const FLOOR_FRICTION = 0.12

const _rayDelta = new Vector3()
const _closestOnRay = new Vector3()
const _fromRay = new Vector3()
const _ropePushDir = new Vector3()

/** One overhead rail per row, arching up toward the middle of the pavilion. */
export const RAILS = times( ROW_COUNT, rowIndex => {
	const rowRatio = rowIndex / ( ROW_COUNT - 1 )
	return {
		rowRatio,
		y: ANCHOR_Y + Math.cos( ( rowRatio - 0.5 ) * Math.PI * 0.9 ) * 0.22,
		z: ( rowRatio - 0.5 ) * ANCHOR_SPAN_Z,
	}
} )

/** What both solvers read each substep. RopePointer and the stepper write these, the color hook reads the pointer ones. */
export const createRopeUniforms = () => ( {
	time: uniform( 0 ),
	velocityScale: uniform( 1 ),
	accelerationScale: uniform( 0 ),
	maxStepDisplacement: uniform( 0.011 ),
	rayOrigin: uniform( new Vector3( 0, 0, 18 ) ),
	rayDir: uniform( new Vector3( 0, 0, -1 ) ),
	pointerVelocity: uniform( new Vector3() ),
	pointerEngage: uniform( 0 ),
	pluckOrigin: uniform( new Vector3() ),
	pluck: uniform( 0 ),
} )

function getAnchorData( ropeIndex ) {
	const rowIndex = Math.floor( ropeIndex / ROPES_PER_ROW )
	const colIndex = ropeIndex % ROPES_PER_ROW
	const { rowRatio, y, z } = RAILS[rowIndex]
	const colRatio = colIndex / ( ROPES_PER_ROW - 1 )

	// Stagger alternate rows slightly in X so every rope is clearly visible in 3D.
	const stagger = ( rowIndex % 2 === 0 ? -0.5 : 0.5 ) * ( ANCHOR_SPAN_X / ( ROPES_PER_ROW - 1 ) ) * 0.28
	const anchorX = ( colRatio - 0.5 ) * ANCHOR_SPAN_X + stagger

	// Sculpted 3D canopy: longer in the center dome, shorter toward the outer corners.
	const radialX = ( colRatio - 0.5 ) * 2
	const radialZ = ( rowRatio - 0.5 ) * 2
	const radial = Math.min( 1, Math.hypot( radialX * 0.85, radialZ * 0.75 ) )
	const dome = Math.cos( radial * Math.PI * 0.5 ) ** 1.25
	const wave = Math.sin( colIndex * 1.15 + rowIndex * 1.4 ) * 0.28
	const totalLength = SHORTEST_ROPE + ( LONGEST_ROPE - SHORTEST_ROPE ) * dome + wave
	const restLength = totalLength / ( POINTS_PER_ROPE - 1 )

	return { anchorX, anchorY: y, anchorZ: z, restLength, rowRatio, colRatio }
}

/** Hanging start state. `lines` are views into `positions`, one per rope, and `colors` serve the CPU fallback. */
export function seedRopes() {
	const positions = new Float32Array( TOTAL_POINTS * 3 )
	const colors = new Float32Array( TOTAL_POINTS * 3 )
	const ropeData = new Float32Array( ROPE_COUNT * 4 )

	for ( let ropeIndex = 0; ropeIndex < ROPE_COUNT; ropeIndex++ ) {
		const { anchorX, anchorY, anchorZ, restLength, rowRatio, colRatio } = getAnchorData( ropeIndex )
		ropeData.set( [anchorX, anchorY, anchorZ, restLength], ropeIndex * 4 )

		const depthCue = 0.74 + 0.36 * rowRatio
		const baseR = ( 0.16 + 0.84 * colRatio ) * ( 1 - 0.28 * rowRatio ) + 0.28 * rowRatio
		const baseG = ( 0.82 - 0.44 * colRatio ) * ( 1 - 0.28 * rowRatio ) + 0.76 * 0.28 * rowRatio
		const baseB = ( 1.0 - 0.38 * colRatio ) * ( 1 - 0.28 * rowRatio ) + 0.34 * 0.28 * rowRatio

		for ( let pointIndex = 0; pointIndex < POINTS_PER_ROPE; pointIndex++ ) {
			const pointRatio = pointIndex / ( POINTS_PER_ROPE - 1 )
			const bow = Math.sin( pointRatio * Math.PI )
			const offset = ( ropeIndex * POINTS_PER_ROPE + pointIndex ) * 3
			const brightness = ( pointRatio ** 1.35 * 0.76 + 0.28 ) * depthCue
			const bead = MathUtils.smoothstep( pointRatio, 0.91, 0.975 ) * 0.85

			positions.set( [
				anchorX + bow * Math.sin( ropeIndex * 1.7 ) * 0.06,
				anchorY - pointIndex * restLength,
				anchorZ + bow * Math.cos( ropeIndex * 1.31 ) * 0.08,
			], offset )
			colors.set( [
				baseR * brightness * ( 1 - bead ) + bead,
				baseG * brightness * ( 1 - bead ) + bead * 0.95,
				baseB * brightness * ( 1 - bead ) + bead * 0.86,
			], offset )
		}
	}

	const floatsPerRope = POINTS_PER_ROPE * 3
	const lines = times( ROPE_COUNT, ropeIndex => positions.subarray( ropeIndex * floatsPerRope, ( ropeIndex + 1 ) * floatsPerRope ) )
	return { positions, previous: positions.slice(), colors, ropeData, lines }
}

const toVec4Attribute = source => {
	const records = new Float32Array( TOTAL_POINTS * 4 ).fill( 1 )
	for ( let point = 0; point < TOTAL_POINTS; point++ ) records.set( source.subarray( point * 3, point * 3 + 3 ), point * 4 )
	return stage3d.own( new StorageBufferAttribute( records, 4 ) )
}

function projectGpuLink( positions, baseOffset, aPoint, span, targetLength, stiffness, aWeight, bWeight, compressOnly = false ) {
	const aIndex = baseOffset.add( aPoint ).toUint().toVar()
	const bIndex = aIndex.add( span ).toUint().toVar()
	const a = positions.element( aIndex ).xyz.toVar()
	const b = positions.element( bIndex ).xyz.toVar()
	const delta = b.sub( a ).toVar()
	const distance = max( length( delta ), 0.0001 ).toVar()
	const error = distance.sub( targetLength )
	const correction = delta.mul( ( compressOnly ? min( error, 0 ) : error ).div( distance ).mul( stiffness ) ).toVar()

	positions.element( aIndex ).assign( vec4( a.add( correction.mul( aWeight ) ), 1 ) )
	positions.element( bIndex ).assign( vec4( b.sub( correction.mul( bWeight ) ), 1 ) )
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

/** The WebGPU solver. Returns its compute node and the storage nodes MeshLine's hooks read. */
export function createRopeCompute( seed, sim ) {
	const positions = storage( toVec4Attribute( seed.positions ), 'vec4', TOTAL_POINTS )
	const prevPositions = storage( toVec4Attribute( seed.previous ), 'vec4', TOTAL_POINTS )
	const ropeData = storage( stage3d.own( new StorageBufferAttribute( seed.ropeData, 4 ) ), 'vec4', ROPE_COUNT )

	const computeNode = stage3d.own( Fn( () => {
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
			const toPos = pos.sub( sim.rayOrigin ).toVar()
			const along = clamp( dot( toPos, sim.rayDir ), 2, 42 ).toVar()
			const onRay = sim.rayOrigin.add( sim.rayDir.mul( along ) ).toVar()
			const diff = pos.sub( onRay ).toVar()
			const dist = length( diff ).toVar()
			const closer = dist.lessThan( minRayDist )
			const horizDiff = vec3( diff.x, 0, diff.z )
			const horizNorm = horizDiff.div( max( length( horizDiff ), 0.001 ) )
			minRayDist.assign( closer.select( dist, minRayDist ) )
			ropePushDir.assign( closer.select( horizNorm, ropePushDir ) )
			hitProgress.assign( closer.select( scanNum.div( POINTS_PER_ROPE - 1 ), hitProgress ) )
		} )

		const ropeWake = smoothstep( 0, POINTER_WAKE_RADIUS, minRayDist ).oneMinus().mul( sim.pointerEngage ).toVar()
		const horizPointerVel = vec3( sim.pointerVelocity.x, 0, sim.pointerVelocity.z ).toVar()
		const pointerSpeed = length( horizPointerVel ).toVar()
		const rawBrushForce = horizPointerVel.mul( WAKE_SWISH_ACCELERATION )
			.add( ropePushDir.mul( pointerSpeed.add( 0.6 ).mul( WAKE_PUSH_ACCELERATION ) ) )
			.mul( ropeWake )
			.toVar()
		const brushMag = max( length( rawBrushForce ), 0.0001 ).toVar()
		const ropeForce = rawBrushForce.mul( min( float( MAX_BRUSH_ACCELERATION ).div( brushMag ), 1 ) ).toVar()

		// Whole-rope horizontal pluck impulse.
		const tipIdx = baseOffset.add( POINTS_PER_ROPE - 1 ).toUint().toVar()
		const midIdx = baseOffset.add( Math.floor( POINTS_PER_ROPE * 0.6 ) ).toUint().toVar()
		const samplePos = mix( positions.element( midIdx ).xyz, positions.element( tipIdx ).xyz, 0.5 ).toVar()
		const fromPluck = samplePos.sub( sim.pluckOrigin ).toVar()
		const pluckDist = max( length( fromPluck ), 0.0001 ).toVar()
		const horizPluckDir = vec3( fromPluck.x, 0, fromPluck.z )
			.div( max( length( vec2( fromPluck.x, fromPluck.z ) ), 0.001 ) )
		const ropePluckForce = horizPluckDir.mul(
			smoothstep( 0, PLUCK_RADIUS, pluckDist ).oneMinus().mul( sim.pluck ).mul( PLUCK_ACCELERATION )
		).toVar()

		// 2. Time-corrected Verlet integration.
		Loop( { start: 1, end: POINTS_PER_ROPE, name: 'point' }, ( { point } ) => {
			const pointNumber = float( point ).toVar()
			const idx = baseOffset.add( pointNumber ).toUint().toVar()
			const progress = pointNumber.div( POINTS_PER_ROPE - 1 ).toVar()

			const cur = positions.element( idx ).xyz.toVar()
			const prev = prevPositions.element( idx ).xyz.toVar()
			const rawVel = cur.sub( prev ).mul( sim.velocityScale ).toVar()
			const speed = max( length( rawVel ), 0.0001 ).toVar()
			const velocity = rawVel.mul( min( sim.maxStepDisplacement.div( speed ), 1 ) ).toVar()

			// Gentle 3D breeze in X and Z.
			const phaseX = sim.time.mul( 0.9 )
				.add( anchor.x.mul( 0.24 ) )
				.add( anchor.z.mul( 0.31 ) )
				.add( progress.mul( 1.4 ) )
			const phaseZ = sim.time.mul( 0.78 )
				.sub( anchor.x.mul( 0.19 ) )
				.add( anchor.z.mul( 0.29 ) )
				.add( progress.mul( 1.6 ) )
			const gust = sin( sim.time.mul( 0.3 ).add( anchor.x.mul( 0.14 ) ).sub( anchor.z.mul( 0.18 ) ) )
				.mul( 0.2 ).add( 0.8 )
			const wind = vec3( sin( phaseX ), 0, cos( phaseZ ).mul( 0.9 ) ).mul( progress.mul( gust ).mul( WIND_ACCELERATION ) )

			const distToHit = abs( progress.sub( hitProgress ) )
			const localFlex = smoothstep( 0, 0.5, distToHit ).oneMinus().mul( 0.2 )
			const pendulumGain = progress.mul( float( 0.85 ).add( localFlex ) )

			const acceleration = vec3( 0, GRAVITY, 0 )
				.add( wind )
				.add( ropeForce.mul( pendulumGain ) )
				.add( ropePluckForce.mul( progress ) )
			const next = cur.add( velocity ).add( acceleration.mul( sim.accelerationScale ) ).toVar()

			prevPositions.element( idx ).assign( vec4( cur, 1 ) )
			positions.element( idx ).assign( vec4( next.x, max( next.y, FLOOR_Y ), next.z, 1 ) )
		} )

		// 3. Momentum-conserving symmetric Gauss-Seidel solver (0.5 / 0.5 weights,
		// 0 / 1 at the ceiling anchor) reproduces exact circular pendulum arcs.
		Loop( { start: 0, end: CONSTRAINT_ITERATIONS, name: 'iteration' }, () => {
			Loop( { start: 0, end: POINTS_PER_ROPE - 2, name: 'upLink' }, ( { upLink } ) => {
				const aPoint = float( POINTS_PER_ROPE - 2 ).sub( float( upLink ) ).toVar()
				projectGpuLink( positions, baseOffset, aPoint, 1, restLength, 1, 0.5, 0.5 )
			} )

			Loop( { start: 0, end: POINTS_PER_ROPE - 1, name: 'downLink' }, ( { downLink } ) => {
				const aPoint = float( downLink ).toVar()
				const isAnchor = aPoint.equal( 0 )
				const aWeight = isAnchor.select( 0, 0.5 )
				const bWeight = isAnchor.select( 1, 0.5 )
				projectGpuLink( positions, baseOffset, aPoint, 1, restLength, 1, aWeight, bWeight )
			} )

			Loop( { start: 0, end: POINTS_PER_ROPE - 2, name: 'bend' }, ( { bend } ) => {
				const aPoint = float( bend ).toVar()
				const isAnchor = aPoint.equal( 0 )
				const aWeight = isAnchor.select( 0, 0.5 )
				const bWeight = isAnchor.select( 1, 0.5 )
				projectGpuLink( positions, baseOffset, aPoint, 2, restLength.mul( MIN_BEND_RATIO ), BEND_STIFFNESS, aWeight, bWeight, true )
			} )

			Loop( { start: 1, end: POINTS_PER_ROPE, name: 'solverPoint' }, ( { solverPoint } ) => {
				const idx = baseOffset.add( float( solverPoint ) ).toUint().toVar()
				const cur = positions.element( idx ).xyz.toVar()
				positions.element( idx ).assign( vec4( cur.x, max( cur.y, FLOOR_Y ), cur.z, 1 ) )
			} )
		} )

		Loop( { start: 1, end: POINTS_PER_ROPE, name: 'contactPoint' }, ( { contactPoint } ) => {
			const idx = baseOffset.add( float( contactPoint ) ).toUint().toVar()
			const cur = positions.element( idx ).xyz.toVar()
			const previous = prevPositions.element( idx ).xyz.toVar()
			const floorContact = cur.y.lessThan( FLOOR_Y + 0.0001 )
			const contactPrevious = vec3(
				mix( previous.x, cur.x, FLOOR_FRICTION ),
				cur.y,
				mix( previous.z, cur.z, FLOOR_FRICTION ),
			)

			prevPositions.element( idx ).assign( vec4( floorContact.select( contactPrevious, previous ), 1 ) )
		} )
	} )().compute( ROPE_COUNT ) )

	return { computeNode, positions, ropeData }
}

/** One substep of the WebGL2 fallback, mirroring the compute shader above. */
export function stepRopesCpu( { positions, previous, ropeData }, sim ) {
	const rayOrigin = sim.rayOrigin.value
	const rayDir = sim.rayDir.value
	const pointerVelocity = sim.pointerVelocity.value
	const horizPointerSpeed = Math.hypot( pointerVelocity.x, pointerVelocity.z )
	const pointerEngage = sim.pointerEngage.value
	const pluckOrigin = sim.pluckOrigin.value
	const pluck = sim.pluck.value
	const velocityScale = sim.velocityScale.value
	const accelerationScale = sim.accelerationScale.value
	const maxStepDisp = sim.maxStepDisplacement.value
	const time = sim.time.value

	for ( let ropeIndex = 0; ropeIndex < ROPE_COUNT; ropeIndex++ ) {
		const dataOffset = ropeIndex * 4
		const anchorX = ropeData[dataOffset]
		const anchorY = ropeData[dataOffset + 1]
		const anchorZ = ropeData[dataOffset + 2]
		const restLength = ropeData[dataOffset + 3]
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
			const along = MathUtils.clamp( _rayDelta.dot( rayDir ), 2, 42 )
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

		const ropeWake = ( 1 - MathUtils.smoothstep( minRayDist, 0, POINTER_WAKE_RADIUS ) ) * pointerEngage
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
		const pluckMagnitude = ( 1 - MathUtils.smoothstep( pluckDist, 0, PLUCK_RADIUS ) ) * pluck * PLUCK_ACCELERATION
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

			const localFlex = ( 1 - MathUtils.smoothstep( Math.abs( progress - hitProgress ), 0, 0.5 ) ) * 0.2
			const pendulumGain = progress * ( 0.85 + localFlex )

			const accelerationX = Math.sin( phaseX ) * windScale + ropeForceX * pendulumGain + ropePluckX * progress
			const accelerationZ = Math.cos( phaseZ ) * 0.9 * windScale + ropeForceZ * pendulumGain + ropePluckZ * progress

			previous[offset] = x
			previous[offset + 1] = y
			previous[offset + 2] = z
			positions[offset] = x + velocityX + accelerationX * accelerationScale
			positions[offset + 1] = Math.max( y + velocityY + GRAVITY * accelerationScale, FLOOR_Y )
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

/** Returns `advance( frameDt )`, which runs `solve()` once per substep with time-corrected scales. */
export function createRopeStepper( sim, pointer, solve ) {
	let smoothFrameDt = 1 / 60
	let lastStepDt = 1 / 240

	return frameDt => {
		smoothFrameDt += ( frameDt - smoothFrameDt ) * FRAME_DT_SMOOTHING
		const steps = MathUtils.clamp( Math.ceil( smoothFrameDt / MAX_STEP_DT ), 1, MAX_SUBSTEPS )
		const stepDt = smoothFrameDt / steps
		for ( let substep = 0; substep < steps; substep++ ) {
			sim.velocityScale.value = stepDt / lastStepDt * Math.exp( -AIR_DRAG * stepDt )
			sim.accelerationScale.value = stepDt * ( stepDt + lastStepDt ) * 0.5
			sim.maxStepDisplacement.value = MAX_POINT_SPEED * stepDt
			lastStepDt = stepDt
			pointer.sweepRay( ( substep + 1 ) / steps )
			sim.time.value += stepDt
			solve()
			sim.pluck.value *= Math.exp( -PLUCK_DECAY * stepDt )
			if ( sim.pluck.value < 0.0001 ) sim.pluck.value = 0
		}
		pointer.endSweep()
	}
}

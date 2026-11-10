/** Traffic of the Road Builder demo: toy cars that drive the built road out and back. None of it is MeshLine API. */
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
	BoxGeometry,
	BufferAttribute,
	Color,
	CylinderGeometry,
	DynamicDrawUsage,
	Euler,
	ExtrudeGeometry,
	InstancedMesh,
	MathUtils,
	Matrix4,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	Quaternion,
	Shape,
	Vector3,
} from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { times } from '@/utils/points'

const CAR_COUNT = 6
const CAR_LENGTH = 3.3
const CAR_WIDTH = 1.5
const WHEELBASE = 2
const BEVEL = 0.07
const PAINTS = [0xD9D5C8, 0xE8A91E, 0x2A63D9, 0xD43D43, 0x1DA598, 0x30353F]

// Metres of circuit each car needs, and the shortest road worth driving.
const CAR_SPACING = 9
const MIN_ROUTE = 12
const TOP_SPEED = 16
const TURN_SPEED = 2.6
// Lateral acceleration a car accepts in a bend, then how hard it brakes and pulls away.
const GRIP = 9
const BRAKING = 6
const THROTTLE = 4.5
const HEADWAY = 0.9

const _euler = new Euler()
const _frame = new Quaternion()
const _matrix = new Matrix4()
const _rear = new Vector3()
const _front = new Vector3()
const _forward = new Vector3()
const _left = new Vector3()
const _up = new Vector3()
const _probe = new Vector3()
const _color = new Color()
// Where a point of the circuit sits on the road: metres along the centreline, metres to its left.
const _lane = { distance: 0, lateral: 0, turning: false }

//---------------------------------------------------------- CAR MODEL

/** One flat colour over a part, so the trim merges into a single vertex-coloured geometry. */
const tint = ( geometry, r, g, b ) => {
	const part = geometry.index ? geometry.toNonIndexed() : geometry
	const colors = new Float32Array( part.getAttribute( 'position' ).count * 3 )
	for ( let offset = 0; offset < colors.length; offset += 3 ) colors.set( [r, g, b], offset )
	part.setAttribute( 'color', new BufferAttribute( colors, 3 ) )
	return part
}

/** A side profile drawn as `[z, y]` pairs and extruded across the car, which faces +Z. */
const extrudeProfile = ( outline, width, bevel = 0 ) => {
	const shape = new Shape()
	outline.forEach( ( [z, y], index ) => index ? shape.lineTo( z, y ) : shape.moveTo( z, y ) )
	const depth = width - bevel * 2
	const geometry = new ExtrudeGeometry( shape, {
		depth,
		bevelEnabled: bevel > 0,
		bevelThickness: bevel,
		bevelSize: bevel,
		bevelOffset: -bevel,
		bevelSegments: 2,
	} )
	return geometry.translate( 0, 0, -depth / 2 ).rotateY( -Math.PI / 2 )
}

/**
 * A panel `width` across, laid on the slope of the profile from `[z0, y0]` forward to `[z1, y1]`.
 * It faces up and is one-sided, so the driver's seat looks straight through the glass.
 */
const slopePanel = ( z0, y0, z1, y1, width, cover = 1 ) => {
	const length = Math.hypot( z1 - z0, y1 - y0 )
	const normalY = ( z1 - z0 ) / length
	const normalZ = ( y0 - y1 ) / length
	return new PlaneGeometry( width, length * cover )
		.rotateX( Math.atan2( -normalY, normalZ ) )
		.translate( 0, ( y0 + y1 ) / 2 + normalY * 0.012, ( z0 + z1 ) / 2 + normalZ * 0.012 )
}

function createCarGeometries() {
	// Bumper to bumper over the roof: boot, rear window, roof, windscreen, bonnet, nose.
	const outline = [[-1.6, 0.24], [-1.64, 0.62], [-1.18, 0.68], [-0.78, 1.06], [0.18, 1.06], [0.7, 0.7], [1.54, 0.6], [1.64, 0.42], [1.58, 0.24]]
	const shell = extrudeProfile( outline, CAR_WIDTH, BEVEL )

	const glass = [0.05, 0.07, 0.09]
	const parts = [
		tint( extrudeProfile( [[-1.02, 0.73], [-0.72, 1], [0.14, 1], [0.54, 0.73]], CAR_WIDTH + 0.02 ), ...glass ),
		tint( slopePanel( 0.18, 1.06, 0.7, 0.7, CAR_WIDTH - 0.3, 0.8 ), ...glass ),
		tint( slopePanel( -1.18, 0.68, -0.78, 1.06, CAR_WIDTH - 0.3, 0.8 ), ...glass ),
		// A dashboard: without one the driver looks down through the bonnet at the front wheels.
		tint( slopePanel( 0.26, 0.4, 0.7, 0.7, CAR_WIDTH - 0.02 ), 0.012, 0.013, 0.016 ),
	]
	for ( const side of [-1, 1] ) {
		// Lamps are brighter than white, so they still glow on the shaded end of the car.
		parts.push(
			tint( new BoxGeometry( 0.34, 0.1, 0.06 ).translate( side * 0.46, 0.5, 1.585 ), 2.4, 2.2, 1.7 ),
			tint( new BoxGeometry( 0.36, 0.09, 0.06 ).translate( side * 0.45, 0.52, -1.6 ), 2.6, 0.12, 0.1 ),
		)
		for ( const axle of [-1, 1] ) {
			const tyre = new CylinderGeometry( 0.31, 0.31, 0.26, 18 ).rotateZ( Math.PI / 2 )
			const hub = new CylinderGeometry( 0.17, 0.17, 0.28, 12 ).rotateZ( Math.PI / 2 )
			for ( const wheel of [tyre, hub] ) wheel.translate( side * 0.64, 0.31, axle * WHEELBASE * 0.5 )
			parts.push( tint( tyre, 0.03, 0.03, 0.035 ), tint( hub, 0.5, 0.52, 0.55 ) )
		}
	}
	return { shell, trim: mergeGeometries( parts ) }
}

//---------------------------------------------------------- TRAFFIC

/**
 * Cars follow the centreline of the built road at one lane's offset, turn round
 * at each end and come back on the other side. Each one keeps its two axles on
 * the deck, so it pitches, rolls and steers with the road it is on.
 */
export class RoadTraffic {
	// `phase` is metres round the circuit. Every car keeps the same pace, so they stay spread along the road.
	cars = times( CAR_COUNT, () => ( { phase: 0, speed: 0, position: new Vector3(), quaternion: new Quaternion() } ) )
	active = 0
	rows = 0
	length = 0
	circuit = 0
	straight = 0
	laneOffset = 1
	// Per road row: metres travelled, the deck's left and up axes, and the speed a car may hold there.
	distance = new Float32Array( 0 )
	left = new Float32Array( 0 )
	up = new Float32Array( 0 )
	limit = new Float32Array( 0 )

	constructor() {
		const { shell, trim } = createCarGeometries()
		this.body = new InstancedMesh( shell, new MeshStandardNodeMaterial( { roughness: 0.45 } ), CAR_COUNT )
		this.trim = new InstancedMesh( trim, new MeshStandardNodeMaterial( { roughness: 0.55, vertexColors: true } ), CAR_COUNT )
		for ( const mesh of [this.body, this.trim] ) {
			mesh.count = 0
			mesh.castShadow = true
			mesh.frustumCulled = false
			mesh.instanceMatrix.setUsage( DynamicDrawUsage )
		}
		this.cars.forEach( ( car, index ) => this.body.setColorAt( index, _color.setHex( PAINTS[index % PAINTS.length] ) ) )
		stage3d.add( this.body, this.trim )
	}

	/** Drive `plan`, the route the road ribbon shows, `laneOffset` metres either side of its centreline. */
	setRoute( plan, laneOffset ) {
		const previousCircuit = this.circuit
		const rows = plan ? plan.points.length / 3 : 0
		this.points = plan?.points
		this.rows = rows
		this.laneOffset = laneOffset
		if ( rows >= 2 ) this.measureRoute( plan )
		this.length = rows >= 2 ? this.distance[rows - 1] : 0

		// A turn at each end is half a circle from one lane to the other.
		this.straight = Math.max( 0, this.length - laneOffset * 2 )
		this.circuit = ( this.straight + Math.PI * laneOffset ) * 2
		const active = this.length < MIN_ROUTE ? 0 : MathUtils.clamp( Math.floor( this.circuit / CAR_SPACING ), 1, CAR_COUNT )
		if ( active !== this.active ) {
			this.active = active
			this.cars.forEach( ( car, index ) => car.phase = this.circuit * index / Math.max( 1, active ) )
		} else if ( previousCircuit > 0 ) {
			// An edit stretches the circuit under the cars instead of sliding them along it.
			for ( const car of this.cars ) car.phase *= this.circuit / previousCircuit
		}
		this.body.count = this.trim.count = active
		this.update( 0 )
	}

	measureRoute( { points, bank } ) {
		const { rows } = this
		if ( this.distance.length < rows ) {
			const capacity = Math.ceil( rows * 1.5 )
			this.distance = new Float32Array( capacity )
			this.limit = new Float32Array( capacity )
			this.left = new Float32Array( capacity * 3 )
			this.up = new Float32Array( capacity * 3 )
		}
		const { distance, limit, left, up } = this

		for ( let row = 0; row < rows; row++ ) {
			const offset = row * 3
			const before = Math.max( 0, row - 1 ) * 3
			const after = Math.min( rows - 1, row + 1 ) * 3
			_rear.fromArray( points, offset ).sub( _probe.fromArray( points, before ) )
			_front.fromArray( points, after ).sub( _probe.fromArray( points, offset ) )
			const entering = _rear.length()
			const leaving = _front.length()
			distance[row] = row === 0 ? 0 : distance[row - 1] + entering
			if ( row === 0 ) _rear.copy( _front )
			if ( row === rows - 1 ) _front.copy( _rear )
			_rear.normalize()
			_front.normalize()

			// A row lies across the bisector of its two segments, level, then rolled by its bank:
			// the yaw, climb, bank recipe the surface and the bridge piers share.
			_forward.addVectors( _rear, _front ).normalize()
			_euler.set( -Math.atan2( _forward.y, Math.hypot( _forward.x, _forward.z ) ), Math.atan2( _forward.x, _forward.z ), bank[row], 'YXZ' )
			_frame.setFromEuler( _euler )
			_left.set( 1, 0, 0 ).applyQuaternion( _frame ).toArray( left, offset )
			_up.set( 0, 1, 0 ).applyQuaternion( _frame ).toArray( up, offset )

			const curvature = _rear.angleTo( _front ) / Math.max( 1e-3, ( entering + leaving ) * 0.5 )
			limit[row] = Math.min( TOP_SPEED, Math.sqrt( GRIP / Math.max( curvature, 1e-4 ) ) )
		}

		// Cars slow for the turn at each end, and brake early enough for every bend whichever way they travel.
		limit[0] = limit[rows - 1] = TURN_SPEED
		for ( let row = rows - 2; row >= 0; row-- ) {
			limit[row] = Math.min( limit[row], Math.sqrt( limit[row + 1] ** 2 + 2 * BRAKING * ( distance[row + 1] - distance[row] ) ) )
		}
		for ( let row = 1; row < rows; row++ ) {
			limit[row] = Math.min( limit[row], Math.sqrt( limit[row - 1] ** 2 + 2 * BRAKING * ( distance[row] - distance[row - 1] ) ) )
		}
	}

	/** Unroll the circuit: out on the right-hand lane, half a circle, back on the other lane, half a circle. */
	locate( phase ) {
		const { straight, laneOffset: offset, length } = this
		const turn = Math.PI * offset
		let along = MathUtils.euclideanModulo( phase, this.circuit )
		_lane.turning = false
		if ( along < straight ) {
			_lane.distance = offset + along
			_lane.lateral = -offset
			return _lane
		}
		along -= straight
		if ( along < turn ) {
			_lane.turning = true
			_lane.distance = length - offset + Math.sin( along / offset ) * offset
			_lane.lateral = -Math.cos( along / offset ) * offset
			return _lane
		}
		along -= turn
		if ( along < straight ) {
			_lane.distance = length - offset - along
			_lane.lateral = offset
			return _lane
		}
		along -= straight
		_lane.turning = true
		_lane.distance = offset - Math.sin( along / offset ) * offset
		_lane.lateral = Math.cos( along / offset ) * offset
		return _lane
	}

	/** The row a centreline distance falls after, and how far it is towards the next one. */
	segment( distance ) {
		let lower = 0
		let upper = this.rows - 1
		while ( lower + 1 < upper ) {
			const middle = ( lower + upper ) >> 1
			if ( this.distance[middle] <= distance ) lower = middle
			else upper = middle
		}
		const span = this.distance[upper] - this.distance[lower]
		this.segmentBlend = span > 0 ? MathUtils.clamp( ( distance - this.distance[lower] ) / span, 0, 1 ) : 0
		return lower
	}

	/** Write into `target` the point of the deck under `phase`, and return the row it follows. */
	deckPoint( phase, target ) {
		const { distance, lateral } = this.locate( phase )
		const row = this.segment( distance )
		const blend = this.segmentBlend
		const offset = row * 3
		_probe.fromArray( this.left, offset ).lerp( _left.fromArray( this.left, offset + 3 ), blend ).normalize()
		target.fromArray( this.points, offset ).lerp( _left.fromArray( this.points, offset + 3 ), blend ).addScaledVector( _probe, lateral )
		return row
	}

	/** The pace a car may hold at `phase`: as fast as it can go and still brake for the rows either side. */
	speedLimit( phase ) {
		const { distance, turning } = this.locate( phase )
		if ( turning ) return TURN_SPEED
		const row = this.segment( distance )
		return Math.min(
			TOP_SPEED,
			Math.sqrt( this.limit[row] ** 2 + 2 * BRAKING * ( distance - this.distance[row] ) ),
			Math.sqrt( this.limit[row + 1] ** 2 + 2 * BRAKING * ( this.distance[row + 1] - distance ) ),
		)
	}

	update( dt ) {
		const { active, cars, circuit } = this
		if ( active === 0 ) return
		const seconds = dt / 1000

		for ( let index = 0; index < active; index++ ) {
			const car = cars[index]
			// Cars never overtake, so the one ahead is always the next one round the circuit.
			const gap = active > 1 ? MathUtils.euclideanModulo( cars[( index + 1 ) % active].phase - car.phase, circuit ) - CAR_LENGTH : Infinity
			const target = Math.min( this.speedLimit( car.phase ), Math.max( 0, gap - 1 ) / HEADWAY )
			const change = ( target > car.speed ? THROTTLE : BRAKING ) * seconds
			car.speed += MathUtils.clamp( target - car.speed, -change, change )
			car.phase = ( car.phase + Math.min( car.speed * seconds, Math.max( 0, gap - 0.5 ) ) ) % circuit
			this.placeCar( car, index )
		}
		this.body.instanceMatrix.needsUpdate = true
		this.trim.instanceMatrix.needsUpdate = true
	}

	/** Stand the car on its two axles, which gives it the heading, pitch and roll of the deck under it. */
	placeCar( car, index ) {
		this.deckPoint( car.phase - WHEELBASE * 0.5, _rear )
		this.deckPoint( car.phase + WHEELBASE * 0.5, _front )
		const row = this.segment( this.locate( car.phase ).distance )
		_up.fromArray( this.up, row * 3 ).lerp( _probe.fromArray( this.up, row * 3 + 3 ), this.segmentBlend )

		_forward.subVectors( _front, _rear ).normalize()
		_left.crossVectors( _up, _forward ).normalize()
		_up.crossVectors( _forward, _left )
		car.position.addVectors( _rear, _front ).multiplyScalar( 0.5 )
		_matrix.makeBasis( _left, _up, _forward ).setPosition( car.position )
		car.quaternion.setFromRotationMatrix( _matrix )
		this.body.setMatrixAt( index, _matrix )
		this.trim.setMatrixAt( index, _matrix )
	}

	/** The car `ray` points at, nearest first, or -1. */
	pick( ray ) {
		let picked = -1
		let nearest = Infinity
		for ( let index = 0; index < this.active; index++ ) {
			_probe.copy( this.cars[index].position )
			_probe.y += 0.6
			if ( ray.distanceSqToPoint( _probe ) > 2.6 ) continue
			const depth = _probe.sub( ray.origin ).dot( ray.direction )
			if ( depth < 0 || depth >= nearest ) continue
			nearest = depth
			picked = index
		}
		return picked
	}
}

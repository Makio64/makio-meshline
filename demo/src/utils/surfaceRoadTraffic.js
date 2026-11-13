/** Traffic of the Road Builder demo: toy cars that drive the built road out and back. None of it is MeshLine API. */
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { color, Fn, mix, normalView, positionViewDirection, reflectVector } from 'three/tsl'
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CircleGeometry,
	Color,
	CylinderGeometry,
	Euler,
	ExtrudeGeometry,
	InstancedMesh,
	MathUtils,
	Matrix4,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	PlaneGeometry,
	Quaternion,
	Shape,
	SphereGeometry,
	StreamDrawUsage,
	Vector3,
} from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { times } from '@/utils/points'
import { signedAngle } from '@/utils/surfaceRoadRoute'

const MAX_CARS = 20
const CAR_LENGTH = 3
const CAR_WIDTH = 1.35
const CABIN_WIDTH = 1.12
const WHEELBASE = 1.8
const TRACK = 1.13
const WHEEL_RADIUS = 0.26
// Room the body leaves round each tyre.
const ARCH = 0.05
const BEVEL = 0.055
// The deck the cabin stands on, from the foot of the rear glass to the scuttle, as `[z, y]`.
const DECK = [[-1.05, 0.7], [0.42, 0.67]]
// The well cut into that deck for the cockpit: half its width, and where it starts and ends.
export const WELL = { half: 0.5, rear: -0.95, front: 0.36 }
export const PAINTS = [0xECE8DC, 0xFFB81C, 0x1F6FEB, 0xE2362B, 0x12B5A0, 0x2A2E36]
// A door mirror: where the middle of its glass is on the left-hand door, and half the width and height of that glass.
export const DOOR_MIRROR = { x: CABIN_WIDTH * 0.5 + 0.078, y: 0.742, z: 0.262, half: [0.046, 0.024] }
// The light bar across the tail: lit, and under braking. Unlit paint, so it glows on the shaded end of the car too.
const TAIL = new Color( 0.5, 0.02, 0.015 )
const BRAKE = new Color( 1, 0.2, 0.12 )

// Leave a generous gap: one car per 48 metres across both lanes.
const CAR_SPACING = 48
const MIN_ROUTE = 12
// Edit and Follow use this driving model as it is. Drive slows it down: from the
// driver's seat the same pace is a blur, and the dashboard has figures to read.
const DRIVE_PACE = 0.6
const TOP_SPEED = 26
const TURN_SPEED = 3
// Lateral acceleration a car accepts in a bend, and the braking it counts on to get down to that pace.
const GRIP = 14
const BRAKING = 9
// The hardest a car brakes and pulls away, how fast its pedals move in m/s³, and how far ahead its driver reads the road in seconds.
const HARD_BRAKING = 12
const THROTTLE = 8.5
const JERK = 32
const FORESIGHT = 0.3
const HEADWAY = 0.9
// Radians the body leans per m/s² in a bend and under the pedals, and the most the front wheels turn.
const ROLL = 0.0055
const DIVE = 0.004
const MAX_LEAN = 0.09
const MAX_STEER = 0.6

const _euler = new Euler()
const _frame = new Quaternion()
const _matrix = new Matrix4()
const _part = new Matrix4()
const _stripe = new Matrix4()
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

/**
 * What polish mirrors towards `direction`: the sky of this scene, the haze under it and the meadows
 * under that. There is no environment map here, so paint and trim mirror their surroundings by hand.
 */
export const surroundings = Fn( ( [direction] ) => {
	const elevation = direction.normalize().y
	const sky = mix( color( 0xB9D6E3 ), color( 0x5C9CCF ), elevation.smoothstep( 0, 0.55 ) )
	return mix( color( 0x5F7F45 ), sky, elevation.smoothstep( -0.2, 0.02 ) )
} )

/** How much of them a polished surface shows: a little head on, all of it at a glancing angle. */
export const glance = normalView.dot( positionViewDirection ).clamp().oneMinus().pow( 5 ).mul( 0.96 ).add( 0.04 )

/** One flat colour over a part, so the trim merges into a single vertex-coloured geometry. */
const tint = ( geometry, r, g, b ) => {
	const part = geometry.index ? geometry.toNonIndexed() : geometry
	const colors = new Float32Array( part.getAttribute( 'position' ).count * 3 )
	for ( let offset = 0; offset < colors.length; offset += 3 ) colors.set( [r, g, b], offset )
	part.setAttribute( 'color', new BufferAttribute( colors, 3 ) )
	return part
}

/** A side profile drawn as `[z, y]` pairs and extruded across the car, which faces +Z. */
export const extrudeProfile = ( outline, width, bevel = 0 ) => {
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

/** The underside of the body from the nose back to the tail, cut away over each wheel. */
const sillOutline = floor => {
	const outline = []
	for ( const axle of [1, -1] ) {
		const radius = WHEEL_RADIUS + ARCH
		const reach = Math.asin( ( floor - WHEEL_RADIUS ) / radius )
		for ( let step = 0; step <= 7; step++ ) {
			const angle = MathUtils.lerp( reach, Math.PI - reach, step / 7 )
			outline.push( [axle * WHEELBASE * 0.5 + Math.cos( angle ) * radius, WHEEL_RADIUS + Math.sin( angle ) * radius] )
		}
	}
	return outline
}

/** Height of the deck under the cabin, `z` metres ahead of the middle of the car. */
export const deckHeight = z => MathUtils.mapLinear( z, DECK[0][0], DECK[1][0], DECK[0][1], DECK[1][1] )

/** A strip of that deck between two `x` and two `z`, facing up. */
const deckStrip = ( [x0, x1, z0, z1] ) => {
	const y0 = deckHeight( z0 )
	const y1 = deckHeight( z1 )
	const geometry = new BufferGeometry()
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( [x0, y0, z0, x0, y1, z1, x1, y1, z1, x0, y0, z0, x1, y1, z1, x1, y0, z0] ), 3 ) )
	geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( 12 ), 2 ) )
	geometry.computeVertexNormals()
	return geometry
}

/**
 * Cut the well of the cockpit out of the deck of `body`. The cabin stands over the cut, so it never
 * shows from outside, and the driver's seat looks down into a cockpit rather than onto a lid.
 */
function openDeck( body ) {
	const position = body.getAttribute( 'position' )
	// The deck is one flat panel between the bevels of the two flanks.
	const reach = CAR_WIDTH / 2 - BEVEL
	const onDeck = vertex => {
		const z = position.getZ( vertex )
		return Math.abs( position.getX( vertex ) ) < reach + 1e-3 && z > DECK[0][0] - 1e-3 && z < DECK[1][0] + 1e-3
			&& Math.abs( position.getY( vertex ) - deckHeight( z ) ) < 1e-3
	}
	const kept = []
	for ( let vertex = 0; vertex < position.count; vertex += 3 ) {
		if ( !onDeck( vertex ) || !onDeck( vertex + 1 ) || !onDeck( vertex + 2 ) ) kept.push( vertex, vertex + 1, vertex + 2 )
	}
	const { half, rear, front } = WELL
	const rim = [[-reach, reach, DECK[0][0], rear], [-reach, reach, front, DECK[1][0]], [-reach, -half, rear, front], [half, reach, rear, front]]
	return mergeGeometries( [body.setIndex( kept ).toNonIndexed(), ...rim.map( deckStrip )] )
}

/** A coupé: a low body cut away over its wheels, a narrower cabin with a glass roof, and a wing. */
function createCarGeometries() {
	// Over the top from tail to nose: bumper, ducktail, deck, scuttle, bonnet, nose, splitter. Then back underneath.
	const top = [[-1.45, 0.22], [-1.5, 0.48], [-1.47, 0.73], ...DECK, [1.12, 0.62], [1.44, 0.46], [1.5, 0.32], [1.45, 0.17]]
	const body = openDeck( extrudeProfile( [...top, ...sillOutline( 0.17 )], CAR_WIDTH, BEVEL ) )
	// Rear glass, roof, windscreen.
	const cabin = extrudeProfile( [[-1.04, 0.67], [-0.48, 0.95], [0.02, 0.96], [0.4, 0.65]], CABIN_WIDTH, BEVEL )

	const glass = [0.04, 0.055, 0.075]
	const carbon = [0.03, 0.032, 0.036]
	const parts = [
		tint( extrudeProfile( [[-0.9, 0.715], [-0.47, 0.91], [0, 0.92], [0.27, 0.7]], CABIN_WIDTH + 0.02 ), ...glass ),
		tint( slopePanel( 0.02, 0.96, 0.4, 0.65, CABIN_WIDTH - 0.22, 0.82 ), ...glass ),
		tint( slopePanel( -1.04, 0.67, -0.48, 0.95, CABIN_WIDTH - 0.22, 0.82 ), ...glass ),
		tint( slopePanel( -0.44, 0.955, -0.02, 0.96, CABIN_WIDTH - 0.3 ), ...glass ),
		// Splitter, grille and diffuser, then the wing on its two stays.
		tint( new BoxGeometry( CAR_WIDTH - 0.06, 0.035, 0.2 ).translate( 0, 0.165, 1.43 ), ...carbon ),
		tint( new BoxGeometry( 0.78, 0.085, 0.04 ).translate( 0, 0.3, 1.492 ), ...carbon ),
		tint( new BoxGeometry( CAR_WIDTH - 0.3, 0.1, 0.06 ).translate( 0, 0.27, -1.478 ), ...carbon ),
		tint( new BoxGeometry( CAR_WIDTH - 0.1, 0.03, 0.24 ).rotateX( -0.14 ).translate( 0, 0.92, -1.36 ), ...carbon ),
	]
	// The stripe of the MakioMeshlines hover car runs over the bonnet, the nose and the tail: white between two lines of cyan.
	for ( const [z0, y0, z1, y1] of [[0.44, 0.669, 1.12, 0.62], [1.12, 0.62, 1.42, 0.47], [-1.46, 0.729, -1.06, 0.7]] ) {
		parts.push( tint( slopePanel( z0, y0, z1, y1, 0.15 ), 0.81, 0.84, 0.88 ) )
		for ( const side of [-1, 1] ) {
			parts.push( tint( slopePanel( z0, y0, z1, y1, 0.022 ).applyMatrix4( _stripe.makeTranslation( side * 0.104, 0, 0 ) ), 0.098, 0.716, 1 ) )
		}
	}
	for ( const side of [-1, 1] ) {
		parts.push(
			tint( new BoxGeometry( 0.035, 0.2, 0.1 ).translate( side * 0.44, 0.82, -1.34 ), ...carbon ),
			tint( new BoxGeometry( 0.05, 0.075, WHEELBASE - 0.76 ).translate( side * ( CAR_WIDTH * 0.5 - 0.01 ), 0.2, 0 ), ...carbon ),
			// The arm of a door mirror, and its dark glass. The pod round them is painted with the body.
			tint( new BoxGeometry( 0.05, 0.012, 0.028 ).translate( side * ( DOOR_MIRROR.x - 0.05 ), DOOR_MIRROR.y - 0.008, DOOR_MIRROR.z + 0.026 ), ...carbon ),
			tint( new CircleGeometry( 1, 20 ).scale( ...DOOR_MIRROR.half, 1 ).rotateY( Math.PI ).translate( side * DOOR_MIRROR.x, DOOR_MIRROR.y, DOOR_MIRROR.z ), ...glass ),
			// Headlamps lie on the slope of the nose. They are brighter than white, so they still glow on the shaded end of the car.
			tint( new BoxGeometry( 0.3, 0.03, 0.09 ).rotateX( 0.46 ).translate( side * 0.43, 0.512, 1.36 ), 2.6, 2.4, 1.9 ),
		)
	}

	const lamps = new BoxGeometry( CAR_WIDTH - 0.24, 0.05, 0.04 ).translate( 0, 0.6, -1.49 )
	// A pod over each door mirror: half an egg, its open end to the rear, where the glass is.
	const pods = [-1, 1].map( side => new SphereGeometry( 1, 12, 8, 0, Math.PI ).toNonIndexed()
		.scale( DOOR_MIRROR.half[0] + 0.004, DOOR_MIRROR.half[1] + 0.004, 0.07 )
		.translate( side * DOOR_MIRROR.x, DOOR_MIRROR.y, DOOR_MIRROR.z - 0.001 ) )
	return { shell: mergeGeometries( [body, cabin, ...pods] ), trim: mergeGeometries( parts ), lamps, wheel: createWheelGeometry() }
}

/** A tyre on a five-spoke rim, the same on both faces, so one geometry serves all four corners and shows that it turns. */
function createWheelGeometry() {
	const across = geometry => geometry.rotateZ( Math.PI / 2 )
	const parts = [
		tint( across( new CylinderGeometry( WHEEL_RADIUS, WHEEL_RADIUS, 0.2, 20 ) ), 0.02, 0.02, 0.024 ),
		tint( across( new CylinderGeometry( 0.18, 0.18, 0.205, 16 ) ), 0.07, 0.072, 0.08 ),
		tint( across( new CylinderGeometry( 0.055, 0.055, 0.22, 10 ) ), 0.72, 0.74, 0.78 ),
	]
	for ( let spoke = 0; spoke < 5; spoke++ ) {
		parts.push( tint( new BoxGeometry( 0.214, 0.17, 0.042 ).translate( 0, 0.085, 0 ).rotateX( spoke * Math.PI * 0.4 ), 0.72, 0.74, 0.78 ) )
	}
	return mergeGeometries( parts )
}

//---------------------------------------------------------- TRAFFIC

/**
 * Cars follow the centreline of the built road at one lane's offset, turn round
 * at each end and come back on the other side. Round a road that closes on
 * itself there is no end to turn at: each lane is a ring, driven one way. Each
 * car keeps its two axles on the deck, so it pitches, rolls and steers with the
 * road it is on, and its body leans on that as a sprung one does: out of a bend,
 * onto its nose under braking.
 */
export class RoadTraffic {
	// `phase` is metres round the circuit. Keep a pool so length edits only change the draw counts.
	cars = times( MAX_CARS, () => ( {
		phase: 0,
		speed: 0,
		accel: 0,
		braking: false,
		heading: 0,
		// The front wheels' lock, how far the wheels have rolled, and the lean of the body on its springs.
		steer: 0,
		spin: 0,
		roll: 0,
		pitch: 0,
		position: new Vector3(),
		quaternion: new Quaternion(),
		// Where the leaning body stands, which is what the driver rides in.
		body: new Matrix4(),
	} ) )
	active = 0
	pace = 1
	// Counts the routes driven, for whatever draws the road again when it changes.
	route = 0
	closed = false
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
		const { shell, trim, lamps, wheel } = createCarGeometries()
		this.body = new InstancedMesh( shell, new MeshStandardNodeMaterial( { roughness: 0.32, metalness: 0.2 } ), MAX_CARS )
		// Lacquer over the paint: the bonnet carries the sky, most of all from the driver's seat.
		this.body.material.emissiveNode = surroundings( reflectVector ).mul( glance ).mul( 0.7 )
		this.trim = new InstancedMesh( trim, new MeshStandardNodeMaterial( { roughness: 0.5, vertexColors: true } ), MAX_CARS )
		this.trim.material.emissiveNode = surroundings( reflectVector ).mul( glance ).mul( 0.5 )
		this.lamps = new InstancedMesh( lamps, new MeshBasicNodeMaterial(), MAX_CARS )
		this.wheels = new InstancedMesh( wheel, new MeshStandardNodeMaterial( { roughness: 0.6, vertexColors: true } ), MAX_CARS * 4 )
		this.meshes = [this.body, this.trim, this.lamps, this.wheels]
		for ( const mesh of this.meshes ) {
			mesh.count = 0
			mesh.castShadow = mesh !== this.lamps
			mesh.frustumCulled = false
			// Stream, not dynamic: three uploads a DynamicDrawUsage attribute on every render,
			// so once more for each shadow and mirror pass of the frame.
			mesh.instanceMatrix.setUsage( StreamDrawUsage )
		}
		this.cars.forEach( ( car, index ) => {
			this.body.setColorAt( index, _color.setHex( PAINTS[index % PAINTS.length] ) )
			this.lamps.setColorAt( index, TAIL )
		} )
		this.lamps.instanceColor.setUsage( StreamDrawUsage )
		stage3d.add( ...this.meshes )
	}

	/** The driver's seat has its own, slower pace; taking it or leaving it changes how fast traffic goes without moving a car. */
	setDriving( driving ) {
		const pace = driving ? DRIVE_PACE : 1
		if ( pace === this.pace ) return
		const ratio = pace / this.pace
		this.pace = pace
		for ( const car of this.cars ) {
			car.speed *= ratio
			car.accel *= ratio ** 2
		}
	}

	/** Drive `plan`, the route the road ribbon shows, `laneOffset` metres either side of its centreline. */
	setRoute( plan, laneOffset ) {
		const previousCircuit = this.circuit
		const closed = !!plan?.closed
		this.route++
		const rejoined = closed !== this.closed
		// A loop comes with a row of ribbon overlapping each side of its seam, which is not road to drive.
		this.points = closed ? plan.points.subarray( 3, plan.points.length - 3 ) : plan?.points
		const rows = this.points ? this.points.length / 3 : 0
		this.rows = rows
		this.closed = closed
		this.laneOffset = laneOffset
		if ( rows >= 2 ) this.measureRoute( this.points, closed ? plan.bank.subarray( 1, rows + 1 ) : plan.bank )
		this.length = rows >= 2 ? this.distance[rows - 1] : 0

		// A turn at each end is half a circle from one lane to the other. A loop is its two lanes, end to end.
		this.straight = Math.max( 0, this.length - laneOffset * 2 )
		this.circuit = closed ? this.length * 2 : ( this.straight + Math.PI * laneOffset ) * 2
		const active = this.length < MIN_ROUTE ? 0 : MathUtils.clamp( Math.floor( this.circuit / CAR_SPACING ), closed ? 2 : 1, MAX_CARS )
		if ( active !== this.active || rejoined ) {
			this.active = active
			this.cars.forEach( ( car, index ) => {
				// Round a loop the cars take the two lanes in turn, spread along each.
				const lane = closed ? index % 2 : 0
				const slot = closed ? index >> 1 : index
				car.phase = lane * this.length + this.lap * slot / Math.max( 1, this.peers( lane ) )
			} )
		} else if ( previousCircuit > 0 ) {
			// An edit stretches the circuit under the cars instead of sliding them along it.
			for ( const car of this.cars ) car.phase *= this.circuit / previousCircuit
		}
		for ( const mesh of this.meshes ) mesh.count = mesh === this.wheels ? active * 4 : active
		this.update( 0 )
	}

	/** Metres a car drives before it is back where it started without leaving its ring. */
	get lap() {
		return this.closed ? this.length : this.circuit
	}

	/** How many cars share the ring of `lane`: all of them on an open road, every other one round a loop. */
	peers( lane ) {
		return this.closed ? ( this.active + 1 - lane ) >> 1 : this.active
	}

	measureRoute( points, bank ) {
		const { rows, closed } = this
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
			// The first and last rows of a loop are one place, so each has the other's neighbour too.
			const before = ( closed && row === 0 ? rows - 2 : Math.max( 0, row - 1 ) ) * 3
			const after = ( closed && row === rows - 1 ? 1 : Math.min( rows - 1, row + 1 ) ) * 3
			_rear.fromArray( points, offset ).sub( _probe.fromArray( points, before ) )
			_front.fromArray( points, after ).sub( _probe.fromArray( points, offset ) )
			const entering = _rear.length()
			const leaving = _front.length()
			distance[row] = row === 0 ? 0 : distance[row - 1] + entering
			if ( row === 0 && !closed ) _rear.copy( _front )
			if ( row === rows - 1 && !closed ) _front.copy( _rear )
			_rear.normalize()
			_front.normalize()

			// A row lies across the bisector of its two segments, level, then rolled by its bank:
			// the yaw, climb, bank recipe the surface and the bridge piers share.
			_forward.addVectors( _rear, _front ).normalize()
			_euler.set( -Math.atan2( _forward.y, Math.hypot( _forward.x, _forward.z ) ), Math.atan2( _forward.x, _forward.z ), bank[row], 'YXZ' )
			_frame.setFromEuler( _euler )
			_left.set( 1, 0, 0 ).applyQuaternion( _frame ).toArray( left, offset )
			_up.set( 0, 1, 0 ).applyQuaternion( _frame ).toArray( up, offset )

			// A bend is taken as fast as the tyres hold, and a hill slower the steeper it is, up or down.
			const curvature = _rear.angleTo( _front ) / Math.max( 1e-3, ( entering + leaving ) * 0.5 )
			const hill = 1 + 4 * _forward.y * _forward.y
			limit[row] = Math.min( TOP_SPEED / hill, Math.sqrt( GRIP / Math.max( curvature, 1e-4 ) ) )
		}

		// Cars slow for the turn at each end, and brake early enough for every bend whichever way they travel.
		// Round a loop the braking for a bend just past the seam starts before it, so the passes go round twice.
		if ( !closed ) limit[0] = limit[rows - 1] = TURN_SPEED
		for ( let pass = closed ? 2 : 1; pass > 0; pass-- ) {
			if ( closed ) limit[0] = limit[rows - 1] = Math.min( limit[0], limit[rows - 1] )
			for ( let row = rows - 2; row >= 0; row-- ) {
				limit[row] = Math.min( limit[row], Math.sqrt( limit[row + 1] ** 2 + 2 * BRAKING * ( distance[row + 1] - distance[row] ) ) )
			}
			if ( closed ) limit[rows - 1] = limit[0]
			for ( let row = 1; row < rows; row++ ) {
				limit[row] = Math.min( limit[row], Math.sqrt( limit[row - 1] ** 2 + 2 * BRAKING * ( distance[row] - distance[row - 1] ) ) )
			}
		}
		if ( closed ) limit[0] = limit[rows - 1]
	}

	/** Unroll the circuit: out on the right-hand lane, half a circle, back on the other lane, half a circle. */
	locate( phase ) {
		const { straight, laneOffset: offset, length } = this
		const turn = Math.PI * offset
		let along = MathUtils.euclideanModulo( phase, this.circuit )
		_lane.turning = false
		if ( this.closed ) {
			// A ring a lane: up the distances on the right-hand one, back down them on the other.
			_lane.distance = along < length ? along : length * 2 - along
			_lane.lateral = along < length ? -offset : offset
			return _lane
		}
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

	/** The phase `metres` on from `phase`, or back from it. Round a loop that stays on the ring of its own lane. */
	ahead( phase, metres ) {
		if ( !this.closed ) return phase + metres
		const lane = phase < this.length ? 0 : this.length
		return lane + MathUtils.euclideanModulo( phase - lane + metres, this.length )
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

	/** Height of the centreline `distance` metres along the road. */
	heightAt( distance ) {
		const y = this.segment( distance ) * 3 + 1
		return MathUtils.lerp( this.points[y], this.points[y + 3], this.segmentBlend )
	}

	/** Which way a car at `phase` runs along the road: 1 on the way out, -1 on the way back, and in between through each turn. */
	travel( phase ) {
		return -this.locate( phase ).lateral / this.laneOffset
	}

	/**
	 * Metres a car at `phase` stands above the far end of a straight boom laid `reach` metres back
	 * along the road, negative on a descent. The boom rests on the road wherever that is highest,
	 * like a ladder, so it clears a crest instead of cutting through it.
	 */
	climb( phase, reach ) {
		const { distance } = this.locate( phase )
		const here = this.heightAt( distance )
		let climb = Infinity
		for ( let part = 1; part <= 4; part++ ) {
			const back = distance - reach * part / 4
			const rung = this.heightAt( this.closed ? MathUtils.euclideanModulo( back, this.length ) : MathUtils.clamp( back, 0, this.length ) )
			climb = Math.min( climb, ( here - rung ) * 4 / part )
		}
		return climb
	}

	/** The pace a car may hold at `phase`: as fast as it can go and still brake for the rows either side. */
	speedLimit( phase ) {
		const { distance, turning } = this.locate( phase )
		if ( turning ) return TURN_SPEED * this.pace
		const row = this.segment( distance )
		return Math.min(
			TOP_SPEED,
			Math.sqrt( this.limit[row] ** 2 + 2 * BRAKING * ( distance - this.distance[row] ) ),
			Math.sqrt( this.limit[row + 1] ** 2 + 2 * BRAKING * ( this.distance[row + 1] - distance ) ),
		) * this.pace
	}

	update( dt ) {
		const { active, cars, circuit, pace } = this
		if ( active === 0 ) return
		const seconds = dt / 1000
		const acceleration = pace ** 2
		const topSpeed = TOP_SPEED * pace
		const foresight = FORESIGHT / pace

		for ( let index = 0; index < active; index++ ) {
			const car = cars[index]
			// Cars never overtake, so the one ahead is always the next one round the ring: every car on an
			// open road, every other one round a loop.
			const lane = this.closed ? index % 2 : 0
			const stride = this.closed ? 2 : 1
			const peers = this.peers( lane )
			const leader = cars[lane + ( ( index - lane ) / stride + 1 ) % peers * stride]
			const gap = peers > 1 ? MathUtils.euclideanModulo( leader.phase - car.phase, this.lap ) - CAR_LENGTH : Infinity
			// A driver reads the road a moment ahead and moves the pedals towards the pace it allows there.
			// The engine pulls hardest from rest, and neither pedal is stamped on.
			const target = Math.min( this.speedLimit( this.ahead( car.phase, car.speed * foresight ) ), Math.max( 0, gap - 1 ) * pace / HEADWAY )
			const pull = THROTTLE * acceleration * ( 1 - 0.6 * car.speed / topSpeed )
			const pedal = MathUtils.clamp( ( target - car.speed ) / foresight, -HARD_BRAKING * acceleration, pull )
			const jerk = JERK * pace ** 3 * seconds
			car.accel += MathUtils.clamp( pedal - car.accel, -jerk, jerk )
			car.speed = Math.max( 0, car.speed + car.accel * seconds )
			if ( car.speed === 0 ) car.accel = Math.max( 0, car.accel )

			const travelled = Math.min( car.speed * seconds, Math.max( 0, gap - 0.5 ) )
			car.phase = this.ahead( car.phase, travelled ) % circuit
			car.spin = ( car.spin + travelled / WHEEL_RADIUS ) % ( Math.PI * 2 )
			this.placeCar( car, index, seconds )
			// The lamps come on with the brakes and stay on until the car has let them go.
			car.braking = car.accel < ( car.braking ? -0.5 : -1.8 )
			this.lamps.setColorAt( index, car.braking ? BRAKE : TAIL )
		}
		for ( const mesh of this.meshes ) mesh.instanceMatrix.needsUpdate = true
		this.lamps.instanceColor.needsUpdate = true
	}

	/** Stand the car on its two axles, which gives it the heading, pitch and roll of the deck under it. */
	placeCar( car, index, seconds ) {
		this.deckPoint( this.ahead( car.phase, -WHEELBASE * 0.5 ), _rear )
		this.deckPoint( this.ahead( car.phase, WHEELBASE * 0.5 ), _front )
		const row = this.segment( this.locate( car.phase ).distance )
		_up.fromArray( this.up, row * 3 ).lerp( _probe.fromArray( this.up, row * 3 + 3 ), this.segmentBlend )

		_forward.subVectors( _front, _rear ).normalize()
		_left.crossVectors( _up, _forward ).normalize()
		_up.crossVectors( _forward, _left )
		car.position.addVectors( _rear, _front ).multiplyScalar( 0.5 )
		_matrix.makeBasis( _left, _up, _forward ).setPosition( car.position )
		car.quaternion.setFromRotationMatrix( _matrix )

		// How fast the car is turning says how far its front wheels are turned, and how hard the bend pushes its body out.
		const heading = Math.atan2( _forward.x, _forward.z )
		const turning = seconds > 0 ? signedAngle( heading - car.heading ) / seconds : 0
		const ease = 1 - Math.exp( -8 * seconds )
		car.heading = heading
		car.steer += ( MathUtils.clamp( Math.atan( WHEELBASE * turning / Math.max( car.speed, 1 ) ), -MAX_STEER, MAX_STEER ) - car.steer ) * ease
		car.roll += ( MathUtils.clamp( car.speed * turning * ROLL / this.pace ** 2, -MAX_LEAN, MAX_LEAN ) - car.roll ) * ease
		car.pitch += ( MathUtils.clamp( -car.accel * DIVE / this.pace ** 2, -MAX_LEAN, MAX_LEAN ) - car.pitch ) * ease

		// The wheels stay on the deck: they roll, and the front pair steers.
		for ( let wheel = 0; wheel < 4; wheel++ ) {
			const axle = wheel < 2 ? 1 : -1
			_part.makeRotationFromEuler( _euler.set( car.spin, axle > 0 ? car.steer : 0, 0, 'YXZ' ) )
				.setPosition( ( wheel % 2 ? -0.5 : 0.5 ) * TRACK, WHEEL_RADIUS, axle * WHEELBASE * 0.5 )
			this.wheels.setMatrixAt( index * 4 + wheel, _part.premultiply( _matrix ) )
		}

		// The body leans about the line through its axles.
		car.body.makeRotationFromEuler( _euler.set( car.pitch, 0, car.roll, 'XYZ' ) )
		_probe.set( 0, WHEEL_RADIUS, 0 ).applyMatrix4( car.body )
		car.body.setPosition( -_probe.x, WHEEL_RADIUS - _probe.y, -_probe.z ).premultiply( _matrix )
		this.body.setMatrixAt( index, car.body )
		this.trim.setMatrixAt( index, car.body )
		this.lamps.setMatrixAt( index, car.body )
	}
}

import { color, float, Fn, fract, fwidth, mx_noise_float, normalWorld, positionWorld, sin, uv, vec3 } from 'three/tsl'
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CylinderGeometry,
	DoubleSide,
	DynamicDrawUsage,
	ExtrudeGeometry,
	FrontSide,
	InstancedMesh,
	MathUtils,
	Mesh,
	MeshStandardNodeMaterial,
	Object3D,
	Shape,
	Vector3,
} from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { DASH_PERIOD, pinnedRowDistances, RAISED_FROM, RAISED_TO } from '@/utils/roadPaint'
import { terrainHeight } from '@/utils/surfaceRoadRoute'

/** How much is built around the ribbon of the road: nothing, the walls and piers it started with, or the whole bridge. */
export const STRUCTURE_LEVELS = ['none', 'simple', 'complex']

// Metres between two cross-sections of whatever hangs on the road, and how many are allocated at a time.
const COLUMN_STEP = 1.5
const COLUMN_CHUNK = 64

// The cross-section of a raised deck, as [metres in from its edge, metres up from its surface].
// A parapet stands on the kerb, set back from the edge beam that hangs under it, and a box girder carries the middle.
const PARAPET = [[0.5, -0.05], [0.36, 0.24], [0.27, 0.8], [0.07, 0.8], [0.07, 0]]
const EDGE_BEAM = [[0, -0.02], [0, -0.42], [0.26, -0.42], [0.3, -0.26]]
const GIRDER_DEPTH = 1.45
// Where the web of the girder starts and ends, as a share of the half width of the deck.
const WEB_TOP = 0.4
const WEB_TOP_DEPTH = 0.5
const WEB_BOTTOM = 0.58
// A part the road has no use for yet waits here, just under its surface.
const HIDDEN = [0.08, -0.05]
// Metres of clearance over which the girder grows under a deck leaving the ground.
const GIRDER_FROM = 1
const GIRDER_TO = 2.2
// Profile points per side, the flat strips between them, and the soffit strip that joins both sides.
const PROFILE_POINTS = PARAPET.length + EDGE_BEAM.length + 2
const SIDE_STRIPS = PROFILE_POINTS - 1
const DECK_STRIPS = SIDE_STRIPS * 2 + 1
const DECK_VERTICES = DECK_STRIPS * 2

// A low road stands on an embankment that slopes out to the meadow. Where the
// deck climbs past this clearance the embankment stops, in a slope down the
// road like the ones down its sides, and the girder spans on from it.
const BERM_END = 2.4
const BERM_SLOPE = 1.5
const BERM_REACH = 4.2
// A section is a toe and a crest on each side: left toe, left crest, right crest, right toe.
// Nothing joins the crests under the road. Two more vertices carry the slope an embankment ends in.
const SECTION_STRIDE = 12
const BERM_VERTICES = 6
const BERM_STRIDE = BERM_VERTICES * 3
const BERM_STRIPS = [[0, 1], [2, 3], [4, 5]]
// Columns it takes to close one end of an embankment: where it stops, the foot of its end slope, and that foot buried.
const BERM_END_COLUMNS = 3

// The simple structure: a wall hung under each edge of the deck, down to the
// ground where the road is low, and a round pier under a hammerhead cap.
const FASCIA_DEPTH = 0.75
const FASCIA_VERTICES = 4
const FASCIA_STRIPS = [[0, 1], [2, 3]]
const POST_SPACING = 8.5
const POST_MIN_HEIGHT = 1.2
const CAP_HEIGHT = 0.7

const PIER_PROBE_STEP = 0.45
const PIER_SPACING = 12
const PIER_MIN_HEIGHT = 0.6
const PIER_FOOTING = 0.6
const MAX_PIERS = 96
// A pier is drawn for a deck this wide from its middle to its edge, and scaled across for any other.
const PIER_HALF = 3.7
const HEAD_HEIGHT = 1.7
const HEAD_TOP = 1.42
const HEAD_COLLAR = 0.8
const HEAD_DEPTH = 1.04
const SHAFT_WIDTH = 0.72
const SHAFT_DEPTH = 0.46
const SHAFT_CORNER = 0.2
const BEARING_HEIGHT = 0.12
const FOOTING_HEIGHT = 0.7
const FOOTING_SHOWS = 0.25

const CONCRETE_COLOR = 0xBAB5AA
const BEARING_COLOR = 0x2B2C2E
const GRASS_COLOR = 0x6E9645
// What the sunlit meadow throws back up at whatever hangs over it.
const BOUNCE_COLOR = 0x9BA28F
// Metres between the lifts a pier is poured in.
const POUR_HEIGHT = 1.8

const _edgeA = new Vector3()
const _edgeB = new Vector3()
const _left = new Vector3()
const _right = new Vector3()
const _across = new Vector3()
const _tangent = new Vector3()
const _up = new Vector3()
const _in = new Vector3()
const _point = new Vector3()
const _section = new Float32Array( SECTION_STRIDE )
const _profile = new Float32Array( PROFILE_POINTS * 2 )
const WEB_POINT = PARAPET.length + EDGE_BEAM.length
const _pier = new Object3D()
_pier.rotation.order = 'YXZ'
const _capDown = new Vector3()

const segmentLength = ( points, index ) => Math.hypot(
	points[index * 3] - points[index * 3 - 3],
	points[index * 3 + 1] - points[index * 3 - 2],
	points[index * 3 + 2] - points[index * 3 - 1]
)

/** True when another part of the route runs underneath this deck sample. */
function isAboveRoad( points, index, x, y, z, half ) {
	const clearance = half + 1.5
	const rows = points.length / 3
	for ( let other = 0; other < rows - 1; other++ ) {
		if ( Math.abs( other - index ) <= 1 && Math.abs( other + 1 - index ) <= 1 ) continue
		const a = other * 3
		const b = a + 3
		const ax = points[a]
		const ay = points[a + 1]
		const az = points[a + 2]
		const dx = points[b] - ax
		const dy = points[b + 1] - ay
		const dz = points[b + 2] - az
		const lenSq = dx * dx + dz * dz
		const t = lenSq > 1e-6 ? MathUtils.clamp( ( ( x - ax ) * dx + ( z - az ) * dz ) / lenSq, 0, 1 ) : 0
		const py = ay + dy * t
		if ( py > y - GIRDER_DEPTH - PIER_MIN_HEIGHT * 0.5 ) continue
		if ( Math.hypot( ax + dx * t - x, az + dz * t - z ) < clearance ) return true
	}
	return false
}

/** Both built edges as `[left xyz, right xyz]` per ribbon row, or null without a road to read. */
function readRibbonEdges( ribbon ) {
	const edges = ribbon.getAttribute( 'position' )
	const surfaceLine = ribbon._surfaceLines?.[0]
	const rows = surfaceLine ? surfaceLine.rowCount : ( edges ? edges.count / 2 : 0 )
	if ( !edges || !Number.isInteger( rows ) || rows < 2 ) return null

	const topology = surfaceLine?.topology
	const pairVertices = topology?.pairVertices
	const edgeCoords = new Float32Array( rows * 6 )
	for ( let row = 0; row < rows; row++ ) {
		for ( let side = 0; side < 2; side++ ) {
			let v0 = row * 2 + side
			let v1 = v0
			// A join splits its row in two vertex pairs: the edge runs halfway between them.
			if ( topology ) {
				const entering = ( row - 1 ) * 4 + 2 + side
				const leaving = row * 4 + side
				const slot0 = row === 0 ? leaving : entering
				const slot1 = row === rows - 1 ? entering : leaving
				v0 = pairVertices ? pairVertices[slot0] : slot0
				v1 = pairVertices ? pairVertices[slot1] : slot1
			}
			for ( let axis = 0; axis < 3; axis++ ) {
				edgeCoords[( row * 2 + side ) * 3 + axis] = ( edges.getComponent( v0, axis ) + edges.getComponent( v1, axis ) ) * 0.5
			}
		}
	}
	return edgeCoords
}

/** A strip of quads between consecutive columns of `vertices` vertices, for every `[vertex, vertex]` of `strips`. */
function stripIndices( columns, vertices, strips, flipped = () => false ) {
	const indices = new Uint32Array( ( columns - 1 ) * strips.length * 6 )
	let offset = 0
	for ( let column = 0; column < columns - 1; column++ ) {
		strips.forEach( ( [from, to], strip ) => {
			const a = column * vertices + from
			const b = column * vertices + to
			const c = a + vertices
			const d = b + vertices
			indices.set( flipped( strip ) ? [a, c, b, b, c, d] : [a, b, c, c, b, d], offset )
			offset += 6
		} )
	}
	return new BufferAttribute( indices, 1 )
}

const dynamicAttribute = ( count, size ) => new BufferAttribute( new Float32Array( count * size ), size ).setUsage( DynamicDrawUsage )

/**
 * Room for `columns` cross-sections of the deck: every strip owns its vertices,
 * so its edges stay crisp. The strips are wound to face out of the concrete,
 * which depends on which way the ribbon they hang from is `handed`: only the
 * outside of the deck is drawn, and nothing shows inside it through a wireframe road.
 */
function allocateDeck( geometry, columns, handed ) {
	geometry.setAttribute( 'position', dynamicAttribute( columns * DECK_VERTICES, 3 ) )
	geometry.setAttribute( 'normal', dynamicAttribute( columns * DECK_VERTICES, 3 ) )
	geometry.setAttribute( 'uv', dynamicAttribute( columns * DECK_VERTICES, 2 ) )
	const strips = Array.from( { length: DECK_STRIPS }, ( _, strip ) => [strip * 2, strip * 2 + 1] )
	// The far side mirrors the near one, so its strips wind the other way.
	geometry.setIndex( stripIndices( columns, DECK_VERTICES, strips, strip => ( strip >= SIDE_STRIPS && strip < SIDE_STRIPS * 2 ) !== handed > 0 ) )
}

/** Room for `columns` cross-sections of the simple walls: a top and a bottom vertex under each edge. */
function allocateFascia( geometry, columns ) {
	geometry.setAttribute( 'position', dynamicAttribute( columns * FASCIA_VERTICES, 3 ) )
	geometry.setAttribute( 'normal', dynamicAttribute( columns * FASCIA_VERTICES, 3 ) )
	geometry.setIndex( stripIndices( columns, FASCIA_VERTICES, FASCIA_STRIPS ) )
}

/** Room for `columns` cross-sections of the embankment: a slope down each side, and the slope it ends in. */
function allocateBerm( geometry, columns ) {
	geometry.setAttribute( 'position', dynamicAttribute( columns * BERM_VERTICES, 3 ) )
	geometry.setAttribute( 'normal', dynamicAttribute( columns * BERM_VERTICES, 3 ) )
	geometry.setIndex( stripIndices( columns, BERM_VERTICES, BERM_STRIPS ) )
}

/** How far a slope from a crest at `x, y, z` runs along `directionX, directionZ` before it meets the meadow. */
function slopeReach( x, y, z, directionX, directionZ ) {
	let reach = 0.3 + BERM_SLOPE * Math.max( 0, y - terrainHeight( x, z ) )
	for ( let pass = 0; pass < 2; pass++ ) {
		const fall = y - terrainHeight( x + directionX * reach, z + directionZ * reach )
		reach = Math.min( BERM_REACH, 0.3 + BERM_SLOPE * Math.max( 0, fall ) )
	}
	return reach
}

/**
 * The profile of one side of the deck into `_profile`: parapet, edge beam and
 * girder web, each grown out of hiding by its own weight between 0 and 1.
 */
function writeProfile( half, parapet, beam, girder ) {
	const put = ( index, x, y, weight ) => {
		_profile[index * 2] = HIDDEN[0] + ( x - HIDDEN[0] ) * weight
		_profile[index * 2 + 1] = HIDDEN[1] + ( y - HIDDEN[1] ) * weight
	}
	PARAPET.forEach( ( [x, y], index ) => put( index, x, y, parapet ) )
	EDGE_BEAM.forEach( ( [x, y], index ) => put( PARAPET.length + index, x, y, beam ) )
	put( WEB_POINT, half * WEB_TOP, -WEB_TOP_DEPTH, girder )
	put( WEB_POINT + 1, half * WEB_BOTTOM, -GIRDER_DEPTH, girder )
}

/**
 * Cast concrete with world-space mineral variation, so every part shares one
 * finish without UVs: rain streaks down its upright faces, and for the whole
 * bridge the joints it was cast with and the light the meadow throws back up
 * (`bounce`). Cast along the `'road'`, it reads the distance from its UVs and
 * is cut every half dash period, like the kerb painted on the road; cast in
 * `'lifts'`, it is cut every pour up its height.
 */
function createConcreteMaterial( { cast: casts = null, bounce = false, side = DoubleSide } = {} ) {
	const material = new MeshStandardNodeMaterial( { roughness: 0.93, side } )
	const casting = mx_noise_float( positionWorld.mul( 0.7 ) )
	const weathering = mx_noise_float( positionWorld.mul( vec3( 1.4, 0.09, 1.4 ) ) )
	const aggregate = mx_noise_float( positionWorld.mul( 38 ) )
	// Centimetre pores disappear into their average once a pixel covers them.
	const detail = fwidth( positionWorld ).length().smoothstep( 0.012, 0.065 ).oneMinus()
	const pores = aggregate.smoothstep( 0.3, 0.6 ).mul( detail )
	const upright = normalWorld.y.abs().oneMinus()
	const streaks = weathering.smoothstep( 0, 0.55 ).mul( upright )

	const run = casts === 'road' ? uv().x : positionWorld.y
	const length = casts === 'road' ? DASH_PERIOD / 2 : POUR_HEIGHT
	const cast = run.div( length )
	const toJoint = fract( cast.add( 0.5 ) ).sub( 0.5 ).abs().mul( length )
	const perPixel = fwidth( run ).max( 1e-4 )
	// A joint thinner than a pixel fades out rather than shimmer.
	const joint = casts ? toJoint.smoothstep( float( 0.01 ), perPixel.add( 0.01 ) ).oneMinus().mul( float( 0.03 ).div( perPixel.max( 0.03 ) ) ) : float( 0 )
	// No two pours cure to the same grey.
	const pour = casts ? fract( sin( cast.add( 0.5 ).floor().mul( 91.7 ) ).mul( 43758.5 ) ).sub( 0.5 ) : float( 0 )

	const concrete = Fn( () => {
		const minerals = casting.mul( 0.1 ).add( pour.mul( 0.05 ) ).add( aggregate.mul( 0.055 ).mul( detail ) )
		return color( CONCRETE_COLOR ).mul( minerals.add( 1 ) ).mul( pores.mul( 0.2 ).oneMinus() )
			.mul( streaks.mul( 0.2 ).oneMinus() ).mul( joint.mul( 0.32 ).oneMinus() )
	} )()
	material.colorNode = concrete
	material.roughnessNode = float( 0.93 ).add( casting.mul( 0.025 ) ).add( pores.mul( 0.04 ) ).clamp( 0.86, 0.99 )
	// The sun never reaches a soffit: the light under a bridge is the meadow's.
	if ( bounce ) material.emissiveNode = concrete.mul( color( BOUNCE_COLOR ) ).mul( normalWorld.y.negate().max( 0 ).mul( 0.42 ).add( upright.mul( 0.04 ) ) )
	return material
}

/** An embankment wears the grass of the meadow it stands on. */
function createBermMaterial( grass ) {
	const material = new MeshStandardNodeMaterial( { roughness: 1, side: DoubleSide } )
	material.colorNode = grass ?? color( GRASS_COLOR )
	return material
}

/** One unit-high pier shaft, a rounded rectangle a little wider at its foot, standing on the origin. */
function createShaftGeometry() {
	const ring = []
	for ( let corner = 0; corner < 4; corner++ ) {
		const signX = corner === 0 || corner === 3 ? 1 : -1
		const signZ = corner < 2 ? 1 : -1
		for ( let step = 0; step <= 4; step++ ) {
			const angle = ( corner + step / 4 ) * Math.PI * 0.5
			ring.push( {
				x: signX * ( SHAFT_WIDTH - SHAFT_CORNER ) + Math.cos( angle ) * SHAFT_CORNER,
				z: signZ * ( SHAFT_DEPTH - SHAFT_CORNER ) + Math.sin( angle ) * SHAFT_CORNER,
				normalX: Math.cos( angle ),
				normalZ: Math.sin( angle ),
			} )
		}
	}
	const position = []
	const normal = []
	const index = []
	ring.forEach( ( { x, z, normalX, normalZ }, vertex ) => {
		position.push( x * 1.08, 0, z * 1.08, x, 1, z )
		normal.push( normalX, 0, normalZ, normalX, 0, normalZ )
		const a = vertex * 2
		const b = ( ( vertex + 1 ) % ring.length ) * 2
		index.push( a, a + 1, b, b, a + 1, b + 1 )
	} )
	const geometry = new BufferGeometry()
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( position ), 3 ) )
	geometry.setAttribute( 'normal', new BufferAttribute( new Float32Array( normal ), 3 ) )
	geometry.setIndex( index )
	return geometry
}

/** The head of a pier: a collar round the shaft that flares out to the width of the girder, its top on the origin. */
function createHeadGeometry() {
	const shape = new Shape()
	shape.moveTo( -HEAD_COLLAR, 0 )
	shape.lineTo( HEAD_COLLAR, 0 )
	shape.lineTo( HEAD_COLLAR, 0.12 )
	shape.quadraticCurveTo( HEAD_COLLAR + 0.03, HEAD_HEIGHT * 0.72, HEAD_TOP, HEAD_HEIGHT - 0.3 )
	shape.lineTo( HEAD_TOP, HEAD_HEIGHT )
	shape.lineTo( -HEAD_TOP, HEAD_HEIGHT )
	shape.lineTo( -HEAD_TOP, HEAD_HEIGHT - 0.3 )
	shape.quadraticCurveTo( -HEAD_COLLAR - 0.03, HEAD_HEIGHT * 0.72, -HEAD_COLLAR, 0.12 )
	shape.closePath()
	const bevel = 0.035
	return new ExtrudeGeometry( shape, { depth: HEAD_DEPTH - bevel * 2, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 12 } )
		.translate( 0, -HEAD_HEIGHT, bevel - HEAD_DEPTH * 0.5 )
}

/** The two pads a girder rests on, their top on the origin. */
function createBearingGeometry() {
	const pad = new BoxGeometry( 0.56, BEARING_HEIGHT, 0.6 )
	const count = pad.getAttribute( 'position' ).count
	const geometry = new BufferGeometry()
	for ( const name of ['position', 'normal'] ) {
		const source = pad.getAttribute( name ).array
		const array = new Float32Array( source.length * 2 )
		array.set( source )
		array.set( source, source.length )
		geometry.setAttribute( name, new BufferAttribute( array, 3 ) )
	}
	const position = geometry.getAttribute( 'position' )
	for ( let vertex = 0; vertex < count * 2; vertex++ ) {
		position.setX( vertex, position.getX( vertex ) + ( vertex < count ? -1 : 1 ) * HEAD_TOP * 0.6 )
		position.setY( vertex, position.getY( vertex ) - BEARING_HEIGHT * 0.5 )
	}
	geometry.setIndex( [...pad.getIndex().array, ...Array.from( pad.getIndex().array, vertex => vertex + count )] )
	pad.dispose()
	return geometry
}

/** The block a pier stands on, its top on the origin. */
function createFootingGeometry() {
	const shape = new Shape()
	const width = SHAFT_WIDTH + 0.55
	const depth = SHAFT_DEPTH + 0.5
	shape.moveTo( -width, -depth )
	shape.lineTo( width, -depth )
	shape.lineTo( width, depth )
	shape.lineTo( -width, depth )
	shape.closePath()
	const bevel = 0.06
	return new ExtrudeGeometry( shape, { depth: FOOTING_HEIGHT - bevel * 2, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 } )
		.rotateX( Math.PI * 0.5 ).translate( 0, -bevel, 0 )
}

/**
 * What is built around the road, at one of `STRUCTURE_LEVELS`. None of it is
 * the road itself, which is one MeshLine ribbon.
 *
 * `'simple'` hangs a concrete wall under each edge of the ribbon, down to the
 * ground where the road is low, and stands round piers under hammerhead caps.
 *
 * `'complex'` builds the whole bridge. Near the ground the road stands on a
 * grass embankment. Where it leaves the ground it gets a box girder under the
 * deck, a parapet on each kerb, and piers on footings wherever the deck clears
 * the terrain and any road beneath it.
 */
export class RoadBridge {
	level = 'complex'
	columns = 0
	capacity = 0

	/** `grass` is the colour node of the meadow, which the embankments wear. */
	constructor( grass ) {
		const plain = createConcreteMaterial()
		this.fascia = new Mesh( new BufferGeometry(), plain )
		this.posts = new InstancedMesh( new CylinderGeometry( 0.5, 0.62, 1, 16 ).translate( 0, 0.5, 0 ), plain, MAX_PIERS )
		this.postCaps = new InstancedMesh( new BoxGeometry( 1, 1, 1 ), plain, MAX_PIERS )
		this.postParts = [this.posts, this.postCaps]
		this.simpleParts = [this.fascia, ...this.postParts]

		const concrete = createConcreteMaterial( { cast: 'lifts', bounce: true } )
		this.deck = new Mesh( new BufferGeometry(), createConcreteMaterial( { cast: 'road', bounce: true, side: FrontSide } ) )
		this.berm = new Mesh( new BufferGeometry(), createBermMaterial( grass ) )
		this.piers = new InstancedMesh( createShaftGeometry(), concrete, MAX_PIERS )
		this.pierHeads = new InstancedMesh( createHeadGeometry(), concrete, MAX_PIERS )
		this.pierFootings = new InstancedMesh( createFootingGeometry(), concrete, MAX_PIERS )
		this.pierBearings = new InstancedMesh( createBearingGeometry(), new MeshStandardNodeMaterial( { color: BEARING_COLOR, roughness: 0.7 } ), MAX_PIERS )
		this.pierParts = [this.piers, this.pierHeads, this.pierFootings, this.pierBearings]
		this.complexParts = [this.deck, this.berm, ...this.pierParts]

		for ( const mesh of [...this.postParts, ...this.pierParts] ) {
			mesh.count = 0
			mesh.instanceMatrix.setUsage( DynamicDrawUsage )
		}
		for ( const mesh of [...this.simpleParts, ...this.complexParts] ) {
			mesh.castShadow = mesh !== this.berm
			mesh.receiveShadow = true
			mesh.frustumCulled = false
		}
		stage3d.add( ...this.simpleParts, ...this.complexParts )
		this.setLevel( this.level )
	}

	/** Show one of `STRUCTURE_LEVELS`. It is built by the next `update()`. */
	setLevel( level ) {
		this.level = level
		for ( const mesh of this.simpleParts ) mesh.visible = level === 'simple'
		for ( const mesh of this.complexParts ) mesh.visible = level === 'complex'
	}

	/** Rebuild the level on show from the ribbon's geometry and the plan it shows, if it shows one. */
	update( ribbon, plan, half ) {
		if ( this.level === 'none' ) return
		if ( !this.readColumns( ribbon, plan ) ) {
			for ( const mesh of [this.fascia, this.deck, this.berm] ) mesh.geometry.setDrawRange( 0, 0 )
		} else if ( this.level === 'simple' ) {
			this.updateFascia()
		} else {
			this.updateDeck( ribbon, half )
		}
		this.updatePiers( plan, half )
	}

	/**
	 * Cut the built edges of the ribbon into columns. Long adaptive road segments
	 * are subdivided along the edge, so whatever hangs on them tracks the terrain
	 * smoothly without adding vertices to the road ribbon. False without a road to read.
	 */
	readColumns( ribbon, plan ) {
		const edgeCoords = readRibbonEdges( ribbon )
		this.columns = 0
		if ( !edgeCoords ) return false

		const rows = edgeCoords.length / 6
		const stepsPerRow = new Int32Array( rows - 1 )
		let columns = 1
		for ( let row = 0; row < rows - 1; row++ ) {
			const leftLength = _edgeA.fromArray( edgeCoords, row * 6 ).distanceTo( _edgeB.fromArray( edgeCoords, row * 6 + 6 ) )
			const rightLength = _edgeA.fromArray( edgeCoords, row * 6 + 3 ).distanceTo( _edgeB.fromArray( edgeCoords, row * 6 + 9 ) )
			stepsPerRow[row] = Math.max( 1, Math.ceil( Math.max( leftLength, rightLength ) / COLUMN_STEP ) )
			columns += stepsPerRow[row]
		}
		if ( columns > this.capacity ) {
			this.capacity = Math.ceil( columns / COLUMN_CHUNK ) * COLUMN_CHUNK
			this.edges = new Float32Array( this.capacity * 6 )
			this.distances = new Float32Array( this.capacity )
			this.sections = new Float32Array( this.capacity * SECTION_STRIDE )
			this.clearances = new Float32Array( this.capacity )
		}
		this.columns = columns

		// Both edges and the paint distance of every column, a row or a share of the way between two.
		const { edges, distances } = this
		const paint = plan && plan.points.length === rows * 3 ? pinnedRowDistances( plan.points, plan.anchors ) : null
		let column = 0
		for ( let row = 0; row < rows; row++ ) {
			const steps = row > 0 ? stepsPerRow[row - 1] : 1
			for ( let step = 1; step <= steps; step++ ) {
				const share = row > 0 ? step / steps : 1
				const from = Math.max( 0, row - 1 )
				for ( let component = 0; component < 6; component++ ) {
					edges[column * 6 + component] = MathUtils.lerp( edgeCoords[from * 6 + component], edgeCoords[row * 6 + component], share )
				}
				distances[column] = paint ? MathUtils.lerp( paint[from], paint[row], share ) : column * COLUMN_STEP
				column++
			}
		}
		return true
	}

	/** Send the columns written into `geometry` to the GPU, `strips` strips of them. */
	finish( geometry, strips ) {
		const { columns } = this
		const position = geometry.getAttribute( 'position' )
		const stride = position.count / this.capacity * 3
		// The spare columns repeat the last one, so they add nothing to its normals.
		for ( let column = columns; column < this.capacity; column++ ) position.array.copyWithin( column * stride, ( columns - 1 ) * stride, columns * stride )
		position.needsUpdate = true
		geometry.computeVertexNormals()
		geometry.setDrawRange( 0, ( columns - 1 ) * strips * 6 )
	}

	/** The simple structure: top of the wall on the deck edge; its bottom eases from the footing up to the soffit of a bridge. */
	updateFascia() {
		const { geometry } = this.fascia
		if ( this.fasciaCapacity !== this.capacity ) {
			allocateFascia( geometry, this.capacity )
			this.fasciaCapacity = this.capacity
		}
		const { edges } = this
		const position = geometry.getAttribute( 'position' ).array
		for ( let column = 0; column < this.columns; column++ ) {
			for ( let side = 0; side < 2; side++ ) {
				const edge = column * 6 + side * 3
				const top = ( column * FASCIA_VERTICES + side * 2 ) * 3
				const footing = terrainHeight( edges[edge], edges[edge + 2] ) - 0.2
				const drop = edges[edge + 1] - FASCIA_DEPTH - footing
				position[top] = position[top + 3] = edges[edge]
				position[top + 1] = edges[edge + 1]
				position[top + 4] = footing + drop * MathUtils.smoothstep( drop, 0.8, 2.4 )
				position[top + 2] = position[top + 5] = edges[edge + 2]
			}
		}
		this.finish( geometry, FASCIA_STRIPS.length )
	}

	/** The whole bridge: the deck hung on both built edges, and the embankment under it. */
	updateDeck( ribbon, half ) {
		// Which way the deck faces relative to its edges, from the ribbon's own normal.
		const ribbonNormal = ribbon.getAttribute( 'normal' )
		this.frame( 0 )
		const handed = ribbonNormal && _up.dot( _point.fromBufferAttribute( ribbonNormal, 0 ) ) < 0 ? -1 : 1
		if ( this.deckCapacity !== this.capacity || this.handed !== handed ) {
			allocateDeck( this.deck.geometry, this.capacity, handed )
			allocateBerm( this.berm.geometry, this.capacity )
			this.deckCapacity = this.capacity
			this.handed = handed
		}

		for ( let column = 0; column < this.columns; column++ ) this.writeColumn( column, half, handed )
		this.writeBerm()
		this.finish( this.deck.geometry, DECK_STRIPS )
		this.finish( this.berm.geometry, BERM_STRIPS.length )
		this.deck.geometry.getAttribute( 'uv' ).needsUpdate = true
	}

	/** Both edges of `column` into `_left` and `_right`, and its frame into `_across`, `_tangent` and `_up`. */
	frame( column ) {
		const { edges } = this
		const before = Math.max( 0, column - 1 ) * 6
		const after = Math.min( this.columns - 1, column + 1 ) * 6
		_left.fromArray( edges, column * 6 )
		_right.fromArray( edges, column * 6 + 3 )
		_across.subVectors( _right, _left ).normalize()
		_tangent.set(
			edges[after] + edges[after + 3] - edges[before] - edges[before + 3],
			edges[after + 1] + edges[after + 4] - edges[before + 1] - edges[before + 4],
			edges[after + 2] + edges[after + 5] - edges[before + 2] - edges[before + 5]
		)
		_up.crossVectors( _across, _tangent ).normalize()
	}

	/** One cross-section of the deck, and of the embankment that would stand under it. */
	writeColumn( column, half, handed ) {
		this.frame( column )
		_up.multiplyScalar( handed )
		const deck = this.deck.geometry.getAttribute( 'position' ).array
		const deckUV = this.deck.geometry.getAttribute( 'uv' ).array
		const leftDrop = _left.y - terrainHeight( _left.x, _left.z )
		const rightDrop = _right.y - terrainHeight( _right.x, _right.z )
		this.clearances[column] = ( leftDrop + rightDrop ) * 0.5
		// A girder needs both edges off the ground; each parapet only its own.
		const girder = MathUtils.smoothstep( Math.min( leftDrop, rightDrop ), GIRDER_FROM, GIRDER_TO )
		const soffit = ( column * DECK_VERTICES + SIDE_STRIPS * 4 ) * 3

		for ( let side = 0; side < 2; side++ ) {
			const edge = side === 0 ? _left : _right
			const drop = side === 0 ? leftDrop : rightDrop
			_in.copy( _across ).multiplyScalar( side === 0 ? 1 : -1 )
			const parapet = MathUtils.smoothstep( drop, RAISED_FROM, RAISED_TO )
			writeProfile( half, parapet, Math.max( parapet, girder ), girder )

			const put = ( vertex, point ) => {
				const offset = ( column * DECK_VERTICES + vertex ) * 3
				_point.copy( edge ).addScaledVector( _in, _profile[point * 2] ).addScaledVector( _up, _profile[point * 2 + 1] ).toArray( deck, offset )
				deckUV[offset / 3 * 2] = this.distances[column]
				deckUV[offset / 3 * 2 + 1] = _profile[point * 2 + 1]
			}
			for ( let strip = 0; strip < SIDE_STRIPS; strip++ ) {
				put( ( side * SIDE_STRIPS + strip ) * 2, strip )
				put( ( side * SIDE_STRIPS + strip ) * 2 + 1, strip + 1 )
			}
			put( SIDE_STRIPS * 4 + side, PROFILE_POINTS - 1 )

			// The crest tucks under the edge of the road, and the slope runs out and down from it to wherever it meets the meadow.
			const crestY = edge.y - 0.06
			const outLength = Math.hypot( _in.x, _in.z ) || 1
			const outX = -_in.x / outLength
			const outZ = -_in.z / outLength
			const reach = slopeReach( edge.x, crestY, edge.z, outX, outZ )
			const toe = column * SECTION_STRIDE + ( side === 0 ? 0 : 3 ) * 3
			const crest = column * SECTION_STRIDE + ( side === 0 ? 1 : 2 ) * 3
			this.sections[toe] = edge.x + outX * reach
			this.sections[toe + 2] = edge.z + outZ * reach
			this.sections[toe + 1] = terrainHeight( this.sections[toe], this.sections[toe + 2] ) - 0.12
			this.sections[crest] = edge.x - outX * 0.12
			this.sections[crest + 1] = crestY
			this.sections[crest + 2] = edge.z - outZ * 0.12
		}
		// With no girder to close, the soffit folds onto one edge rather than lie as a sheet under the road.
		if ( girder === 0 ) deck.copyWithin( soffit + 3, soffit, soffit + 3 )
	}

	/**
	 * The embankment under every column low enough to stand on one. Where the
	 * deck climbs away it stops in an end slope, and it only stops for a gap long
	 * enough to close both of its ends.
	 */
	writeBerm() {
		const { columns, sections, clearances, edges } = this
		const berm = this.berm.geometry.getAttribute( 'position' ).array
		for ( let column = 0; column < columns; column++ ) this.placeSection( column, sections, column * SECTION_STRIDE )

		// A lone standing column between two gaps is too short to end twice: it goes with the gaps.
		const open = column => column < columns && ( clearances[column] >= BERM_END || ( column + 1 < columns && clearances[column + 1] >= BERM_END && column > 0 && clearances[column - 1] >= BERM_END ) )
		let column = 0
		while ( column < columns ) {
			if ( !open( column ) ) {
				column++
				continue
			}
			const first = column
			while ( open( column ) ) column++
			const last = column - 1
			// A gap that runs off either end of the road has only its other end to close.
			const opens = first > 0
			const closes = last < columns - 1
			if ( last - first + 1 < ( ( opens ? 1 : 0 ) + ( closes ? 1 : 0 ) ) * BERM_END_COLUMNS ) continue

			// Inside the gap nothing stands: each column folds to a point under its own ground.
			for ( let buried = first; buried <= last; buried++ ) {
				const x = ( edges[buried * 6] + edges[buried * 6 + 3] ) * 0.5
				const z = ( edges[buried * 6 + 2] + edges[buried * 6 + 5] ) * 0.5
				const y = terrainHeight( x, z ) - 1
				for ( let vertex = buried * BERM_STRIDE; vertex < ( buried + 1 ) * BERM_STRIDE; vertex += 3 ) {
					berm[vertex] = x
					berm[vertex + 1] = y
					berm[vertex + 2] = z
				}
			}
			if ( opens ) this.writeBermEnd( first - 1, first, 1 )
			if ( closes ) this.writeBermEnd( last + 1, last, -1 )
		}
	}

	/** The section at `offset` of `source` into `column`: a slope down each side, and no end slope, folded onto the left crest. */
	placeSection( column, source, offset ) {
		const berm = this.berm.geometry.getAttribute( 'position' ).array
		const base = column * BERM_STRIDE
		for ( let component = 0; component < SECTION_STRIDE; component++ ) berm[base + component] = source[offset + component]
		this.placeEndSlope( column, base + 3, base + 3 )
	}

	/** The two vertices of `column` that carry an end slope, onto the vertices at `left` and `right` of the embankment. */
	placeEndSlope( column, left, right ) {
		const berm = this.berm.geometry.getAttribute( 'position' ).array
		const base = column * BERM_STRIDE + SECTION_STRIDE
		berm.copyWithin( base, left, left + 3 )
		berm.copyWithin( base + 3, right, right + 3 )
	}

	/**
	 * Close the embankment between the last column that stands, `standing`, and
	 * the first that does not, `open`: its section exactly where the deck reaches
	 * `BERM_END`, then the foot of the slope that runs on from there, then that
	 * foot buried. The slope is one quad between the crests and where they land:
	 * every other column keeps its two end-slope vertices on one point of that
	 * quad's edge, so nothing else is drawn between the crests.
	 */
	writeBermEnd( standing, open, step ) {
		const { sections, clearances, edges } = this
		const berm = this.berm.geometry.getAttribute( 'position' ).array
		const share = MathUtils.clamp( ( BERM_END - clearances[standing] ) / ( clearances[open] - clearances[standing] ), 0, 1 )
		for ( let component = 0; component < SECTION_STRIDE; component++ ) {
			_section[component] = MathUtils.lerp( sections[standing * SECTION_STRIDE + component], sections[open * SECTION_STRIDE + component], share )
		}
		const top = open * BERM_STRIDE
		const foot = ( open + step ) * BERM_STRIDE
		const buried = ( open + step * 2 ) * BERM_STRIDE
		this.placeSection( open, _section, 0 )
		this.placeEndSlope( open, top + 3, top + 6 )
		this.placeEndSlope( standing, top + 3, top + 3 )

		// Down the road, away from the embankment.
		let alongX = edges[open * 6] + edges[open * 6 + 3] - edges[standing * 6] - edges[standing * 6 + 3]
		let alongZ = edges[open * 6 + 2] + edges[open * 6 + 5] - edges[standing * 6 + 2] - edges[standing * 6 + 5]
		const length = Math.hypot( alongX, alongZ ) || 1
		alongX /= length
		alongZ /= length
		this.placeSection( open + step, _section, 0 )
		for ( const crest of [3, 6] ) {
			const reach = slopeReach( _section[crest], _section[crest + 1], _section[crest + 2], alongX, alongZ )
			berm[foot + crest] = _section[crest] + alongX * reach
			berm[foot + crest + 2] = _section[crest + 2] + alongZ * reach
			berm[foot + crest + 1] = terrainHeight( berm[foot + crest], berm[foot + crest + 2] ) - 0.12
		}
		this.placeEndSlope( open + step, foot + 3, foot + 6 )

		berm.copyWithin( buried, foot, foot + SECTION_STRIDE )
		for ( let vertex = 0; vertex < SECTION_STRIDE; vertex += 3 ) berm[buried + vertex + 1] -= 0.6
		this.placeEndSlope( open + step * 2, foot + 3, foot + 3 )
	}

	/**
	 * Spread piers evenly along each authored span, wherever the deck clears the
	 * terrain and any road beneath it. Spacing restarts at every control, so a
	 * longer span re-spaces only its own piers instead of sliding every pier after it.
	 */
	updatePiers( plan, half ) {
		let count = 0
		const spans = plan ? plan.anchors.length - 1 : 0
		for ( let span = 0; span < spans && count < MAX_PIERS; span++ ) {
			count = this.updateSpanPiers( plan, plan.anchors[span], plan.anchors[span + 1], half, count )
		}
		for ( const mesh of this.level === 'simple' ? this.postParts : this.pierParts ) {
			mesh.count = count
			mesh.instanceMatrix.needsUpdate = true
		}
	}

	/** Stand the piers of one span from instance `count` on, and return the new count. */
	updateSpanPiers( plan, start, end, half, count ) {
		const { points } = plan
		let length = 0
		for ( let index = start + 1; index <= end; index++ ) length += segmentLength( points, index )
		const slots = Math.max( 1, Math.round( length / ( this.level === 'simple' ? POST_SPACING : PIER_SPACING ) ) )
		const pitch = length / slots
		let travelled = 0
		let slot = 0
		for ( let index = start + 1; index <= end && slot < slots && count < MAX_PIERS; index++ ) {
			const segment = segmentLength( points, index )
			const probes = Math.max( 1, Math.ceil( segment / PIER_PROBE_STEP ) )
			for ( let probe = 1; probe <= probes && slot < slots && count < MAX_PIERS; probe++ ) {
				const t = probe / probes
				const probeDistance = travelled + segment * t
				const target = ( slot + 0.5 ) * pitch
				if ( probeDistance < target || probeDistance >= length - 1e-4 ) continue

				if ( this.placePier( plan, index, t, half, count ) ) {
					slot++
					count++
				} else if ( probeDistance >= target + pitch * 0.5 ) {
					// Waited half a pitch for the deck to clear: give the slot up.
					slot++
				}
			}
			travelled += segment
		}
		return count
	}

	/** Stand pier `count` under the deck at `t` along segment `index`, unless the deck is too low there. */
	placePier( plan, index, t, half, count ) {
		const { points } = plan
		const from = ( index - 1 ) * 3
		const to = index * 3
		const x = points[from] + ( points[to] - points[from] ) * t
		const y = points[from + 1] + ( points[to + 1] - points[from + 1] ) * t
		const z = points[from + 2] + ( points[to + 2] - points[from + 2] ) * t
		const ahead = t > 0.999 && to + 3 < points.length ? to + 3 : to
		const tangentX = points[ahead] - points[from]
		const tangentY = points[ahead + 1] - points[from + 1]
		const tangentZ = points[ahead + 2] - points[from + 2]
		const yaw = Math.atan2( tangentX, tangentZ )
		const climb = -Math.atan2( tangentY, Math.hypot( tangentX, tangentZ ) )
		const bank = MathUtils.lerp( plan.bank[index - 1], plan.bank[index], t )

		// Yaw, pitch, then a positive roll about the tangent rebuild the deck's
		// own level-then-banked frame, so the head stays parallel to the deck and
		// hangs along its normal instead of straight down, where its upper
		// corner cut through a banked or sloping road.
		_pier.rotation.set( climb, yaw, bank )
		_capDown.set( 0, -1, 0 ).applyQuaternion( _pier.quaternion )
		const simple = this.level === 'simple'
		// How far under the road the shaft starts, along that normal.
		const neck = simple ? FASCIA_DEPTH + CAP_HEIGHT : GIRDER_DEPTH + BEARING_HEIGHT + HEAD_HEIGHT
		const footX = x + _capDown.x * neck
		const footY = y + _capDown.y * neck
		const footZ = z + _capDown.z * neck
		const ground = terrainHeight( footX, footZ )
		const height = footY - ground
		if ( height < ( simple ? POST_MIN_HEIGHT : PIER_MIN_HEIGHT ) || isAboveRoad( points, index, x, y, z, half ) ) return false

		if ( simple ) {
			const capDepth = FASCIA_DEPTH + CAP_HEIGHT * 0.5
			_pier.position.set( x + _capDown.x * capDepth, y + _capDown.y * capDepth, z + _capDown.z * capDepth )
			_pier.scale.set( half * 1.5, CAP_HEIGHT, 1.3 )
			_pier.updateMatrix()
			this.postCaps.setMatrixAt( count, _pier.matrix )

			_pier.position.set( footX, ground - PIER_FOOTING, footZ )
			_pier.rotation.set( 0, yaw, 0 )
			_pier.scale.set( 1, height + PIER_FOOTING, 1 )
			_pier.updateMatrix()
			this.posts.setMatrixAt( count, _pier.matrix )
			return true
		}

		// The pads sit on the soffit of the girder, and the head hangs under the pads.
		const across = half / PIER_HALF
		_pier.scale.set( across, 1, 1 )
		_pier.position.set( x + _capDown.x * GIRDER_DEPTH, y + _capDown.y * GIRDER_DEPTH, z + _capDown.z * GIRDER_DEPTH )
		_pier.updateMatrix()
		this.pierBearings.setMatrixAt( count, _pier.matrix )
		_pier.position.addScaledVector( _capDown, BEARING_HEIGHT )
		_pier.updateMatrix()
		this.pierHeads.setMatrixAt( count, _pier.matrix )

		// The shaft stands plumb, and rises into the collar of a leaning head far enough to leave no gap under it.
		const rise = HEAD_COLLAR * across * Math.hypot( _capDown.x, _capDown.z ) + 0.06
		_pier.rotation.set( 0, yaw, 0 )
		_pier.position.set( footX, ground - PIER_FOOTING, footZ )
		_pier.scale.set( across, height + PIER_FOOTING + rise, 1 )
		_pier.updateMatrix()
		this.piers.setMatrixAt( count, _pier.matrix )

		_pier.position.set( footX, ground + FOOTING_SHOWS, footZ )
		_pier.scale.set( across, 1, 1 )
		_pier.updateMatrix()
		this.pierFootings.setMatrixAt( count, _pier.matrix )
		return true
	}
}

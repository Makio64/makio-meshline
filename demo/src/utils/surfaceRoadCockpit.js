/**
 * The driver's seat of the Road Builder demo: the cockpit the Drive view looks out of, in the carbon,
 * the cyan lights and the type of the MakioMeshlines hover car of the Wind Tunnel demo, with instruments
 * that read the car and the renderer, and a map of the road. Only the route on that map is a MeshLine.
 *
 * Nobody needs it before they take the driver's seat, so it costs the demo nothing to load: it is built
 * when the page first has an idle moment. And it is kept cheap to compile on the first drive: it stays
 * out of the occlusion prepass, and its mirror is filmed with the pipelines the road is already drawn with.
 */
import { MeshLine } from 'makio-meshline'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { attribute, color, float, Fn, mix, normalView, positionViewDirection, reflectVector, texture, triplanarTexture, uniform, uv, vec2, vec3 } from 'three/tsl'
import {
	BoxGeometry,
	BufferAttribute,
	BufferGeometry,
	CatmullRomCurve3,
	CircleGeometry,
	Color,
	CylinderGeometry,
	DepthTexture,
	ExtrudeGeometry,
	FloatType,
	Group,
	HalfFloatType,
	InstancedMesh,
	MathUtils,
	Matrix4,
	Mesh,
	MeshBasicNodeMaterial,
	MeshStandardNodeMaterial,
	PerspectiveCamera,
	PlaneGeometry,
	Quaternion,
	RenderTarget,
	Shape,
	ShapeGeometry,
	TextureLoader,
	TorusGeometry,
	TubeGeometry,
	Vector2,
	Vector3,
} from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { createCarbonWeave } from '@/utils/carbonWeave'
import { DOOR_MIRROR, extrudeProfile, glance, PAINTS, surroundings, WELL } from '@/utils/surfaceRoadTraffic'

// Where the driver sits, to the left of the centreline, and their eyes in the frame of the car's body:
// far enough back to see the steering wheel whole, and the instruments over its rim.
const SEAT = 0.24
export const EYE = new Vector3( SEAT, 0.88, -0.28 )
// The hub of the steering wheel, how far its top leans away from the driver, and how far it turns for the lock of the front wheels.
const HUB = new Vector3( SEAT, 0.656, 0.045 )
const RAKE = 0.42
const WHEEL_TURNS = 4
const RIM = 0.088
const GRIP = 0.0105
// The floor of the well, and the top of the doors either side of it.
const FLOOR = 0.36
const SILL = 0.704
// The top of the dashboard from its brow to the foot of the windscreen, as `[z, y]`.
const PAD_TOP = [[0.135, 0.707], [0.2, 0.703], [0.3, 0.692], [0.395, 0.676]]
// Tows of the carbon weave to the metre.
const WEAVE = 170

// The two screens standing on the dashboard, in metres, and how far they lean back.
const CLUSTER = [0.246, 0.074]
const NAV = [0.266, 0.074]
const BEZEL = 0.006
const LEAN = 0.25
const NAV_TURN = 0.24
// The part of the map screen the road is drawn in, from its centre, and how far the drawing stands off the glass.
const MAP = { x: -0.051, y: 0.002, width: 0.125, height: 0.056, lift: 0.0012 }
// The lean of the car's body that pins the needle of each instrument.
const HARD_PEDAL = 0.05
const HARD_BEND = 0.09
// How often the readings are taken, in milliseconds: figures that change every frame cannot be read.
const READING = 500

// Where each mark lies on `/textures/road-cockpit.png`, in pixels from its top left corner. The sheet is set
// in the type of the hover car's livery by scripts/road-cockpit/sheet.py, which prints this table.
const SHEET = {
	width: 2048,
	height: 448,
	digit: [128, 200],
	roundel: [1304, 0, 195, 195],
	solid: [1531, 8, 32, 32],
	name: [0, 224, 1124, 131],
	unit: [1148, 224, 161, 55],
	fps: [1333, 224, 108, 57],
	vertices: [1465, 224, 194, 57],
	triangles: [1683, 224, 136, 57],
	install: [0, 379, 685, 52],
}
// The vinyl of the livery: white, the cyan of the hover car's light bars, and a grey for what should not shout.
const VINYL = [0.81, 0.84, 0.88]
const VINYL_CYAN = [0.098, 0.716, 1]
const VINYL_GREY = [0.3, 0.32, 0.35]
// A decal on the dashboard is seen at a glancing angle: it is drawn this many times deeper than it is wide to read true.
const STRETCH = 3
// How far a decal stands off what it is stuck on.
const PROUD = 0.0006

/** Do `chore` when the page next has nothing better to do, or within a couple of seconds. */
const whenIdle = chore => window.requestIdleCallback ? window.requestIdleCallback( chore, { timeout: 2000 } ) : setTimeout( chore, 200 )

const _span = new Vector3()
const _start = new Vector3()
const _turn = new Quaternion()
const _frame = new Matrix4()
const _dot = new Matrix4()
const _yAxis = new Vector3( 0, 1, 0 )
const _color = new Color()

//---------------------------------------------------------- PARTS

/**
 * What a part is made of: its colour, how rough it is, and how metallic, how brightly it glows,
 * how much of the car's paint it wears and whether it is woven carbon.
 */
const look = ( r, g, b, roughness, { metalness = 0, glow = 0, paint = 0, weave = 0 } = {} ) => ( { tone: [r, g, b, weave], finish: [roughness, metalness, glow, paint] } )
// Lacquered carbon, as on the hover car: its weave gives it both its colour and its gloss.
const CARBON = look( 1, 1, 1, 0.4, { weave: 1 } )
const SUEDE = look( 0.02, 0.021, 0.025, 0.95 )
const PLASTIC = look( 0.03, 0.031, 0.036, 0.8 )
const CARPET = look( 0.008, 0.0085, 0.01, 1 )
const PIANO = look( 0.006, 0.0065, 0.008, 0.1 )
const ALLOY = look( 0.62, 0.64, 0.68, 0.3, { metalness: 1 } )
const GUNMETAL = look( 0.2, 0.21, 0.23, 0.36, { metalness: 1 } )
// The car's own paint, metallic under its lacquer, and matt where it is stitched into a seat.
const PAINT = look( 1, 1, 1, 0.22, { metalness: 0.5, paint: 1 } )
const PIPING = look( 1, 1, 1, 0.8, { paint: 1 } )
// Light bars: the cyan of the hover car. And the red that marks the top of the steering wheel.
const CYAN = look( ...VINYL_CYAN, 0.5, { glow: 1.25 } )
const MARK = look( 0.75, 0.03, 0.02, 0.5, { glow: 0.25 } )

/**
 * Give every vertex of a part its look, so the cockpit merges into one geometry behind one material.
 * `shade` darkens a part that sits in the shadow of another: no shadow map is fine enough for a cockpit.
 */
const dress = ( geometry, { tone, finish }, shade = 1 ) => {
	const part = geometry.index ? geometry.toNonIndexed() : geometry
	const count = part.getAttribute( 'position' ).count
	const tones = new Float32Array( count * 4 )
	const finishes = new Float32Array( count * 4 )
	for ( let vertex = 0; vertex < count; vertex++ ) {
		tones.set( [tone[0] * shade, tone[1] * shade, tone[2] * shade, tone[3]], vertex * 4 )
		finishes.set( finish, vertex * 4 )
	}
	part.setAttribute( 'tone', new BufferAttribute( tones, 4 ) )
	part.setAttribute( 'finish', new BufferAttribute( finishes, 4 ) )
	return part
}

const box = ( width, height, depth, x, y, z ) => new BoxGeometry( width, height, depth ).translate( x, y, z )

/** A disc or a short rod about the Z axis, its `near` end towards the driver. */
const puck = ( near, far, depth, sides = 24 ) => new CylinderGeometry( near, far, depth, sides ).rotateX( -Math.PI / 2 )

/** A bar `width` by `depth` from one point to another. */
const strut = ( from, to, width, depth ) => {
	_span.fromArray( to ).sub( _start.fromArray( from ) )
	const length = _span.length()
	_turn.setFromUnitVectors( _yAxis, _span.normalize() )
	return new BoxGeometry( width, length, depth ).applyQuaternion( _turn )
		.translate( ( from[0] + to[0] ) / 2, ( from[1] + to[1] ) / 2, ( from[2] + to[2] ) / 2 )
}

/** Turn a box inside out: the well of the cockpit is seen from within. */
const inward = geometry => {
	const index = geometry.getIndex()
	for ( let face = 0; face < index.count; face += 3 ) {
		const corner = index.getX( face )
		index.setX( face, index.getX( face + 2 ) )
		index.setX( face + 2, corner )
	}
	const normal = geometry.getAttribute( 'normal' )
	for ( let offset = 0; offset < normal.array.length; offset++ ) normal.array[offset] *= -1
	return geometry
}

/** The outline of a plate with rounded corners, about its middle. */
const roundedPlate = ( width, height, radius ) => {
	const x = width / 2 - radius
	const y = height / 2 - radius
	return new Shape()
		.absarc( x, y, radius, 0, Math.PI / 2 )
		.absarc( -x, y, radius, Math.PI / 2, Math.PI )
		.absarc( -x, -y, radius, Math.PI, Math.PI * 1.5 )
		.absarc( x, -y, radius, Math.PI * 1.5, Math.PI * 2 )
}

/** Stretch the UVs of a flat piece of glass from one corner of its `width` and `height` to the other, then keep the part `[u, v, across, up]` of them. */
const frameGlass = ( geometry, width, height, [u, v, across, up] = [0, 0, 1, 1] ) => {
	const position = geometry.getAttribute( 'position' )
	const uv = geometry.getAttribute( 'uv' )
	for ( let vertex = 0; vertex < uv.count; vertex++ ) {
		uv.setXY( vertex, u + ( position.getX( vertex ) / width + 0.5 ) * across, v + ( position.getY( vertex ) / height + 0.5 ) * up )
	}
	return geometry
}

/** The frame of a panel at `centre` that faces along `normal`: X to the right of whoever reads it, Y up it, Z out of it. */
const panelFrame = ( centre, normal ) => {
	const out = new Vector3().fromArray( normal ).normalize()
	const right = new Vector3( 0, 1, 0 ).cross( out ).normalize()
	const up = new Vector3().crossVectors( out, right )
	return new Matrix4().makeBasis( right, up, out ).setPosition( ...centre )
}

// The instruments face the driver over the wheel. The map hinges on their inner edge and turns towards the seat.
const CLUSTER_FRAME = panelFrame( [SEAT, 0.739, 0.275], [0, Math.sin( LEAN ), -Math.cos( LEAN )] )
const HINGE = SEAT - CLUSTER[0] / 2 - BEZEL - 0.002
const NAV_REACH = NAV[0] / 2 + BEZEL
const NAV_FRAME = panelFrame(
	[HINGE - Math.cos( NAV_TURN ) * NAV_REACH, 0.739, 0.275 - Math.sin( NAV_TURN ) * NAV_REACH],
	[Math.sin( NAV_TURN ) * Math.cos( LEAN ), Math.sin( LEAN ), -Math.cos( NAV_TURN ) * Math.cos( LEAN )],
)
// The rear-view mirror hangs under the header, clear of the windscreen, and looks at the driver. Its glass is
// a screen: a camera over the tail lamps sees the road behind, `REAR_VIEW` degrees of it across.
const MIRROR_AT = [0.02, 0.904, 0.03]
const MIRROR_FRAME = panelFrame( MIRROR_AT, [EYE.x - MIRROR_AT[0], EYE.y - MIRROR_AT[1], EYE.z - MIRROR_AT[2]] )
const MIRROR_GLASS = [0.118, 0.03]
// How much of that picture a door mirror shows, across and up: the side of the road that is on its side of the car.
const DOOR_VIEW = [0.4, 0.7]
const REAR_CAMERA = [0, 0.8, -1.53]
const REAR_VIEW = 32
// The steering column: the wheel turns about its Z.
const COLUMN_FRAME = new Matrix4().makeRotationX( RAKE ).setPosition( HUB )

/** Everything that stays put: the well, the doors, the dashboard, the seats, and the frame of the glass. */
function createCabinGeometry() {
	const { half, rear, front } = WELL
	const length = front - rear + 0.01
	const middle = ( front + rear + 0.01 ) / 2
	const parts = [
		dress( inward( new BoxGeometry( half * 2, 0.672 - FLOOR, length ) ).translate( 0, ( 0.672 + FLOOR ) / 2, middle ), CARPET ),

		// The dashboard: a pad of carbon that rises from the foot of the windscreen to a brow, and the fascia tucked under it.
		dress( extrudeProfile( [[0.395, 0.66], ...PAD_TOP.toReversed(), [0.108, 0.702], [0.094, 0.688], [0.092, 0.672], [0.15, 0.664]], half * 2 ), CARBON ),
		dress( extrudeProfile( [[0.37, 0.5], [0.37, 0.66], [0.139, 0.66], [0.125, 0.6], [0.14, 0.535], [0.19, 0.5]], half * 2 ), SUEDE, 0.55 ),
		dress( box( 0.74, 0.0022, 0.016, 0, 0.6815, 0.366 ), CARPET ),
		// A pinstripe of light along the brow.
		dress( box( half * 2 - 0.02, 0.001, 0.0016, 0, 0.7072, 0.1362 ), CYAN ),
		// A blade in the car's paint across the fascia, under a bar of light.
		dress( box( 0.76, 0.016, 0.01, 0, 0.632, 0.129 ), PAINT, 0.7 ),
		dress( box( 0.76, 0.0022, 0.003, 0, 0.6435, 0.1255 ), CYAN ),

		// The two screens stand on the pad in one glossy slab, on a foot of alloy.
		dress( box( CLUSTER[0] + BEZEL * 2, CLUSTER[1] + BEZEL * 2, 0.008, 0, 0, -0.0045 ).applyMatrix4( CLUSTER_FRAME ), PIANO ),
		dress( box( NAV[0] + BEZEL * 2, NAV[1] + BEZEL * 2, 0.008, 0, 0, -0.0045 ).applyMatrix4( NAV_FRAME ), PIANO ),
		dress( box( CLUSTER[0] + BEZEL * 2, 0.0024, 0.004, 0, -CLUSTER[1] / 2 - BEZEL + 0.0012, 0.0006 ).applyMatrix4( CLUSTER_FRAME ), ALLOY ),
		dress( box( NAV[0] + BEZEL * 2, 0.0024, 0.004, 0, -NAV[1] / 2 - BEZEL + 0.0012, 0.0006 ).applyMatrix4( NAV_FRAME ), ALLOY ),

		// The column behind the wheel.
		dress( box( 0.05, 0.044, 0.075, 0, -0.006, 0.052 ).applyMatrix4( COLUMN_FRAME ), PLASTIC ),

		// The tunnel between the seats, with its selector and its dial.
		dress( box( 0.15, 0.2, 0.92, 0, 0.46, -0.32 ), CARBON ),
		dress( box( 0.126, 0.004, 0.5, 0, 0.562, -0.14 ), PIANO ),
		dress( box( 0.032, 0.024, 0.05, 0.022, 0.576, -0.02 ), ALLOY ),
		dress( new CylinderGeometry( 0.02, 0.02, 0.014, 24 ).translate( -0.03, 0.571, -0.13 ), ALLOY ),
		dress( new TorusGeometry( 0.0215, 0.0016, 6, 24 ).rotateX( Math.PI / 2 ).translate( -0.03, 0.566, -0.13 ), CYAN ),

		// Over the glass: the header, and the mirror on its stem.
		dress( box( half * 2, 0.012, 0.026, 0, 0.947, 0.034 ), SUEDE ),
		// The mirror's back, and the neck that hangs it from the header: behind the glass, never across it.
		dress( new ExtrudeGeometry( roundedPlate( MIRROR_GLASS[0] + 0.006, MIRROR_GLASS[1] + 0.006, 0.011 ), { depth: 0.01, bevelEnabled: false, curveSegments: 5 } ).translate( 0, 0, -0.0105 ).applyMatrix4( MIRROR_FRAME ), PIANO ),
		dress( box( 0.016, 0.03, 0.008, 0, MIRROR_GLASS[1] / 2 + 0.012, -0.008 ).applyMatrix4( MIRROR_FRAME ), PLASTIC ),
	]

	for ( const side of [-1, 1] ) {
		parts.push(
			// A door: its card, the capping under the glass, a panel of suede over an armrest, and a bar of light between them.
			dress( box( 0.012, SILL - 0.4, length, side * ( half - 0.008 ), ( SILL + 0.4 ) / 2, middle ), PLASTIC, 0.7 ),
			dress( box( 0.06, 0.02, length + 0.05, side * ( half + 0.025 ), SILL, middle + 0.025 ), SUEDE ),
			dress( box( 0.008, 0.05, length - 0.16, side * ( half - 0.017 ), 0.636, middle - 0.03 ), SUEDE, 0.8 ),
			dress( box( 0.05, 0.03, 0.5, side * ( half - 0.04 ), 0.585, -0.2 ), SUEDE ),
			dress( box( 0.004, 0.003, length - 0.16, side * ( half - 0.0155 ), 0.666, middle - 0.03 ), CYAN ),
			// The pillar beside the windscreen, and the rail it carries.
			dress( strut( [side * ( half + 0.015 ), 0.692, 0.388], [side * half, 0.947, 0.036], 0.022, 0.034 ), SUEDE ),
			dress( box( 0.022, 0.014, 0.56, side * half, 0.946, -0.25 ), SUEDE ),
			// An air vent at each end of the fascia.
			dress( new TorusGeometry( 0.02, 0.0032, 8, 28 ).translate( side * 0.44, 0.63, 0.126 ), ALLOY ),
			dress( new CircleGeometry( 0.019, 24 ).rotateY( Math.PI ).translate( side * 0.44, 0.63, 0.1285 ), CARPET ),
			dress( puck( 0.005, 0.005, 0.006, 12 ).translate( side * 0.44, 0.63, 0.1255 ), GUNMETAL ),
			// A stalk on the column.
			dress( new CylinderGeometry( 0.0036, 0.0046, 0.07, 8 ).rotateZ( Math.PI / 2 ).translate( side * 0.058, 0.004, 0.036 ).applyMatrix4( COLUMN_FRAME ), PIANO ),
			// A seat, with a stripe of the car's paint down its middle.
			dress( box( 0.26, 0.06, 0.36, side * 0.25, 0.45, -0.38 ), SUEDE ),
			dress( box( 0.05, 0.004, 0.34, side * 0.25, 0.481, -0.38 ), PIPING ),
			dress( new BoxGeometry( 0.26, 0.38, 0.06 ).rotateX( -0.22 ).translate( side * 0.25, 0.64, -0.6 ), SUEDE ),
			dress( new BoxGeometry( 0.05, 0.34, 0.004 ).translate( 0, 0, 0.031 ).rotateX( -0.22 ).translate( side * 0.25, 0.64, -0.6 ), PIPING ),
			dress( box( 0.14, 0.09, 0.05, side * 0.25, 0.815, -0.62 ), SUEDE ),
		)
	}

	const cabin = mergeGeometries( parts )
	// No light bounces round this cabin, so the well is shaded by hand: the deeper a part sits, the darker it is.
	const position = cabin.getAttribute( 'position' )
	const tone = cabin.getAttribute( 'tone' )
	const finish = cabin.getAttribute( 'finish' )
	for ( let vertex = 0; vertex < position.count; vertex++ ) {
		if ( finish.getZ( vertex ) > 0 ) continue
		const depth = MathUtils.lerp( 0.3, 1, MathUtils.smoothstep( position.getY( vertex ), 0.44, 0.69 ) )
		tone.setXYZ( vertex, tone.getX( vertex ) * depth, tone.getY( vertex ) * depth, tone.getZ( vertex ) * depth )
	}
	return cabin
}

/**
 * The steering wheel about its own Z axis, facing -Z: a flat-bottomed rim of suede with a red mark at the
 * top, so the driver sees it turn, three spokes, and the number of the car on its hub.
 */
function createHelmGeometry() {
	// Round from the right-hand end of the flat bottom, over the top, to its left-hand end.
	const rim = []
	for ( let step = 0; step <= 28; step++ ) {
		const angle = MathUtils.degToRad( -48 + step * 276 / 28 )
		rim.push( new Vector3( Math.cos( angle ) * RIM, Math.sin( angle ) * RIM, 0 ) )
	}
	const parts = [
		dress( new TubeGeometry( new CatmullRomCurve3( rim, true ), 96, GRIP, 10, true ), SUEDE ),
		dress( new TorusGeometry( RIM, GRIP + 0.0008, 10, 6, 0.2 ).rotateZ( Math.PI / 2 - 0.1 ), MARK ),
		// The pad over the hub, the column behind it, and the spoke down to the flat of the rim.
		dress( puck( 0.026, 0.031, 0.016, 28 ).translate( 0, 0, -0.004 ), PLASTIC ),
		dress( puck( 0.02, 0.017, 0.1, 16 ).translate( 0, 0, 0.055 ), PLASTIC ),
		dress( box( 0.02, 0.06, 0.007, 0, -0.04, 0.002 ), GUNMETAL ),
	]
	for ( const side of [-1, 1] ) {
		parts.push(
			// A spoke with a lit switch, and a shift paddle behind it.
			dress( box( 0.064, 0.02, 0.007, side * 0.054, -0.004, 0.002 ), GUNMETAL ),
			dress( puck( 0.0034, 0.0034, 0.002, 10 ).translate( side * 0.052, -0.004, -0.0025 ), CYAN ),
			dress( box( 0.03, 0.046, 0.003, side * 0.066, 0.014, 0.014 ), ALLOY ),
		)
	}
	return mergeGeometries( parts )
}

/** The inside of the windscreen, and the glass roof behind its header. `uv().y` runs up the screen and is 1 all over the roof. */
function createGlassGeometry() {
	const foot = [0.678, 0.385]
	const head = [0.946, 0.037]
	const rise = head[0] - foot[0]
	const run = head[1] - foot[1]
	const length = Math.hypot( rise, run )
	_frame.makeBasis( _span.set( -1, 0, 0 ), _start.set( 0, rise / length, run / length ), new Vector3( 0, run / length, -rise / length ) )
		.setPosition( 0, ( foot[0] + head[0] ) / 2, ( foot[1] + head[1] ) / 2 )
	const screen = new PlaneGeometry( WELL.half * 2, length ).applyMatrix4( _frame )
	const roof = new PlaneGeometry( WELL.half * 2, 0.54 ).rotateX( Math.PI / 2 ).translate( 0, 0.951, -0.235 )
	const roofUV = roof.getAttribute( 'uv' )
	for ( let vertex = 0; vertex < roofUV.count; vertex++ ) roofUV.setY( vertex, 1 )
	return mergeGeometries( [screen, roof] )
}

//---------------------------------------------------------- DECALS

/**
 * A decal: `region` of the sheet, from `corner` along `across` and up `rise`, in vinyl of `tint`.
 * `from` and `to` take a band of the region, for a decal laid over more than one facet.
 */
const decal = ( region, corner, across, rise, tint, from = 0, to = 1 ) => {
	const [x, y, width, height] = region
	const corners = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]
	const geometry = new BufferGeometry()
	geometry.setAttribute( 'position', new BufferAttribute( new Float32Array( corners.flatMap( ( [a, b] ) => corner.map( ( start, axis ) => start + across[axis] * a + rise[axis] * b ) ) ), 3 ) )
	geometry.setAttribute( 'uv', new BufferAttribute( new Float32Array( corners.flatMap( ( [a, b] ) => [
		( x + width * a ) / SHEET.width,
		1 - ( y + height * ( 1 - MathUtils.lerp( from, to, b ) ) ) / SHEET.height,
	] ) ), 2 ) )
	geometry.setAttribute( 'color', new BufferAttribute( new Float32Array( corners.flatMap( () => tint ) ), 3 ) )
	geometry.computeVertexNormals()
	return geometry
}

/** Height of the top of the dashboard, `z` metres ahead of the middle of the car. */
const padHeight = z => {
	const facet = Math.max( 1, PAD_TOP.findIndex( ( [end] ) => end >= z ) )
	return MathUtils.mapLinear( z, PAD_TOP[facet - 1][0], PAD_TOP[facet][0], PAD_TOP[facet - 1][1], PAD_TOP[facet][1] )
}

/**
 * Stick `region` on the dashboard so that it reads from the driver's seat: it starts `left` of the
 * centreline, `near` metres ahead of the middle of the car, and runs `depth` towards the windscreen.
 * `lean` slants its far edge to the right, and `width` overrides the width its own shape gives it.
 */
const onPad = ( region, left, near, depth, tint, lean = 0, width = region[2] / region[3] * depth / STRETCH ) => {
	const strips = []
	for ( let facet = 1; facet < PAD_TOP.length; facet++ ) {
		const start = Math.max( near, PAD_TOP[facet - 1][0] )
		const end = Math.min( near + depth, PAD_TOP[facet][0] )
		if ( end <= start ) continue
		const from = ( start - near ) / depth
		const to = ( end - near ) / depth
		strips.push( decal( region, [left - lean * from, padHeight( start ) + PROUD, start], [-width, 0, 0], [-lean * ( to - from ), padHeight( end ) - padHeight( start ), end - start], tint, from, to ) )
	}
	return strips
}

/** The livery of the cockpit, kept quiet: the three slashes of the hover car under the map, and along the driver's door how to get the car. */
function createLiveryGeometry() {
	return mergeGeometries( [
		...onPad( SHEET.solid, 0.05, 0.143, 0.058, VINYL, 0.03, 0.026 ),
		...onPad( SHEET.solid, 0.012, 0.143, 0.058, VINYL_CYAN, 0.03, 0.011 ),
		...onPad( SHEET.solid, -0.008, 0.143, 0.058, VINYL, 0.03, 0.006 ),
		decal( SHEET.install, [WELL.half + 0.012, SILL + 0.01 + PROUD, 0.04], [0, 0, 0.22], [0.03, 0, 0], VINYL_GREY ),
	] )
}

/** The number of the car, on the hub of the steering wheel. */
const createRoundelGeometry = () => decal( SHEET.roundel, [0.019, -0.019, -0.012 - PROUD], [-0.038, 0, 0], [0, 0.038, 0], VINYL )

//---------------------------------------------------------- MATERIALS

/**
 * A material that hides what is behind it, yet is drawn with the transparent objects. The contact
 * occlusion of the road is taken from a prepass of the opaque ones: a cockpit a hand's width from
 * the eye has no use for it, and staying out of that pass halves the shaders it has to compile.
 */
const lateOpaque = material => Object.assign( material, { transparent: true, fog: false } )

/** One material for every part: each vertex carries its own colour and finish. */
function createCabinMaterial( paint ) {
	const tone = attribute( 'tone', 'vec4' )
	const finish = attribute( 'finish', 'vec4' )
	// The twill of the hover car's trim: tows of alternating colour and gloss under one lacquer.
	const tow = triplanarTexture( texture( createCarbonWeave() ), null, null, float( WEAVE ) ).r
	const dyed = mix( tone.rgb, paint, finish.w )
	const base = mix( dyed, dyed.mul( mix( color( 0x101114 ), color( 0x24262B ), tow ) ), tone.a )
	const roughness = mix( finish.x, mix( float( 0.52 ), float( 0.34 ), tow ), tone.a )
	const material = lateOpaque( new MeshStandardNodeMaterial() )
	// What glows is all light: lit as well, a bar of cyan would wash out to white.
	material.colorNode = base.mul( finish.z.clamp().oneMinus() )
	material.roughnessNode = roughness
	material.metalnessNode = finish.y
	// What polish a part has mirrors the sky, as the paint of the cars does. Metal tints what it mirrors.
	const polish = roughness.oneMinus().pow( 2 )
	material.emissiveNode = base.mul( finish.z ).add( surroundings( reflectVector ).mul( polish ).mul( mix( vec3( glance ), base, finish.y ) ) )
	return material
}

/** Vinyl: the ink of the sheet is where there is any. */
function createLiveryMaterial( sheet ) {
	const material = new MeshStandardNodeMaterial( { transparent: true, depthWrite: false, roughness: 0.45 } )
	material.colorNode = attribute( 'color', 'vec3' )
	material.opacityNode = texture( sheet, uv() ).r
	return material
}

/**
 * The canopy: a tint down from the header with the thin-film sheen of the hover car's,
 * violet seen square on and teal at a glance, and the pale ghost of the dashboard low in the glass.
 */
function createGlassMaterial() {
	const material = new MeshBasicNodeMaterial( { transparent: true, depthWrite: false, fog: false } )
	const height = uv().y
	const band = height.smoothstep( 0.6, 1 ).mul( 0.52 )
	const ghost = height.smoothstep( 0, 0.28 ).oneMinus().mul( 0.045 )
	const film = mix( color( 0x05283A ), color( 0x1A0E3C ), normalView.dot( positionViewDirection ).abs() )
	material.colorNode = mix( film, color( 0xCAD4DE ), ghost.div( ghost.add( band ).max( 1e-3 ) ) )
	material.opacityNode = band.add( ghost )
	return material
}

/** The mirror shows what the camera on the tail sees, the wrong way round as a mirror would, a touch cool and darker at its edges. */
function createMirrorMaterial( view ) {
	const material = lateOpaque( new MeshBasicNodeMaterial() )
	const shade = uv().sub( 0.5 ).mul( vec2( 1, 0.6 ) ).length().smoothstep( 0.2, 0.62 ).oneMinus().mul( 0.3 ).add( 0.62 )
	material.colorNode = texture( view, uv().oneMinus() ).rgb.mul( vec3( 0.9, 0.96, 1 ) ).mul( shade )
	return material
}

/** 1 within `half` of zero, fading out over `soft`. */
const within = ( distance, half, soft = 0.012 ) => distance.abs().sub( half ).div( soft ).negate().clamp()

/** How much ink of `region` of the sheet lies over `point`, when the region is drawn `size` wide and tall from `corner`. */
const stamp = ( sheet, [x, y, width, height], point, corner, size ) => {
	const cell = point.sub( vec2( ...corner ) ).div( vec2( ...size ) )
	const inside = within( cell.x.sub( 0.5 ), 0.5, 0.01 ).mul( within( cell.y.sub( 0.5 ), 0.5, 0.01 ) )
	const at = vec2( x / SHEET.width, 1 - ( y + height ) / SHEET.height ).add( cell.clamp().mul( vec2( width / SHEET.width, height / SHEET.height ) ) )
	return texture( sheet, at ).r.mul( inside )
}

/**
 * `value` written in the digits of the sheet, `places` of them at most and each `size` wide and tall,
 * the last one ending at `right`. A place the value has not reached stays dark.
 */
const figures = ( sheet, point, value, right, size, places ) => {
	const [cell, tall] = SHEET.digit
	let ink = float( 0 )
	for ( let place = 0; place < places; place++ ) {
		const weight = 10 ** place
		const digit = value.div( weight ).floor().mod( 10 )
		const column = point.sub( vec2( right[0] - ( place + 1 ) * size[0], right[1] ) ).div( vec2( ...size ) )
		const inside = within( column.x.sub( 0.5 ), 0.5, 0.01 ).mul( within( column.y.sub( 0.5 ), 0.5, 0.01 ) )
		const at = vec2( column.x.clamp( 0.02, 0.98 ).add( digit ).mul( cell / SHEET.width ), column.y.clamp().mul( tall / SHEET.height ).add( 1 - tall / SHEET.height ) )
		const reached = place === 0 ? 1 : value.sub( weight - 0.5 ).sign().max( 0 )
		ink = ink.add( texture( sheet, at ).r.mul( inside ).mul( reached ) )
	}
	return ink
}

// The lights of the screens: the cyan of the hover car, red for what warns, and a glass that is almost black.
const SCREEN_CYAN = vec3( ...VINYL_CYAN )
const SCREEN_RED = vec3( 1, 0.09, 0.06 )
const SCREEN_DIM = vec3( 0.06, 0.075, 0.09 )
const SCREEN_GLASS = vec3( 0.004, 0.007, 0.012 )

/**
 * The instruments: the speed in figures under a bar of slashes that fills with it, the pedals to the left
 * (power one way, braking the other) and to the right a bead that the bends and the pedals push about.
 */
function createClusterMaterial( sheet, { speed, fastest, pedal, pull } ) {
	const aspect = CLUSTER[0] / CLUSTER[1]
	const middle = aspect / 2
	const material = lateOpaque( new MeshBasicNodeMaterial() )
	material.colorNode = Fn( () => {
		// One unit is the height of the screen.
		const point = uv().mul( vec2( aspect, 1 ) )

		const reading = figures( sheet, point, speed, [middle + 0.72, 0.07], [0.48, 0.75], 3 )
		const unit = stamp( sheet, SHEET.unit, point, [middle + 0.78, 0.2], [0.33, 0.113] )

		// The bar: slashes lit as far as the speed has climbed, cyan running to white, and red at the far end.
		const segments = 32
		const along = point.x.sub( point.y.sub( 0.915 ).mul( 0.45 ) ).sub( 0.2 ).div( aspect - 0.4 )
		const bar = within( along.sub( 0.5 ), 0.5, 0.004 ).mul( within( point.y.sub( 0.915 ), 0.036 ) ).mul( within( along.mul( segments ).fract().sub( 0.5 ), 0.32, 0.08 ) )
		const lit = speed.div( fastest ).sub( along.mul( segments ).floor().add( 0.5 ).div( segments ) ).sign().max( 0 )
		const scale = mix( mix( SCREEN_CYAN, vec3( 1 ), along ), SCREEN_RED, along.smoothstep( 0.84, 0.86 ) )

		// The pedals, from the middle of their track.
		const travel = point.x.sub( 0.5 ).div( 0.32 )
		const track = within( travel, 1, 0.03 ).mul( within( point.y.sub( 0.5 ), 0.03 ) )
		const pressed = travel.sub( pedal.min( 0 ) ).sign().max( 0 ).mul( pedal.max( 0 ).sub( travel ).sign().max( 0 ) )
		const notch = within( travel, 0.02, 0.01 ).mul( within( point.y.sub( 0.5 ), 0.075 ) )

		// The bead in its ring.
		const centre = vec2( aspect - 0.5, 0.5 )
		const reach = point.sub( centre ).length()
		const ring = within( reach.sub( 0.27 ), 0.008 ).add( within( reach.sub( 0.135 ), 0.005 ).mul( 0.5 ) )
		const cross = within( point.x.sub( centre.x ), 0.004 ).add( within( point.y.sub( centre.y ), 0.004 ) ).mul( within( reach, 0.27 ) ).mul( 0.4 )
		const bead = within( point.sub( centre ).sub( pull.mul( 0.22 ) ).length(), 0.05, 0.02 )

		return SCREEN_GLASS.add( vec3( 0.03, 0.06, 0.1 ).mul( uv().y.oneMinus().pow( 2 ) ).mul( 0.25 ) )
			.add( vec3( reading ) )
			.add( vec3( 0.5, 0.55, 0.6 ).mul( unit ) )
			.add( mix( SCREEN_DIM, scale, lit ).mul( bar ) )
			.add( mix( SCREEN_DIM, mix( SCREEN_RED, SCREEN_CYAN, pedal.sign().max( 0 ) ), pressed ).mul( track ) )
			.add( vec3( 0.7 ).mul( notch ) )
			.add( vec3( 0.2, 0.24, 0.28 ).mul( ring.add( cross ) ) )
			.add( SCREEN_CYAN.mul( bead ) )
	} )()
	return material
}

/**
 * The map screen under the route: a dark sheet ruled into squares where the road is drawn, and beside it
 * what the renderer is doing: frames a second, and the vertices and triangles of the scene.
 */
function createMapMaterial( sheet, { fps, vertices, triangles } ) {
	const aspect = NAV[0] / NAV[1]
	const material = lateOpaque( new MeshBasicNodeMaterial() )
	material.colorNode = Fn( () => {
		const point = uv().mul( vec2( aspect, 1 ) )
		const column = aspect - 1.42
		const ruled = within( point.x.mul( 5 ).fract().sub( 0.5 ), 0.02, 0.03 ).max( within( point.y.mul( 5 ).fract().sub( 0.5 ), 0.02, 0.03 ) )
			.mul( point.x.smoothstep( column - 0.2, column - 0.1 ).oneMinus() )
		const rule = within( point.x.sub( column - 0.06 ), 0.004 ).mul( within( point.y.sub( 0.5 ), 0.4 ) )
		const name = stamp( sheet, SHEET.name, point, [column + 0.1, 0.81], [1.2, 1.2 * SHEET.name[3] / SHEET.name[2]] )
		// A reading a row: figures that end where its label starts.
		const edge = column + 0.9
		const label = ( region, y ) => stamp( sheet, region, point, [edge + 0.05, y], [region[2] / region[3] * 0.12, 0.12] )
		const labels = label( SHEET.fps, 0.525 ).add( label( SHEET.vertices, 0.295 ) ).add( label( SHEET.triangles, 0.085 ) )
		const counts = figures( sheet, point, vertices, [edge, 0.265], [0.115, 0.18], 7 ).add( figures( sheet, point, triangles, [edge, 0.055], [0.115, 0.18], 7 ) )
		return mix( SCREEN_GLASS, vec3( 0.012, 0.026, 0.044 ), uv().y )
			.add( vec3( 0.022, 0.04, 0.056 ).mul( ruled ) )
			.add( SCREEN_DIM.mul( rule ) )
			.add( vec3( 0.5, 0.55, 0.6 ).mul( name ) )
			.add( SCREEN_CYAN.mul( figures( sheet, point, fps, [edge, 0.49], [0.166, 0.26], 4 ) ) )
			.add( vec3( 0.84, 0.87, 0.9 ).mul( counts ) )
			.add( vec3( 0.4, 0.46, 0.52 ).mul( labels ) )
	} )()
	return material
}

//---------------------------------------------------------- COCKPIT

/**
 * One cockpit serves every car: it is built round the seat somebody sits in and put away with the
 * view. The cars themselves carry no interior, since their glass shows none of it from outside.
 */
export class RoadCockpit {
	// The paint of the car being driven, which the blade of the dashboard and the seats take up.
	paint = uniform( new Color() )
	speed = uniform( 0 )
	// The speed that fills the bar across the instruments, in km/h: the most this road allows at the pace of the traffic.
	fastest = uniform( 1 )
	allowed = 0
	pedal = uniform( 0 )
	pull = uniform( new Vector2() )
	// The readings of the map screen: frames a second, and the vertices and triangles the scene draws.
	fps = uniform( 0 )
	vertices = uniform( 0 )
	triangles = uniform( 0 )
	frames = 0
	since = 0
	root = new Group()
	ridden = -1
	route = -1
	// The road as the map draws it: the middle of the world it shows, and metres of screen per metre of road.
	chartPoints = new Float32Array( 0 )
	chartCentre = new Vector2()
	chartScale = 1

	constructor( cars ) {
		this.cars = cars
		// The car's own matrix seats the cockpit, leaning with the body on its springs.
		this.root.matrixAutoUpdate = false
		this.root.visible = false
		stage3d.add( this.root )
		// Leaving the demo before the page has had its idle moment leaves nothing to build.
		stage3d.own( () => this.gone = true )
		whenIdle( () => this.build() )
	}

	/** Make the cockpit. Whoever takes the driver's seat before the page has had an idle moment builds it there and then. */
	build() {
		if ( this.built || this.gone ) return
		const sheet = stage3d.own( new TextureLoader().load( '/textures/road-cockpit.png' ) )
		// The marks on the dashboard are read at a glancing angle.
		sheet.anisotropy = 8
		const material = createCabinMaterial( this.paint )
		const livery = createLiveryMaterial( sheet )
		this.helm = new Mesh( createHelmGeometry(), material )
		this.helm.position.copy( HUB )
		this.helm.rotation.x = RAKE
		const roundel = new Mesh( createRoundelGeometry(), livery )
		this.helm.add( roundel )

		const cluster = new Mesh( new PlaneGeometry( ...CLUSTER ), createClusterMaterial( sheet, this ) )
		cluster.applyMatrix4( CLUSTER_FRAME )

		// The route is a MeshLine like any other, an eighth of a millimetre to the metre.
		this.chart = new MeshLine()
			.lines( new Float32Array( [0, 0, 0, 0.001, 0, 0] ) )
			.color( 0x58DCFF )
			.lineWidth( 0.0026 )
			.setFrustumCulled( false )
			.dynamic( true )
			.build()
		lateOpaque( this.chart.material )
		// A dot a car, and a halo behind the one being driven.
		this.dots = new InstancedMesh( new CircleGeometry( 1, 20 ), lateOpaque( new MeshBasicNodeMaterial() ), this.cars + 1 )
		this.dots.frustumCulled = false
		const map = new Mesh( new PlaneGeometry( ...NAV ), createMapMaterial( sheet, this ) )
		const nav = new Group()
		nav.add( map, this.chart, this.dots )
		nav.applyMatrix4( NAV_FRAME )

		// The mirror: a camera on the tail, and the screen that shows what it sees. Its picture has the format
		// of the pass that draws the scene, and is filmed from inside that pass, just before the mirror is drawn:
		// so every object in it is drawn with a pipeline the scene has compiled already.
		const { renderer } = stage3d
		const aspect = MIRROR_GLASS[0] / MIRROR_GLASS[1]
		this.rearView = stage3d.own( new RenderTarget( 512, Math.round( 512 / aspect ), { samples: renderer.samples, type: HalfFloatType, depthTexture: new DepthTexture() } ) )
		if ( renderer.reversedDepthBuffer ) this.rearView.depthTexture.type = FloatType
		this.rearCamera = new PerspectiveCamera( MathUtils.radToDeg( Math.atan( Math.tan( MathUtils.degToRad( REAR_VIEW / 2 ) ) / aspect ) ) * 2, aspect, 0.3, 320 )
		this.rearCamera.position.fromArray( REAR_CAMERA )
		this.rearCamera.rotation.x = -0.04
		const glazing = createMirrorMaterial( this.rearView.texture )
		this.mirror = new Mesh( frameGlass( new ShapeGeometry( roundedPlate( ...MIRROR_GLASS, 0.009 ), 5 ), ...MIRROR_GLASS ), glazing )
		this.mirror.applyMatrix4( MIRROR_FRAME )
		// Filmed whether or not the mirror itself is in sight: the door mirrors show the same picture.
		this.mirror.frustumCulled = false
		this.mirror.onBeforeRender = this.lookBehind
		// The glass of the two door mirrors, over the dark glass every car has: each shows its own side of the road behind.
		const [wide, tall] = DOOR_MIRROR.half
		this.doorMirrors = [1, -1].map( side => new Mesh(
			frameGlass( new CircleGeometry( 1, 20 ).scale( wide, tall, 1 ), wide * 2, tall * 2, [side > 0 ? 0 : 1 - DOOR_VIEW[0], ( 1 - DOOR_VIEW[1] ) / 2, ...DOOR_VIEW] )
				.rotateY( Math.PI ).translate( side * DOOR_MIRROR.x, DOOR_MIRROR.y, DOOR_MIRROR.z - 0.0008 ),
			glazing,
		) )
		// The sun, whose shadows the mirror borrows from the frame before rather than casting them again.
		this.sun = stage3d.scene.children.find( child => child.isDirectionalLight )

		// The livery is drawn after the trim it is stuck on, and the glass after them both.
		const cabin = new Mesh( createCabinGeometry(), material )
		const decals = new Mesh( createLiveryGeometry(), livery )
		const glass = new Mesh( createGlassGeometry(), createGlassMaterial() )
		decals.renderOrder = roundel.renderOrder = 1
		glass.renderOrder = 2
		this.built = true
		this.root.add( cabin, this.helm, cluster, nav, this.mirror, ...this.doorMirrors, this.rearCamera, decals, glass )
	}

	/** Build the cockpit round the seat of car `index` of `traffic`, or put it away while nobody looks out of it. */
	update( traffic, index, shown ) {
		this.root.visible = shown
		// The first reading comes half a second after the driver sits down.
		if ( !shown ) this.frames = 0
		if ( !shown ) return
		this.build()
		this.takeReadings()
		const car = traffic.cars[index]
		this.root.matrix.copy( car.body )
		this.root.matrixWorldNeedsUpdate = true
		// The steering wheel turns the other way round its column than the road wheels about `up`.
		this.helm.rotation.z = -car.steer * WHEEL_TURNS

		this.speed.value = Math.round( car.speed * 3.6 )
		this.fastest.value = Math.max( 1, this.allowed * traffic.pace * 3.6 )
		this.pedal.value = MathUtils.clamp( -car.pitch / HARD_PEDAL, -1, 1 )
		this.pull.value.set( MathUtils.clamp( car.roll / HARD_BEND, -1, 1 ), this.pedal.value )

		if ( traffic.route !== this.route ) this.drawRoute( traffic )
		if ( index !== this.ridden ) this.takeSeat( traffic, index )
		for ( let other = 0; other < traffic.active; other++ ) this.placeDot( other, traffic.cars[other], other === index ? 0.0036 : 0.0021, 0.0008 )
		this.placeDot( traffic.active, car, 0.0066, 0.0004 )
		this.dots.count = traffic.active + 1
		this.dots.instanceMatrix.needsUpdate = true
	}

	/**
	 * Film the road behind for the mirrors, with the shadows the sun has cast for this frame already.
	 * The mirrors themselves sit it out: they cannot show the picture they are being drawn into.
	 */
	lookBehind = renderer => {
		const shadow = this.sun?.shadow
		const casting = shadow?.autoUpdate
		if ( shadow ) shadow.autoUpdate = false
		this.hang( false )
		const target = renderer.getRenderTarget()
		renderer.setRenderTarget( this.rearView )
		renderer.render( stage3d.scene, this.rearCamera )
		renderer.setRenderTarget( target )
		this.hang( true )
		if ( shadow ) shadow.autoUpdate = casting
	}

	/** Show the glass of the three mirrors, or take it down. */
	hang( shown ) {
		this.mirror.visible = shown
		for ( const mirror of this.doorMirrors ) mirror.visible = shown
	}

	/** Twice a second: how many frames that half second saw, and what the scene holds. */
	takeReadings() {
		const now = performance.now()
		// What the scene holds is known from the first frame. How fast it is drawn takes half a second to tell.
		const first = this.frames++ === 0
		if ( first ) this.since = now
		else if ( now - this.since < READING ) return
		else {
			this.fps.value = Math.round( ( this.frames - 1 ) * 1000 / ( now - this.since ) )
			this.frames = 0
		}
		this.vertices.value = 0
		this.triangles.value = 0
		stage3d.scene.traverseVisible( this.count )
	}

	/** Add what `object` draws to the readings: every vertex and triangle of a mesh, once for each of its instances. */
	count = ( { isMesh, isInstancedMesh, geometry, count } ) => {
		if ( !isMesh ) return
		const copies = isInstancedMesh ? count : 1
		// A MeshLine that reuses its buffers draws fewer vertices than they hold, and says how many.
		const drawn = geometry.vertexCount ?? geometry.getAttribute( 'position' )?.count ?? 0
		this.vertices.value += drawn * copies
		this.triangles.value += ( geometry.indexCount ?? geometry.index?.count ?? drawn ) / 3 * copies
	}

	/** Wear the paint of car `index`, and light its dot on the map. */
	takeSeat( traffic, index ) {
		this.ridden = index
		this.paint.value.setHex( PAINTS[index % PAINTS.length] )
		for ( let other = 0; other < traffic.cars.length; other++ ) this.dots.setColorAt( other, _color.setScalar( other === index ? 1 : 0.42 ) )
		this.dots.setColorAt( traffic.active, _color.setRGB( 0.04, 0.26, 0.36 ) )
		this.dots.instanceColor.needsUpdate = true
	}

	/** Draw the road on the map: north up, as large as the screen takes it. And note the fastest it lets a car go. */
	drawRoute( { points, rows, route, limit } ) {
		this.route = route
		this.allowed = 0
		for ( let row = 0; row < rows; row++ ) this.allowed = Math.max( this.allowed, limit[row] )
		// A different number of cars moves the halo to another instance.
		this.ridden = -1
		let west = Infinity
		let east = -Infinity
		let north = Infinity
		let south = -Infinity
		for ( let row = 0; row < rows; row++ ) {
			west = Math.min( west, points[row * 3] )
			east = Math.max( east, points[row * 3] )
			north = Math.min( north, points[row * 3 + 2] )
			south = Math.max( south, points[row * 3 + 2] )
		}
		this.chartCentre.set( ( west + east ) / 2, ( north + south ) / 2 )
		this.chartScale = Math.min( MAP.width / Math.max( east - west, 1 ), MAP.height / Math.max( south - north, 1 ) )
		if ( this.chartPoints.length < rows * 3 ) this.chartPoints = new Float32Array( Math.ceil( rows * 1.5 ) * 3 )
		for ( let row = 0; row < rows; row++ ) this.toChart( points[row * 3], points[row * 3 + 2], MAP.lift ).toArray( this.chartPoints, row * 3 )
		if ( rows >= 2 ) this.chart.lines( this.chartPoints.subarray( 0, rows * 3 ) )
	}

	/** Where the world's `x` and `z` fall on the map screen, `lift` metres off its glass. */
	toChart( x, z, lift ) {
		return _span.set( MAP.x + ( x - this.chartCentre.x ) * this.chartScale, MAP.y - ( z - this.chartCentre.y ) * this.chartScale, lift )
	}

	placeDot( instance, { position }, radius, lift ) {
		this.toChart( position.x, position.z, MAP.lift + lift )
		this.dots.setMatrixAt( instance, _dot.makeScale( radius, radius, 1 ).setPosition( _span ) )
	}
}

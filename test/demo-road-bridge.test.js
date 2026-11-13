import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { Matrix4, StreamDrawUsage, Vector3 } from 'three'

import { fitRoadControlsToSurface, measureRoadSurfaceClearance } from '../demo/src/utils/roadClearance.js'
import { pinnedRowDistances, pinRoadPaintToControls, RAISED_FROM, RAISED_TO } from '../demo/src/utils/roadPaint.js'
import MeshLineSurfaceGeometry from '../src/MeshLineSurfaceGeometry.js'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const asModule = source => `data:text/javascript;base64,${Buffer.from( source ).toString( 'base64' )}`

// Load the actual Vite modules in Node: their aliases resolved, the stage replaced by a list of what was added to it.
const resolveImports = ( source, stubs = {} ) => source.replace( /from '(@\/[^']+|three\/webgpu|three\/tsl)'/g, ( _, specifier ) => {
	const url = stubs[specifier] ?? ( specifier.startsWith( '@/' )
		? new URL( `../demo/src/${specifier.slice( 2 )}.js`, import.meta.url ).href
		: import.meta.resolve( specifier ) )
	return `from '${url}'`
} )

const previousWindow = globalThis.window
globalThis.window = { fxseed: 'road-bridge', fxrand: () => 0.5 }
const routeUrl = asModule( resolveImports( await read( 'demo/src/utils/surfaceRoadRoute.js' ) ) )
let route
try {
	route = await import( routeUrl )
} finally {
	if ( previousWindow === undefined ) delete globalThis.window
	else globalThis.window = previousWindow
}

const bridgeSource = await read( 'demo/src/utils/surfaceRoadBridge.js' )
const { RoadBridge } = await import( asModule( resolveImports( bridgeSource, {
	'@/makio/three/stage3d': asModule( 'export default { added: [], add( ...objects ) { this.added.push( ...objects ) } }' ),
	'@/utils/surfaceRoadRoute': routeUrl,
} ) ) )

const numberConstant = name => {
	const match = bridgeSource.match( new RegExp( `const ${name} = ([0-9.]+)` ) )
	assert.ok( match, `${name} should remain a numeric constant` )
	return Number( match[1] )
}
const GIRDER_DEPTH = numberConstant( 'GIRDER_DEPTH' )
const GIRDER_FROM = numberConstant( 'GIRDER_FROM' )
const GIRDER_TO = numberConstant( 'GIRDER_TO' )
const BERM_END = numberConstant( 'BERM_END' )
const BERM_REACH = numberConstant( 'BERM_REACH' )
const HEAD_HEIGHT = numberConstant( 'HEAD_HEIGHT' )
const BEARING_HEIGHT = numberConstant( 'BEARING_HEIGHT' )
const FOOTING_SHOWS = numberConstant( 'FOOTING_SHOWS' )
const FASCIA_DEPTH = numberConstant( 'FASCIA_DEPTH' )
const PIER_MIN_HEIGHT = numberConstant( 'PIER_MIN_HEIGHT' )
const PARAPET_HEIGHT = 0.8

const HALF = 3.7
const surfaceOptions = plan => ( {
	lines: Float32Array.from( plan.points ),
	lineWidth: HALF * 2,
	needsUV: true,
	needsProgress: true,
	surface: { frame: 'fixed-up', bank: plan.bank, uvMode: 'distance', uvScale: 1 },
	join: { type: 'miter', limit: 1.25, inner: 'clip' },
} )

/** The road the demo builds from `controls`, and what is built around it at `level`. */
const build = ( controls, level = 'complex' ) => {
	const { plan, converged } = fitRoadControlsToSurface( controls, points => route.planRoute( points, HALF, true ), candidate => {
		const geometry = new MeshLineSurfaceGeometry( surfaceOptions( candidate ) )
		const clearance = measureRoadSurfaceClearance( candidate.points, geometry, route.terrainHeight, route.ROAD_LIFT )
		geometry.dispose()
		return clearance
	} )
	assert.equal( converged, true, 'the road must fit its terrain' )
	const ribbon = new MeshLineSurfaceGeometry( surfaceOptions( plan ) )
	pinRoadPaintToControls( ribbon, plan.points, plan.anchors )
	const bridge = new RoadBridge( null )
	bridge.setLevel( level )
	bridge.update( ribbon, plan, HALF )
	return { plan, ribbon, bridge }
}

/** Every drawn cross-section of the deck: its edges, how far each stands above the ground, and its vertices. */
const deckColumns = bridge => {
	const position = bridge.deck.geometry.getAttribute( 'position' )
	const perColumn = position.count / bridge.capacity
	const sideVertices = ( perColumn - 2 ) / 2
	const vertex = ( column, index ) => new Vector3().fromBufferAttribute( position, column * perColumn + index )
	return Array.from( { length: bridge.columns }, ( _, column ) => {
		const edges = [0, 1].map( side => new Vector3().fromArray( bridge.edges, column * 6 + side * 3 ) )
		return {
			column,
			edges,
			drops: edges.map( edge => edge.y - route.terrainHeight( edge.x, edge.z ) ),
			// Profile point `point` of `side`: the first vertex of its strip, or the last of the strip before.
			point: ( side, point ) => vertex( column, side * sideVertices + ( point === 0 ? 0 : ( point - 1 ) * 2 + 1 ) ),
			soffit: side => vertex( column, sideVertices * 2 + side ),
			index: ( side, point ) => column * perColumn + ( point === 'soffit' ? sideVertices * 2 + side : side * sideVertices + ( point - 1 ) * 2 + 1 ),
			all: () => Array.from( { length: perColumn }, ( _, index ) => vertex( column, index ) ),
		}
	} )
}

test( 'a road on the ground keeps its deck hidden and stands on an embankment the size of its lift', () => {
	const { ribbon, bridge } = build( route.defaultControls() )
	const columns = deckColumns( bridge )
	assert.ok( columns.length > 40, 'the valley road should be cut into many cross-sections' )

	for ( const { column, edges, drops, all } of columns ) {
		assert.ok( Math.max( ...drops ) < RAISED_FROM, `the valley road leaves the ground at column ${column}` )
		for ( const point of all() ) {
			const reach = Math.min( point.distanceTo( edges[0] ), point.distanceTo( edges[1] ) )
			assert.ok( reach < 0.12, `column ${column} shows ${reach.toFixed( 2 )}m of bridge deck on a road that stands on the ground` )
		}
	}

	const berm = bridge.berm.geometry.getAttribute( 'position' )
	const perColumn = berm.count / bridge.capacity
	for ( let column = 0; column < bridge.columns; column++ ) {
		// Left to right: toe, crest, crest, toe.
		for ( const [toe, crest, side] of [[0, 1, 0], [3, 2, 1]] ) {
			const toePoint = new Vector3().fromBufferAttribute( berm, column * perColumn + toe )
			const crestPoint = new Vector3().fromBufferAttribute( berm, column * perColumn + crest )
			const edge = columns[column].edges[side]
			assert.ok( toePoint.y < route.terrainHeight( toePoint.x, toePoint.z ), `the toe of column ${column} floats over the meadow` )
			assert.ok( edge.y - crestPoint.y > 0.03 && edge.y - crestPoint.y < 0.1, `the crest of column ${column} must tuck under the edge of the road` )
			assert.ok( Math.hypot( toePoint.x - edge.x, toePoint.z - edge.z ) >= 0.29, `the slope of column ${column} must run out from the road` )
		}
	}

	assert.equal( bridge.piers.count, 0, 'a road on the ground needs no pier' )
	ribbon.dispose()
} )

test( 'a raised deck grows a parapet on each kerb and a box girder under its middle', () => {
	const { ribbon, bridge } = build( route.elevatedControls() )
	const columns = deckColumns( bridge )
	const raised = columns.filter( ( { drops } ) => Math.min( ...drops ) > Math.max( RAISED_TO, GIRDER_TO ) )
	const normals = bridge.deck.geometry.getAttribute( 'normal' )
	// The normal of the strip that ends on profile point `point` of `side`, or of the soffit.
	const normal = ( column, point, side ) => new Vector3().fromBufferAttribute( normals, columns[column].index( side, point ) )
	const grounded = columns.filter( ( { drops } ) => Math.max( ...drops ) < Math.min( RAISED_FROM, GIRDER_FROM ) )
	assert.ok( raised.length > 20, 'the overpass should carry a long stretch of bridge' )
	assert.ok( grounded.length > 20, 'the overpass should also run on the ground' )

	for ( const { column, edges, point, soffit, all } of raised ) {
		const across = edges[1].clone().sub( edges[0] ).normalize()
		const before = columns[Math.max( 0, column - 1 )].edges
		const after = columns[Math.min( columns.length - 1, column + 1 )].edges
		const tangent = after[0].clone().add( after[1] ).sub( before[0] ).sub( before[1] )
		const up = across.clone().cross( tangent ).normalize()
		if ( up.y < 0 ) up.negate()
		for ( const side of [0, 1] ) {
			// Parapet: toe, knee, top inner, top outer. Its top stands its full height off the deck, inside the edge.
			const top = point( side, 3 )
			const inward = top.clone().sub( edges[side] ).dot( across ) * ( side === 0 ? 1 : -1 )
			const lift = top.clone().sub( edges[side] ).addScaledVector( across, side === 0 ? -inward : inward ).length()
			assert.ok( Math.abs( lift - PARAPET_HEIGHT ) < 1e-3, `the parapet of column ${column} stands ${lift.toFixed( 3 )}m high` )
			assert.ok( inward > 0 && inward < 0.3, `the parapet of column ${column} must stand on the kerb, inside the edge` )
			assert.ok( top.clone().sub( edges[side] ).dot( up ) > 0, `the parapet of column ${column} hangs under the deck` )
		}
		// Soffit: parallel to the deck, the depth of the girder under it, and narrower than the deck.
		const down = soffit( 0 ).clone().sub( edges[0] )
		const depth = down.clone().addScaledVector( across, -down.dot( across ) ).length()
		assert.ok( Math.abs( depth - GIRDER_DEPTH ) < 1e-3, `the girder of column ${column} is ${depth.toFixed( 3 )}m deep` )
		for ( const side of [0, 1] ) {
			const signedDepth = soffit( side ).clone().sub( edges[side] ).dot( up )
			assert.ok( Math.abs( signedDepth + GIRDER_DEPTH ) < 1e-3, `the girder of column ${column} stands on the deck` )
		}
		assert.ok( soffit( 0 ).distanceTo( soffit( 1 ) ) < edges[0].distanceTo( edges[1] ) * 0.5, `the soffit of column ${column} must be narrower than the deck` )
		for ( const vertex of all() ) {
			assert.ok( vertex.y > route.terrainHeight( vertex.x, vertex.z ), `the deck of column ${column} digs into the ground` )
		}
		// Only the outside of the deck is drawn, so every strip must be wound to face out of the concrete.
		assert.ok( normal( column, 'soffit', 0 ).dot( up ) < -0.9, `the soffit of column ${column} faces into the girder` )
		for ( const side of [0, 1] ) {
			const outward = across.clone().multiplyScalar( side === 0 ? -1 : 1 )
			assert.ok( normal( column, 3, side ).dot( up ) > 0.9, `the top of the parapet of column ${column} faces down` )
			assert.ok( normal( column, 6, side ).dot( outward ) > 0.9, `the edge beam of column ${column} faces the road` )
		}
	}
	for ( const { column, edges, all } of grounded ) {
		for ( const vertex of all() ) {
			assert.ok( Math.min( vertex.distanceTo( edges[0] ), vertex.distanceTo( edges[1] ) ) < 0.12, `column ${column} shows a deck on the ground` )
		}
	}

	const berm = bridge.berm.geometry.getAttribute( 'position' )
	for ( const attribute of [bridge.deck.geometry.getAttribute( 'position' ), bridge.deck.geometry.getAttribute( 'normal' ), berm] ) {
		assert.ok( attribute.array.every( Number.isFinite ), 'the bridge geometry holds a value that is not a number' )
	}
	ribbon.dispose()
} )

test( 'an embankment stops where the deck climbs away, in a slope that runs down to the meadow', () => {
	const { ribbon, bridge } = build( route.elevatedControls() )
	const berm = bridge.berm.geometry.getAttribute( 'position' )
	const point = ( column, vertex ) => new Vector3().fromBufferAttribute( berm, column * 6 + vertex )
	const above = vertex => vertex.y - route.terrainHeight( vertex.x, vertex.z )
	assert.equal( berm.count, bridge.capacity * 6, 'an embankment section is a toe and a crest on each side, and two vertices for the slope it may end in' )

	// Every stretch of columns too high to stand on an embankment, as [first, last].
	const gaps = []
	for ( let column = 0; column < bridge.columns; column++ ) {
		if ( bridge.clearances[column] < BERM_END ) continue
		if ( gaps.at( -1 )?.[1] === column - 1 ) gaps.at( -1 )[1] = column
		else gaps.push( [column, column] )
	}
	const spans = gaps.filter( ( [first, last] ) => first > 0 && last < bridge.columns - 1 && last - first >= 5 )
	assert.ok( spans.length >= 1, 'the overpass should leave its embankment at least once' )

	for ( const [first, last] of spans ) {
		for ( const [open, step] of [[first, 1], [last, -1]] ) {
			// The section the embankment stops on: at the height where the deck reaches BERM_END, its crests under the road.
			const crests = [point( open, 1 ), point( open, 2 )]
			const height = ( above( crests[0] ) + above( crests[1] ) ) * 0.5
			assert.ok( Math.abs( height - BERM_END ) < 0.35, `the embankment stops ${height.toFixed( 2 )}m high at column ${open}` )

			// Its foot: the same toes, and both crests brought down the road to the ground.
			const foot = open + step
			for ( const toe of [0, 3] ) assert.ok( point( foot, toe ).distanceTo( point( open, toe ) ) < 1e-4, `the end slope of column ${open} moves a toe` )
			crests.forEach( ( crest, side ) => {
				const landed = point( foot, 1 + side )
				const reach = Math.hypot( landed.x - crest.x, landed.z - crest.z )
				assert.ok( above( landed ) < 0, `the end slope of column ${open} stops in the air` )
				assert.ok( reach > 0.3 && reach <= BERM_REACH + 1e-3, `the end slope of column ${open} runs ${reach.toFixed( 2 )}m` )
			} )
			for ( let vertex = 0; vertex < 4; vertex++ ) {
				assert.ok( above( point( foot + step, vertex ) ) < -0.5, `the foot of column ${open} is not buried behind it` )
			}
			// The end slope is the one quad from the crests to where they land.
			for ( const column of [open, foot] ) {
				assert.ok( point( column, 4 ).distanceTo( point( column, 1 ) ) < 1e-4 && point( column, 5 ).distanceTo( point( column, 2 ) ) < 1e-4, `the end slope of column ${open} is not hung on its crests` )
			}
		}
		// Nothing stands under the span itself.
		for ( let column = first + 3; column <= last - 3; column++ ) {
			for ( let vertex = 0; vertex < 6; vertex++ ) {
				assert.ok( above( point( column, vertex ) ) < -0.5, `earth stands under the span at column ${column}` )
			}
		}
	}

	// No polygon lies under the road between the crests: away from an end, the end-slope vertices sit on one point.
	const index = bridge.berm.geometry.getIndex()
	const drawn = bridge.berm.geometry.drawRange.count
	const corner = new Vector3()
	let area = 0
	for ( let offset = 0; offset < drawn; offset += 3 ) {
		const [a, b, c] = [0, 1, 2].map( vertex => index.getX( offset + vertex ) )
		if ( Math.min( a % 6, b % 6, c % 6 ) < 4 ) continue
		const [first, second, third] = [a, b, c].map( vertex => new Vector3().fromBufferAttribute( berm, vertex ) )
		area += corner.crossVectors( second.sub( first ), third.sub( first ) ).length() * 0.5
	}
	const slopes = spans.length * 2
	assert.ok( area > slopes * 2 && area < slopes * 40, `${slopes} end slopes should be all there is between the crests, saw ${area.toFixed( 1 )}m²` )
	ribbon.dispose()
} )

test( 'the simple structure hangs a wall under each edge and stands hammerhead piers', () => {
	const { plan, ribbon, bridge } = build( route.elevatedControls(), 'simple' )
	assert.ok( bridge.simpleParts.every( part => part.visible ) && bridge.complexParts.every( part => !part.visible ), 'only the simple structure shows at its level' )

	const position = bridge.fascia.geometry.getAttribute( 'position' )
	assert.equal( position.count, bridge.capacity * 4, 'a wall section is a top and a bottom under each edge' )
	let low = 0
	let high = 0
	for ( let column = 0; column < bridge.columns; column++ ) {
		for ( const side of [0, 1] ) {
			const edge = new Vector3().fromArray( bridge.edges, column * 6 + side * 3 )
			const top = new Vector3().fromBufferAttribute( position, column * 4 + side * 2 )
			const bottom = new Vector3().fromBufferAttribute( position, column * 4 + side * 2 + 1 )
			const ground = route.terrainHeight( edge.x, edge.z )
			assert.ok( top.distanceTo( edge ) < 1e-5, `the wall of column ${column} does not hang from the edge of the road` )
			assert.ok( Math.hypot( bottom.x - top.x, bottom.z - top.z ) < 1e-6 && bottom.y < top.y, `the wall of column ${column} is not plumb` )
			if ( edge.y - ground < 0.8 ) {
				assert.ok( bottom.y < ground, `the wall of a low road must reach into the ground at column ${column}` )
				low++
			} else if ( edge.y - ground > 3.4 ) {
				assert.ok( Math.abs( top.y - bottom.y - FASCIA_DEPTH ) < 1e-3, `the wall of a bridge must stop at its soffit at column ${column}` )
				high++
			}
		}
	}
	assert.ok( low > 20 && high > 20, 'the overpass should show both a road on the ground and a bridge' )
	assert.ok( bridge.fascia.geometry.getAttribute( 'normal' ).array.every( Number.isFinite ) )

	const count = bridge.posts.count
	assert.ok( count >= 4, `the overpass should stand on several piers, saw ${count}` )
	assert.equal( bridge.postCaps.count, count, 'every pier carries its cap' )
	const matrix = new Matrix4()
	const place = new Vector3()
	for ( let pier = 0; pier < count; pier++ ) {
		bridge.posts.getMatrixAt( pier, matrix )
		place.setFromMatrixPosition( matrix )
		assert.ok( place.y < route.terrainHeight( place.x, place.z ), `pier ${pier} starts above the ground` )
	}

	// The same bridge object rebuilds as the whole structure, with fewer and larger piers.
	bridge.setLevel( 'complex' )
	bridge.update( ribbon, plan, HALF )
	assert.ok( bridge.complexParts.every( part => part.visible ) && bridge.simpleParts.every( part => !part.visible ) )
	assert.ok( bridge.piers.count >= 4 && bridge.piers.count < count, `the whole bridge should stand on fewer piers than the simple one, saw ${bridge.piers.count} against ${count}` )
	ribbon.dispose()
} )

test( 'the structure steps through none, simple and complex, and only the whole bridge paints a kerb', async () => {
	const { ribbon, bridge } = build( route.defaultControls(), 'none' )
	const parts = [...bridge.simpleParts, ...bridge.complexParts]
	assert.ok( parts.every( part => part.visible === false ), 'nothing is built around a bare ribbon' )
	assert.equal( bridge.columns, 0, 'nothing is read from the road while nothing is built' )
	ribbon.dispose()

	const [demo, hud, paint, source] = await Promise.all( [
		read( 'demo/src/demos/surfaceRoad.js' ),
		read( 'demo/src/components/SurfaceRoad.vue' ),
		read( 'demo/src/utils/roadPaint.js' ),
		read( 'demo/src/utils/surfaceRoadBridge.js' ),
	] )
	assert.match( source, /export const STRUCTURE_LEVELS = \['none', 'simple', 'complex'\]/ )
	const set = demo.slice( demo.indexOf( '\n\tsetStructure( level ) {' ), demo.indexOf( '\n\tremoveSelectedControl() {' ) )
	assert.match( demo, /this\.setStructure\( STRUCTURE_LEVELS\[\( STRUCTURE_LEVELS\.indexOf\( this\.ui\.structure \) \+ 1 \) % STRUCTURE_LEVELS\.length\] \)/ )
	assert.match( set, /this\.roadUniforms\.structure\.value = level === 'complex' \? 1 : 0/, 'a road without the whole bridge must keep its gravel and earth' )
	assert.match( set, /this\.bridge\.setLevel\( level \)\s+if \( this\.built \) this\.bridge\.update\(/, 'a level is built when it is first shown' )
	assert.match( demo, /structure: 'complex',/ )
	assert.match( paint, /clearance\.smoothstep\( RAISED_FROM, RAISED_TO \)\.mul\( uniforms\.structure \)/ )
	assert.match( hud, /@click="api\.cycleStructure\(\)"\s+>Structure<small>\{\{ structureLabel \}\}<\/small><\/button>/ )
	assert.match( hud, /const STRUCTURE_LABELS = \{ none: 'None', simple: 'Simple', complex: 'Complex' \}/ )
	assert.match( hud, /onShortcut\( 'b', \(\) => this\.api\.cycleStructure\(\) \)/ )
} )

test( 'the deck is cut into the same lengths as the paint on the road', () => {
	const { plan, ribbon, bridge } = build( route.elevatedControls() )
	const paint = pinnedRowDistances( plan.points, plan.anchors )
	const ribbonUV = ribbon.getAttribute( 'uv' )
	assert.ok( Math.abs( paint.at( -1 ) - ribbonUV.getX( ribbon.vertexCount - 1 ) ) < 1e-2, 'the pinned distance of the last row must be the one painted on it' )

	const uv = bridge.deck.geometry.getAttribute( 'uv' )
	const perColumn = uv.count / bridge.capacity
	let previous = -Infinity
	for ( let column = 0; column < bridge.columns; column++ ) {
		const distance = uv.getX( column * perColumn )
		assert.ok( distance >= previous, `the deck runs backwards at column ${column}` )
		for ( let vertex = 1; vertex < perColumn; vertex++ ) {
			assert.equal( uv.getX( column * perColumn + vertex ), distance, `column ${column} is not cut straight across` )
		}
		previous = distance
	}
	assert.equal( uv.getX( 0 ), paint[0] )
	assert.ok( Math.abs( previous - paint.at( -1 ) ) < 1e-3, 'the last cross-section must end on the last painted distance' )
	ribbon.dispose()
} )

test( 'the bridge uploads the buffers it rewrites only when the road changes', () => {
	// three uploads a DynamicDrawUsage attribute on every render, changed or not.
	for ( const level of ['simple', 'complex'] ) {
		const { ribbon, bridge } = build( route.elevatedControls(), level )
		for ( const mesh of level === 'simple' ? [bridge.fascia] : [bridge.deck, bridge.berm] ) {
			const attributes = Object.entries( mesh.geometry.attributes )
			assert.ok( attributes.length > 0, `the ${level} structure should have built its geometry` )
			for ( const [name, attribute] of attributes ) assert.equal( attribute.usage, StreamDrawUsage, `${name} at the ${level} level` )
		}
		for ( const mesh of [...bridge.postParts, ...bridge.pierParts] ) assert.equal( mesh.instanceMatrix.usage, StreamDrawUsage )
		ribbon.dispose()
	}
} )

test( 'pier heads and footings draw with the shaft\'s shader', () => {
	// three picks a pipeline by material and attribute set: a uv the concrete never reads made each part its own.
	const bridge = new RoadBridge( null )
	const layout = mesh => Object.keys( mesh.geometry.attributes ).sort().join()
	for ( const part of [bridge.pierHeads, bridge.pierFootings] ) {
		assert.equal( layout( part ), layout( bridge.piers ) )
		assert.equal( part.material, bridge.piers.material )
	}
} )

test( 'piers stand on footings in the meadow and reach the girder they carry', () => {
	const { plan, ribbon, bridge } = build( route.elevatedControls() )
	const count = bridge.piers.count
	assert.ok( count >= 4, `the overpass should stand on several piers, saw ${count}` )
	for ( const part of bridge.pierParts ) assert.equal( part.count, count, 'every pier needs its shaft, head, bearings and footing' )

	const matrix = new Matrix4()
	const place = new Vector3()
	const scale = new Vector3()
	for ( let pier = 0; pier < count; pier++ ) {
		bridge.pierFootings.getMatrixAt( pier, matrix )
		place.setFromMatrixPosition( matrix )
		assert.ok( Math.abs( place.y - route.terrainHeight( place.x, place.z ) - FOOTING_SHOWS ) < 1e-3, `footing ${pier} is not set in the ground` )
		const footing = place.clone()

		bridge.piers.getMatrixAt( pier, matrix )
		place.setFromMatrixPosition( matrix )
		scale.setFromMatrixScale( matrix )
		assert.ok( Math.hypot( place.x - footing.x, place.z - footing.z ) < 1e-3, `shaft ${pier} does not stand on its footing` )
		assert.ok( place.y < route.terrainHeight( place.x, place.z ), `shaft ${pier} starts above the ground` )

		// The head hangs from the deck along its normal: its top is one girder and one pad below the road.
		bridge.pierHeads.getMatrixAt( pier, matrix )
		const head = new Vector3().setFromMatrixPosition( matrix )
		let nearest = Infinity
		for ( let offset = 0; offset < plan.points.length; offset += 3 ) {
			nearest = Math.min( nearest, head.distanceTo( place.fromArray( plan.points, offset ) ) )
		}
		assert.ok( nearest >= GIRDER_DEPTH + BEARING_HEIGHT - 1e-3 && nearest < GIRDER_DEPTH + BEARING_HEIGHT + 0.5, `head ${pier} hangs ${nearest.toFixed( 2 )}m under the road` )
		const shaftTop = footing.y - FOOTING_SHOWS - numberConstant( 'PIER_FOOTING' ) + scale.y
		// The plumb shaft must enter the lower half of the leaning head in its own frame.
		const tipInHead = new Vector3( footing.x, shaftTop, footing.z ).applyMatrix4( matrix.clone().invert() )
		assert.ok( tipInHead.y > -HEAD_HEIGHT, `shaft ${pier} stops short of its head` )
		assert.ok( tipInHead.y < -HEAD_HEIGHT * 0.5, `shaft ${pier} runs through its head` )
		const headBase = new Vector3( 0, -HEAD_HEIGHT, 0 ).applyMatrix4( matrix )
		assert.ok( headBase.y - route.terrainHeight( footing.x, footing.z ) > PIER_MIN_HEIGHT - 0.5, `pier ${pier} is too short to show a shaft` )
	}
	ribbon.dispose()
} )

test( 'the shader measures the height of the ground with the same waves as the planner', async () => {
	const numbers = source => Array.from( source.matchAll( /\d+\.\d+/g ), match => Number( match[0] ) )
	const routeSource = await read( 'demo/src/utils/surfaceRoadRoute.js' )
	const scenerySource = await read( 'demo/src/utils/surfaceRoadScenery.js' )
	const planner = routeSource.slice( routeSource.indexOf( 'export const terrainHeight = ' ), routeSource.indexOf( 'export const roadHeight' ) )
	const shader = scenerySource.slice( scenerySource.indexOf( 'export const terrainHeightNode = ' ), scenerySource.indexOf( '/** Metres between the fragment' ) )
	assert.deepEqual( numbers( shader ), numbers( planner ) )
	assert.equal( numbers( planner ).length, 7, 'the terrain is three waves: a frequency and a height each, and one skew' )
} )

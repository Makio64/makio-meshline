import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
	AUTOSAVE_ID,
	AUTOSAVE_NAME,
	createRoadSaveStore,
	createSaveId,
	createShareUrl,
	formatRoadFilename,
	listSlots,
	parseLibrary,
	parseRoad,
	readRoadFromLocation,
	ROAD_LIBRARY_KIND,
	ROAD_SAVE_KIND,
	ROAD_SAVE_LIMITS,
	ROAD_SAVE_VERSION,
	serializeLibrary,
	serializeRoad,
	slugifyName,
	stripRoadFromHref,
} from '../demo/src/utils/roadSave.js'

const controls = [
	{ x: -10, y: 1.25, z: 2, bank: 0.125 },
	{ x: 0, y: 4, z: -3.5, bank: -0.4 },
	{ x: 12.5, y: 2.75, z: 8, roll: 0.05 },
]

class MemoryStorage {
	constructor( initial = {} ) {
		this.map = new Map( Object.entries( initial ) )
	}

	getItem( key ) {
		return this.map.has( key ) ? this.map.get( key ) : null
	}

	setItem( key, value ) {
		this.map.set( String( key ), String( value ) )
	}

	removeItem( key ) {
		this.map.delete( key )
	}
}

test( 'road saves round-trip finite XYZ, bank aliases, and clamped width', () => {
	const record = serializeRoad( {
		name: '  Loop  A  ',
		roadWidth: 19,
		controls,
	} )

	assert.equal( record.kind, ROAD_SAVE_KIND )
	assert.equal( record.version, ROAD_SAVE_VERSION )
	assert.equal( record.name, 'Loop A' )
	assert.equal( record.roadWidth, ROAD_SAVE_LIMITS.maxWidth )
	assert.equal( record.controls[2].bank, 0.05 )
	assert.deepEqual( parseRoad( JSON.stringify( record ) ).controls, record.controls )
} )

test( 'road saves reject impossible control counts and non-finite points', () => {
	assert.throws( () => serializeRoad( { controls: controls.slice( 0, 1 ) } ), RangeError )
	assert.throws( () => serializeRoad( { controls: [{ x: 0, y: Infinity, z: 0 }] } ), TypeError )
	assert.throws( () => parseRoad( '{' ), /not valid JSON/ )
	assert.throws( () => parseRoad( { kind: 'other', controls } ), /Unsupported kind/ )
} )

test( 'missing width falls back to the editor default', () => {
	assert.equal( serializeRoad( { controls } ).roadWidth, ROAD_SAVE_LIMITS.defaultWidth )
} )

test( 'named slots replace the same title and keep autosave separate', () => {
	let now = 1_000
	const store = createRoadSaveStore( {
		storage: new MemoryStorage(),
		now: () => now,
	} )

	const first = store.saveNamed( { name: 'Hairpin', roadWidth: 6, controls } )
	now = 2_000
	const second = store.saveNamed( {
		name: 'hairpin',
		roadWidth: 8,
		controls: controls.map( control => ( { ...control, y: control.y + 1 } ) ),
	} )
	now = 3_000
	store.autosave( { roadWidth: 5, controls } )

	assert.equal( first.id, second.id )
	assert.equal( store.list().length, 2 )
	assert.equal( store.list()[0].id, AUTOSAVE_ID )
	assert.equal( store.list()[0].name, AUTOSAVE_NAME )
	assert.equal( store.get( first.id ).roadWidth, 8 )
	assert.equal( store.get( AUTOSAVE_ID ).roadWidth, 5 )
} )

test( 'the library drops the oldest named slot once the cap is reached', () => {
	let now = 0
	const store = createRoadSaveStore( {
		storage: new MemoryStorage(),
		now: () => ++now * 1_000,
		limits: { ...ROAD_SAVE_LIMITS, maxSlots: 2 },
	} )

	store.saveNamed( { name: 'A', controls } )
	store.saveNamed( { name: 'B', controls } )
	store.saveNamed( { name: 'C', controls } )

	assert.deepEqual( store.list().map( slot => slot.name ), ['C', 'B'] )
} )

test( 'corrupt storage and missing ids do not crash the library', () => {
	assert.deepEqual( parseLibrary( 'not-json' ).slots, [] )
	assert.deepEqual( parseLibrary( { kind: ROAD_LIBRARY_KIND, version: ROAD_SAVE_VERSION, slots: [{ controls }] } ).slots, [] )
	assert.equal( parseLibrary( serializeLibrary( { slots: [serializeRoad( { id: 'keep', controls } )] } ) ).slots[0].id, 'keep' )
} )

test( 'share URLs encode the road in the hash and can be stripped later', () => {
	const record = serializeRoad( { name: 'Bridge', roadWidth: 7, controls } )
	const href = 'https://meshline-demo.makio.io/examples/surface-road?noUI=1#keep=1'
	const shared = createShareUrl( href, record )
	const loaded = readRoadFromLocation( shared )

	assert.match( shared, /#road=/ )
	assert.equal( loaded.name, 'Bridge' )
	assert.equal( loaded.roadWidth, 7 )
	assert.equal( loaded.controls.length, 3 )
	assert.equal( readRoadFromLocation( stripRoadFromHref( shared ) ), null )
	assert.equal( new URL( stripRoadFromHref( shared ) ).searchParams.get( 'noUI' ), '1' )
} )

test( 'query-string payloads are accepted as a fallback', () => {
	const record = serializeRoad( { name: 'Query', controls } )
	const url = new URL( 'https://meshline-demo.makio.io/examples/surface-road' )
	url.searchParams.set( 'road', JSON.stringify( record ) )
	assert.equal( readRoadFromLocation( url.toString() ).name, 'Query' )
} )

test( 'storage failures are reported instead of throwing', () => {
	const storage = new MemoryStorage()
	storage.setItem = () => {
		throw new Error( 'quota' )
	}
	const store = createRoadSaveStore( { storage } )
	assert.equal( store.available, false )
	assert.equal( store.saveNamed( { name: 'Nope', controls } ), null )
} )

test( 'filenames and ids stay filesystem-safe', () => {
	assert.equal( slugifyName( 'My Loop!!' ), 'my-loop' )
	assert.match( createSaveId( 'My Loop', () => 99 ), /^my-loop-99$/ )
	assert.match( formatRoadFilename( { name: 'My Loop', savedAt: '2026-08-25T00:00:00.000Z' } ), /^surface-road-my-loop-2026-08-25\.json$/ )
} )

test( 'the Surface Road editor restores, autosaves, and exports the save format', async () => {
	const [demo, route, saves, editor, hud, detect] = await Promise.all( [
		readFile( new URL( '../demo/src/demos/surfaceRoad.js', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/utils/surfaceRoadRoute.js', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/utils/surfaceRoadSaves.js', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/utils/surfaceRoadEditor.js', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/components/SurfaceRoad.vue', import.meta.url ), 'utf8' ),
		readFile( new URL( '../demo/src/makio/utils/detect.js', import.meta.url ), 'utf8' ),
	] )

	assert.match( route, /const MAX_CONTROLS = 24/ )
	assert.match( route, /const MIN_CONTROLS = 2/ )
	assert.equal( ROAD_SAVE_LIMITS.maxControls, 24 )
	assert.equal( ROAD_SAVE_LIMITS.minControls, 2 )
	assert.equal( ROAD_SAVE_LIMITS.defaultWidth, 6 )
	assert.match( demo, /if \( !this\.saves\.restoreSavedRoad\(\) \) this\.updateRoad\(\)/ )
	assert.match( saves, /const fromUrl = readRoadFromLocation\( window\.location\.href \)/ )
	assert.match( saves, /const record = fromUrl \?\? this\.saveStore\.get\( AUTOSAVE_ID \)/ )
	assert.match( demo, /this\.saves\.scheduleAutosave\(\)/ )
	assert.match( saves, /this\.persistAutosave\(\)/ )
	assert.match( hud, /@click="api\.exportRoadFile\(\)">Export</ )
	assert.match( hud, /@click="api\.importRoadFile\(\)">Import</ )
	assert.match( hud, /@click="api\.copyShareLink\(\)">Copy link</ )
	assert.match( editor, /const UI_SELECTOR = '[^']*\.SurfaceRoadSaves/ )
	assert.match( hud, /class="SurfaceRoadSaves"/ )
	assert.match( hud, /<template v-if="!hideSaves">/ )
	assert.match( hud, /hideSaves: noUI/ )
	assert.match( detect, /export const noUI = new URLSearchParams\( window\.location\.search \)\.has\( 'noUI' \)/ )
	assert.match( hud, /\( event\.ctrlKey \|\| event\.metaKey \) && key\.toLowerCase\(\) === 's'/ )
} )

test( 'listed slots keep autosave first then newest named roads', () => {
	const library = parseLibrary( serializeLibrary( {
		slots: [
			serializeRoad( { id: 'old', name: 'Old', savedAt: '2026-01-01T00:00:00.000Z', controls } ),
			serializeRoad( { id: AUTOSAVE_ID, name: AUTOSAVE_NAME, savedAt: '2026-01-02T00:00:00.000Z', controls } ),
			serializeRoad( { id: 'new', name: 'New', savedAt: '2026-01-03T00:00:00.000Z', controls } ),
		],
	} ) )
	assert.deepEqual( listSlots( library ).map( slot => slot.id ), [AUTOSAVE_ID, 'new', 'old'] )
} )

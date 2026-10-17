/**
 * Versioned save format for the Surface Road editor: control XYZ + bank,
 * ribbon width, named slots, and a shareable URL payload.
 */

export const ROAD_SAVE_KIND = 'makio-meshline/surface-road'
export const ROAD_LIBRARY_KIND = 'makio-meshline/surface-road-library'
export const ROAD_SAVE_VERSION = 1
export const ROAD_SAVE_STORAGE_KEY = 'makio-meshline:surface-road:saves'
export const AUTOSAVE_ID = 'autosave'
export const AUTOSAVE_NAME = 'Autosave'
export const ROAD_HASH_PARAM = 'road'

export const ROAD_SAVE_LIMITS = {
	minControls: 2,
	maxControls: 24,
	minWidth: 3,
	maxWidth: 11,
	defaultWidth: 6,
	maxNameLength: 40,
	maxSlots: 12,
	positionDigits: 4,
	bankDigits: 6,
}

const emptyLibrary = () => ( {
	kind: ROAD_LIBRARY_KIND,
	version: ROAD_SAVE_VERSION,
	slots: [],
} )

const roundTo = ( value, digits ) => {
	if ( !Number.isFinite( value ) ) return value
	const factor = 10 ** digits
	return Math.round( value * factor ) / factor
}

const clamp = ( value, minimum, maximum ) => Math.max( minimum, Math.min( maximum, value ) )

const readBank = control => {
	for ( const key of ['bank', 'roll'] ) {
		const value = control?.[key]
		if ( value === undefined ) continue
		if ( !Number.isFinite( value ) ) throw new TypeError( `[roadSave] control.${key} must be finite` )
		return value
	}
	return 0
}

export const namesEqual = ( a, b ) => normalizeName( a ).toLowerCase() === normalizeName( b ).toLowerCase()

export function normalizeName( name, limits = ROAD_SAVE_LIMITS ) {
	const cleaned = String( name ?? '' ).trim().replace( /\s+/g, ' ' )
	if ( !cleaned ) return 'Road'
	return cleaned.slice( 0, limits.maxNameLength )
}

export function slugifyName( name ) {
	return normalizeName( name )
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' ) || 'road'
}

export function createSaveId( name, now = Date.now ) {
	return `${slugifyName( name )}-${now()}`
}

export function formatRoadFilename( record ) {
	const stamp = ( record?.savedAt ? new Date( record.savedAt ) : new Date() )
	const day = Number.isNaN( stamp.getTime() ) ? new Date() : stamp
	const date = day.toISOString().slice( 0, 10 )
	return `surface-road-${slugifyName( record?.name )}-${date}.json`
}

const snapshotControl = ( control, limits ) => {
	if ( !control || typeof control !== 'object' ) {
		throw new TypeError( '[roadSave] Each control must be an object' )
	}
	const x = Number( control.x )
	const y = Number( control.y )
	const z = Number( control.z )
	if ( !Number.isFinite( x ) || !Number.isFinite( y ) || !Number.isFinite( z ) ) {
		throw new TypeError( '[roadSave] Each control needs finite x, y, z' )
	}
	return {
		x: roundTo( x, limits.positionDigits ),
		y: roundTo( y, limits.positionDigits ),
		z: roundTo( z, limits.positionDigits ),
		bank: roundTo( readBank( control ), limits.bankDigits ),
	}
}

const parseJsonObject = ( value, label ) => {
	if ( value && typeof value === 'object' && !Array.isArray( value ) ) return value
	if ( typeof value !== 'string' ) {
		throw new TypeError( `[roadSave] ${label} must be JSON text or an object` )
	}
	try {
		const data = JSON.parse( value )
		if ( !data || typeof data !== 'object' || Array.isArray( data ) ) {
			throw new TypeError( `[roadSave] ${label} must be an object` )
		}
		return data
	} catch ( error ) {
		if ( error instanceof TypeError && String( error.message ).startsWith( '[roadSave]' ) ) throw error
		throw new TypeError( `[roadSave] ${label} is not valid JSON` )
	}
}

export function serializeRoad( input = {}, limits = ROAD_SAVE_LIMITS ) {
	const source = input && typeof input === 'object' ? input : {}
	if ( source.kind != null && source.kind !== ROAD_SAVE_KIND ) {
		throw new TypeError( `[roadSave] Unsupported kind "${source.kind}"` )
	}
	if ( source.version != null && source.version !== ROAD_SAVE_VERSION ) {
		throw new TypeError( `[roadSave] Unsupported version ${source.version}` )
	}

	const controls = Array.isArray( source.controls ) ? source.controls.map( control => snapshotControl( control, limits ) ) : []
	if ( controls.length < limits.minControls || controls.length > limits.maxControls ) {
		throw new RangeError( `[roadSave] A road needs ${limits.minControls}–${limits.maxControls} controls` )
	}

	const width = source.roadWidth == null ? limits.defaultWidth : Number( source.roadWidth )
	if ( !Number.isFinite( width ) ) throw new TypeError( '[roadSave] roadWidth must be finite' )

	const savedAt = typeof source.savedAt === 'string' && source.savedAt ? source.savedAt : undefined
	const id = typeof source.id === 'string' && source.id ? source.id : undefined

	const record = {
		kind: ROAD_SAVE_KIND,
		version: ROAD_SAVE_VERSION,
		name: normalizeName( source.name, limits ),
		roadWidth: roundTo( clamp( width, limits.minWidth, limits.maxWidth ), 3 ),
		controls,
	}
	if ( id ) record.id = id
	if ( savedAt ) record.savedAt = savedAt
	return record
}

export function parseRoad( value, limits = ROAD_SAVE_LIMITS ) {
	return serializeRoad( parseJsonObject( value, 'Road save' ), limits )
}

export function serializeLibrary( library = emptyLibrary() ) {
	const slots = Array.isArray( library?.slots ) ? library.slots.map( slot => serializeRoad( slot ) ) : []
	return JSON.stringify( {
		kind: ROAD_LIBRARY_KIND,
		version: ROAD_SAVE_VERSION,
		slots,
	} )
}

export function parseLibrary( raw ) {
	if ( raw == null || raw === '' ) return emptyLibrary()
	let data
	try {
		data = parseJsonObject( raw, 'Road library' )
	} catch {
		return emptyLibrary()
	}
	if ( data.kind !== ROAD_LIBRARY_KIND || data.version !== ROAD_SAVE_VERSION || !Array.isArray( data.slots ) ) {
		return emptyLibrary()
	}

	const slots = []
	const seen = new Set()
	for ( const entry of data.slots ) {
		try {
			const record = parseRoad( entry )
			if ( !record.id || seen.has( record.id ) ) continue
			seen.add( record.id )
			slots.push( record )
		} catch {
			// Skip a corrupt slot and keep the rest of the library.
		}
	}
	return { kind: ROAD_LIBRARY_KIND, version: ROAD_SAVE_VERSION, slots }
}

export function listSlots( library ) {
	const slots = library?.slots ?? []
	const autosave = slots.find( slot => slot.id === AUTOSAVE_ID )
	const named = slots
		.filter( slot => slot.id !== AUTOSAVE_ID )
		.sort( ( a, b ) => Date.parse( b.savedAt || 0 ) - Date.parse( a.savedAt || 0 ) )
	return autosave ? [autosave, ...named] : named
}

export function createShareUrl( href, record, limits = ROAD_SAVE_LIMITS ) {
	const url = new URL( href )
	url.searchParams.delete( ROAD_HASH_PARAM )
	const payload = parseRoad( record, limits )
	delete payload.savedAt
	url.hash = `${ROAD_HASH_PARAM}=${encodeURIComponent( JSON.stringify( payload ) )}`
	return url.toString()
}

export function readRoadFromLocation( href, limits = ROAD_SAVE_LIMITS ) {
	if ( !href ) return null
	let url
	try {
		url = new URL( href )
	} catch {
		return null
	}

	const hashParams = new URLSearchParams( url.hash.startsWith( '#' ) ? url.hash.slice( 1 ) : url.hash )
	const encoded = hashParams.get( ROAD_HASH_PARAM ) ?? url.searchParams.get( ROAD_HASH_PARAM )
	if ( !encoded ) return null
	try {
		return parseRoad( encoded, limits )
	} catch {
		return null
	}
}

export function stripRoadFromHref( href ) {
	const url = new URL( href )
	url.searchParams.delete( ROAD_HASH_PARAM )
	const hashParams = new URLSearchParams( url.hash.startsWith( '#' ) ? url.hash.slice( 1 ) : url.hash )
	if ( hashParams.has( ROAD_HASH_PARAM ) ) {
		hashParams.delete( ROAD_HASH_PARAM )
		url.hash = hashParams.toString()
	}
	return url.toString()
}

export function createRoadSaveStore( options = {} ) {
	const storage = options.storage ?? globalThis.localStorage
	const key = options.key ?? ROAD_SAVE_STORAGE_KEY
	const now = options.now ?? Date.now
	const limits = options.limits ?? ROAD_SAVE_LIMITS
	let available = !!storage

	const probe = () => {
		if ( !storage ) {
			available = false
			return false
		}
		try {
			const token = `${key}:probe`
			storage.setItem( token, '1' )
			storage.removeItem( token )
			available = true
			return true
		} catch {
			available = false
			return false
		}
	}

	const load = () => {
		if ( !storage ) return emptyLibrary()
		try {
			return parseLibrary( storage.getItem( key ) )
		} catch {
			return emptyLibrary()
		}
	}

	const write = library => {
		if ( !storage ) {
			available = false
			return false
		}
		try {
			storage.setItem( key, serializeLibrary( library ) )
			available = true
			return true
		} catch {
			available = false
			return false
		}
	}

	const get = id => load().slots.find( slot => slot.id === id ) ?? null

	const upsert = ( input, { autosave = false } = {} ) => {
		const library = load()
		const savedAt = new Date( now() ).toISOString()
		let record = serializeRoad( {
			...input,
			savedAt,
			id: autosave ? AUTOSAVE_ID : input.id,
			name: autosave ? AUTOSAVE_NAME : input.name,
		}, limits )

		if ( autosave ) {
			record = { ...record, id: AUTOSAVE_ID, name: AUTOSAVE_NAME, savedAt }
		} else {
			const existing = library.slots.find( slot => slot.id !== AUTOSAVE_ID && namesEqual( slot.name, record.name ) )
			record = {
				...record,
				id: existing?.id ?? record.id ?? createSaveId( record.name, now ),
				savedAt,
			}
		}

		const replacing = library.slots.some( slot => slot.id === record.id )
		let slots = library.slots.filter( slot => slot.id !== record.id )
		if ( !replacing && record.id !== AUTOSAVE_ID ) {
			const named = slots.filter( slot => slot.id !== AUTOSAVE_ID )
			if ( named.length >= limits.maxSlots ) {
				named.sort( ( a, b ) => Date.parse( a.savedAt || 0 ) - Date.parse( b.savedAt || 0 ) )
				const dropId = named[0]?.id
				slots = slots.filter( slot => slot.id !== dropId )
			}
		}
		slots.push( record )
		if ( !write( { ...library, slots } ) ) return null
		return record
	}

	const remove = id => {
		if ( !id ) return false
		const library = load()
		const slots = library.slots.filter( slot => slot.id !== id )
		if ( slots.length === library.slots.length ) return false
		return write( { ...library, slots } )
	}

	probe()

	return {
		get available() {
			return available
		},
		probe,
		load,
		get,
		list: () => listSlots( load() ),
		autosave: record => upsert( record, { autosave: true } ),
		saveNamed: record => upsert( record, { autosave: false } ),
		remove,
	}
}

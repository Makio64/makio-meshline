/**
 * WGSL rewrites that keep every instruction and shorten the native compile, ported from the
 * ultra-msdf-threejs gallery (demo/wgsl-locals.ts, wgsl-functions.ts, gallery-node-builder.ts).
 *
 * - Entry-only privates: three declares every generated variable as a module-scope
 *   `var<private>`. For Metal, Tint routes each one through a member of a per-invocation struct,
 *   which the driver compiler then unpicks. Those only the entry point uses become its locals:
 *   both are per-invocation and zero-initialised.
 * - Stable helper names: three names anonymous TSL helpers `fn0`, `fn1`... in module execution
 *   order, so an unrelated `Fn()` added anywhere renames them in every shader. Numbered by
 *   declaration order inside each shader instead, a recorded pipeline manifest keeps matching.
 * - Stable stage identifiers: `nodeUniform` and `nodeConst` counters run across both stages, so
 *   identical stage programs differ by name. Renumbered by first appearance within each stage.
 */
import { WebGPUBackend } from 'three/webgpu'

//---------------------------------------------------------- ENTRY-ONLY PRIVATES
const FUNCTION_HEADER = /(^|\n)\s*fn\s+(\w+)\s*\(/g
const PRIVATE_DECLARATION = /^var<private>\s+(\w+)\s*:([^;]*);[ \t]*\r?\n?/gm
const IDENTIFIER = /\b[A-Za-z_]\w*/g

function functionSpans( code ) {
	const spans = []
	FUNCTION_HEADER.lastIndex = 0
	let header
	while ( ( header = FUNCTION_HEADER.exec( code ) ) ) {
		const open = code.indexOf( '{', FUNCTION_HEADER.lastIndex )
		if ( open < 0 ) break
		let depth = 0
		let index = open
		for ( ; index < code.length; index++ ) {
			const char = code[index]
			if ( char === '{' ) depth++
			else if ( char === '}' && --depth === 0 ) break
		}
		if ( depth !== 0 ) return []
		spans.push( { name: header[2], start: header.index, open, end: index + 1 } )
		FUNCTION_HEADER.lastIndex = index + 1
	}
	return spans
}

/** Moves the `var<private>` declarations only the entry function uses into it. */
export function localizeEntryPrivates( code, entry = 'main' ) {
	if ( !code.includes( 'var<private>' ) ) return code
	const declarations = [...code.matchAll( PRIVATE_DECLARATION )]
	if ( declarations.length === 0 ) return code
	const spans = functionSpans( code )
	const main = spans.find( span => span.name === entry )
	if ( !main ) return code
	// A helper's use needs the global; a parameter of the same name would clash with the local.
	const excluded = new Set()
	for ( const span of spans ) {
		const limit = span === main ? span.open : span.end
		IDENTIFIER.lastIndex = span.start
		let match
		while ( ( match = IDENTIFIER.exec( code ) ) && match.index < limit ) excluded.add( match[0] )
	}
	const moved = new Map()
	for ( const [, name, type] of declarations ) {
		if ( !excluded.has( name ) ) moved.set( name, type.trim() )
	}
	if ( moved.size === 0 ) return code
	const locals = [...moved].map( ( [name, type] ) => `\tvar ${name} : ${type};\n` ).join( '' )
	// Insert first, at the recorded brace: removing declarations only shortens earlier text.
	const withLocals = `${code.slice( 0, main.open + 1 )}\n${locals}${code.slice( main.open + 1 )}`
	return withLocals.replace( PRIVATE_DECLARATION, ( line, name ) => moved.has( name ) ? '' : line )
}

//---------------------------------------------------------- STABLE HELPER NAMES
// Token kinds. BAD: an unterminated block comment or a non-ASCII token, and the code stays as it is.
const END = 0
const IDENT = 1
const PUNCT = 2
const BAD = 3

// ASCII character classes: 1 whitespace, 2 identifier start, 4 identifier part.
const CLASS = new Uint8Array( 128 )
for ( const c of [9, 10, 11, 12, 13, 32] ) CLASS[c] = 1
for ( let c = 0; c < 128; c++ ) {
	if ( ( c >= 65 && c <= 90 ) || ( c >= 97 && c <= 122 ) || c === 95 ) CLASS[c] = 2 | 4
	else if ( c >= 48 && c <= 57 ) CLASS[c] = 4
}
const UNICODE_SPACE = /\s/

let code = ''
let length = 0
let pos = 0
let start = 0
let end = 0

/** Advances to the next token: comments (nested block ones too) and whitespace are skipped. */
function next() {
	let i = pos
	for ( ;; ) {
		let c = 0
		while ( i < length ) {
			c = code.charCodeAt( i )
			if ( c < 128 ? CLASS[c] !== 1 : !UNICODE_SPACE.test( code[i] ) ) break
			i++
		}
		if ( i >= length ) {
			pos = i
			return END
		}
		if ( c === 47 ) {
			const d = code.charCodeAt( i + 1 )
			if ( d === 47 ) {
				i += 2
				while ( i < length ) {
					const e = code.charCodeAt( i )
					if ( e === 10 || e === 13 ) break
					i++
				}
				continue
			}
			if ( d === 42 ) {
				i += 2
				let depth = 1
				while ( depth > 0 ) {
					const open = code.indexOf( '/*', i )
					const close = code.indexOf( '*/', i )
					if ( close < 0 && open < 0 ) break
					if ( open >= 0 && ( close < 0 || open < close ) ) {
						depth++
						i = open + 2
					} else {
						depth--
						i = close + 2
					}
				}
				if ( depth > 0 ) {
					pos = length
					return BAD
				}
				continue
			}
		}
		start = i
		if ( c < 128 ) {
			if ( ( CLASS[c] & 2 ) !== 0 ) {
				i++
				while ( i < length ) {
					const e = code.charCodeAt( i )
					if ( e >= 128 || ( CLASS[e] & 4 ) === 0 ) break
					i++
				}
				end = pos = i
				return IDENT
			}
			end = pos = i + 1
			return PUNCT
		}
		pos = length
		return BAD
	}
}

/** `fn<digits>` exactly. */
function isFnName( s, e ) {
	if ( e - s < 3 || code.charCodeAt( s ) !== 102 || code.charCodeAt( s + 1 ) !== 110 ) return false
	for ( let i = s + 2; i < e; i++ ) {
		const c = code.charCodeAt( i )
		if ( c < 48 || c > 57 ) return false
	}
	return true
}
const ENTRY = /^(vertex|fragment|compute)$/
const PREFIX = 'stable_fn'

/**
 * Renames module-level `fn<number>` declarations and their calls by declaration order. Entry
 * points, explicit names, members and locals stay; an ambiguous use, a duplicate declaration or a
 * name clash leaves the code as it is.
 */
export function stabilizeFunctionNames( source ) {
	if ( !/\bfn\s+fn\d+\s*\(/.test( source ) ) return source
	code = source
	length = source.length
	pos = 0
	const names = new Map()
	const uses = [] // start, end, renamable (1 or 0), for every fn<number> identifier
	let clashes = null
	let braces = 0
	let entryPoint = false
	let previousDot = false
	try {
		for ( let kind = next(); kind !== END; kind = next() ) {
			if ( kind === BAD ) return source
			const s = start
			const e = end
			const c = code.charCodeAt( s )
			if ( kind === PUNCT ) {
				if ( braces === 0 && c === 64 ) {
					const save = pos
					if ( next() === IDENT && ENTRY.test( code.slice( start, end ) ) ) entryPoint = true
					pos = save
				}
				if ( c === 123 ) braces++
				else if ( c === 125 ) braces--
				if ( braces < 0 ) return source
				if ( braces === 0 && ( c === 59 || c === 125 ) ) entryPoint = false
				previousDot = c === 46
				continue
			}
			if ( c === 102 ) {
				if ( e - s === 2 && code.charCodeAt( s + 1 ) === 110 ) {
					if ( braces === 0 ) {
						// `fn <name> (`: a declaration when <name> is fn<digits>.
						const save = pos
						const k1 = next()
						if ( k1 === BAD ) return source
						if ( k1 === IDENT && isFnName( start, end ) ) {
							const name = code.slice( start, end )
							const k2 = next()
							if ( k2 === BAD ) return source
							if ( k2 === PUNCT && code.charCodeAt( start ) === 40 ) {
								if ( entryPoint || names.has( name ) ) return source
								names.set( name, `${PREFIX}${names.size}` )
							}
						}
						pos = save
					}
				} else if ( isFnName( s, e ) ) {
					// A use, or the declared name itself: renamed only when `(` follows and no `.` precedes.
					const save = pos
					const k = next()
					if ( k === BAD ) return source
					const paren = k === PUNCT && code.charCodeAt( start ) === 40
					pos = save
					uses.push( s, e, !previousDot && paren ? 1 : 0 )
				}
			} else if ( c === 115 && e - s > PREFIX.length && code.startsWith( PREFIX, s ) ) {
				( clashes ??= [] ).push( code.slice( s, e ) )
			}
			previousDot = false
		}
		if ( braces !== 0 || names.size === 0 ) return source
		if ( clashes ) {
			const destinations = new Set( names.values() )
			for ( const text of clashes ) if ( destinations.has( text ) ) return source
		}
		const parts = []
		let previous = 0
		for ( let i = 0; i < uses.length; i += 3 ) {
			const name = names.get( code.slice( uses[i], uses[i + 1] ) )
			if ( name === undefined ) continue
			if ( uses[i + 2] === 0 ) return source
			parts.push( code.slice( previous, uses[i] ), name )
			previous = uses[i + 1]
		}
		parts.push( code.slice( previous ) )
		return parts.join( '' )
	} finally {
		code = ''
	}
}

//---------------------------------------------------------- STABLE STAGE IDENTIFIERS
function renumber( text, pattern, name ) {
	const ids = new Map()
	return text.replace( pattern, ( _, id, ...rest ) => {
		if ( !ids.has( id ) ) ids.set( id, ids.size )
		// A pattern without a suffix group passes the match offset here instead.
		const suffix = typeof rest[0] === 'string' ? rest[0] : ''
		return `${name}${ids.get( id )}${suffix}`
	} )
}

/** Numbers `nodeUniform`, `VERTEX_nodeConst` and the entry's `nodeConst` by first appearance in this stage. */
export function stabilizeStageIdentifiers( source ) {
	let result = source
	if ( result.includes( 'nodeUniform' ) ) result = renumber( result, /\bnodeUniform(\d+)(_sampler|Struct)?\b/g, 'nodeUniform' )
	if ( result.includes( 'VERTEX_nodeConst' ) ) result = renumber( result, /\bVERTEX_nodeConst(\d+)\b/g, 'VERTEX_nodeConst' )
	const main = result.search( /@(?:vertex|fragment|compute)\s+fn\s+main\b/ )
	if ( main >= 0 && result.includes( 'nodeConst', main ) ) result = result.slice( 0, main ) + renumber( result.slice( main ), /\bnodeConst(\d+)\b/g, 'nodeConst' )
	return result
}

//---------------------------------------------------------- BUILDER
// Startup builds about two stages per distinct source: a repeat costs a lookup. Bounded for long visits.
const compacted = new Map()
const COMPACTED_LIMIT = 256

export function compactWGSL( source ) {
	let result = compacted.get( source )
	if ( result === undefined ) {
		result = stabilizeStageIdentifiers( stabilizeFunctionNames( localizeEntryPrivates( source ) ) )
		if ( compacted.size >= COMPACTED_LIMIT ) compacted.clear()
		compacted.set( source, result )
	}
	return result
}

/**
 * Makes every WebGPU backend compact the vertex and fragment stages it builds; compute shaders stay
 * as three writes them. Install before the first material is built. Returns the undo.
 */
export function compactShaders() {
	const prototype = WebGPUBackend.prototype
	const createNodeBuilder = prototype.createNodeBuilder
	prototype.createNodeBuilder = function ( object, renderer ) {
		const builder = createNodeBuilder.call( this, object, renderer )
		const buildCode = builder.buildCode.bind( builder )
		builder.buildCode = () => {
			buildCode()
			if ( builder.vertexShader ) builder.vertexShader = compactWGSL( builder.vertexShader )
			if ( builder.fragmentShader ) builder.fragmentShader = compactWGSL( builder.fragmentShader )
		}
		return builder
	}
	return () => { prototype.createNodeBuilder = createNodeBuilder }
}

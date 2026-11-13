/**
 * Thin helpers on ultra-text (SDF text from browser CSS, three r186 only).
 *
 *   await loadFonts( ['800 1em Inter'] )
 *   const title = await createText( stage.renderer, 'MeshLine', { fontFamily: 'Inter', fontWeight: 800 }, { size: 1.2 } )
 *   stage.scene.add( title )
 *   title.opacity.value = 0.5     // uniforms, safe every frame
 *   title.reveal.value = 0.3      // left-to-right wipe 0..1
 *
 *   const counter = await createCounter( stage.renderer, { template: '000,000', css: { fontFamily: 'Inter', fontWeight: 800 }, size: 2 } )
 *   counter.setValue( 1234 )      // zero-DOM per-instance payload swap, cheap every frame
 *
 * World units: `size` = world units per CSS em (the font-size). A 1-line text
 * is ~1.2 × size tall (line box). Glyphs are flat, unlit, transparent quads
 * (depthWrite false): order them against additive lines with `renderOrder`.
 *
 * Shared atlases: every text and counter of one font face (family, weight, style: what the glyph
 * raster draws) shares ONE SDF atlas holding TEXT_GLYPHS, baked on first use or up front with
 * prepareText() in a loader step. A text with a glyph outside TEXT_GLYPHS gets a private atlas
 * (logged once). `await textIdle()` waits for every capture and bake in flight.
 */
import { smoothstep, uniform, vec4 } from 'three/tsl'
import { Color, DynamicDrawUsage, Group, Mesh } from 'three/webgpu'
import { buildSdfAtlas, collectDomSnapshot, createGlyphGeometry, rasterizeGlyphAtlas, SdfTextMaterial, Text } from 'ultra-text'

export const NUMBER_GLYPHS = '0123456789.,%×+−-→·/ KMBpxms'

/**
 * Glyphs baked into each shared face atlas: printable ASCII plus the typography the prototypes
 * print (dashes, quotes, arrows, math, French accents). No emoji-capable characters (©, ®, ™, ↔):
 * those would need a colour layer.
 */
export const TEXT_GLYPHS = [
	'!"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~',
	'–—‘’“”«»…•·×÷−±°≈≠≤≥→←↑↓∞π²³½€£',
	'àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŒÆ',
].join( '' )

const DEFAULT_CSS_FONT_SIZE = 100
const BAKE_SIZE = 160 // atlas raster size: sharp giant numerals
const BAKE_PADDING = 24 // = SDF px range
const SHARED_ATLAS_MAX = 4096 // a full face (≈150 glyphs at 160 px) needs more than ultra's 2048 default
// ultra options that change the atlas itself: such texts keep a private atlas
const PRIVATE_ATLAS_OPTIONS = ['sharedAtlas', 'bakeSize', 'padding', 'colorGlyphs', 'textBackend', 'maxAtlasSize', 'adaptiveBakeSize', 'atlasMode', 'cpuWorker', 'svg']

/** Google Fonts loaded by base.css: Inter, Inter Tight, JetBrains Mono, Cormorant Garamond. */
export const FONTS = {
	inter: 'Inter',
	interTight: 'Inter Tight',
	mono: 'JetBrains Mono',
	garamond: 'Cormorant Garamond',
}

/**
 * Await webfonts before any capture. `specs` are CSS font shorthands, e.g. '800 1em Inter'.
 * Resolves even if a font fails (falls back to system fonts).
 */
export async function loadFonts( specs = ['800 1em Inter', '400 1em Inter'] ) {
	try {
		await Promise.all( specs.map( ( s ) => document.fonts.load( s ) ) )
	} catch ( e ) {
		console.warn( '[showcase] font load failed', e )
	}
	await document.fonts.ready
}

// GPU (compute) atlas on WebGPU; the CPU worker directly on WebGL2 (skips a fallback warning)
const atlasModeFor = ( renderer ) => renderer.backend?.isWebGPUBackend ? 'auto' : 'cpu'

function cssText( css ) {
	if ( typeof css === 'string' ) return css
	const style = document.createElement( 'div' ).style
	const unitless = new Set( ['font-weight', 'line-height', 'opacity', 'z-index'] )
	for ( const [key, value] of Object.entries( css || {} ) ) {
		if ( value === null || value === undefined ) continue
		const prop = key.startsWith( '--' ) ? key : key.replace( /[A-Z]/g, ( c ) => `-${c.toLowerCase()}` )
		style.setProperty( prop, typeof value === 'number' && !unitless.has( prop ) ? `${value}px` : String( value ) )
	}
	return style.cssText
}

//------------------------------------------------------------------ IN-FLIGHT WORK (textIdle)
const inFlight = new Set()
const track = ( promise ) => {
	inFlight.add( promise )
	const done = () => inFlight.delete( promise )
	promise.then( done, done )
	return promise
}

/** Resolves once every createText / createCounter / atlas bake started so far has settled. */
export async function textIdle() {
	while ( inFlight.size ) await Promise.allSettled( [...inFlight] )
}

//------------------------------------------------------------------ SHARED FACE ATLASES
// Hidden but laid-out source for face probes and atlas bakes (same trick as ultra-text's Text host).
let probeHost = null
let probeSource = null
function probe( css, text ) {
	if ( !probeHost?.isConnected ) {
		probeHost = document.createElement( 'div' )
		probeHost.setAttribute( 'aria-hidden', 'true' )
		probeHost.style.cssText = 'position:fixed;left:0;top:0;display:grid;width:max-content;min-width:1px;min-height:1px;margin:0;padding:0;border:0;clip-path:inset(100%);pointer-events:none;z-index:-1;'
		probeSource = document.createElement( 'div' )
		probeSource.setAttribute( 'data-sdf-block', '' )
		probeHost.append( probeSource )
		document.body.append( probeHost )
	}
	probeSource.style.cssText = cssText( css )
	probeSource.textContent = text
	return probeSource
}

const faces = new Map() // cssText -> { key, canvasFont }

/**
 * The font face of a CSS block as ultra-text keys it: `key` (every computed font property, the
 * glyph request key prefix) and `canvasFont` (what the raster draws: style, small-caps, weight, family).
 */
function faceOf( cssObj ) {
	const id = cssText( cssObj )
	let face = faces.get( id )
	if ( face ) return face
	const snap = collectDomSnapshot( probe( cssObj, 'H' ), { pixelsPerUnit: 1, bakeSize: BAKE_SIZE, padding: BAKE_PADDING } )
	const font = snap.requests[0]?.font
	if ( !font ) throw new Error( 'text: could not resolve the font face' )
	face = { key: font.key, canvasFont: font.canvasFont }
	faces.set( id, face )
	return face
}

const registries = new WeakMap() // renderer -> Map<canvasFont|quality, Promise<entry>>
const warnedPrivate = new Set()

async function bakeFace( renderer, cssObj, face, { glyphs, quality } ) {
	const t0 = performance.now()
	try {
		await document.fonts.load( face.canvasFont, glyphs )
	} catch {
		// unknown family: the system fallback is baked, like the DOM would show it
	}
	await document.fonts.ready
	// glyphs are baked as written (no text-transform): the extra glyphs carry every request
	const bakeCss = typeof cssObj === 'string'
		? `${cssObj};font-size:${DEFAULT_CSS_FONT_SIZE}px;text-transform:none;white-space:pre`
		: { ...cssObj, fontSize: DEFAULT_CSS_FONT_SIZE, textTransform: 'none', whiteSpace: 'pre' }
	const snap = collectDomSnapshot( probe( bakeCss, 'H' ), { pixelsPerUnit: 1, bakeSize: BAKE_SIZE, padding: BAKE_PADDING, extraGlyphs: glyphs } )
	const requests = snap.requests.filter( ( r ) => r.key.startsWith( `${face.key}\u0000` ) )
	const raster = await rasterizeGlyphAtlas( document, requests, { bakeSize: BAKE_SIZE, padding: BAKE_PADDING, maxAtlasSize: SHARED_ATLAS_MAX } )
	const high = quality === 'high'
	const atlas = await buildSdfAtlas( renderer, raster, { mode: atlasModeFor( renderer ), mipmaps: high, anisotropy: high ? 4 : 1 } )
	atlas.texture.name = `showcase text atlas ${face.canvasFont}`
	const ms = performance.now() - t0
	console.info( `[showcase] text atlas ${face.canvasFont}: ${requests.length} glyphs, ${atlas.width}×${atlas.height} in ${ms.toFixed( 0 )} ms` )
	return { atlas, baseKey: face.key, chars: requests.map( ( r ) => r.character ), aliased: new Set( [face.key] ), ms }
}

/**
 * Glyph keys carry every computed font property (variant, kerning, features...), while the raster
 * only uses style, small-caps, weight and family. A face with the same raster (e.g. a counter's
 * tabular-nums variant) reuses the atlas slots under its own keys.
 */
function alias( entry, key ) {
	if ( entry.aliased.has( key ) ) return
	entry.aliased.add( key )
	const glyphs = entry.atlas.glyphs
	for ( const ch of entry.chars ) {
		const slot = glyphs.get( `${entry.baseKey}\u0000${ch}` )
		if ( slot ) glyphs.set( `${key}\u0000${ch}`, slot )
	}
}

/**
 * The shared atlas of the face of `css` (baked on first use, then cached per renderer).
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {object|string} css text CSS (only the font properties matter)
 * @param {{ quality?: 'standard'|'high', glyphs?: string }} [o]
 * @returns {Promise<object>} ultra-text SdfAtlas (pass it as `sharedAtlas`; owned by this module)
 */
export function sharedTextAtlas( renderer, css, { quality = 'standard', glyphs = TEXT_GLYPHS } = {} ) {
	const cssObj = typeof css === 'string' ? css : { fontSize: DEFAULT_CSS_FONT_SIZE, ...css }
	const face = faceOf( cssObj )
	let registry = registries.get( renderer )
	if ( !registry ) {
		registry = new Map()
		registries.set( renderer, registry )
	}
	const id = `${face.canvasFont}|${quality === 'high' ? 'high' : 'standard'}`
	let pending = registry.get( id )
	if ( !pending ) {
		pending = track( bakeFace( renderer, cssObj, face, { glyphs, quality } ) )
		registry.set( id, pending )
		pending.catch( () => registry.delete( id ) )
	}
	return pending.then( ( entry ) => {
		alias( entry, face.key )
		return entry.atlas
	} )
}

/**
 * Bake the shared atlas of every face up front (a loader step). Optional: createText and
 * createCounter bake a face on first use otherwise.
 *
 *   { label: 'type', run: () => prepareText( renderer, [{ fontFamily: 'Inter', fontWeight: 800 }, { fontFamily: 'JetBrains Mono' }] ) }
 *
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {Array<object|string>} cssList one CSS block per face (only the font properties matter)
 * @param {{ quality?: 'standard'|'high', onProgress?: ( f: number ) => void }} [o]
 * @returns {Promise<{ faces: number, ms: number }>}
 */
export async function prepareText( renderer, cssList, { quality = 'standard', onProgress } = {} ) {
	const t0 = performance.now()
	let done = 0
	for ( const css of cssList ) { // one at a time: each bake holds atlas-sized GPU scratch buffers
		await sharedTextAtlas( renderer, css, { quality } )
		onProgress?.( ++done / cssList.length )
	}
	return { faces: cssList.length, ms: +( performance.now() - t0 ).toFixed( 1 ) }
}

/** Dispose every shared atlas of `renderer` (after every text using them is disposed). */
export async function disposeTextAtlases( renderer ) {
	const registry = registries.get( renderer )
	if ( !registry ) return
	registries.delete( renderer )
	for ( const pending of registry.values() ) {
		try {
			( await pending ).atlas.dispose()
		} catch {
			// a failed bake holds nothing
		}
	}
}

const wantsShared = ( opts ) => opts.sharedAtlas !== false && !PRIVATE_ATLAS_OPTIONS.some( ( k ) => opts.ultra?.[k] !== undefined )

async function sharedFor( renderer, cssObj, opts ) {
	if ( !wantsShared( opts ) ) return null
	try {
		return await sharedTextAtlas( renderer, cssObj, { quality: opts.ultra?.quality } )
	} catch ( e ) {
		console.warn( '[showcase] shared text atlas failed, falling back to private atlases', e )
		return null
	}
}

//------------------------------------------------------------------ FILL + ANCHOR
/** TSL fill shared by createText and createCounter: glow (HDR multiplier), opacity, left-to-right reveal. */
function makeFill( opts ) {
	const opacity = uniform( opts.opacity ?? 1 )
	const glow = uniform( opts.glow ?? 1 )
	const reveal = uniform( opts.reveal ?? 1 )
	const revealWidth = uniform( 1 ) // local units, set after capture
	const softness = uniform( opts.revealSoftness ?? 0.15 ) // fraction of width
	const tint = opts.tint !== undefined ? uniform( new Color( opts.tint ) ) : null
	const fill = ( { position, color } ) => {
		const soft = revealWidth.mul( softness )
		const front = reveal.mul( revealWidth.add( soft ) )
		const k = smoothstep( front.sub( soft ), front, position.x ).oneMinus()
		const base = tint ? tint : color
		return vec4( base.mul( glow ), k.mul( opacity ) )
	}
	return { fill, opacity, glow, reveal, revealWidth, tint }
}

function anchorOffset( width, height, align, valign ) {
	const x = align === 'left' ? 0 : align === 'right' ? -width : -width / 2
	const y = valign === 'bottom' ? 0 : valign === 'top' ? -height : -height / 2
	return [x, y]
}

//------------------------------------------------------------------ TEXT
/**
 * Static or occasionally-changing text (titles, labels, final numbers).
 *
 * @param {import('three/webgpu').WebGPURenderer} renderer initialized renderer
 * @param {string} string
 * @param {object|string} [css] CSS for the source element (camelCase keys, numbers = px). fontSize defaults to 100px.
 * @param {object} [opts]
 * @param {number} [opts.size=1] world units per em
 * @param {'center'|'left'|'right'} [opts.align='center']
 * @param {'middle'|'top'|'bottom'} [opts.valign='middle']
 * @param {number} [opts.opacity=1] @param {number} [opts.glow=1] HDR multiplier (>1 feeds bloom) @param {number} [opts.reveal=1]
 * @param {number|string} [opts.tint] override ink colour (else CSS color)
 * @param {number|string} [opts.backdrop] scene colour behind the text (tone), default 0x05060a
 * @param {string} [opts.extraGlyphs] glyphs to bake up front (default NUMBER_GLYPHS)
 * @param {boolean} [opts.sharedAtlas=true] use the face's shared atlas (false: a private one)
 * @param {object} [opts.ultra] extra ultra-text DomSdf options (bakeSize, padding, quality, motion...)
 * @returns {Promise<Group & { text, width, height, opacity, glow, reveal, setText( s ): Promise<void>, dispose() }>}
 */
export function createText( renderer, string, css = {}, opts = {} ) {
	return track( buildText( renderer, string, css, opts ) )
}

async function buildText( renderer, string, css, opts ) {
	const { size = 1, align = 'center', valign = 'middle', backdrop = 0x05060a, extraGlyphs = NUMBER_GLYPHS } = opts
	const cssObj = typeof css === 'string' ? css : { fontSize: DEFAULT_CSS_FONT_SIZE, color: '#ffffff', whiteSpace: 'pre', lineHeight: 1.2, ...css }
	const fontSize = typeof css === 'string' ? DEFAULT_CSS_FONT_SIZE : parseFloat( cssObj.fontSize )
	const pixelsPerUnit = fontSize / size
	const shared = await sharedFor( renderer, cssObj, opts )
	const u = makeFill( opts )
	const text = new Text( string, {
		renderer,
		css: cssObj,
		pixelsPerUnit,
		observe: false,
		castShadow: false,
		motion: { enabled: false, mode: 'none' },
		tone: { backdrop },
		extraGlyphs,
		bakeSize: BAKE_SIZE,
		padding: BAKE_PADDING,
		atlasMode: atlasModeFor( renderer ),
		fill: u.fill,
		...( shared ? { sharedAtlas: shared } : {} ),
		...( opts.ultra || {} ),
	} )
	await text.ready
	if ( shared && text.atlasTexture !== shared.texture ) {
		const missing = [...new Set( string + extraGlyphs )].filter( ( c ) => !/\s/.test( c ) && !TEXT_GLYPHS.includes( c ) ).join( '' )
		const note = missing || 'CSS text-transform output'
		if ( !warnedPrivate.has( note ) ) {
			warnedPrivate.add( note )
			console.info( `[showcase] text "${string.slice( 0, 32 )}" uses a private atlas (glyphs outside TEXT_GLYPHS: ${note})` )
		}
	}
	const group = new Group()
	group.name = `text:${string.slice( 0, 24 )}`
	group.add( text )
	const reanchor = () => {
		const [x, y] = anchorOffset( text.width, text.height, align, valign )
		text.position.set( x, y, 0 )
		u.revealWidth.value = Math.max( 1e-3, text.width )
		group.width = text.width
		group.height = text.height
	}
	reanchor()
	Object.assign( group, {
		text,
		opacity: u.opacity,
		glow: u.glow,
		reveal: u.reveal,
		tint: u.tint,
		/** Re-capture (NOT per frame). Glyphs outside the shared atlas re-bake a private one. */
		async setText( s ) {
			text.text = s
			await track( text.rebuild() )
			reanchor()
		},
		dispose() {
			group.removeFromParent()
			text.dispose() // never disposes the shared atlas
		},
	} )
	return group
}

//------------------------------------------------------------------ COUNTER
const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9]
const BIG_CLIP = 1e6

/**
 * Zero-DOM animated number. Captures the template once per digit (10 snapshots) on the face's
 * shared atlas, then `setValue()` only rewrites per-instance attributes (a few dozen bytes) and
 * re-packs the visible glyphs from their own advances: no gap where hidden leading slots were,
 * none between proportional figures either.
 *
 * Template: every '0' is a digit slot; other characters are fixed ('.', ',', '×', '%', '+', '−', '→', ' px'...).
 * Leading integer digits (and group separators left of them) are hidden while the value is short.
 *
 * @param {import('three/webgpu').WebGPURenderer} renderer
 * @param {object} o
 * @param {string} o.template e.g. '000×', '000,000', '−00.00%', '00.0 px'
 * @param {object} [o.css] CSS (fontFamily, fontWeight, color, letterSpacing...). tabular-nums is forced.
 * @param {number} [o.size=1] world units per em
 * @param {'center'|'left'|'right'} [o.align='center'] anchor of the VISIBLE glyphs' layout box (re-anchored as digits appear)
 * @param {'middle'|'top'|'bottom'} [o.valign='middle']
 * @param {number|string} [o.backdrop=0x05060a]
 * @param {boolean} [o.sharedAtlas=true]
 * @param {number} [o.opacity] @param {number} [o.glow] @param {number} [o.reveal] @param {number|string} [o.tint]
 * @returns {Promise<Group & { mesh, setValue( v, { scramble } ), setDigits( str ), tween( { from, to, duration, ease, scramble } ): Promise<void>, value, opacity, glow, reveal, width, height, dispose() }>}
 */
export function createCounter( renderer, o ) {
	return track( buildCounter( renderer, o ) )
}

async function buildCounter( renderer, o ) {
	const { template, size = 1, align = 'center', valign = 'middle', backdrop = 0x05060a } = o
	const css = { fontSize: DEFAULT_CSS_FONT_SIZE, color: '#ffffff', whiteSpace: 'pre', lineHeight: 1.2, ...( o.css || {} ), fontVariantNumeric: 'tabular-nums' }
	const fontSize = parseFloat( css.fontSize )
	const pixelsPerUnit = fontSize / size
	const shared = await sharedFor( renderer, css, o )

	// hidden but laid-out source (same trick as ultra-text's Text host)
	const host = document.createElement( 'div' )
	host.setAttribute( 'aria-hidden', 'true' )
	host.style.cssText = 'position:fixed;left:0;top:0;display:grid;width:max-content;min-width:1px;min-height:1px;margin:0;padding:0;border:0;clip-path:inset(100%);pointer-events:none;z-index:-1;'
	const source = document.createElement( 'div' )
	source.setAttribute( 'data-sdf-block', '' )
	source.style.cssText = cssText( css )
	host.append( source )
	document.body.append( host )

	const chars = [...template]
	const slots = [] // { char, digit: bool, instance }
	let instance = 0
	for ( const c of chars ) {
		if ( /\s/.test( c ) ) continue
		slots.push( { char: c, digit: c === '0', instance: instance++ } )
	}
	const n = slots.length

	let atlas = null
	let ownsAtlas = false
	try {
		source.textContent = template
		source.getBoundingClientRect()
		await document.fonts.ready
		const snaps = []
		for ( let d = 0; d < 10; d++ ) {
			source.textContent = template.replace( /0/g, String( d ) )
			// bakeSize must match the raster: the snapshot bakes it into each request's canvas font
			snaps.push( collectDomSnapshot( source, { pixelsPerUnit, bakeSize: BAKE_SIZE, padding: BAKE_PADDING } ) )
		}
		const requests = new Map()
		for ( const s of snaps ) for ( const r of s.requests ) requests.set( r.key, r )
		if ( shared && [...requests.keys()].every( ( k ) => shared.glyphs.has( k ) ) ) {
			atlas = shared
		} else {
			if ( shared ) console.info( `[showcase] counter "${template}" uses a private atlas (glyphs outside TEXT_GLYPHS)` )
			const raster = await rasterizeGlyphAtlas( document, [...requests.values()], { bakeSize: BAKE_SIZE, padding: BAKE_PADDING } )
			atlas = await buildSdfAtlas( renderer, raster, { mode: atlasModeFor( renderer ) } )
			ownsAtlas = true
		}

		// per digit d: every instance attribute, plus each slot's pen position and step to the next slot
		const payloads = []
		const origin = []
		const step = []
		let live = null
		let maxSequence = 0
		for ( let d = 0; d < 10; d++ ) {
			const built = createGlyphGeometry( snaps[d], atlas, 0 )
			if ( built.geometry.instanceCount !== n ) {
				throw new Error( `createCounter: template "${template}" gave ${built.geometry.instanceCount} glyphs, expected ${n}` )
			}
			const payload = {}
			for ( const [name, attr] of Object.entries( built.geometry.attributes ) ) {
				if ( attr.isInstancedBufferAttribute ) payload[name] = attr.array.slice()
			}
			payloads.push( payload )
			const drawn = snaps[d].glyphs.filter( ( g ) => atlas.glyphs.has( g.glyphKey ) )
			const o0 = new Float32Array( n )
			const s0 = new Float32Array( n )
			for ( let i = 0; i < n; i++ ) o0[i] = drawn[i].originX
			for ( let i = 0; i < n; i++ ) s0[i] = i < n - 1 ? o0[i + 1] - o0[i] : drawn[i].advance
			origin.push( o0 )
			step.push( s0 )
			if ( d === 0 ) {
				live = built.geometry
				maxSequence = built.maxSequence
			} else {
				built.geometry.dispose()
			}
		}
		const attrs = []
		for ( const [name, attr] of Object.entries( live.attributes ) ) {
			if ( !attr.isInstancedBufferAttribute ) continue
			attr.setUsage( DynamicDrawUsage )
			attrs.push( { attr, itemSize: attr.itemSize, sources: payloads.map( ( p ) => p[name] ) } )
		}
		// packed glyphs may leave the template box: no clipping
		const clip = live.getAttribute( 'sdfClip' )
		if ( clip ) {
			for ( let i = 0; i < n; i++ ) clip.array.set( [-BIG_CLIP, -BIG_CLIP, BIG_CLIP, BIG_CLIP], i * 4 )
			for ( const p of payloads ) p.sdfClip?.set( clip.array )
		}

		const u = makeFill( o )
		const material = new SdfTextMaterial( {
			atlas: atlas.texture,
			atlasWidth: atlas.width,
			atlasHeight: atlas.height,
			pxRange: atlas.pxRange,
			bakeSize: atlas.bakeSize,
			shapeTop: atlas.shapeTop,
			maxSequence,
			motion: false,
			tone: { backdrop },
			fill: u.fill,
		} )
		const mesh = new Mesh( live, material )
		mesh.frustumCulled = false
		mesh.name = `counter:${template}`
		const group = new Group()
		group.add( mesh )
		const width = snaps[0].width
		const height = snaps[0].height
		u.revealWidth.value = Math.max( 1e-3, width )

		// per-slot state: -1 hidden, else the source snapshot (the digit shown; 0 for fixed chars)
		const state = new Int8Array( n ).fill( -2 )
		const rect = live.getAttribute( 'sdfRect' )
		const rectSources = payloads.map( ( p ) => p.sdfRect )
		const writeSlot = ( slot, src ) => {
			const i = slot.instance
			if ( state[i] === src ) return false
			state[i] = src
			const from = src < 0 ? 0 : src
			for ( let a = 0; a < attrs.length; a++ ) {
				const { attr, itemSize, sources } = attrs[a]
				const arr = attr.array
				const s = sources[from]
				const off = i * itemSize
				for ( let k = 0; k < itemSize; k++ ) arr[off + k] = s[off + k]
				attr.needsUpdate = true
			}
			if ( src < 0 ) { // degenerate quad: no fragments
				const off = i * 4
				rect.array[off + 2] = rect.array[off]
				rect.array[off + 3] = rect.array[off + 1]
			}
			return true
		}
		// lay the visible glyphs out from x = 0 with their own advances, then anchor the layout box
		const pack = () => {
			let pen = 0
			const r = rect.array
			for ( let i = 0; i < n; i++ ) {
				const src = state[i]
				if ( src < 0 ) continue
				const dx = pen - origin[src][i]
				const s = rectSources[src]
				const off = i * 4
				r[off] = s[off] + dx
				r[off + 2] = s[off + 2] + dx
				pen += step[src][i]
			}
			rect.needsUpdate = true
			const [x, y] = anchorOffset( pen, height, align, valign )
			mesh.position.set( x, y, 0 )
			group.width = pen
			group.visibleMinX = 0
		}

		const digitSlots = slots.filter( ( s ) => s.digit )
		const dotIndex = chars.filter( ( c ) => !/\s/.test( c ) ).indexOf( '.' )
		const intSlots = digitSlots.filter( ( s ) => dotIndex < 0 || s.instance < dotIndex )
		const fracSlots = digitSlots.filter( ( s ) => dotIndex >= 0 && s.instance > dotIndex )
		const fixedSlots = slots.filter( ( s ) => !s.digit )
		const nInt = intSlots.length
		const nFrac = Math.min( fracSlots.length, POW10.length - 1 )
		const firstIntInstance = intSlots[0]?.instance ?? 0
		const lastIntInstance = intSlots[nInt - 1]?.instance ?? -1
		let lastScramble = 0

		const counter = Object.assign( group, {
			mesh,
			atlas,
			templateWidth: width,
			width,
			height,
			value: 0,
			opacity: u.opacity,
			glow: u.glow,
			reveal: u.reveal,
			tint: u.tint,
			/**
			 * Show a number in the template. `scramble` 0..1 = chance each visible digit shows a random digit.
			 * Cheap every frame: returns at once when nothing changed, allocates nothing.
			 */
			setValue( v, { scramble = 0 } = {} ) {
				if ( v === counter.value && scramble === 0 && lastScramble === 0 && state[0] !== -2 ) return counter
				counter.value = v
				lastScramble = scramble
				const scaled = Math.round( Math.abs( v ) * POW10[nFrac] )
				let intVal = Math.floor( scaled / POW10[nFrac] )
				let fracVal = scaled - intVal * POW10[nFrac]
				let digits = 1
				for ( let t = intVal; t >= 10; t = Math.floor( t / 10 ) ) digits++
				const firstShown = nInt - Math.min( digits, nInt ) // index into intSlots
				let changed = false
				for ( let i = nInt - 1; i >= 0; i-- ) {
					const digit = intVal % 10
					intVal = Math.floor( intVal / 10 )
					const shown = i >= firstShown
					const d = shown && scramble > 0 && Math.random() < scramble ? ( Math.random() * 10 ) | 0 : digit
					changed = writeSlot( intSlots[i], shown ? d : -1 ) || changed
				}
				for ( let i = fracSlots.length - 1; i >= 0; i-- ) {
					const digit = i < nFrac ? fracVal % 10 : 0
					if ( i < nFrac ) fracVal = Math.floor( fracVal / 10 )
					const d = scramble > 0 && Math.random() < scramble ? ( Math.random() * 10 ) | 0 : digit
					changed = writeSlot( fracSlots[i], d ) || changed
				}
				// fixed chars: separators between integer slots hide until a digit left of them shows
				const firstShownInstance = intSlots[firstShown]?.instance ?? ( fracSlots[0]?.instance ?? 0 )
				for ( let i = 0; i < fixedSlots.length; i++ ) {
					const s = fixedSlots[i]
					const isSeparator = s.instance > firstIntInstance && s.instance < lastIntInstance
					changed = writeSlot( s, isSeparator && s.instance < firstShownInstance ? -1 : 0 ) || changed
				}
				if ( changed ) pack()
				return counter
			},
			/** Raw slot control: `str` has one char per non-space template char; digits show, ' ' hides, others show the template char. */
			setDigits( str ) {
				let changed = false
				const list = [...str]
				for ( let i = 0; i < n; i++ ) {
					const s = slots[i]
					const c = list[i] ?? ' '
					if ( c === ' ' ) changed = writeSlot( s, -1 ) || changed
					else if ( s.digit && c >= '0' && c <= '9' ) changed = writeSlot( s, c.charCodeAt( 0 ) - 48 ) || changed
					else changed = writeSlot( s, 0 ) || changed
				}
				if ( changed ) pack()
				return counter
			},
			/** Time-based count (rAF). Scroll-driven pages should call setValue() themselves instead. */
			tween( { from = counter.value, to, duration = 1.2, ease = ( t ) => 1 - Math.pow( 1 - t, 3 ), scramble = 0.35 } ) {
				return new Promise( ( resolve ) => {
					const start = performance.now()
					const tick = () => {
						const t = Math.min( 1, ( performance.now() - start ) / ( duration * 1000 ) )
						const v = from + ( to - from ) * ease( t )
						counter.setValue( t < 1 ? v : to, { scramble: t < 1 ? scramble * ( 1 - t ) : 0 } )
						if ( t < 1 ) requestAnimationFrame( tick )
						else resolve()
					}
					tick()
				} )
			},
			dispose() {
				group.removeFromParent()
				live.dispose()
				material.dispose()
				if ( ownsAtlas ) atlas.dispose()
			},
		} )
		counter.setValue( o.value ?? 0 )
		return group
	} catch ( e ) {
		if ( ownsAtlas ) atlas?.dispose()
		throw e
	} finally {
		host.remove()
	}
}

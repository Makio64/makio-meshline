/**
 * Glyph geometry for plan B: every numeral is drawn from MeshLines, so we need
 * the glyph as data. A 2D canvas rasterizes the text with the same font,
 * letter spacing and line box as the ultra-text capture, then:
 *
 * - `isoLoops()`   marching squares on the coverage or the signed distance
 * - `spans()`      filled x-intervals on a horizontal scanline (hatching)
 * - `resample()`   equal arc-length resampling of a closed loop
 *
 * World mapping matches createText( ..., { size } ) centred on its line box,
 * so an ultra-text face and a MeshLine outline of the same string overlap.
 */

export const FAMILY = 'Inter Tight'

/**
 * @param {string} text
 * @param {object} [o]
 * @param {number} [o.size=1] world units per em (same as createText size)
 * @param {number} [o.fontPx=360] raster font size
 * @param {number} [o.weight=800]
 * @param {string} [o.family]
 * @param {number} [o.letterSpacing=-0.04] em
 * @param {number} [o.pad=48] px around the ink box
 */
export function layoutText( text, { size = 1, fontPx = 360, weight = 800, family = FAMILY, letterSpacing = -0.04, pad = 48 } = {} ) {
	const font = `${weight} ${fontPx}px "${family}"`
	const canvas = document.createElement( 'canvas' )
	const ctx = canvas.getContext( '2d', { willReadFrequently: true } )
	const setup = () => {
		ctx.font = font
		ctx.letterSpacing = `${letterSpacing * fontPx}px`
		ctx.textBaseline = 'alphabetic'
		ctx.textAlign = 'left'
	}
	setup()
	const m = ctx.measureText( text )
	const advance = m.width
	const asc = m.fontBoundingBoxAscent
	const desc = m.fontBoundingBoxDescent
	const w = Math.ceil( m.actualBoundingBoxLeft + m.actualBoundingBoxRight + pad * 2 )
	const h = Math.ceil( m.actualBoundingBoxAscent + m.actualBoundingBoxDescent + pad * 2 )
	canvas.width = w
	canvas.height = h
	setup()
	const ox = pad + m.actualBoundingBoxLeft
	const by = pad + m.actualBoundingBoxAscent
	ctx.fillStyle = '#fff'
	ctx.fillText( text, ox, by )
	const rgba = ctx.getImageData( 0, 0, w, h ).data
	const mask = new Float32Array( w * h )
	for ( let i = 0; i < w * h; i++ ) mask[i] = rgba[i * 4 + 3] / 255

	// DOM line box (line-height 1.2) centre in canvas px: createText anchors there
	const lineH = 1.2 * fontPx
	const halfLeading = ( lineH - ( asc + desc ) ) / 2
	const cx = ox + advance / 2
	const cy = by - asc - halfLeading + lineH / 2
	const k = size / fontPx

	const layout = {
		text,
		w,
		h,
		mask,
		k,
		cx,
		cy,
		size,
		/** canvas px -> world x */
		wx: ( px ) => ( px - cx ) * k,
		/** canvas px -> world y */
		wy: ( py ) => ( cy - py ) * k,
		/** world -> canvas px */
		px: ( x ) => x / k + cx,
		py: ( y ) => cy - y / k,
		/** ink box in world units */
		ink: {
			left: ( pad - cx ) * k,
			right: ( w - pad - cx ) * k,
			top: ( cy - pad ) * k,
			bottom: ( cy - ( h - pad ) ) * k,
		},
		/** bilinear coverage at canvas px */
		sample( x, y ) {
			if ( x < 0 || y < 0 || x > w - 1 || y > h - 1 ) return 0
			const x0 = Math.floor( x )
			const y0 = Math.floor( y )
			const x1 = Math.min( w - 1, x0 + 1 )
			const y1 = Math.min( h - 1, y0 + 1 )
			const fx = x - x0
			const fy = y - y0
			const a = mask[y0 * w + x0] * ( 1 - fx ) + mask[y0 * w + x1] * fx
			const b = mask[y1 * w + x0] * ( 1 - fx ) + mask[y1 * w + x1] * fx
			return a * ( 1 - fy ) + b * fy
		},
		/** world-space coverage */
		inside( x, y ) {
			return layout.sample( layout.px( x ), layout.py( y ) ) > 0.5
		},
	}
	return layout
}

//------------------------------------------------------------------ SIGNED DISTANCE (Felzenszwalb EDT)
function edt1d( f, n, d, v, z ) {
	let k = 0
	v[0] = 0
	z[0] = -1e20
	z[1] = 1e20
	for ( let q = 1; q < n; q++ ) {
		let s = ( ( f[q] + q * q ) - ( f[v[k]] + v[k] * v[k] ) ) / ( 2 * q - 2 * v[k] )
		while ( s <= z[k] ) {
			k--
			s = ( ( f[q] + q * q ) - ( f[v[k]] + v[k] * v[k] ) ) / ( 2 * q - 2 * v[k] )
		}
		k++
		v[k] = q
		z[k] = s
		z[k + 1] = 1e20
	}
	k = 0
	for ( let q = 0; q < n; q++ ) {
		while ( z[k + 1] < q ) k++
		d[q] = ( q - v[k] ) * ( q - v[k] ) + f[v[k]]
	}
}

function edt2d( grid, w, h ) {
	const n = Math.max( w, h )
	const f = new Float64Array( n )
	const d = new Float64Array( n )
	const v = new Int32Array( n )
	const z = new Float64Array( n + 1 )
	for ( let x = 0; x < w; x++ ) {
		for ( let y = 0; y < h; y++ ) f[y] = grid[y * w + x]
		edt1d( f, h, d, v, z )
		for ( let y = 0; y < h; y++ ) grid[y * w + x] = d[y]
	}
	for ( let y = 0; y < h; y++ ) {
		for ( let x = 0; x < w; x++ ) f[x] = grid[y * w + x]
		edt1d( f, w, d, v, z )
		for ( let x = 0; x < w; x++ ) grid[y * w + x] = Math.sqrt( d[x] )
	}
}

/** Signed distance in px: negative inside, positive outside (edge pixels corrected by coverage). */
export function signedDistance( layout ) {
	const { w, h, mask } = layout
	const INF = 1e20
	const toInside = new Float64Array( w * h )
	const toOutside = new Float64Array( w * h )
	for ( let i = 0; i < w * h; i++ ) {
		const inside = mask[i] >= 0.5
		toInside[i] = inside ? 0 : INF
		toOutside[i] = inside ? INF : 0
	}
	edt2d( toInside, w, h )
	edt2d( toOutside, w, h )
	const sd = new Float32Array( w * h )
	for ( let i = 0; i < w * h; i++ ) {
		sd[i] = toInside[i] - toOutside[i] + ( 0.5 - mask[i] ) * 0.9
	}
	return sd
}

//------------------------------------------------------------------ MARCHING SQUARES
// case -> edge pairs; edges: 0 top, 1 right, 2 bottom, 3 left. Saddles (5, 10) resolved by centre.
const CASES = [
	[], [3, 2], [2, 1], [3, 1], [0, 1], null, [0, 2], [0, 3],
	[0, 3], [0, 2], null, [0, 1], [3, 1], [2, 1], [3, 2], [],
]

/**
 * Closed iso loops of `field` at `level` (inside = value < level). Returns arrays of
 * canvas-px points [x0, y0, x1, y1, ...] (Float32Array), largest first.
 */
// scratch reused by every isoLoops() call (p1 traces 64 isolines of one glyph: fresh arrays per call
// were ~6 MB of garbage each, ~400 MB per build, and the GC paid for it after the loader)
const iso = { size: 0, nb: null, px: null, py: null, visited: null }
export function isoLoops( field, w, h, level = 0 ) {
	const ids = w * h * 2
	if ( iso.size < ids ) {
		iso.size = ids
		iso.nb = new Int32Array( ids * 2 )
		iso.px = new Float32Array( ids )
		iso.py = new Float32Array( ids )
		iso.visited = new Uint8Array( ids )
	}
	const nb = iso.nb.fill( -1, 0, ids * 2 )
	const px = iso.px
	const py = iso.py
	const val = ( x, y ) => field[y * w + x] - level
	const edgeId = ( x, y, e ) => {
		if ( e === 0 ) return ( y * w + x ) * 2
		if ( e === 2 ) return ( ( y + 1 ) * w + x ) * 2
		if ( e === 3 ) return ( y * w + x ) * 2 + 1
		return ( y * w + x + 1 ) * 2 + 1
	}
	const setPoint = ( id, x, y, e, a, b, c, d ) => {
		// a tl, b tr, c br, d bl
		if ( e === 0 ) { px[id] = x + a / ( a - b ); py[id] = y }
		else if ( e === 1 ) { px[id] = x + 1; py[id] = y + b / ( b - c ) }
		else if ( e === 2 ) { px[id] = x + d / ( d - c ); py[id] = y + 1 }
		else { px[id] = x; py[id] = y + a / ( a - d ) }
	}
	const link = ( p, q ) => {
		if ( nb[p * 2] === -1 ) nb[p * 2] = q
		else nb[p * 2 + 1] = q
		if ( nb[q * 2] === -1 ) nb[q * 2] = p
		else nb[q * 2 + 1] = p
	}
	const seg = ( x, y, e0, e1, a, b, c, d ) => {
		const p = edgeId( x, y, e0 )
		const q = edgeId( x, y, e1 )
		setPoint( p, x, y, e0, a, b, c, d )
		setPoint( q, x, y, e1, a, b, c, d )
		link( p, q )
	}
	for ( let y = 0; y < h - 1; y++ ) {
		for ( let x = 0; x < w - 1; x++ ) {
			const a = val( x, y )
			const b = val( x + 1, y )
			const c = val( x + 1, y + 1 )
			const d = val( x, y + 1 )
			const index = ( a < 0 ? 8 : 0 ) | ( b < 0 ? 4 : 0 ) | ( c < 0 ? 2 : 0 ) | ( d < 0 ? 1 : 0 )
			if ( index === 0 || index === 15 ) continue
			const pair = CASES[index]
			if ( pair ) {
				seg( x, y, pair[0], pair[1], a, b, c, d )
				continue
			}
			const centreInside = ( a + b + c + d ) / 4 < 0
			if ( index === 5 ) { // tr + bl inside
				if ( centreInside ) { seg( x, y, 0, 3, a, b, c, d ); seg( x, y, 2, 1, a, b, c, d ) }
				else { seg( x, y, 0, 1, a, b, c, d ); seg( x, y, 3, 2, a, b, c, d ) }
			} else { // 10: tl + br inside
				if ( centreInside ) { seg( x, y, 0, 1, a, b, c, d ); seg( x, y, 3, 2, a, b, c, d ) }
				else { seg( x, y, 0, 3, a, b, c, d ); seg( x, y, 2, 1, a, b, c, d ) }
			}
		}
	}
	const visited = iso.visited.fill( 0, 0, ids )
	const loops = []
	for ( let start = 0; start < ids; start++ ) {
		if ( visited[start] || nb[start * 2] === -1 ) continue
		const pts = []
		let prev = -1
		let cur = start
		while ( cur !== -1 && !visited[cur] ) {
			visited[cur] = 1
			pts.push( px[cur], py[cur] )
			const n0 = nb[cur * 2]
			const n1 = nb[cur * 2 + 1]
			const next = n0 !== prev && !visited[n0] ? n0 : ( n1 !== -1 && n1 !== prev && !visited[n1] ? n1 : -1 )
			prev = cur
			cur = next
		}
		if ( pts.length >= 8 ) loops.push( new Float32Array( pts ) )
	}
	loops.sort( ( p, q ) => loopLength( q ) - loopLength( p ) )
	return loops
}

export function loopLength( loop, closed = true ) {
	let len = 0
	const n = loop.length / 2
	for ( let i = 0; i < n - ( closed ? 0 : 1 ); i++ ) {
		const j = ( i + 1 ) % n
		len += Math.hypot( loop[j * 2] - loop[i * 2], loop[j * 2 + 1] - loop[i * 2 + 1] )
	}
	return len
}

/** Signed area (canvas px, y down): > 0 clockwise on screen. */
export function loopArea( loop ) {
	let a = 0
	const n = loop.length / 2
	for ( let i = 0; i < n; i++ ) {
		const j = ( i + 1 ) % n
		a += loop[i * 2] * loop[j * 2 + 1] - loop[j * 2] * loop[i * 2 + 1]
	}
	return a / 2
}

/** Resample a closed 2D loop to `n` points of equal arc length (no duplicated seam point). */
export function resample( loop, n ) {
	const m = loop.length / 2
	const cum = new Float64Array( m + 1 )
	for ( let i = 0; i < m; i++ ) {
		const j = ( i + 1 ) % m
		cum[i + 1] = cum[i] + Math.hypot( loop[j * 2] - loop[i * 2], loop[j * 2 + 1] - loop[i * 2 + 1] )
	}
	const total = cum[m]
	const out = new Float32Array( n * 2 )
	let s = 0
	for ( let k = 0; k < n; k++ ) {
		const target = ( k / n ) * total
		while ( s < m - 1 && cum[s + 1] < target ) s++
		const seg = cum[s + 1] - cum[s] || 1
		const t = ( target - cum[s] ) / seg
		const j = ( s + 1 ) % m
		out[k * 2] = loop[s * 2] + ( loop[j * 2] - loop[s * 2] ) * t
		out[k * 2 + 1] = loop[s * 2 + 1] + ( loop[j * 2 + 1] - loop[s * 2 + 1] ) * t
	}
	return out
}

/** Light Laplacian smoothing of a closed loop (removes pixel stair-steps). */
export function smoothLoop( loop, passes = 2 ) {
	let a = loop
	const n = a.length / 2
	for ( let p = 0; p < passes; p++ ) {
		const b = new Float32Array( a.length )
		for ( let i = 0; i < n; i++ ) {
			const i0 = ( i - 1 + n ) % n
			const i1 = ( i + 1 ) % n
			b[i * 2] = ( a[i0 * 2] + a[i * 2] * 2 + a[i1 * 2] ) / 4
			b[i * 2 + 1] = ( a[i0 * 2 + 1] + a[i * 2 + 1] * 2 + a[i1 * 2 + 1] ) / 4
		}
		a = b
	}
	return a
}

/**
 * Filled x-intervals of the glyph on canvas row `y` (px, fractional), sub-pixel ends.
 * @returns {Array<[number, number]>} canvas px
 */
export function spans( layout, y ) {
	const { w } = layout
	const out = []
	let inside = false
	let start = 0
	let prev = layout.sample( 0, y ) - 0.5
	for ( let x = 1; x < w; x++ ) {
		const v = layout.sample( x, y ) - 0.5
		if ( !inside && prev < 0 && v >= 0 ) {
			inside = true
			start = x - 1 + prev / ( prev - v )
		} else if ( inside && prev >= 0 && v < 0 ) {
			inside = false
			out.push( [start, x - 1 + prev / ( prev - v )] )
		}
		prev = v
	}
	return out
}

/** Map a canvas-px loop to world xy (Float32Array xyz with z = 0). */
export function loopToWorld( layout, loop, z = 0 ) {
	const n = loop.length / 2
	const out = new Float32Array( n * 3 )
	for ( let i = 0; i < n; i++ ) {
		out[i * 3] = layout.wx( loop[i * 2] )
		out[i * 3 + 1] = layout.wy( loop[i * 2 + 1] )
		out[i * 3 + 2] = z
	}
	return out
}

/** Small deterministic PRNG. */
export function mulberry32( seed ) {
	let a = seed >>> 0
	return () => {
		a = ( a + 0x6d2b79f5 ) >>> 0
		let t = a
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 )
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 )
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296
	}
}

/**
 * Ricefield village: generative farmsteads around the paddies, drawn only with MeshLine.
 *
 * Roofs, walls, shoji, tiles and the raised plots are world-space `.surface()` ribbons, batched
 * into one MeshLine per material. A thatched hip roof is a stack of closed loops banked to the
 * roof pitch, each course lapping the one below. A wall is a loop banked upright, and a gable is
 * a level path whose width tapers to a diamond: its lower half stays hidden inside the roof.
 * Posts, beams, ridges and drying racks are billboard lines, and the hearth smoke is a billboard
 * line that `.positionFn()` bends downwind.
 */
import { MeshLine } from 'makio-meshline'
import { abs, color, float, Fn, fract, fwidth, max, mix, positionWorld, pow, sin, smoothstep, texture, time, uv, vec2, vec3 } from 'three/tsl'
import { Color, DirectionalLight, DoubleSide, Group, HemisphereLight } from 'three/webgpu'

import random, { pickInArray, randomInt } from '@/makio/utils/random'
import { linePoints } from '@/utils/points'
import { SUN_DIRECTION, WIND_DIRECTION } from '@/utils/ricefieldScenery'
import { FIELD_WIDTH } from '@/utils/ricefieldShading'

// Farmsteads are built in meters, then scaled into the scene.
const M = 1.6
const FIELD_HALF = FIELD_WIDTH / 2
const FARMSTEADS = 7
const PLOT_HEIGHT = 0.3 // meters of earth above the flooded plain
const BAY = 1.82 // one ken: the post spacing of a traditional house
// A thatch course is 0.9 m down the slope and the next one starts 0.6 m higher, so each
// course laps a third of the one below it.
const COURSE = 0.9
const COURSE_STEP = 0.6
const SMOKE_RISE = 18
const SMOKE_DRIFT = 14

const TIMBER = 0x2B2019
const RIDGE = 0x3A3125
const TILE_EDGE = 0x31363C
const ONIGAWARA = 0x4C525A
const LOG = 0x6E4D30
const SHEAVES = [0xA88232, 0xB8913E, 0xC9A250, 0xD2B060]

const rect = ( hx, hz ) => [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]

/** World-space ribbons that share one material, built as a single MeshLine. */
class Surfaces {
	lines = []
	closed = []
	widths = []
	banks = []
	tapers = []

	add( points, { width, bank = 0, closed = false, taper = false } ) {
		this.lines.push( points )
		this.closed.push( closed )
		this.widths.push( width * M )
		this.banks.push( bank )
		this.tapers.push( taper )
	}

	build( { color, emissive, roughness = 0.95, metalness = 0 } ) {
		const { widths, banks, tapers } = this
		const line = new MeshLine()
			.lines( this.lines, this.closed )
			.lineWidth( 1 )
			// A tapered line narrows linearly from its middle to both ends: a diamond.
			.widthCallback( ( progress, point, index ) => widths[index] * ( tapers[index] ? Math.max( 0.001, 1 - Math.abs( progress * 2 - 1 ) ) : 1 ) )
			.needsUV( true )
			.surface( { frame: 'fixed-up', bank: ( progress, point, index ) => banks[index], roughness, metalness, side: DoubleSide } )
			// The top courses of a hip roof are short loops: clip their inner corners.
			.join( { type: 'miter', inner: 'clip' } )
			.build()
		line.material.colorNode = color
		if ( emissive ) line.material.emissiveNode = emissive
		return line
	}
}

/** Billboard strokes of any width and color, built as a single MeshLine. */
class Strokes {
	lines = []
	widths = []
	colors = []

	add( points, width, hex ) {
		const { r, g, b } = new Color( hex )
		this.lines.push( points.flat() )
		this.widths.push( width * M )
		for ( let i = 0; i < points.length; i++ ) this.colors.push( r, g, b )
	}

	build() {
		const { widths } = this
		return new MeshLine()
			.lines( this.lines )
			.lineWidth( 1 )
			.widthCallback( ( progress, point, index ) => widths[index] )
			.vertexColors( new Float32Array( this.colors ) )
			.autoResize()
	}
}

/** A local frame in meters: +x runs along the facade, +z faces the paddies, y is up. */
class Site {
	constructor( village, x, z, yaw, y ) {
		Object.assign( this, { village, x, z, yaw, y, cos: Math.cos( yaw ), sin: Math.sin( yaw ) } )
	}

	at( px, py, pz ) {
		return [this.x + ( px * this.cos - pz * this.sin ) * M, this.y + py * M, this.z + ( px * this.sin + pz * this.cos ) * M]
	}

	child( px, pz, yaw ) {
		const [x, , z] = this.at( px, 0, pz )
		return new Site( this.village, x, z, this.yaw + yaw, this.y )
	}

	path( points ) {
		return points.flatMap( point => this.at( ...point ) )
	}

	/** An upright band from y0 to y1 along a polyline of [x, z] points. */
	band( name, outline, y0, y1, closed = false ) {
		const y = ( y0 + y1 ) / 2
		this.village[name].add( this.path( outline.map( ( [x, z] ) => [x, y, z] ) ), { width: y1 - y0, bank: Math.PI / 2, closed } )
	}

	/** A level slab along x, `depth` meters deep. */
	slab( name, x0, x1, z, y, depth ) {
		this.village[name].add( this.path( [[x0, y, z], [x1, y, z]] ), { width: depth } )
	}

	/**
	 * A sloped course along x, falling toward +z when `eave` is 1 and toward -z when it is -1.
	 * Like a hip loop, it runs with the eave on its right, so uv.y is 1 along its lower edge.
	 */
	slope( name, x0, x1, z, y, width, pitch, eave ) {
		const ends = eave > 0 ? [[x1, y, z], [x0, y, z]] : [[x0, y, z], [x1, y, z]]
		this.village[name].add( this.path( ends ), { width, bank: -pitch } )
	}

	/** A gable along z at `x`: a diamond centered on `y`, `height` meters from its middle to its apex. */
	gable( name, x, halfSpan, y, height ) {
		this.village[name].add( this.path( [[x, y, -halfSpan], [x, y, 0], [x, y, halfSpan]] ), { width: height * 2, bank: Math.PI / 2, taper: true } )
	}

	stroke( points, width, hex ) {
		this.village.strokes.add( points.map( point => this.at( ...point ) ), width, hex )
	}
}

/**
 * A thatched roof over an eave outline of `hx` by `hz` meters. `style` is 'irimoya'
 * (hip below, gable above), 'yosemune' (hip) or 'kirizuma' (gable). Returns the local
 * point the hearth smoke leaves from.
 */
function thatchRoof( site, { hx, hz, eaveY, pitch, style, gableDepth = 0.5, kera = 0.5, thickness = 0.5 } ) {
	const cos = Math.cos( pitch )
	const tan = Math.tan( pitch )
	const top = eaveY + thickness
	const ridgeY = top + hz * tan
	const inset = k => ( COURSE / 2 + k * COURSE_STEP ) * cos
	const height = k => top + ( COURSE / 2 + k * COURSE_STEP ) * Math.sin( pitch )
	const lastCourse = hz - COURSE * cos * 0.25
	let k = 0

	if ( style === 'kirizuma' ) {
		for ( const z of [-hz, hz] ) site.band( 'thatchEdge', [[-hx, z], [hx, z]], eaveY, top )
	} else {
		// The thick cut edge of the thatch all around the eaves, then the hipped courses.
		site.band( 'thatchEdge', rect( hx, hz ), eaveY, top, true )
		const hipUntil = style === 'irimoya' ? hz * ( 1 - gableDepth ) : lastCourse
		for ( ; inset( k ) < hipUntil; k++ ) {
			const c = inset( k )
			site.village.thatch.add( site.path( rect( hx - c, hz - c ).map( ( [x, z] ) => [x, height( k ), z] ) ), { width: COURSE, bank: -pitch, closed: true } )
		}
	}

	// Above the hip, the front and back courses run on between the two gables.
	let gableX = hx
	let ridgeX = Math.max( 0.4, hx - hz )
	if ( style !== 'yosemune' ) {
		if ( style === 'irimoya' ) {
			const base = inset( k - 1 ) + COURSE * cos / 2
			gableX = hx - base
			ridgeX = gableX + kera * 0.6
			site.gable( 'wood', gableX, ( hz - base ) * 0.96, top + base * tan, ( hz - base ) * tan * 0.96 )
			site.gable( 'wood', -gableX, ( hz - base ) * 0.96, top + base * tan, ( hz - base ) * tan * 0.96 )
		} else {
			ridgeX = hx
		}
		const span = style === 'irimoya' ? gableX + kera : hx
		for ( ; inset( k ) < lastCourse; k++ ) {
			for ( const side of [-1, 1] ) site.slope( 'thatch', -span, span, side * ( hz - inset( k ) ), height( k ), COURSE, pitch, side )
		}
	}

	// A wrapped ridge bundle, a ridge pole, and crossed sticks riding over it.
	site.stroke( [[-ridgeX, ridgeY + 0.12, 0], [ridgeX, ridgeY + 0.12, 0]], 0.75, RIDGE )
	site.stroke( [[-ridgeX - 0.15, ridgeY + 0.42, 0], [ridgeX + 0.15, ridgeY + 0.42, 0]], 0.28, TIMBER )
	const sticks = Math.max( 2, Math.round( ridgeX * 2 / 1.1 ) )
	for ( let i = 0; i <= sticks; i++ ) {
		const x = -ridgeX + 0.2 + ( ridgeX * 2 - 0.4 ) * i / sticks
		site.stroke( [[x, ridgeY - 0.3, 0.7], [x, ridgeY + 0.75, -0.35]], 0.12, TIMBER )
		site.stroke( [[x, ridgeY - 0.3, -0.7], [x, ridgeY + 0.75, 0.35]], 0.12, TIMBER )
	}

	return style === 'irimoya' ? [gableX + 0.2, ridgeY - 0.9, 0] : [ridgeX * 0.5, ridgeY + 0.5, 0]
}

/** A tiled gable roof: one sloped ribbon per side, with tile edges, ridge and end tiles. */
function tileRoof( site, { hx, hz, eaveY, pitch } ) {
	const tan = Math.tan( pitch )
	const ridgeY = eaveY + hz * tan
	for ( const side of [-1, 1] ) {
		site.slope( 'tiles', -hx, hx, side * hz / 2, eaveY + hz * tan / 2, hz / Math.cos( pitch ), pitch, side )
		site.stroke( [[-hx, eaveY - 0.04, side * hz], [hx, eaveY - 0.04, side * hz]], 0.2, TILE_EDGE )
		for ( const end of [-1, 1] ) site.stroke( [[end * hx, eaveY - 0.04, side * hz], [end * hx, ridgeY + 0.04, 0]], 0.2, TILE_EDGE )
	}
	site.stroke( [[-hx - 0.05, ridgeY + 0.1, 0], [hx + 0.05, ridgeY + 0.1, 0]], 0.42, TILE_EDGE )
	site.stroke( [[-hx, ridgeY + 0.32, 0], [hx, ridgeY + 0.32, 0]], 0.22, ONIGAWARA )
	for ( const end of [-1, 1] ) site.stroke( [[end * ( hx + 0.05 ), ridgeY - 0.05, 0], [end * ( hx + 0.05 ), ridgeY + 0.6, 0]], 0.6, ONIGAWARA )
}

/** Posts at every bay of a `hx` by `hz` footprint, and the sill and head beams around it. */
function frame( site, hx, hz, baysX, baysZ, sill, head ) {
	for ( let i = 0; i <= baysX; i++ ) {
		const x = -hx + i * hx * 2 / baysX
		for ( const z of [-hz - 0.05, hz + 0.05] ) site.stroke( [[x, 0, z], [x, head + 0.1, z]], 0.2, TIMBER )
	}
	for ( let i = 1; i < baysZ; i++ ) {
		const z = -hz + i * hz * 2 / baysZ
		for ( const x of [-hx - 0.05, hx + 0.05] ) site.stroke( [[x, 0, z], [x, head + 0.1, z]], 0.2, TIMBER )
	}
	for ( const [y, width] of [[sill, 0.16], [head, 0.2]] ) {
		for ( const z of [-hz - 0.06, hz + 0.06] ) site.stroke( [[-hx - 0.12, y, z], [hx + 0.12, y, z]], width, TIMBER )
		for ( const x of [-hx - 0.06, hx + 0.06] ) site.stroke( [[x, y, -hz - 0.12], [x, y, hz + 0.12]], width, TIMBER )
	}
}

/**
 * The front bays of a raised house: one is the earthen-floor entrance, the others
 * are shoji (lit from inside when `lit`), wooden storm shutters or plain wall.
 */
function facade( site, hx, hz, baysX, floor, head, lit ) {
	const entrance = pickInArray( [0, baysX - 1] )
	const shoji = lit ? 'shoji' : 'paper'
	for ( let i = 0; i < baysX; i++ ) {
		const x0 = -hx + i * BAY + 0.08
		const x1 = x0 + BAY - 0.16
		const kind = random()
		if ( i === entrance ) site.band( 'wood', [[x0, hz + 0.04], [x1, hz + 0.04]], 0, head - 0.2 )
		else if ( kind < 0.62 ) site.band( shoji, [[x0, hz + 0.03], [x1, hz + 0.03]], floor + 0.04, head - 0.06 )
		else if ( kind < 0.88 ) site.band( 'wood', [[x0, hz + 0.03], [x1, hz + 0.03]], floor + 0.04, head - 0.06 )
	}
}

/** Small lattice windows here and there along the sides and the back. */
function sideWindows( site, hx, hz, floor, lit ) {
	const shoji = lit ? 'shoji' : 'paper'
	const baysZ = Math.round( hz * 2 / BAY )
	for ( const x of [-hx - 0.03, hx + 0.03] ) {
		for ( let i = 0; i < baysZ; i++ ) {
			if ( random() > 0.4 ) continue
			const z = -hz + ( i + 0.5 ) * hz * 2 / baysZ
			site.band( shoji, [[x, z - 0.5], [x, z + 0.5]], floor + 0.85, floor + 1.7 )
		}
	}
	for ( let x = -hx + BAY / 2; x < hx; x += BAY ) {
		if ( random() < 0.3 ) site.band( shoji, [[x - 0.5, -hz - 0.03], [x + 0.5, -hz - 0.03]], floor + 0.85, floor + 1.7 )
	}
}

/** Firewood stacked along a wall from [x0, z0] to [x1, z1]: every log is one billboard line. */
function woodpile( site, [x0, z0], [x1, z1], height ) {
	for ( let y = 0.08; y < height; y += 0.15 ) {
		const jitter = random( -0.08, 0.08 )
		site.stroke( [[x0 + jitter, y, z0], [x1 + jitter, y, z1]], 0.15, LOG )
	}
}

/** Minka: a farmhouse on a raised floor under a deep thatched roof. */
function minka() {
	const baysX = randomInt( 5, 7 )
	const baysZ = randomInt( 3, 4 )
	const hx = baysX * BAY / 2
	const hz = baysZ * BAY / 2
	const floor = random( 0.5, 0.65 )
	const head = floor + random( 2.2, 2.45 )
	const pitch = random( 0.78, 0.9 )
	const overhang = random( 0.95, 1.2 )
	const style = random() < 0.65 ? 'irimoya' : 'yosemune'
	const gableDepth = random( 0.42, 0.55 )
	const veranda = random() < 0.75
	const pile = random() < 0.4 ? pickInArray( [-1, 1] ) : 0

	return { hx: hx + overhang, hz: hz + overhang, build: ( site, lit ) => {
		const eaveY = head - 0.3
		const roofAtWall = eaveY + 0.5 + overhang * Math.tan( pitch )
		site.band( 'wood', rect( hx - 0.15, hz - 0.15 ), 0, floor, true )
		site.band( 'plaster', rect( hx, hz ), floor, roofAtWall, true )
		facade( site, hx, hz, baysX, floor, head, lit )
		sideWindows( site, hx, hz, floor, lit )
		frame( site, hx, hz, baysX, baysZ, floor, head )
		if ( veranda ) {
			site.slab( 'wood', -hx, hx, hz + 0.5, floor - 0.05, 0.9 )
			for ( let i = 0; i <= baysX; i++ ) site.stroke( [[-hx + i * BAY, 0, hz + 0.9], [-hx + i * BAY, floor - 0.05, hz + 0.9]], 0.12, TIMBER )
		}
		if ( pile ) woodpile( site, [pile * ( hx + 0.3 ), -hz + 0.4], [pile * ( hx + 0.3 ), hz - 0.6], 1.2 )
		return site.at( ...thatchRoof( site, { hx: hx + overhang, hz: hz + overhang, eaveY, pitch, style, gableDepth } ) )
	} }
}

/** Gassho-zukuri: a steep A-frame of thatch, its gable ends stacked with lit floors. */
function gassho() {
	const baysX = randomInt( 6, 8 )
	const hx = baysX * BAY / 2
	const hz = random( 3.6, 4.5 )
	const floor = 0.45
	const head = floor + 1.9
	const pitch = random( 0.98, 1.06 )
	const overhang = random( 0.8, 1 )
	const kera = random( 0.6, 0.85 )

	return { hx: hx + kera, hz: hz + overhang, build: ( site, lit ) => {
		const tan = Math.tan( pitch )
		const eaveY = head - 0.3
		const gableY = eaveY + 0.55 + overhang * tan
		const gableHeight = hz * tan
		site.band( 'wood', rect( hx, hz ), 0, gableY, true )
		facade( site, hx, hz, baysX, floor, head, lit )
		frame( site, hx, hz, baysX, Math.round( hz * 2 / BAY ), floor, head )
		const shoji = lit ? 'shoji' : 'paper'
		for ( const end of [-1, 1] ) {
			site.gable( 'wood', end * ( hx - 0.05 ), hz, gableY, gableHeight )
			// Window rows shrink with the gable, one floor above the other.
			for ( let y = 0.45; y + 1.4 < gableHeight; y += 2.1 ) {
				const half = hz * ( 1 - ( y + 1 ) / gableHeight ) - 0.3
				const count = Math.floor( half * 2 / 1.2 )
				site.stroke( [[end * ( hx + 0.03 ), gableY + y - 0.15, -half - 0.2], [end * ( hx + 0.03 ), gableY + y - 0.15, half + 0.2]], 0.16, TIMBER )
				for ( let i = 0; i < count; i++ ) {
					const z = ( i - ( count - 1 ) / 2 ) * 1.2
					site.band( shoji, [[end * ( hx - 0.02 ), z - 0.45], [end * ( hx - 0.02 ), z + 0.45]], gableY + y, gableY + y + 0.95 )
				}
			}
		}
		const vent = thatchRoof( site, { hx: hx + kera, hz: hz + overhang, eaveY, pitch, style: 'kirizuma', thickness: 0.55 } )
		return site.at( ...vent )
	} }
}

/** Kura: a white storehouse on a stone plinth, tiled in diamond-jointed namako below. */
function kura() {
	const hx = random( 2.3, 3.1 )
	const hz = random( 1.7, 2.1 )
	const head = random( 4.6, 5.4 )
	const pitch = random( 0.42, 0.5 )
	const overhang = 0.55
	const kera = 0.45

	return { hx: hx + kera, hz: hz + overhang, build: site => {
		const tan = Math.tan( pitch )
		const wallTop = head + 0.15
		site.band( 'stone', rect( hx + 0.08, hz + 0.08 ), 0, 0.45, true )
		site.band( 'namako', rect( hx + 0.03, hz + 0.03 ), 0.45, 1.6, true )
		site.band( 'white', rect( hx, hz ), 1.6, wallTop, true )
		for ( const end of [-1, 1] ) site.gable( 'white', end * ( hx - 0.03 ), hz, wallTop, hz * tan )
		// A heavy door in a thick white frame, under a small tiled hood.
		site.band( 'white', [[-0.9, hz + 0.03], [0.9, hz + 0.03]], 0.45, 2.85 )
		site.band( 'wood', [[-0.62, hz + 0.06], [0.62, hz + 0.06]], 0.45, 2.55 )
		site.slope( 'tiles', -1.15, 1.15, hz + 0.42, 3.08, 0.95, 0.4, 1 )
		site.stroke( [[-1.15, 2.92, hz + 0.86], [1.15, 2.92, hz + 0.86]], 0.14, TILE_EDGE )
		// Iron-shuttered windows high on the gable ends.
		for ( const end of [-1, 1] ) {
			site.band( 'white', [[end * ( hx + 0.03 ), -0.55], [end * ( hx + 0.03 ), 0.55]], head - 1.55, head - 0.45 )
			site.band( 'wood', [[end * ( hx + 0.06 ), -0.38], [end * ( hx + 0.06 ), 0.38]], head - 1.38, head - 0.62 )
		}
		tileRoof( site, { hx: hx + kera, hz: hz + overhang, eaveY: wallTop - overhang * tan, pitch } )
	} }
}

/** Koya: a board shed under a small thatched gable, firewood stacked along one side. */
function koya() {
	const hx = random( 1.8, 2.5 )
	const hz = random( 1.4, 1.8 )
	const head = random( 2, 2.3 )
	const pitch = random( 0.75, 0.85 )
	const overhang = 0.6
	const kera = 0.45

	return { hx: hx + kera, hz: hz + overhang, build: site => {
		const eaveY = head - 0.25
		const gableY = eaveY + 0.45 + overhang * Math.tan( pitch )
		site.band( 'wood', rect( hx, hz ), 0, gableY, true )
		for ( const end of [-1, 1] ) site.gable( 'wood', end * ( hx - 0.04 ), hz, gableY, hz * Math.tan( pitch ) )
		frame( site, hx, hz, 2, 1, 0.1, head )
		woodpile( site, [-hx + 0.2, hz + 0.25], [hx - 0.2, hz + 0.25], 1.3 )
		thatchRoof( site, { hx: hx + kera, hz: hz + overhang, eaveY, pitch, style: 'kirizuma', thickness: 0.4 } )
	} }
}

/** Hasa: a rice-drying rack, its rails hung with sheaves. Each sheaf is one billboard line. */
function dryingRack( site, { x, z, bays } ) {
	const length = bays * 1.8
	for ( let i = 0; i <= bays; i++ ) site.stroke( [[x + i * 1.8, 0, z], [x + i * 1.8, 2.7, z]], 0.12, TIMBER )
	for ( const y of [0.95, 1.5, 2.05, 2.6] ) {
		site.stroke( [[x - 0.2, y, z], [x + length + 0.2, y, z]], 0.07, TIMBER )
		if ( random() > 0.85 ) continue
		for ( let s = x + 0.12; s < x + length - 0.08; s += 0.19 ) {
			site.stroke( [[s, y + 0.06, z], [s + random( -0.05, 0.05 ), y - random( 0.38, 0.5 ), z]], 0.2, pickInArray( SHEAVES ) )
		}
	}
}

/** A farmhouse with up to two annexes and a drying rack, and the raised plot they share. */
function planFarmstead() {
	const main = ( random() < 0.72 ? minka : gassho )()
	const buildings = [{ plan: main, x: 0, z: 0, yaw: 0 }]
	let minX = -main.hx
	let maxX = main.hx
	let minZ = -main.hz
	let maxZ = main.hz
	for ( const side of [-1, 1] ) {
		if ( random() > 0.6 ) continue
		const annex = ( random() < 0.55 ? kura : koya )()
		// An annex may turn its gable end to the yard.
		const turned = random() < 0.4
		const [ax, az] = turned ? [annex.hz, annex.hx] : [annex.hx, annex.hz]
		const x = side * ( main.hx + random( 1, 2.6 ) + ax )
		const z = random( -main.hz * 0.6, main.hz * 0.25 )
		buildings.push( { plan: annex, x, z, yaw: turned ? side * Math.PI / 2 : 0 } )
		minX = Math.min( minX, x - ax )
		maxX = Math.max( maxX, x + ax )
		minZ = Math.min( minZ, z - az )
		maxZ = Math.max( maxZ, z + az )
	}

	let rack = null
	if ( random() < 0.55 ) {
		const bays = randomInt( 3, 5 )
		rack = { x: random( minX + 1, maxX - 1 - bays * 1.8 ), z: maxZ + 1.6, bays }
		maxZ += 1.2
	}
	return {
		buildings,
		rack,
		lit: random() < 0.8,
		bounds: { minX: minX - 2.2, maxX: maxX + 2.2, minZ: minZ - 2.2, maxZ: maxZ + 3 },
	}
}

function buildFarmstead( village, plan, site ) {
	const { minX, maxX, minZ, maxZ } = plan.bounds
	// The raised earthen plot: a level slab and the banks around it.
	site.slab( 'earth', minX, maxX, ( minZ + maxZ ) / 2, 0, maxZ - minZ )
	const banks = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]
	site.band( 'earth', banks, -PLOT_HEIGHT - 0.2, 0, true )

	// Only the main house, built first, returns where its hearth smoke leaves the roof.
	const [vent] = plan.buildings.map( ( { plan: building, x, z, yaw } ) => building.build( site.child( x, z, yaw ), plan.lit ) )
	if ( plan.rack ) dryingRack( site, plan.rack )
	return vent
}

/**
 * Farmsteads face the paddies from all four sides, with their yard toward the field,
 * except in a wedge around `clearAzimuth`, where the opening camera looks in.
 */
function placeFarmsteads( village, clearAzimuth ) {
	const placed = []
	const smoke = []
	for ( let attempt = 0; attempt < 80 && placed.length < FARMSTEADS; attempt++ ) {
		const plan = planFarmstead()
		const { minX, maxX, minZ, maxZ } = plan.bounds
		const side = randomInt( 0, 3 )
		const normal = [[1, 0], [0, 1], [-1, 0], [0, -1]][side]
		const along = random( -FIELD_HALF - 8, FIELD_HALF + 8 )
		const distance = FIELD_HALF + random( 3, 9 ) + maxZ * M
		const yaw = Math.atan2( normal[0], -normal[1] ) + random( -0.06, 0.06 )
		const x = normal[0] * distance - normal[1] * along
		const z = normal[1] * distance + normal[0] * along
		const site = new Site( village, x, z, yaw, PLOT_HEIGHT * M )

		const corners = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]].map( ( [px, pz] ) => site.at( px, 0, pz ) )
		const box = {
			minX: Math.min( ...corners.map( c => c[0] ) ) - 2, maxX: Math.max( ...corners.map( c => c[0] ) ) + 2,
			minZ: Math.min( ...corners.map( c => c[2] ) ) - 2, maxZ: Math.max( ...corners.map( c => c[2] ) ) + 2,
		}
		const azimuth = Math.atan2( ( box.minZ + box.maxZ ) / 2, ( box.minX + box.maxX ) / 2 )
		const facingCamera = Math.abs( Math.atan2( Math.sin( azimuth - clearAzimuth ), Math.cos( azimuth - clearAzimuth ) ) ) < 0.62
		const overlaps = placed.some( other => box.minX < other.maxX && box.maxX > other.minX && box.minZ < other.maxZ && box.maxZ > other.minZ )
		if ( facingCamera || overlaps ) continue

		placed.push( box )
		const vent = buildFarmstead( village, plan, site )
		if ( plan.lit && vent && random() < 0.6 ) smoke.push( vent )
	}
	return smoke
}

/** 1 on the integer lines of `coord`, antialiased, and faded to its mean once thinner than a pixel. */
function gridLine( coord, halfWidth ) {
	const pixel = max( fwidth( coord ), 0.0001 )
	const distance = abs( fract( coord.add( 0.5 ) ).sub( 0.5 ) )
	const line = smoothstep( pixel.negate(), pixel, float( halfWidth ).sub( distance ) )
	return mix( line, halfWidth * 2, smoothstep( 0.15, 0.45, pixel ) )
}

/** Color nodes per material. Patterns are in world units: u runs along each ribbon. */
function materials( noise ) {
	const along = uv().x
	const height = positionWorld.y
	const sample = ( x, y ) => texture( noise, vec2( x, y ) )
	// One broad weathering value per farmstead, from a very low-frequency noise.
	const age = sample( positionWorld.x.mul( 0.0045 ).add( 0.13 ), positionWorld.z.mul( 0.0045 ).add( 0.71 ) ).b

	// Straw strands run down the slope: finer across it (along u) than in height. A stronger
	// stretch makes the sampler pick a blurry mip level, which shows as blocks in the sun.
	const straw = sample( along.mul( 1.6 ), height.mul( 0.5 ) ).r.mul( 0.6 ).add( sample( along.mul( 5 ), height.mul( 1.4 ).add( 0.5 ) ).g.mul( 0.4 ) )
	const moss = smoothstep( 0.6, 0.8, sample( positionWorld.x.mul( 0.05 ), positionWorld.z.mul( 0.05 ) ).r ).mul( 0.55 )
	// uv.y is 1 at a course's lower edge, and the course above covers it down to a third:
	// shadow under that lap, brightening toward the cut straw ends, then a dark lip.
	const lap = smoothstep( 0.33, 0.95, uv().y ).mul( 0.5 ).add( 0.55 ).mul( smoothstep( 0.965, 1, uv().y ).mul( -0.35 ).add( 1 ) )
	const thatch = mix(
		mix( mix( color( 0x7A5A30 ), color( 0xC79A58 ), straw ), mix( color( 0x463C2E ), color( 0x7E6E52 ), straw ), smoothstep( 0.3, 0.62, age ) ),
		mix( color( 0x3E4A26 ), color( 0x5E6B34 ), straw ),
		moss,
	).mul( lap )
	const cutStraw = sample( along.mul( 11 ), height.mul( 1.7 ) ).r
	const thatchEdge = mix( color( 0x3A2D1E ), color( 0x6E5638 ), cutStraw )

	const tone = sample( along.mul( 0.13 ), height.mul( 0.09 ) ).r
	const splash = smoothstep( 0.6, 2.2, height ).mul( 0.25 ).add( 0.75 )
	const plaster = mix( color( 0x9E7E50 ), color( 0xC4A574 ), tone ).mul( splash )
	const grime = sample( along.mul( 0.9 ), height.mul( 0.05 ) ).g
	const white = mix( color( 0xCFC7B8 ), color( 0xF0EADD ), grime.mul( 0.6 ).add( tone.mul( 0.4 ) ) ).mul( splash )

	// Namako: dark square tiles set on the diagonal, their joints raised in white plaster.
	const tileSize = 0.42 * M
	const joints = max( gridLine( along.add( height ).div( tileSize ), 0.09 ), gridLine( along.sub( height ).div( tileSize ), 0.09 ) )
	const namako = mix( mix( color( 0x30353B ), color( 0x4A5058 ), tone ), color( 0xE8E2D6 ), joints )

	const boards = gridLine( along.div( 0.3 * M ), 0.04 )
	const grain = sample( along.mul( 3.1 ), height.mul( 0.35 ) ).r
	const wood = mix( color( 0x2E2118 ), color( 0x54402B ), grain ).mul( boards.mul( -0.45 ).add( 1 ) )

	// Shoji: paper in a lattice of thin bars, glowing from an oil lamp inside.
	const lattice = max( gridLine( along.div( 0.3 * M ), 0.07 ), gridLine( height.div( 0.34 * M ), 0.06 ) )
	const paper = mix( color( 0xE6D9BC ), color( 0x3A2A1C ), lattice )
	const flicker = sin( time.mul( 2.3 ).add( positionWorld.x.mul( 0.7 ) ) ).mul( 0.04 )
		.add( sin( time.mul( 5.1 ).add( positionWorld.z ) ).mul( 0.03 ) )
		.add( 1 )
	const lamplight = color( 0xFFAA55 ).mul( lattice.oneMinus() ).mul( flicker ).mul( 1.1 )

	// Kawara: rolled tiles in columns down the slope, each row lapping the next.
	const roll = sin( fract( along.div( 0.27 * M ) ).mul( Math.PI ) )
	const lip = smoothstep( 0, 0.3, fract( height.div( 0.11 * M ) ) )
	const tileShade = mix( float( 0.75 ), roll.mul( 0.5 ).add( 0.5 ).mul( lip.mul( 0.35 ).add( 0.65 ) ), smoothstep( 0.45, 0.15, fwidth( along.div( 0.27 * M ) ) ) )
	const tiles = mix( color( 0x3C4148 ), color( 0x6A7078 ), sample( positionWorld.x.mul( 0.05 ), positionWorld.z.mul( 0.05 ) ).g ).mul( tileShade )

	const stone = mix( color( 0x5E5A52 ), color( 0x948E83 ), sample( along.mul( 0.8 ), height.mul( 1.3 ) ).r )

	const ground = sample( positionWorld.x.mul( 0.035 ), positionWorld.z.mul( 0.035 ) ).r
	const clods = sample( positionWorld.x.mul( 0.17 ), positionWorld.z.mul( 0.17 ) ).g
	const earth = mix( mix( color( 0x8A6E4A ), color( 0xB09068 ), clods ), mix( color( 0x66743A ), color( 0x939448 ), clods ), smoothstep( 0.42, 0.66, ground ) )

	return {
		thatch: { color: thatch, roughness: 1 },
		thatchEdge: { color: thatchEdge, roughness: 1 },
		plaster: { color: plaster },
		white: { color: white },
		namako: { color: namako, roughness: 0.6 },
		wood: { color: wood, roughness: 0.85 },
		shoji: { color: paper, emissive: lamplight },
		paper: { color: paper },
		tiles: { color: tiles, roughness: 0.45, metalness: 0.35 },
		stone: { color: stone },
		earth: { color: earth, roughness: 1 },
	}
}

/** Hearth smoke: a vertical line per chimney, drifting downwind and fading as it rises. */
function createSmoke( vents ) {
	const downwind = vec2( WIND_DIRECTION )
	const across = vec2( -WIND_DIRECTION.y, WIND_DIRECTION.x )
	return new MeshLine()
		.lines( vents.map( ( [x, y, z] ) => linePoints( 32, t => [x, y + t * SMOKE_RISE, z] ) ) )
		.color( 0xE9DCCB )
		.lineWidth( 1 )
		.widthCallback( t => 0.3 + t * 3.4 )
		.transparent( true )
		.positionFn( Fn( ( [position, progress] ) => {
			const seed = position.x.add( position.z ).mul( 0.37 )
			const sway = sin( time.mul( 0.55 ).add( progress.mul( 5.5 ) ).add( seed ) ).mul( progress ).mul( 1.4 )
			const drift = downwind.mul( pow( progress, 1.7 ).mul( SMOKE_DRIFT ) ).add( across.mul( sway ) )
			return position.add( vec3( drift.x, 0, drift.y ) )
		} ) )
		.opacityFn( Fn( ( [alpha, progress] ) => {
			const puffs = sin( progress.mul( 22 ).sub( time.mul( 1.3 ) ) ).mul( 0.25 ).add( 0.75 )
			return alpha.mul( smoothstep( 0, 0.06, progress ) ).mul( pow( progress.oneMinus(), 1.6 ) ).mul( puffs ).mul( 0.4 )
		} ) )
		.autoResize()
}

// Like MeshLine, dispose() leaves the scene and frees everything it holds.
class Village extends Group {
	dispose() {
		this.removeFromParent()
		for ( const child of [...this.children] ) child.dispose?.()
	}
}

/**
 * A new village around the paddies. Every call draws a different one from the demo's
 * seeded random, and keeps the wedge around `clearAzimuth` open for the camera.
 */
export function createVillage( noiseTexture, { clearAzimuth = 0 } = {} ) {
	const looks = materials( noiseTexture )
	const batches = { strokes: new Strokes() }
	for ( const name of Object.keys( looks ) ) batches[name] = new Surfaces()

	const vents = placeFarmsteads( batches, clearAzimuth )

	const village = new Village()
	for ( const [name, look] of Object.entries( looks ) ) {
		if ( batches[name].lines.length ) village.add( batches[name].build( look ) )
	}
	village.add( batches.strokes.build() )
	if ( vents.length ) village.add( createSmoke( vents ) )

	// Only the lit surfaces respond to these: the rice and the water shade themselves.
	const sun = new DirectionalLight( 0xFFB878, 2.6 )
	sun.position.copy( SUN_DIRECTION ).multiplyScalar( 100 )
	village.add( new HemisphereLight( 0xFFCF9E, 0x4A3A28, 1.3 ), sun )
	return village
}

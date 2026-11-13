/**
 * Swiss-poster type on ultra-text: Inter Tight 800 numerals, JetBrains Mono
 * kickers and footnotes. Every helper returns a Group with `fade( a )` that
 * drives all ultra-text opacity uniforms inside it, plus `reveal( r )`.
 */
import { createCounter, createText } from '@shared/text.js'
import { Group } from 'three/webgpu'

export const C = {
	ink: 0x0a0a0a,
	bone: 0xedeae3,
	grey: 0x5a5955,
	red: 0xff2d1a,
}
export const CSS = {
	bone: '#EDEAE3',
	grey: '#6A6965',
	red: '#FF2D1A',
	dim: '#8C8A85',
}

// word-spacing: the tight -0.04em tracking otherwise collapses '1 draw' into '1draw'
export const NUM = { fontFamily: 'Inter Tight', fontWeight: 800, letterSpacing: '-0.04em', wordSpacing: '0.12em' }
export const MONO = { fontFamily: 'JetBrains Mono', fontWeight: 400, letterSpacing: '0.14em' }

let renderer = null
export function setTypeRenderer( r ) { renderer = r }

//------------------------------------------------------------------ portrait: mono labels scale up
// Portrait posters are ~22 units wide on a ~390 px screen, so 0.26-unit footnotes would be ~4 px.
// Every mono() text registers here and is scaled about its own anchor by setMonoScale().
const monos = new Set()
let monoScale = 1
export function setMonoScale( k ) {
	monoScale = k
	for ( const m of monos ) applyMono( m )
}
export const getMonoScale = () => monoScale
function applyMono( { t, size, drop } ) {
	t.scale.setScalar( monoScale )
	// labels hanging under a number drop by their extra height so they never climb into it
	t.position.y = drop ? -( monoScale - 1 ) * size * 0.55 : 0
}

const hex = ( c ) => ( typeof c === 'number' ? `#${c.toString( 16 ).padStart( 6, '0' )}` : c )

function wrap( items ) {
	const g = new Group()
	const texts = []
	for ( const t of items ) {
		g.add( t )
		texts.push( t )
	}
	g.texts = texts
	g.fade = ( a ) => {
		for ( let i = 0; i < texts.length; i++ ) texts[i].opacity.value = a * ( texts[i].baseOpacity ?? 1 )
		g.visible = a > 0.002
	}
	g.reveal = ( r ) => { for ( let i = 0; i < texts.length; i++ ) texts[i].reveal.value = r }
	return g
}

/** One ultra-text numeral run (Inter Tight 800). */
export async function numText( str, { size = 2, color = CSS.bone, align = 'center', valign = 'middle', opacity = 1, glow = 1, ultra } = {} ) {
	const t = await createText( renderer, str, { ...NUM, color: hex( color ) }, { size, align, valign, glow, backdrop: C.ink, ultra } )
	t.baseOpacity = opacity
	t.opacity.value = opacity
	return t
}

/** Mono kicker / footnote / label. */
export async function mono( str, { size = 0.34, color = CSS.dim, align = 'left', valign = 'middle', opacity = 1, upper = true, drop = false } = {} ) {
	const css = { ...MONO, color: hex( color ) }
	const t = await createText( renderer, upper ? str.toUpperCase() : str, css, { size, align, valign, backdrop: C.ink, extraGlyphs: '' } )
	t.baseOpacity = opacity
	t.opacity.value = opacity
	const m = { t, size, drop }
	monos.add( m )
	applyMono( m )
	const g = wrap( [t] )
	g.width = t.width
	g.dispose = () => {
		monos.delete( m )
		t.dispose?.()
	}
	return g
}

/**
 * 'A → B' from the number bank: A grey (v1.2.3), arrow dim, B red (v2). Left-aligned run.
 * Returns a Group (fade/reveal) with `.width`.
 */
export async function pair( value, { size = 2, align = 'left', from = CSS.grey, to = CSS.red, gap = 0.18 } = {} ) {
	const [a, b] = value.split( '→' ).map( ( s ) => s.trim() )
	const ta = await numText( a, { size, color: from, align: 'left' } )
	const arrow = await numText( '→', { size: size * 0.7, color: from, align: 'left' } )
	const tb = await numText( b, { size, color: to, align: 'left' } )
	let x = 0
	ta.position.x = x
	x += ta.width + gap * size
	arrow.position.set( x, -size * 0.02, 0 )
	x += arrow.width + gap * size
	tb.position.x = x
	x += tb.width
	const g = wrap( [ta, arrow, tb] )
	const shift = align === 'center' ? -x / 2 : align === 'right' ? -x : 0
	for ( const t of g.texts ) t.position.x += shift
	g.width = x
	g.parts = { a: ta, arrow, b: tb }
	return g
}

/** Single numeral run as a fade-able group. */
export async function figure( str, o = {} ) {
	const t = await numText( str, o )
	const g = wrap( [t] )
	g.width = t.width
	g.text = t
	return g
}

/** Number + mono label underneath (left aligned at x = 0). */
export async function stat( value, label, { size = 1.6, color = CSS.bone, labelSize = 0.26, align = 'left' } = {} ) {
	const v = value.includes( '→' ) ? await pair( value, { size, align } ) : await figure( value, { size, color, align } )
	const l = await mono( label, { size: labelSize, align, drop: true } )
	l.position.y = -size * 0.78
	const g = new Group()
	g.add( v, l )
	g.fade = ( a ) => { v.fade( a ); l.fade( a * 0.9 ) }
	g.reveal = ( r ) => { v.reveal( r ); l.reveal( r ) }
	g.value = v
	g.label = l
	return g
}

/** Zero-DOM counter wrapped with fade(). */
export async function counter( template, { size = 2, color = CSS.bone, align = 'center', glow = 1, value = 0, tint } = {} ) {
	const c = await createCounter( renderer, { template, css: { ...NUM, color: hex( color ) }, size, align, glow, backdrop: C.ink, value, tint } )
	c.fade = ( a ) => {
		c.opacity.value = a
		c.visible = a > 0.002
	}
	return c
}

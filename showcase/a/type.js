/**
 * Plan A typography: wide heavy Inter 800 numerals in bone white, tiny mono captions.
 * Every printed figure comes from @shared/numbers.js (num()) — never typed here.
 */
import { assertPrintable, BASELINE, num } from '@shared/numbers.js'
import { createCounter, createText } from '@shared/text.js'
import { Group } from 'three/webgpu'

export const BG = 0x05060a
export const BONE = '#ece6da'
export const DIM = '#8f8b83'

export const NUM_CSS = { fontFamily: 'Inter', fontWeight: 800, letterSpacing: '-0.045em', color: BONE }
export const LINE_CSS = { fontFamily: 'Inter', fontWeight: 300, letterSpacing: '-0.01em', color: BONE }
export const CAPS_CSS = { fontFamily: 'JetBrains Mono', fontWeight: 400, letterSpacing: '0.22em', color: DIM }

export { BASELINE, num }

const all = []

/** Static text. `kind`: 'num' | 'line' | 'caps'. */
export async function text( renderer, string, { kind = 'num', size = 1, align = 'center', valign = 'middle', glow = 1, opacity = 1, css = {}, ultra } = {} ) {
	assertPrintable( string )
	const base = kind === 'num' ? NUM_CSS : kind === 'line' ? LINE_CSS : CAPS_CSS
	// caps keep version tokens lower-case: the baseline is always written 'v1.2.3'
	const s = kind === 'caps' ? string.toUpperCase().replace( /\bV(\d)/g, 'v$1' ) : string
	const sz = kind === 'caps' ? size * 1.3 : size // captions read too small at monument distance
	const t = await createText( renderer, s, { ...base, ...css }, { size: sz, align, valign, glow, opacity, backdrop: BG, ultra } )
	t.renderOrder = 20
	t.traverse( ( o ) => { o.renderOrder = 20 } )
	all.push( t )
	return t
}

/** Zero-DOM counter (scroll driven via setValue). */
export async function counter( renderer, template, { size = 1, align = 'center', glow = 1, css = {} } = {} ) {
	const c = await createCounter( renderer, { template, css: { ...NUM_CSS, ...css }, size, align, glow, backdrop: BG } )
	c.traverse( ( o ) => { o.renderOrder = 20 } )
	all.push( c )
	return c
}

/**
 * A number monument: big figure + caps caption underneath, as one Group.
 * Returns the group with `.figure`, `.caption` and `.setPresence( k )` (0..1 fade + reveal).
 */
export async function monument( renderer, figure, caption, { size = 2, captionSize = 0.22, align = 'center', glow = 1.1, gap = 0.18 } = {} ) {
	const g = new Group()
	const fig = typeof figure === 'string' ? await text( renderer, figure, { size, align, glow } ) : figure
	g.add( fig )
	let cap = null
	if ( caption ) {
		cap = await text( renderer, caption, { kind: 'caps', size: captionSize, align, valign: 'top' } )
		cap.position.y = -( fig.height ?? size * 1.2 ) / 2 - gap
		g.add( cap )
	}
	g.figure = fig
	g.caption = cap
	g.setPresence = ( k, reveal = k ) => {
		fig.opacity.value = k
		fig.reveal.value = Math.min( 1, reveal * 1.4 )
		if ( cap ) {
			cap.opacity.value = k * 0.9
			cap.reveal.value = Math.max( 0, Math.min( 1, reveal * 1.6 - 0.4 ) )
		}
	}
	return g
}

/** Orient a flat text group so it faces `eye` (its +z towards the eye), keeping world up. */
export function faceTo( obj, eye ) {
	obj.updateMatrixWorld()
	const p = obj.getWorldPosition( obj.position.clone() )
	const dx = eye.x - p.x
	const dz = eye.z - p.z
	const dy = eye.y - p.y
	obj.rotation.set( 0, 0, 0 )
	obj.rotation.order = 'YXZ'
	obj.rotation.y = Math.atan2( dx, dz )
	obj.rotation.x = -Math.atan2( dy, Math.hypot( dx, dz ) )
}

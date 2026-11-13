/** Shared bits for plan B pages: the poster header, portrait placements and tiny timing helpers. */
import { clamp, smoothstep } from '@shared/math.js'
import { Color, Group } from 'three/webgpu'

import { CSS, mono } from './type.js'

export const POSTER = { w: 38, h: 22 }
export const LEFT = -POSTER.w / 2 + 0.6
export const RIGHT = POSTER.w / 2 - 0.6
export const TOP = POSTER.h / 2 - 1.1
export const BOTTOM = -POSTER.h / 2 + 1.6

/** Portrait poster (phones): the same strip, each poster re-stacked into a tall column. */
export const PORTRAIT = { w: 22, h: 42 }
export const P = {
	left: -PORTRAIT.w / 2 + 0.6,
	right: PORTRAIT.w / 2 - 0.6,
	top: PORTRAIT.h / 2 - 1.1,
	bottom: -PORTRAIT.h / 2 + 1.4,
}

/**
 * Portrait re-stack: put( obj, x, y, s ) remembers obj's current (landscape) x, y and uniform
 * scale, and apply( portrait ) swaps between the two placements. on( fn ) adds custom steps.
 */
export function placer() {
	const items = []
	const hooks = []
	const api = {
		portrait: false,
		put( obj, x, y, s = 1 ) {
			items.push( { obj, land: [obj.position.x, obj.position.y, obj.scale.x], port: [x, y, s] } )
			return obj
		},
		on( fn ) {
			hooks.push( fn )
		},
		apply( portrait ) {
			api.portrait = portrait
			for ( const { obj, land, port } of items ) {
				const [x, y, s] = portrait ? port : land
				obj.position.x = x
				obj.position.y = y
				obj.scale.setScalar( s )
			}
			for ( const fn of hooks ) fn( portrait )
		},
	}
	return api
}

/** Kicker (top-left, "0N  TITLE") + sentence (top-right). Returns a Group with fade(a), reveal(r), portrait(p). */
export async function header( n, title, sentence ) {
	const g = new Group()
	const kicker = await mono( `${String( n ).padStart( 2, '0' )}  ${title}`, { size: 0.36, color: CSS.bone, opacity: 0.92 } )
	kicker.position.set( LEFT, TOP, 0 )
	g.add( kicker )
	let line = null
	if ( sentence ) {
		line = await mono( sentence, { size: 0.36, color: CSS.dim, align: 'right', upper: false } )
		line.position.set( RIGHT, TOP, 0 )
		g.add( line )
	}
	g.fade = ( a ) => {
		kicker.fade( a )
		line?.fade( a )
		g.visible = a > 0.002
	}
	g.reveal = ( r ) => {
		kicker.reveal( r )
		line?.reveal( r )
	}
	// portrait: kicker top-left, sentence one line below, right-aligned
	g.portrait = ( p ) => {
		kicker.position.set( p ? P.left : LEFT, p ? P.top : TOP, 0 )
		line?.position.set( p ? P.right : RIGHT, p ? P.top - 1.25 : TOP, 0 )
		line?.scale.setScalar( p ? 0.86 : 1 )
	}
	return g
}

const PH = { b: 0, h: 0, dim: 1, alive: false }
/**
 * Standard poster timing from the page state: b build 0..1, h hand-off 0..1, dim (wall), alive.
 * Returns one shared object (no per-frame allocation): read it before the next call.
 */
export function phases( s ) {
	PH.b = Math.max( s.build, s.wall )
	PH.h = s.handoff * ( 1 - s.wall )
	PH.dim = 1 - 0.62 * s.wall * ( s.isLast ? 0 : 1 )
	PH.alive = PH.b > 0.001 && PH.h < 0.999
	return PH
}

/** 0..1 window helper: rises over [a, b] of t. */
export const win = ( t, a, b ) => smoothstep( a, b, t )
export const band = ( t, a, b ) => clamp( ( t - a ) / ( b - a ) )

const tmp = new Color()
/** Set a MeshLine colour to `hex` scaled by k (for wall dimming of opaque lines). */
export function dimLine( line, hex, k ) {
	tmp.setHex( hex ).multiplyScalar( k )
	line.color( tmp )
}

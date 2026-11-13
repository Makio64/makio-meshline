/**
 * 05 · Joins And Caps — a type-specimen sheet. Top row: an angular '3' as a
 * thick billboard stroke with miter / bevel / round joins (wireframe overlay
 * reveals the bridge triangles). Bottom row: the same '3' as lit surface()
 * ribbons with butt / square / round caps.
 */
import { smoothstep } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import { Fn, step, uniform } from 'three/tsl'
import { AmbientLight, DirectionalLight, Group } from 'three/webgpu'

import { dimLine, header, LEFT, P, phases, placer } from '../lib/page.js'
import { C, CSS, mono, pair, stat } from '../lib/type.js'

// an angular Swiss '3' (sharp corners to show the joins)
const THREE_PTS = [
	[-1.25, 2.5], [1.35, 2.5], [-0.15, 0.45], [0.55, 0.45], [1.45, -0.35],
	[1.45, -1.45], [0.55, -2.4], [-0.6, -2.4], [-1.45, -1.5],
]
const glyph3 = ( s = 1 ) => new Float32Array( THREE_PTS.flatMap( ( [x, y] ) => [x * s, y * s, 0] ) )

const COLS = [-1.5, 6.4, 14.3]
const PCOLS = [-6.6, 0, 6.6] // portrait columns
const JOINS = ['miter', 'bevel', 'round']
const CAPS = ['butt', 'square', 'round']

export default {
	title: 'Joins And Caps',
	subs: 1,
	async build( ctx ) {
		const group = new Group()
		const uDraw = uniform( 0 )
		const drawFn = Fn( ( [w, progress] ) => w.mul( step( progress, uDraw.mul( 1.001 ) ) ) )

		//------------------------------------------------ top row: billboard joins
		const top = []
		for ( let i = 0; i < 3; i++ ) {
			const line = new MeshLine()
				.lines( glyph3( 1.18 ), false )
				.lineWidth( 0.95 )
				.color( C.bone )
				.join( { type: JOINS[i], limit: 4, segments: 10 } )
				.widthFn( drawFn )
				.autoResize()
			line.position.set( COLS[i], 3.6, 0 )
			const wire = new MeshLine()
				.lines( glyph3( 1.18 ), false )
				.lineWidth( 0.95 )
				.color( C.red )
				.join( { type: JOINS[i], limit: 4, segments: 10 } )
				.wireframe( true )
				.transparent( true )
				.opacity( 0 )
				.autoResize()
			wire.position.set( COLS[i], 3.6, 0.05 )
			wire.renderOrder = 2
			group.add( line, wire )
			const label = await mono( JOINS[i], { size: 0.3, upper: false } )
			label.position.set( COLS[i] - 1.6, -0.1, 0 )
			group.add( label )
			top.push( { line, wire, label } )
		}

		//------------------------------------------------ bottom row: lit surface ribbons with caps
		// the lights live at the scene root for the whole site: a light set that changes with page
		// visibility gives every material a new cache key (pipeline rebuilds on each page turn). A
		// directional light only depends on (position - target), so its place on the strip is free.
		const lights = new Group()
		lights.name = 'b:lights'
		lights.add( new AmbientLight( 0xffffff, 0.9 ) )
		const sun = new DirectionalLight( 0xffffff, 2.8 )
		sun.position.set( -6, 8, 6 )
		lights.add( sun, sun.target )
		ctx.scene.add( lights )
		const bottom = []
		for ( let i = 0; i < 3; i++ ) {
			const ribbon = new MeshLine()
				.lines( glyph3( 1.18 ), false )
				.lineWidth( 0.95 )
				.color( C.bone )
				.surface( { frame: 'fixed-up', up: [0, 0, 1], uvMode: 'distance', roughness: 0.55, metalness: 0.05 } )
				.join( { type: 'round', limit: 3, segments: 10, inner: 'clip' } )
				.cap( { type: CAPS[i], segments: 10 } )
				.build()
			const holder = new Group()
			holder.position.set( COLS[i], -4.4, 0 )
			holder.add( ribbon )
			group.add( holder )
			const label = await mono( CAPS[i], { size: 0.3, upper: false } )
			label.position.set( COLS[i] - 1.6, -8.0, 0 )
			group.add( label )
			bottom.push( { ribbon, holder, label } )
		}

		//------------------------------------------------ numbers
		const joins = num( 'joins' )
		const caps = num( 'caps' )
		const jPair = await pair( joins.value, { size: 2.6 } )
		jPair.position.set( LEFT, 4.4, 0 )
		const jLabel = await mono( 'join types', { size: 0.28 } )
		jLabel.position.set( LEFT + 0.1, 2.7, 0 )
		const cPair = await pair( caps.value, { size: 2.6 } )
		cPair.position.set( LEFT, -3.6, 0 )
		const cLabel = await mono( 'cap types', { size: 0.28 } )
		cLabel.position.set( LEFT + 0.1, -5.3, 0 )
		const r16 = num( 'roundCap16' )
		const plus = await stat( r16.value, 'verts to round-cap a 50K-pt road', { size: 1.2, color: CSS.red } )
		plus.position.set( LEFT, -7.5, 0 )
		group.add( jPair, jLabel, cPair, cLabel, plus )

		const head = await header( 5, 'Joins And Caps', 'Three joins. Three caps.' )
		group.add( head )

		//------------------------------------------------ portrait re-stack: pairs on top, 3 × 2 specimen grid, +16 below
		const lay = placer()
		top.forEach( ( { line, wire, label }, i ) => {
			lay.put( line, PCOLS[i], 6.4 )
			lay.put( wire, PCOLS[i], 6.4 )
			lay.put( label, PCOLS[i] - 1.6, 2.7 )
		} )
		bottom.forEach( ( { holder, label }, i ) => {
			lay.put( holder, PCOLS[i], -3.4 )
			lay.put( label, PCOLS[i] - 1.6, -7.0 )
		} )
		lay.put( jPair, P.left, 15.9, 0.85 )
		lay.put( jLabel, P.left + 0.1, 14.2 )
		lay.put( cPair, 1.0, 15.9, 0.85 )
		lay.put( cLabel, 1.1, 14.2 )
		lay.put( plus, P.left, -11.6, 1.15 )
		lay.on( ( p ) => head.portrait( p ) )

		let lastLimit = 4
		const lastWire = [-1, -1, -1]
		const texts = [jPair, jLabel, cPair, cLabel, plus]
		let lastDim = -1
		return {
			group,
			layout: lay.apply,
			update( s ) {
				const { b, h, dim } = phases( s )
				uDraw.value = smoothstep( 0.1, 0.85, b ) * ( 1 - smoothstep( 0.1, 0.9, h ) )
				const hold = smoothstep( 0.85, 1, b ) * ( 1 - smoothstep( 0, 0.3, h ) ) * ( 1 - s.wall )
				// cursor x drives the miter '3' limit live (uniform update, no rebuild)
				const limit = Math.round( ( 1.2 + ( ctx.pointer.x * 0.5 + 0.5 ) * 4.8 ) * 10 ) / 10
				if ( s.focus > 0.5 && limit !== lastLimit ) {
					lastLimit = limit
					top[0].line.miterLimit( limit )
					top[0].wire.miterLimit( limit )
				}
				const dimChanged = dim !== lastDim
				lastDim = dim
				for ( let i = 0; i < top.length; i++ ) {
					const { line, wire, label } = top[i]
					if ( dimChanged ) dimLine( line, C.bone, dim )
					// wireframe flash: an ambient shimmer across the three '3's while held (bounded, periodic)
					const pulse = ctx.reducedMotion ? 0.6 : 0.5 + 0.5 * Math.sin( s.t * 1.6 - i * 0.9 )
					const a = Math.round( Math.min( 0.99, hold * ( 0.25 + 0.6 * pulse ) ) * 500 ) / 500
					if ( a !== lastWire[i] ) {
						lastWire[i] = a
						wire.opacity( a )
					}
					wire.visible = hold > 0.01
					label.fade( smoothstep( 0.5, 0.95, b ) * ( 1 - h ) * dim )
				}
				for ( let i = 0; i < bottom.length; i++ ) {
					const { holder, label } = bottom[i]
					holder.scale.y = Math.max( 1e-3, smoothstep( 0.35, 0.95, b ) * ( 1 - smoothstep( 0.1, 0.8, h ) ) )
					holder.visible = holder.scale.y > 0.002
					label.fade( smoothstep( 0.6, 1, b ) * ( 1 - h ) * dim )
				}
				const tIn = smoothstep( 0.35, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) * dim
				for ( let i = 0; i < texts.length; i++ ) texts[i].fade( tIn )
				jPair.reveal( smoothstep( 0.35, 0.8, b ) )
				cPair.reveal( smoothstep( 0.5, 0.95, b ) )
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
			},
		}
	},
}

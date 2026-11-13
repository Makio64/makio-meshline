/**
 * VII · The Collection — the camera rises gently over the museum (its MeshLine floor plan, the
 * carpet spine glowing end to end) and settles on four plinths: David, Venus, Aurelius and
 * Nefertiti, each re-traced in another v2 style (arc-length dashes, gradient, round joins,
 * fold-clean rings). Click a bust to fly back to its room (a smooth scroll); click the command to copy.
 */
import { easeOutCubic } from '@shared/math.js'
import { BASELINE, num, RELEASE } from '@shared/numbers.js'
import { createRingStack } from '@shared/statues.js'
import { createText } from '@shared/text.js'
import { Group, Vector3 } from 'three/webgpu'

import { BG, capsText, clamp01, CSS_IVORY, FLOOR_Y, goldCount, goldText, pinToCamera, plinthLine, roomRings, setStyle, spotCone } from '../kit.js'

const STATS = [
	{ id: 'tests366', template: '000', label: 'automated tests' },
	{ id: 'demos', template: '00', label: 'demos' },
	{ id: 'classes', template: '00', label: 'exported classes' },
	{ id: 'typedExports', template: '00', label: 'typed exports' },
]
const BUSTS = [
	{ name: 'david', room: 1, style: 'dash' },
	{ name: 'venus', room: 2, style: 'gradient' },
	{ name: 'aurelius', room: 3, style: 'round' },
	{ name: 'nefertiti', room: 0, style: 'fold' },
]
const STYLE_LABEL = { dash: 'dash()', gradient: 'gradient', round: "join: 'round'", fold: "fold: 'geometry'" }
const SPACING = 7.4
const SPACING_PORTRAIT = 3.9
const SCALE = 0.56

export default {
	slug: 'collection',
	title: 'The Collection',
	numeral: 'VII',
	// phone: a tighter row in the lower half, the wall of numbers pinned as a 2 × 2 grid on top
	rest: { radius: 30, theta: 0, phi: 0.12, tx: 0, ty: -2.6, ptx: 0, pty: -0.6, pradius: 45 },
	stage: false,
	footnote: `${BASELINE} → ${RELEASE} · tests counted by node --test`,

	async create( ctx, root, room ) {
		const { renderer, camera, stage } = ctx
		const shapes = await Promise.all( BUSTS.map( ( b ) => roomRings( b.name ) ) )
		const PLINTH_TOP = FLOOR_Y + 1.2
		const items = []
		for ( let i = 0; i < BUSTS.length; i++ ) {
			const b = BUSTS[i]
			const x = ( i - 1.5 ) * SPACING
			const palettes = b.style === 'gradient' ? [[0xc8a25a, 0xfff6e6]] : b.style === 'dash' ? [[0xece4d6, 0xece4d6]] : undefined
			const stack = createRingStack( [shapes[i]], { lineWidth: 0.045, intensity: 1.15, palettes, antialias: b.style === 'fold' } )
			if ( b.style === 'dash' ) stack.line.dash( { count: 8, ratio: 0.55 } )
			if ( b.style === 'round' ) stack.line.join( { type: 'round' } )
			stack.line.scale.setScalar( SCALE )
			stack.line.position.set( x, PLINTH_TOP + 6 * SCALE + 0.05, 0 )
			stack.reveal.value = 0
			const plinth = plinthLine( { w: 3.4, h: 1.2, opacity: 0.5 } )
			plinth.position.x = x
			const cone = spotCone( new Vector3( x, 15, 2 ), new Vector3( x, FLOOR_Y, 0 ), 2.6, { count: 32, intensity: 0.35 } )
			root.add( stack.line, plinth, cone )

			const s = num( STATS[i].id )
			const group = new Group()
			const from = await goldText( renderer, `${s.nums[0]} →`, 1.25, { align: 'right', glow: 1.0 } )
			from.position.set( -0.05, 0, 0 )
			const to = await goldCount( renderer, STATS[i].template, String( s.nums[1] ), 1.25, { align: 'left', glow: 1.6 } )
			to.position.set( 0.2, 0, 0 )
			const label = await capsText( renderer, STATS[i].label, 0.25 )
			label.position.set( 0, -1.12, 0 )
			group.add( from, to, label )
			// the wall of numbers hangs above the busts, clear of plinths and cones' floor rings
			group.position.set( x, 3.6, 0.6 )
			// the v2 style tag sits on the plinth front, like a museum label
			const style = await capsText( renderer, STYLE_LABEL[b.style], 0.21, { tint: 0xc8a25a } )
			style.position.set( x, FLOOR_Y + 0.6, 1.75 )
			root.add( style )
			root.add( group )
			items.push( { b, x, stack, plinth, cone, group, from, to, label, style, s, i } )
		}

		const cmd = await createText( renderer, 'npm i makio-meshline', { fontFamily: 'JetBrains Mono', fontWeight: 400, color: CSS_IVORY, letterSpacing: '0.02em' }, { size: 0.62, glow: 1.3, backdrop: BG } )
		cmd.position.set( 0, FLOOR_Y - 1.5, 4.6 )
		root.add( cmd )

		// DOM affordances: copy the command, click a bust to revisit its room
		const copyBtn = document.createElement( 'button' )
		copyBtn.type = 'button'
		copyBtn.className = 'musee-copy'
		copyBtn.setAttribute( 'aria-label', 'Copy npm i makio-meshline' )
		document.body.append( copyBtn )
		let copied = 0
		copyBtn.addEventListener( 'click', async ( e ) => {
			e.stopPropagation()
			try {
				await navigator.clipboard.writeText( 'npm i makio-meshline' )
				copied = 1.6
			} catch {
				copied = 0
			}
		} )
		const tmp = new Vector3()
		const onClick = ( e ) => {
			if ( !root.visible || e.target === copyBtn ) return
			let best = null
			let bestD = 140 * 140
			for ( const it of items ) {
				tmp.set( it.x, PLINTH_TOP + 6 * SCALE, 0 ).add( root.position ).project( camera )
				const dx = ( tmp.x * 0.5 + 0.5 ) * stage.size.width - e.clientX
				const dy = ( 0.5 - tmp.y * 0.5 ) * stage.size.height - e.clientY
				const d = dx * dx + dy * dy
				if ( d < bestD ) { bestD = d; best = it }
			}
			if ( best && ctx.scroll.local( room.i ) === 0 && !ctx.scroll.animating ) ctx.goTo( best.b.room )
		}
		window.addEventListener( 'click', onClick )

		const copyRect = new Vector3()
		let wasPortrait = false
		const layout = ( portrait ) => {
			for ( const it of items ) {
				const x = ( it.i - 1.5 ) * ( portrait ? SPACING_PORTRAIT : SPACING )
				it.x = x
				it.stack.line.position.x = x
				it.plinth.position.x = x
				it.cone.position.x = x - ( it.i - 1.5 ) * SPACING // cone points are baked at the landscape x
				it.style.position.x = x
				it.style.visible = !portrait // phone: four style tags do not fit under a 3.9-unit spacing
				if ( !portrait ) {
					it.group.position.set( x, 3.6, 0.6 )
					it.group.scale.setScalar( 1 )
				}
			}
			if ( !portrait ) {
				cmd.position.set( 0, FLOOR_Y - 1.5, 4.6 )
				cmd.scale.setScalar( 1 )
			}
		}

		let btnOn = false
		const showBtn = ( on ) => {
			if ( on === btnOn ) return
			btnOn = on
			copyBtn.classList.toggle( 'is-on', on )
		}
		copyBtn.style.bottom = 'auto'

		return {
			hidden() { showBtn( false ) },
			update( f ) {
				const arrive = clamp01( ( f.local + 1 ) / 0.9 )
				ctx.spine.value = 1 + 2.4 * Math.sin( Math.PI * Math.min( 1, arrive ) ) + 0.8 * f.presence
				ctx.runner.material.emissiveIntensity = 1 + 0.9 * f.presence

				const portrait = ctx.portrait()
				if ( portrait !== wasPortrait ) {
					wasPortrait = portrait
					layout( portrait )
				}
				for ( let i = 0; i < items.length; i++ ) {
					const it = items[i]
					if ( portrait ) pinToCamera( it.group, camera, root, { x: i % 2 ? 0.48 : -0.48, y: i < 2 ? 0.6 : 0.3, width: 11.5, local: f.local } )
					// sequence: busts trace in, then counters decode one after another
					const k = clamp01( ( f.presence - 0.35 - i * 0.08 ) / 0.4 )
					it.stack.reveal.value = easeOutCubic( clamp01( ( f.presence - 0.2 - i * 0.06 ) / 0.5 ) )
					it.stack.line.rotation.y = f.t * 0.15 + i
					// screen-parallel (lookAt a point skews off-axis labels into perspective slants)
					it.group.quaternion.copy( camera.quaternion )
					it.style.quaternion.copy( camera.quaternion )
					const v = Math.round( it.s.nums[1] * easeOutCubic( k ) )
					it.to.set( v, k < 0.98 ? 0.4 : 0, k >= 0.98 )
					const a = Math.pow( f.presence, 1.5 )
					it.to.opacityValue = a
					it.from.opacity.value = a * 0.55
					it.label.opacity.value = a * 0.72
					it.style.opacity.value = a * 0.8
					it.cone.uIntensity.value = 0.35 * f.presence
				}
				if ( portrait ) pinToCamera( cmd, camera, root, { x: 0, y: -0.5, width: 9, local: f.local } )
				else cmd.quaternion.copy( camera.quaternion )
				cmd.reveal.value = clamp01( ( f.presence - 0.55 ) / 0.4 )
				cmd.opacity.value = Math.pow( f.presence, 2 )
				copied = Math.max( 0, copied - f.dt )
				cmd.glow.value = 1.3 + copied * 1.5

				// copy hit area follows the command on screen
				const on = Math.abs( f.local ) < 0.05
				showBtn( on )
				if ( on ) {
					copyRect.copy( cmd.position ).add( root.position ).project( camera )
					setStyle( copyBtn, 'left', `${Math.round( ( copyRect.x * 0.5 + 0.5 ) * stage.size.width )}px` )
					setStyle( copyBtn, 'top', `${Math.round( ( 0.5 - copyRect.y * 0.5 ) * stage.size.height - 32 )}px` )
				}
				ctx.hint( on ? ( copied > 0 ? 'copied' : 'click a bust to revisit · copy the command' ) : '' )
			},
			dispose() {
				window.removeEventListener( 'click', onClick )
				copyBtn.remove()
				for ( const it of items ) {
					it.stack.dispose()
					it.plinth.dispose()
					it.cone.dispose()
					for ( const tx of [it.from, it.label, it.style] ) tx.dispose()
					it.to.dispose()
				}
				cmd.dispose()
			},
		}
	},
}

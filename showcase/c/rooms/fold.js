/**
 * II · The Fold (signature) — one 64 × 96 ring stack turns David into Venus ring by ring while the
 * camera swings down to the grazing angle where old miters spiked. The plaque rides the swelling
 * morph front up the body; when the crown closes it drops onto the plinth and '31.6 px' counts
 * down to '1.6 px'. A gilded loupe magnifies ×4 through a second camera pass: inside it the same
 * stack renders with join { fold: 'exact' }, outside with the discard-free default 'geometry'.
 *
 * Scrolling IS the scrub: the whole piece is a pure function of the scroll position across this
 * room's plateau (where main.js's rig drifts FRONT -> GRAZE), so scrolling back rewinds it
 * exactly. No input capture, no latches, no autoplay.
 */
import { easeOutCubic, lerp } from '@shared/math.js'
import { BASELINE, num } from '@shared/numbers.js'
import { query } from '@shared/stage.js'
import { createRingStack } from '@shared/statues.js'
import { circlePositions, MeshLine } from 'makio-meshline'
import { Fn } from 'three/tsl'
import { Group, Quaternion, Vector3 } from 'three/webgpu'

import { C, capsText, clamp01, easeOutBack, FLOOR_Y, goldCount, goldRule, goldText, lineText, pinToCamera, plinthLine, roomRings, setStyle, smoother, spotCone } from '../kit.js'

const fold = num( 'fold' )
const notched = num( 'notched' )
const discards = num( 'discards' )

// ?morph=0.5 pins the morph (inspection only)
const PIN = query.has( 'morph' ) ? Math.max( 0, Math.min( 1, parseFloat( query.get( 'morph' ) ) || 0 ) ) : null

const CROWN_Y = 5.3 // the riding number's top stop: below the frame edge at the grazing pose
const RIDE_Y = -2.8 // its start: clear of the plinth rosette and the bottom hint
// Across the room's plateau the camera cranes DOWN from FRONT (above, looking down on David) to
// GRAZE (eye level with the rings, where old miters spiked) while it turns a little further down the
// gallery: its heading climbs from the Atrium's toward The Gesture's and never swings back, so the
// same move reads smoothly whether the room is held or flown through. ptheta: phone framing.
const FRONT = { radius: 22, theta: -0.42, phi: 0.2, tx: 3.6, ty: -0.2, ptx: 0, pty: -2.4, fov: 45 }
const GRAZE = { radius: 21, theta: -0.55, ptheta: -0.5, phi: -0.012, tx: 3.4, ty: -0.6, ptx: 0, pty: -1.6, fov: 43 }

export default {
	slug: 'fold',
	title: 'The Fold',
	numeral: 'II',
	rest: FRONT,
	graze: GRAZE,
	footnote: `fold figures documented (CHANGELOG), not re-measured · loupe: fold 'exact'`,

	async create( ctx, root ) {
		const { renderer, camera, loupe, stage, isWebGPU } = ctx
		const [david, venus] = await Promise.all( [roomRings( 'david' ), roomRings( 'venus' )] )

		const opts = { lineWidth: 0.034, intensity: 1.18, swell: 0.6, widthSwell: 0.12 }
		const stack = createRingStack( [david, venus], opts )
		stack.line.layers.set( 1 ) // main camera only
		const exact = createRingStack( [david, venus], opts )
		exact.line.join( { type: 'round', fold: 'exact' } )
		exact.line.layers.set( 2 ) // loupe camera only
		exact.line.build()
		stack.line.build()
		root.add( stack.line, exact.line )

		const plinth = plinthLine( { w: 5.2, h: 1.2, opacity: 0.5 } )
		const cone = spotCone( new Vector3( 2.2, 17.5, 3.4 ), new Vector3( 0, FLOOR_Y, 0 ), 4.4, { intensity: 0.42 } )
		root.add( plinth, cone )

		//---------------------------------------------------------- loupe ring (camera child, main camera only)
		const ringGroup = new Group()
		const ring = new MeshLine()
			.lines( [circlePositions( 128, 1 ), circlePositions( 128, 1.045 )], true )
			.lineWidth( 1.6 )
			.sizeAttenuation( false )
			.color( C.gold )
			.colorFn( Fn( ( [col] ) => col.mul( 1.9 ) ) )
			.autoResize()
		ring.build()
		ring.material.depthTest = false
		ring.material.depthWrite = false
		ring.material.transparent = true
		ring.renderOrder = 999
		ring.layers.set( 1 )
		ring.frustumCulled = false
		ringGroup.add( ring )
		camera.add( ringGroup )
		ringGroup.visible = false
		const loupeTag = document.createElement( 'div' )
		loupeTag.className = 'musee-note'
		loupeTag.style.cssText = 'position:fixed;left:0;top:0;bottom:auto;max-width:none;color:#c8a25a;opacity:0;transform:translate(-100%,-50%);white-space:nowrap;text-align:right'
		loupeTag.textContent = "×4 · fold: 'exact'"
		document.body.append( loupeTag )

		//---------------------------------------------------------- plaque
		const plaque = new Group()
		const line = await lineText( renderer, 'David becomes Venus. Not one spike.', 0.6, { align: 'left' } )
		line.position.set( 0, 3.6, 0 )
		const rule = goldRule( 5.2 )
		rule.position.set( 0, -0.55, 0 )
		const triple = await goldText( renderer, fold.value, 0.46, { align: 'left', glow: 1.2 } )
		triple.position.set( 0, -1.05, 0 )
		const tripleLabel = await capsText( renderer, 'worst fold overshoot · documented', 0.17, { align: 'left' } )
		tripleLabel.position.set( 0, -1.62, 0 )
		const notchedN = await goldText( renderer, notched.value, 0.74, { align: 'left' } )
		notchedN.position.set( 0, -2.65, 0 )
		const notchedL = await capsText( renderer, 'notched pixels', 0.17, { align: 'left' } )
		notchedL.position.set( 0, -3.32, 0 )
		const discN = await goldText( renderer, discards.value, 0.74, { align: 'left' } )
		discN.position.set( 0, -4.25, 0 )
		const discL = await capsText( renderer, `discards · vs ${BASELINE}`, 0.17, { align: 'left' } )
		discL.position.set( 0, -4.92, 0 )
		plaque.add( line, rule, triple, tripleLabel, notchedN, notchedL, discN, discL )
		root.add( plaque )

		// the riding number: '31.6 px' climbs the body with the morph front, lands, counts down
		const counter = await goldCount( renderer, '00.0 px', `${fold.nums[2]} px`, 1.5, { align: 'left', glow: 1.7 } )
		const ride = await goldText( renderer, `${fold.nums[0]} px`, 1.5, { align: 'left', glow: 1.7 } )
		counter.add( ride ) // proportional '31.6 px' while it rides the front
		root.add( counter )
		let wasPortrait = false

		//---------------------------------------------------------- state (a pure function of the scroll)
		const camRight = new Vector3()
		const anchor = new Vector3()
		const tmp = new Vector3()
		const landing = new Vector3()
		const q = new Quaternion()
		const texts = [line, triple, tripleLabel, notchedN, notchedL, discN, discL]
		const values = [triple, notchedN, discN]
		const labels = [tripleLabel, notchedL, discL]
		let tagOn = false
		const showTag = ( on ) => {
			if ( on === tagOn ) return
			tagOn = on
			loupeTag.style.opacity = on ? '0.9' : '0'
		}

		return {
			hidden() {
				ringGroup.visible = false
				showTag( false )
			},
			/**
			 * f.inPage runs -1 .. 1 across the room's plateau, in step with the rig's FRONT -> GRAZE
			 * swing: it scrubs the whole piece. Arriving: -1 (David). Leaving: 1 (landed, counted).
			 */
			update( f ) {
				const u = f.inPage
				const morph = PIN ?? smoother( ( u + 0.9 ) / 1.3 )
				const land = clamp01( ( u - 0.35 ) / 0.3 )
				const count = clamp01( ( u - 0.55 ) / 0.35 )
				stack.morph.value = morph
				exact.morph.value = morph
				ctx.hint( f.local === 0 && morph < 0.02 ? 'scroll to morph' : '' )
				// bloom swells with the morph front, without washing the upper rings into a blob
				stage.setBloom( 0.62 + 0.3 * Math.sin( Math.PI * morph ) * f.presence )

				// camera-facing frame for the plaque (it shrinks with the orbit's dolly-in)
				camRight.setFromMatrixColumn( camera.matrixWorld, 0 ).setY( 0 ).normalize()
				const portrait = ctx.portrait()
				const sc = lerp( 1, GRAZE.radius / FRONT.radius, smoother( ( u + 1 ) / 2 ) )
				anchor.copy( camRight ).multiplyScalar( portrait ? -3.0 : 5.4 * sc )
				anchor.y = portrait ? -8.0 : 0.4
				plaque.position.copy( anchor )
				plaque.scale.setScalar( sc )
				counter.scale.setScalar( sc )
				tmp.copy( camera.position ).sub( root.position )
				tmp.y = plaque.position.y
				plaque.lookAt( tmp.add( root.position ) )
				if ( portrait !== wasPortrait ) {
					// phone: '1 → 0' moves beside '489 → 0' so the plaque fits under the horizon
					wasPortrait = portrait
					discN.position.set( portrait ? 5.2 : 0, portrait ? -2.65 : -4.25, 0 )
					discL.position.set( portrait ? 5.2 : 0, portrait ? -3.32 : -4.92, 0 )
				}
				if ( portrait ) {
					pinToCamera( plaque, camera, root, { y: -0.47, width: 11, local: f.local } )
					counter.scale.copy( plaque.scale )
				}

				// riding number: climbs with the morph front, lands on the plaque, counts down
				plaque.updateMatrixWorld()
				landing.set( 0, 1.0, 0 ).applyMatrix4( plaque.matrixWorld ).sub( root.position )
				if ( land <= 0 ) {
					tmp.copy( camRight ).multiplyScalar( portrait ? 3.2 : 3.4 )
					tmp.y = lerp( RIDE_Y, CROWN_Y, morph < 0.02 ? 0 : stack.frontHeight() ) // starts at David's knees
					counter.position.copy( tmp )
				} else {
					const top = tmp.copy( camRight ).multiplyScalar( portrait ? 3.2 : 3.4 )
					top.y = CROWN_Y
					counter.position.lerpVectors( top, landing, easeOutBack( land, 1.3 ) )
				}
				counter.quaternion.copy( plaque.getWorldQuaternion( q ) )
				const riding = count <= 0
				ride.visible = riding
				if ( riding ) {
					counter.counter.visible = false
					counter.still.visible = false
				} else {
					const v = lerp( fold.nums[0], fold.nums[2], easeOutCubic( count ) )
					counter.set( v, count < 0.97 ? 0.35 : 0, count >= 1 )
				}
				const na = Math.pow( f.presence, 2 ) * ( morph < 0.02 ? 0.55 : 1 )
				counter.opacityValue = na
				ride.opacity.value = na
				rule.draw.value = clamp01( ( count - 0.15 ) / 0.6 )

				const after = clamp01( count * 1.4 ) * Math.pow( f.presence, 2 )
				// the riding number climbs past the headline: the headline steps back while it passes
				const headY = plaque.position.y + line.position.y * plaque.scale.y
				const pass = riding && !portrait ? clamp01( ( Math.abs( counter.position.y - headY ) - 0.7 ) / 0.9 ) : 1
				line.opacity.value = Math.pow( f.presence, 2 ) * ( 0.12 + 0.88 * pass )
				line.reveal.value = clamp01( f.presence * 1.5 - 0.4 )
				for ( const tx of values ) tx.opacity.value = after
				for ( const tx of labels ) tx.opacity.value = after * 0.72
				triple.reveal.value = clamp01( count * 1.6 )
				cone.uIntensity.value = 0.42 * f.presence

				// loupe: follows the pointer, else hunts the grazing silhouette where folds live
				// WebGL2: no loupe (the exact-fold stack is a WebGPU-verified path in this prototype)
				const on = isWebGPU ? clamp01( 1 - Math.abs( f.local ) / 0.25 ) * clamp01( morph * 4 ) : 0
				loupe.on.value = on > 0.01 ? 1 : 0
				ringGroup.visible = on > 0.01
				showTag( on > 0.01 )
				if ( on > 0.01 ) {
					const usePointer = ctx.pointerActive && performance.now() - ctx.lastPointerMove < 4000
					if ( usePointer ) {
						loupe.center.value.set( ctx.pointer.clientX / stage.size.width, ctx.pointer.clientY / stage.size.height )
					} else {
						// hunt the left silhouette of the current shape around chest height (ambient drift)
						const shape = morph < 0.5 ? david : venus
						const y = 1.2 + Math.sin( f.t * 0.45 ) * 1.6
						const ringI = Math.max( 0, Math.min( shape.rings - 1, Math.round( ( y - shape.minY ) / ( shape.maxY - shape.minY ) * ( shape.rings - 1 ) ) ) )
						let edge = 0
						for ( let s = 0; s < shape.samples; s++ ) {
							const o = ( ringI * shape.samples + s ) * 3
							edge = Math.max( edge, -( shape.positions[o] * camRight.x + shape.positions[o + 2] * camRight.z ) )
						}
						tmp.copy( camRight ).multiplyScalar( -edge * 0.9 ) // just inside: the rings' U-turns fill the lens
						tmp.y = y
						tmp.add( root.position ).project( camera )
						loupe.center.value.set( tmp.x * 0.5 + 0.5, 0.5 - tmp.y * 0.5 )
					}
					const r = ( portrait ? 0.075 : 0.13 ) * on
					loupe.radius.value = r
					// loupe camera: same eye, aimed at the loupe centre, fov / 4
					const c = loupe.center.value
					tmp.set( c.x * 2 - 1, 1 - c.y * 2, 0.5 ).unproject( camera )
					loupe.cam.position.copy( camera.position )
					loupe.cam.up.copy( camera.up )
					loupe.cam.lookAt( tmp )
					const fovRad = ( camera.fov * Math.PI ) / 180
					loupe.cam.fov = ( 2 * Math.atan( Math.tan( fovRad / 2 ) / loupe.zoom ) * 180 ) / Math.PI
					loupe.cam.aspect = camera.aspect
					loupe.cam.near = camera.near
					loupe.cam.far = camera.far
					loupe.cam.updateProjectionMatrix()
					loupe.cam.updateMatrixWorld()
					// ring at depth D in front of the main camera, sized to the mask
					const D = 2
					const h = D * Math.tan( fovRad / 2 )
					ringGroup.position.set( ( c.x * 2 - 1 ) * h * camera.aspect, ( 1 - c.y * 2 ) * h, -D )
					ringGroup.scale.setScalar( r * 2 * h )
					// the tag sits left of the lens, over the dark room rather than the statue
					const lensPx = r * stage.size.height
					const leftOk = c.x * stage.size.width - lensPx > 170
					setStyle( loupeTag, 'left', `${Math.round( c.x * stage.size.width + ( leftOk ? -lensPx - 14 : lensPx + 14 ) )}px` )
					setStyle( loupeTag, 'top', `${Math.round( c.y * stage.size.height )}px` )
					setStyle( loupeTag, 'transform', leftOk ? 'translate(-100%,-50%)' : 'translate(0,-50%)' )
				}
			},
			dispose() {
				stack.dispose()
				exact.dispose()
				ringGroup.removeFromParent()
				ring.dispose()
				loupeTag.remove()
				for ( const o of [plinth, cone, rule] ) o.dispose()
				for ( const tx of texts ) tx.dispose()
				ride.dispose()
				counter.dispose()
			},
		}
	},
}

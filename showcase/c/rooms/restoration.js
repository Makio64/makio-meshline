/**
 * IV · The Restoration — Marcus Aurelius in bronze rings, wrapped by a sash, split by a
 * restorer's divider. Left: the v1.2.3 look (flat billboard strip, butt ends, fold: false rings).
 * Right: v2 (lit banked surface() sash, round joins + round caps, default fold, antialiased rings).
 * NOTE: the left half is faked with today's API, not vendored v1.2.3 code.
 */
import { easeOutCubic } from '@shared/math.js'
import { BASELINE, num } from '@shared/numbers.js'
import { createRingStack } from '@shared/statues.js'
import { MeshLine } from 'makio-meshline'
import { float, Fn, min, smoothstep } from 'three/tsl'
import { ClippingGroup, DoubleSide, Group, Plane, Vector3 } from 'three/webgpu'

import { besideRest, C, capsText, clamp01, FLOOR_Y, goldCount, goldText, lineText, pinToCamera, plinthLine, restCamWorld, roomRings, spotCone } from '../kit.js'

const width = num( 'width100' )
const joins = num( 'joins' )
const caps = num( 'caps' )
const roundCap = num( 'roundCap16' )

const CORNERS = [[-140, 0.5], [-76, 0.46], [-38, 0.22], [0, 0.4], [38, 0.22], [76, 0.46], [140, 0.5]]
const LEG = 14 // points per leg

/** Sash path hugging the bust: legs follow the surface, corners stay sharp. */
function sashPath( shape ) {
	const { rings, samples, positions } = shape
	const corners = CORNERS
	const surf = ( deg, rf ) => {
		const a = ( ( deg + 90 ) / 360 ) * samples
		const s = ( ( a % samples ) + samples ) % samples
		const s0 = Math.floor( s )
		const s1 = ( s0 + 1 ) % samples
		const fs = s - s0
		const r = rf * ( rings - 1 )
		const r0 = Math.min( rings - 2, Math.floor( r ) )
		const fr = r - r0
		const p = [0, 0, 0]
		for ( let c = 0; c < 3; c++ ) {
			const A = positions[( r0 * samples + s0 ) * 3 + c] * ( 1 - fs ) + positions[( r0 * samples + s1 ) * 3 + c] * fs
			const B = positions[( ( r0 + 1 ) * samples + s0 ) * 3 + c] * ( 1 - fs ) + positions[( ( r0 + 1 ) * samples + s1 ) * 3 + c] * fs
			p[c] = A * ( 1 - fr ) + B * fr
		}
		const l = Math.hypot( p[0], p[2] ) || 1
		p[0] += ( p[0] / l ) * 0.55
		p[2] += ( p[2] / l ) * 0.55
		return p
	}
	const pts = []
	for ( let i = 0; i < corners.length - 1; i++ ) {
		const [a0, h0] = corners[i]
		const [a1, h1] = corners[i + 1]
		for ( let j = 0; j < LEG; j++ ) {
			const t = j / LEG
			pts.push( ...surf( a0 + ( a1 - a0 ) * t, h0 + ( h1 - h0 ) * t ) )
		}
	}
	pts.push( ...surf( ...corners[corners.length - 1] ) )
	return new Float32Array( pts )
}

export default {
	slug: 'restoration',
	title: 'The Restoration',
	numeral: 'IV',
	rest: { radius: 25.5, theta: -0.04, phi: 0.07, tx: 0.4, ty: 0.2, ptx: 0, pty: -2 },
	footnote: `left half: the ${BASELINE} look, simulated with v2's API · drag the divider`,

	async create( ctx, root, room ) {
		const { renderer, camera, stage } = ctx
		const aurelius = await roomRings( 'aurelius' )
		const path = sashPath( aurelius )
		const SASH = 0x9c2236

		const planeL = new Plane()
		const planeR = new Plane()
		const left = new ClippingGroup()
		left.clippingPlanes = [planeL]
		const right = new ClippingGroup()
		right.clippingPlanes = [planeR]
		root.add( left, right )

		// before (left): fold:false rings, flat billboard strip, butt ends, plain miter
		const ringsOld = createRingStack( [aurelius], { lineWidth: 0.034, intensity: 0.9 } )
		ringsOld.line.join( { type: 'miter', fold: false } )
		// the documented v1.2.3 pinch (71% width at a sharp bend), drawn at the five W corners
		// (arc-length progress of each corner, as the billboard's progress attribute measures it)
		const pinch = 1 - width.nums[0] / 100
		const arc = [0]
		for ( let i = 1; i < path.length / 3; i++ ) arc.push( arc[i - 1] + Math.hypot( path[i * 3] - path[i * 3 - 3], path[i * 3 + 1] - path[i * 3 - 2], path[i * 3 + 2] - path[i * 3 - 1] ) )
		const cornerT = CORNERS.slice( 1, -1 ).map( ( _, k ) => arc[( k + 1 ) * LEG] / arc[arc.length - 1] )
		const sashOld = new MeshLine()
			.lines( path, false )
			.lineWidth( 1.0 )
			.color( SASH )
			.join( { type: 'miter', fold: false } )
			.widthFn( Fn( ( [w, progress] ) => {
				const toCorner = cornerT.reduce( ( d, c ) => min( d, progress.sub( c ).abs() ), float( 1 ) )
				return w.mul( float( 1 ).sub( smoothstep( 0.014, 0, toCorner ).mul( pinch ) ) )
			} ) )
			.colorFn( Fn( ( [col] ) => col.mul( 0.75 ) ) )
			.autoResize()
		left.add( ringsOld.line, sashOld )

		// after (right): default fold rings + antialias, lit surface sash with round joins and caps
		const ringsNew = createRingStack( [aurelius], { lineWidth: 0.034, intensity: 1.2, antialias: true } )
		const sashNew = new MeshLine()
			.lines( path, false )
			.lineWidth( 1.0 )
			.color( SASH )
			.surface( { frame: 'transport', uvMode: 'distance', uvScale: 2, roughness: 0.32, metalness: 0.2, side: DoubleSide } )
			.join( { type: 'round', segments: 10, inner: 'clip' } )
			.cap( { type: 'round', segments: 12 } )
			.build()
		sashNew.material.emissive.set( 0x2a0710 )
		right.add( ringsNew.line, sashNew )

		const plinth = plinthLine( { w: 5.6, h: 1.2, opacity: 0.45 } )
		const cone = spotCone( new Vector3( 0.5, 17.5, 3 ), new Vector3( 0, FLOOR_Y, 0 ), 5, { intensity: 0.4 } )
		root.add( plinth, cone )

		//---------------------------------------------------------- divider (camera child)
		const divider = new MeshLine()
			.lines( [new Float32Array( [0, -1, 0, 0, 1, 0] ), new Float32Array( [-0.012, 0, 0, 0, 0.02, 0, 0.012, 0, 0, 0, -0.02, 0, -0.012, 0, 0] )], false )
			.lineWidth( 1.4 )
			.sizeAttenuation( false )
			.color( C.gold )
			.colorFn( Fn( ( [col] ) => col.mul( 1.8 ) ) )
			.autoResize()
		divider.build()
		divider.material.depthTest = false
		divider.material.transparent = true
		divider.renderOrder = 998
		divider.frustumCulled = false
		divider.layers.set( 1 )
		divider.visible = false // shown by update() while the room is on screen
		camera.add( divider )

		//---------------------------------------------------------- plaques
		const before = new Group()
		const oldTag = await capsText( renderer, BASELINE, 0.21, { align: 'right' } )
		oldTag.position.set( 0, 2.1, 0 )
		const oldN = await goldText( renderer, `${width.nums[0]}%`, 2.3, { align: 'right', glow: 0.55 } )
		oldN.position.set( 0, 0.5, 0 )
		const oldL = await capsText( renderer, 'width at 90°', 0.17, { align: 'right' } )
		oldL.position.set( 0, -0.95, 0 )
		before.add( oldTag, oldN, oldL )
		root.add( before )

		const after = new Group()
		const headline = await lineText( renderer, 'Restored: every bend, full width.', 0.6, { align: 'left' } )
		headline.position.set( 0, 3.5, 0 )
		const newTag = await capsText( renderer, 'v2', 0.21, { align: 'left' } )
		newTag.position.set( 0, 2.1, 0 )
		const newN = await goldCount( renderer, '000%', `${width.nums[1]}%`, 2.3, { align: 'left', glow: 1.6 } )
		newN.position.set( -0.05, 0.5, 0 )
		const newL = await capsText( renderer, 'width at 90°', 0.17, { align: 'left' } )
		newL.position.set( 0, -0.95, 0 )
		const joinsN = await goldText( renderer, joins.value, 0.62, { align: 'left' } )
		joinsN.position.set( 0, -2.0, 0 )
		const joinsL = await capsText( renderer, 'joins', 0.15, { align: 'left' } )
		joinsL.position.set( 0, -2.58, 0 )
		const capsN = await goldText( renderer, caps.value, 0.62, { align: 'left' } )
		capsN.position.set( 2.4, -2.0, 0 )
		const capsL = await capsText( renderer, 'caps', 0.15, { align: 'left' } )
		capsL.position.set( 2.4, -2.58, 0 )
		const rcN = await goldText( renderer, roundCap.value, 0.62, { align: 'left' } )
		rcN.position.set( 0, -3.45, 0 )
		const rcL = await capsText( renderer, 'verts per round cap', 0.15, { align: 'left' } )
		rcL.position.set( 0, -4.03, 0 )
		after.add( headline, newTag, newN, newL, joinsN, joinsL, capsN, capsL, rcN, rcL )
		root.add( after )

		const dimTexts = [oldTag, oldL, newTag, newL, joinsL, capsL, rcL]
		let wasPortrait = false
		const brightTexts = [headline, joinsN, capsN, rcN]

		//---------------------------------------------------------- state
		let dragX = null // NDC while dragging / after a drag
		let dragging = false
		const p1 = new Vector3()
		const p2 = new Vector3()
		const pr = new Vector3()
		const n = new Vector3()
		const camTarget = new Vector3()
		const camRight = new Vector3()
		const anchor = new Vector3()
		const EDGE = ( aurelius.radius || 3.6 ) * 1.25 + 0.55 // past the sash on either side
		const onDown = ( e ) => {
			if ( !root.visible || !divider.visible ) return
			const x = ( e.clientX / stage.size.width ) * 2 - 1
			if ( Math.abs( x - currentX ) * stage.size.width * 0.5 < 60 ) dragging = true
		}
		const onMove = ( e ) => {
			if ( !dragging ) return
			dragX = Math.max( -0.98, Math.min( 0.98, ( e.clientX / stage.size.width ) * 2 - 1 ) )
		}
		const onUp = () => { dragging = false }
		window.addEventListener( 'pointerdown', onDown )
		window.addEventListener( 'pointermove', onMove )
		window.addEventListener( 'pointerup', onUp )
		let currentX = 0

		return {
			hidden() { divider.visible = false },
			update( f ) {
				const portrait = ctx.portrait()
				if ( portrait !== wasPortrait ) {
					// phone: v1.2.3 | v2 as two columns under the horizon (left half | right half), the
					// headline and the joins / caps / +16 row spanning both
					wasPortrait = portrait
					const L = portrait ? -5.25 : 0
					headline.position.set( L, 3.5, 0 )
					joinsN.position.set( L, -2.0, 0 )
					joinsL.position.set( L, -2.58, 0 )
					capsN.position.set( L + 2.4, -2.0, 0 )
					capsL.position.set( L + 2.4, -2.58, 0 )
					rcN.position.set( portrait ? L + 4.8 : 0, portrait ? -2.0 : -3.45, 0 )
					rcL.position.set( portrait ? L + 4.8 : 0, portrait ? -2.58 : -4.03, 0 )
				}
				if ( portrait ) {
					pinToCamera( after, camera, root, { x: 0.06, y: -0.52, width: 10, local: f.local } )
					pinToCamera( before, camera, root, { x: -0.06, y: -0.52, width: 10, local: f.local } )
				} else {
					besideRest( room.def.rest, -6.2, 0.4, before.position, 1 )
					besideRest( room.def.rest, 6.0, 0.4, after.position, 1 )
					before.scale.setScalar( 1 )
					after.scale.setScalar( 1 )
					restCamWorld( room.def.rest, root, camTarget )
					before.lookAt( camTarget )
					after.lookAt( camTarget )
				}

				// divider: the bust's right edge (all v1.2.3) → its centre on arrival → its left edge (all
				// v2) when leaving. Anchored to the bust in world space, so it travels with it through the
				// transitions instead of crossing the empty doorway on its own.
				const arrive = easeOutCubic( clamp01( ( f.local + 1 ) / 0.9 ) )
				const leave = easeOutCubic( clamp01( f.local / 0.9 ) )
				camRight.setFromMatrixColumn( camera.matrixWorld, 0 ).setY( 0 ).normalize()
				anchor.copy( camRight ).multiplyScalar( EDGE * ( 1 - arrive ) - EDGE * leave ).add( root.position )
				anchor.y += 0.5
				let x = anchor.project( camera ).x
				if ( Math.abs( f.local ) > 0.5 ) dragX = null
				if ( dragX !== null ) x = dragX
				currentX = x

				// world plane through the eye and the divider's screen column (main.js updated the camera)
				p1.set( x, -1, 0.5 ).unproject( camera ).sub( camera.position )
				p2.set( x, 1, 0.5 ).unproject( camera ).sub( camera.position )
				n.crossVectors( p1, p2 ).normalize()
				planeR.setFromNormalAndCoplanarPoint( n, camera.position )
				pr.set( Math.min( 1, x + 0.5 ), 0, 0.5 ).unproject( camera )
				if ( planeR.distanceToPoint( pr ) < 0 ) planeR.negate()
				planeL.copy( planeR ).negate()

				const fovRad = ( camera.fov * Math.PI ) / 180
				const D = 2
				const h = D * Math.tan( fovRad / 2 )
				// phone: the divider stops at the horizon instead of slicing the plaques below it
				const span = portrait ? 0.6 : 1
				divider.position.set( x * h * camera.aspect, ( 1 - span ) * h, -D )
				divider.scale.set( h, h * span, 1 )
				divider.visible = Math.abs( f.local ) < 0.98 && x > -1 && x < 1

				// right plaque counts 71 → 100 as v2 takes the room
				const share = clamp01( ( 1 - x ) / 1 )
				const k = clamp01( share ) * clamp01( f.presence * 1.5 )
				newN.set( Math.round( width.nums[0] + ( width.nums[1] - width.nums[0] ) * k ), k < 0.98 ? 0.2 : 0, k >= 0.98 )
				const a = Math.pow( f.presence, 1.5 )
				newN.opacityValue = a
				oldN.opacity.value = a * 0.5
				for ( const tx of dimTexts ) tx.opacity.value = a * 0.7
				for ( const tx of brightTexts ) tx.opacity.value = a
				headline.reveal.value = clamp01( f.presence * 1.5 - 0.4 )
				cone.uIntensity.value = 0.4 * f.presence
				ctx.hint( Math.abs( f.local ) < 0.05 && dragX === null ? 'drag the divider' : '' )
			},
			dispose() {
				window.removeEventListener( 'pointerdown', onDown )
				window.removeEventListener( 'pointermove', onMove )
				window.removeEventListener( 'pointerup', onUp )
				divider.removeFromParent()
				divider.dispose()
				ringsOld.dispose()
				ringsNew.dispose()
				for ( const o of [sashOld, sashNew, plinth, cone] ) o.dispose()
				for ( const tx of [...dimTexts, ...brightTexts, oldN] ) tx.dispose()
				newN.dispose()
			},
		}
	},
}

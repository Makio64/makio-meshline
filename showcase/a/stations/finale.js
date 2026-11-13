/**
 * 08 · One Line — the far pull-back: the whole spine is one luminous filament threading every
 * station (each shown as a cheap dimmed fossil). A MeshLineCompute nebula swirls around it
 * (WebGPU only), the release numbers return, and the install line closes the loop.
 */
import { clamp, remap } from '@shared/math.js'
import { MeshLine, MeshLineCompute } from 'makio-meshline'
import { color, float, Fn, instanceIndex, mix, smoothstep, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import { monument, num, text } from '../type.js'

export default async function build( st, ctx ) {
	const { renderer, spine, stage, camera } = ctx
	st.fog = [520, 900]
	st.bloom = 0.7
	st.rideIn = st.anchorS - st.half
	st.rideOut = st.anchorS
	st.headS = spine.length + 12

	const { center, size } = spine.bounds()
	const radius = 0.5 * Math.hypot( size.x, size.y, size.z )
	const dir = new Vector3( 0.2, 1.0, 0.95 ).normalize()
	const TAN = Math.tan( ( 50 * Math.PI ) / 360 ) // rest FOV
	const fit = ( w, h ) => Math.max( h / 2 / TAN, w / 2 / ( TAN * camera.aspect ) )
	st.pose = ( p, pos, look ) => {
		const portrait = st.isPortrait()
		const d = portrait ? fit( size.x, size.z ) * 0.98 : Math.max( ( radius / Math.sin( ( 50 * Math.PI ) / 360 ) ) * 0.92, fit( size.x, size.z ) * 0.84 )
		pos.copy( center ).addScaledVector( dir, d )
		// look a little toward the viewer so the filament sits high and the install line gets the bottom band
		look.copy( center ).add( portrait ? new Vector3( 0, -18, 6 ) : new Vector3( 0, -18, 30 ) )
	}

	//------------------------------------------------------------------ station markers: one multi-line MeshLine (a ring at every anchor)
	const rings = ctx.stations.slice( 0, -1 ).map( ( s ) => {
		const c = new Float32Array( 64 * 3 )
		for ( let i = 0; i < 64; i++ ) {
			const a = ( i / 64 ) * Math.PI * 2
			c[i * 3] = s.anchor.x + Math.cos( a ) * 4.5
			c[i * 3 + 1] = s.anchor.y
			c[i * 3 + 2] = s.anchor.z + Math.sin( a ) * 4.5
		}
		return c
	} )
	const markers = new MeshLine()
		.lines( rings, true )
		.sizeAttenuation( false )
		.lineWidth( 1.5 )
		.color( new Color( 0xe9e3d6 ).multiplyScalar( 0.9 ) )
		.dash( { count: 16, ratio: 0.5 } )
		.build()
	st.group.add( markers )

	//------------------------------------------------------------------ the nebula (WebGPU compute)
	let nebula = null
	const raycaster = new Raycaster()
	const plane = new Plane( new Vector3( 0, 1, 0 ), -center.y )
	const hit = new Vector3()
	const local = new Vector3()
	const ndc = new Vector2()
	if ( stage.isWebGPU ) {
		nebula = new MeshLineCompute( {
			curveCount: num( 'computeCurves' ).nums[0],
			pointsPerCurve: num( 'computeCurves' ).nums[1],
			curveLength: 5,
			bounds: 13,
			damping: 0.94,
			curlStrength: 0.8,
			flowSpeed: 0.45,
			homeStrength: 2.2,
			mouseStrength: 12,
			mouseRadius: 6,
			mode: 'autonomous',
			lineWidth: 1.6,
			sizeAttenuation: false,
		} )
		const count = num( 'computeCurves' ).nums[0]
		nebula
			.widthFn( Fn( ( [w, progress] ) => w.mul( smoothstep( 0, 0.2, progress ).mul( float( 1 ).sub( smoothstep( 0.7, 1, progress ) ) ).mul( 0.9 ).add( 0.1 ) ) ) )
			.colorFn( Fn( ( [, progress] ) => {
				const r = float( instanceIndex ).div( count - 1 )
				const tint = mix( mix( color( 0x22d3ee ), color( 0xf472b6 ), smoothstep( 0.2, 0.6, r ) ), color( 0xf5d0fe ), smoothstep( 0.6, 1, r ) )
				return vec4( tint.mul( float( 1 ).sub( progress.mul( 0.4 ) ) ).mul( 0.32 ), 1 )
			} ) )
			.transparent( true )
			.build()
		nebula.material.blending = AdditiveBlending
		nebula.material.depthWrite = false
		nebula.position.copy( center )
		nebula.scale.setScalar( 4.6 )
		nebula.frustumCulled = false
		st.group.add( nebula )
	}

	//------------------------------------------------------------------ numbers in the foreground
	const tests = await monument( renderer, num( 'tests366' ).value, 'automated tests', { size: 3.2, captionSize: 0.5, align: 'left' } )
	const demos = await monument( renderer, num( 'demos' ).value, 'gallery demos', { size: 2.0, captionSize: 0.5, align: 'left' } )
	const classes = await monument( renderer, num( 'classes' ).value, 'exported classes', { size: 2.0, captionSize: 0.5, align: 'right' } )
	const typed = await monument( renderer, num( 'typedExports' ).value, 'typed exports', { size: 2.0, captionSize: 0.5, align: 'right' } )
	const one = await text( renderer, 'One line.', { size: 2.4, glow: 1.3 } )
	const install = await text( renderer, 'pnpm add makio-meshline', { kind: 'line', size: 0.95, css: { fontFamily: 'JetBrains Mono', fontWeight: 400, letterSpacing: '0' } } )
	const D = 46
	st.hud( tests, [-27, 12.5], [-0.88, 0.8, 0.8], D )
	st.hud( demos, [-27, 4.6], [-0.88, 0.58, 0.9], D )
	st.hud( classes, [27, 12.5], [0.9, 0.8, 0.9], D )
	st.hud( typed, [27, 4.6], [0.9, 0.58, 0.9], D )
	st.hud( one, [0, -14.8], [0, -0.58, 0.9], D )
	st.hud( install, [0, -18.6], [0, -0.74, 0.95], D )

	// the install pill: a rounded-rectangle MeshLine around the command
	const pillW = install.width + 2.2
	const pillH = 2.2
	const pill = []
	const R = pillH / 2
	for ( let i = 0; i < 96; i++ ) {
		const a = ( i / 96 ) * Math.PI * 2
		const cx = Math.cos( a ) >= 0 ? pillW / 2 - R : -( pillW / 2 - R )
		pill.push( cx + Math.cos( a ) * R, Math.sin( a ) * R, 0 )
	}
	const pillLine = new MeshLine()
		.lines( new Float32Array( pill ), true )
		.lineWidth( 0.07 )
		.color( new Color( 0x22d3ee ).multiplyScalar( 1.6 ) )
		.build()
	st.group.add( pillLine )
	st.onLayout = () => {
		pillLine.position.copy( install.position )
		pillLine.quaternion.copy( install.quaternion )
		pillLine.scale.copy( install.scale )
	}

	// counts land in sequence along the spine
	let seqK = 0
	const seq = ( i ) => clamp( remap( seqK, 0.2 + i * 0.12, 0.6 + i * 0.12, 0, 1 ), 0, 1 )
	let time = 0
	let stepped = 0
	st.update = ( { t, dt } ) => {
		time += dt
		const k = clamp( remap( t, -0.75, 0, 0, 1 ), 0, 1 )
		const here = clamp( 1 + t * 1.2, 0, 1 )
		seqK = k
		tests.setPresence( here * seq( 0 ), seq( 0 ) )
		demos.setPresence( here * seq( 1 ), seq( 1 ) )
		classes.setPresence( here * seq( 2 ), seq( 2 ) )
		typed.setPresence( here * seq( 3 ), seq( 3 ) )
		one.opacity.value = here * seq( 2 )
		one.reveal.value = seq( 2 )
		install.opacity.value = here * seq( 3 )
		install.reveal.value = seq( 3 )
		pillLine.visible = seq( 3 ) > 0.5
		markers.material.dashOffset.value = time * 0.02
		markers.visible = k > 0.05
		if ( nebula ) {
			ndc.set( stage.pointer.x, stage.pointer.y )
			raycaster.setFromCamera( ndc, camera )
			if ( raycaster.ray.intersectPlane( plane, hit ) ) nebula.mouse( nebula.worldToLocal( local.copy( hit ) ) )
			nebula.step( renderer, Math.min( dt, 1 / 30 ) )
			stepped++
		}
	}
	/** Loader: dispatch the nebula once so its compute pipelines exist before the first scroll. */
	st.warm = () => { nebula?.step( renderer, 1 / 60 ) }
	st.debug = { nebula, get stepped() { return stepped } }
}

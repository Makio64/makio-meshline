/**
 * 06 · Only What's Seen — god view of the Alpine Pass from gpuCulling.js: 8 roads + 24 contour
 * tiers, 400,000 points in ONE MeshLine attached to MeshLineCullingSystem with a detached
 * cullCamera (the "ghost" of the journey camera) riding the road. Only chunks inside the
 * ghost frustum are compacted into a single indirect draw; the drawn % is read live from
 * readCullingSnapshot(). WebGL2 falls back to drawing everything (and says so).
 */
import { clamp, remap } from '@shared/math.js'
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { float, Fn, mix, positionGeometry, sin, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { Color, Group, PerspectiveCamera, Vector3 } from 'three/webgpu'

import { counter, monument, num, text } from '../type.js'

// ---- pass generator (copied from demo/src/demos/gpuCulling.js) ----
const ROAD_STRANDS = 8
const CONTOUR_STRANDS = 24
const STRANDS = ROAD_STRANDS + CONTOUR_STRANDS
const POINTS_PER_STRAND = 12_500
const GHOST_POINTS_PER_STRAND = 360
const ROAD_OFFSETS = [-3.2, -2.6, -1.6, -0.18, 0.18, 1.6, 2.6, 3.2]
const SCALE = 0.3
const PASS_NEAR = 2.5
const PASS_FAR = 62
const PASS_FOV = 56

const passRadius = ( angle ) => 58 + Math.sin( angle * 2 - 0.45 ) * 11 + Math.cos( angle * 3 + 0.7 ) * 8.5
const passHeight = ( angle ) => Math.sin( angle * 2 - 0.3 ) * 1.8 + Math.cos( angle * 3 + 0.85 ) * 0.9
const passCentre = ( angle, target ) => {
	const r = passRadius( angle )
	const x = Math.cos( angle ) * r * 1.34 + Math.sin( angle * 2 + 0.5 ) * 9
	const z = Math.sin( angle ) * r * 0.82 + Math.cos( angle * 3 - 0.3 ) * 7
	return target.set( x, passHeight( angle ), z )
}
const samplePassFrame = ( angle, centre, tangent, right ) => {
	const step = 1.5e-3
	passCentre( angle, centre )
	passCentre( angle + step, tangent )
	const dx = tangent.x - centre.x
	const dy = tangent.y - centre.y
	const dz = tangent.z - centre.z
	const len = Math.hypot( dx, dy, dz ) || 1
	tangent.set( dx / len, dy / len, dz / len )
	const rx = Math.cos( angle ) * 1.34 + Math.cos( angle * 2 + 0.5 ) * 0.18
	const rz = Math.sin( angle ) * 0.82 - Math.sin( angle * 3 - 0.3 ) * 0.14
	const rLen = Math.hypot( rx, rz ) || 1
	right.set( rx / rLen, 0, rz / rLen )
	return 0
}
const mountainProfile = ( angle, side, tier, maxTiers ) => {
	const tierFrac = ( tier + 1 ) / maxTiers
	const p1 = Math.pow( Math.max( 0, Math.cos( angle - 0.35 ) ), 2.0 ) * 22
	const p2 = Math.pow( Math.max( 0, Math.cos( angle - 1.85 ) ), 2.4 ) * 28
	const p3 = Math.pow( Math.max( 0, Math.cos( angle - 3.25 ) ), 2.0 ) * 20
	const p4 = Math.pow( Math.max( 0, Math.cos( angle - 4.65 ) ), 2.3 ) * 26
	const p5 = Math.pow( Math.max( 0, Math.cos( angle - 5.55 ) ), 2.5 ) * 18
	const sidePhase = side > 0 ? 0 : 1.1
	const ridge = 6.5
		+ ( p1 + p2 + p3 + p4 + p5 ) * ( side > 0 ? 1.0 : 0.78 )
		+ Math.sin( angle * 5 + sidePhase ) * 3.2
		+ Math.cos( angle * 9 - tier * 0.4 + sidePhase ) * 1.6
	const height = 3.6 + Math.pow( tierFrac, 1.12 ) * Math.max( 6, ridge )
	const maxSpan = side > 0 ? 32 : 21
	const spur = 1 + Math.sin( angle * 6 + tier * 0.3 + sidePhase ) * 0.08
	const lateral = ( 4.4 + tierFrac * maxSpan ) * spur
	return { lateral: side * lateral, height }
}
const buildPassStrands = ( pointsPerStrand ) => {
	const strands = []
	const centre = new Vector3()
	const tangent = new Vector3()
	const right = new Vector3()
	const outerTiers = 14
	const innerTiers = CONTOUR_STRANDS - outerTiers
	for ( let strand = 0; strand < STRANDS; strand++ ) {
		const points = new Float32Array( pointsPerStrand * 3 )
		const isRoad = strand < ROAD_STRANDS
		const roadOffset = isRoad ? ROAD_OFFSETS[strand] : 0
		const isGuardrail = isRoad && ( strand === 0 || strand === ROAD_STRANDS - 1 )
		const contourIndex = strand - ROAD_STRANDS
		const side = contourIndex < outerTiers ? 1 : -1
		const tier = side > 0 ? contourIndex : contourIndex - outerTiers
		const maxTiers = side > 0 ? outerTiers : innerTiers
		for ( let i = 0; i < pointsPerStrand; i++ ) {
			const u = ( i / pointsPerStrand ) * Math.PI * 2
			samplePassFrame( u, centre, tangent, right )
			const offset = i * 3
			if ( isRoad ) {
				points[offset] = centre.x + right.x * roadOffset
				points[offset + 1] = centre.y + ( isGuardrail ? 0.22 : 0.04 )
				points[offset + 2] = centre.z + right.z * roadOffset
			} else {
				const { lateral, height } = mountainProfile( u, side, tier, maxTiers )
				points[offset] = centre.x + right.x * lateral
				points[offset + 1] = centre.y + height
				points[offset + 2] = centre.z + right.z * lateral
			}
		}
		strands.push( points )
	}
	return strands
}
// Pastel tiers on white roads (plan A: colour only from the lines). uPassFade (0..1) fades the pass
// into the background as the station arrives / leaves (it is seen from the neighbouring pages).
const uPassFade = uniform( 1 )
const passColor = Fn( ( [baseColor, progress] ) => {
	const y = positionGeometry.y
	const road = float( 1 ).sub( smoothstep( 2.6, 3.5, y ) )
	const mid = smoothstep( 3.6, 13.5, y )
	const high = smoothstep( 12.0, 24.0, y )
	let terrain = mix( vec3( 0.13, 0.62, 0.9 ), vec3( 0.55, 0.9, 0.95 ), mid )
	terrain = mix( terrain, vec3( 0.98, 0.72, 0.9 ), high )
	const shimmer = sin( progress.mul( Math.PI * 32 ) ).mul( 0.08 ).add( 0.96 )
	return vec4( mix( terrain.mul( shimmer ), vec3( 1.0, 0.98, 0.95 ).mul( 1.6 ), road ).mul( baseColor.rgb ).mul( uPassFade ), 1 )
} )

export default async function build( st, ctx ) {
	const { renderer, scene, spine, stage } = ctx
	st.fog = [40, 150]
	st.bloom = 0.5
	st.rideIn = st.anchorS - st.half
	st.rideOut = st.anchorS + st.half
	st.hide = [( st.anchorS - st.half - 70 ) / spine.length, ( st.anchorS + st.half + 30 ) / spine.length]

	const centre = st.anchor.clone().add( new Vector3( 0, -8, 0 ) )
	// god view; portrait looks from the west side (-x) so the long axis of the pass runs up the screen
	// (west: the statue orbit ends heading west, so the crane up to here never reverses)
	const GOD = new Vector3( 0, 56, 47 )
	const GOD_PORT = new Vector3( -60, 84, 10 )
	st.fogScale = () => ( st.isPortrait() ? GOD_PORT.length() / GOD.length() : 1 )
	st.pose = ( p, pos, look ) => {
		pos.copy( centre ).add( st.isPortrait() ? GOD_PORT : GOD )
		look.copy( centre ).add( new Vector3( 0, -1, st.isPortrait() ? 0 : 1.5 ) )
	}

	//------------------------------------------------------------------ pass lines
	const ghostLine = new MeshLine()
		.lines( buildPassStrands( GHOST_POINTS_PER_STRAND ), true )
		.lineWidth( 0.22 )
		.color( new Color( 0x26486e ) )
		.transparent( true )
		.opacity( 0.3 )
		.build()
	ghostLine.frustumCulled = false
	ghostLine.renderOrder = -1
	ghostLine.position.copy( centre )
	ghostLine.scale.setScalar( SCALE )
	st.group.add( ghostLine )

	const pass = new MeshLine()
		.lines( buildPassStrands( POINTS_PER_STRAND ), true )
		.lineWidth( 0.26 )
		.color( 0xffffff )
		.colorFn( passColor )
		.join( { type: 'miter', limit: 3 } )
		.build()
	pass.position.copy( centre )
	pass.scale.setScalar( SCALE )
	st.group.add( pass )
	const indexCount = pass.geometry.getIndex().count

	//------------------------------------------------------------------ the ghost camera + its MeshLine frustum
	const ghost = new PerspectiveCamera( PASS_FOV, 1.6, PASS_NEAR * SCALE, PASS_FAR * SCALE )
	ghost.updateProjectionMatrix()
	const tanHalf = Math.tan( ( PASS_FOV * Math.PI ) / 360 )
	const nh = PASS_NEAR * SCALE * tanHalf
	const fh = PASS_FAR * SCALE * tanHalf
	const n = PASS_NEAR * SCALE
	const f = PASS_FAR * SCALE
	const corners = [[-nh, nh, -n], [nh, nh, -n], [nh, -nh, -n], [-nh, -nh, -n], [-fh, fh, -f], [fh, fh, -f], [fh, -fh, -f], [-fh, -fh, -f]]
	const pa = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]
	const pb = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]
	const edges = pa.map( ( a, i ) => new Float32Array( [...corners[a], ...corners[pb[i]]] ) )
	const frustum = new MeshLine()
		.lines( edges, false )
		.lineWidth( 0.1 )
		.color( new Color( 0x67e8f9 ).multiplyScalar( 1.25 ) )
		.build()
	frustum.frustumCulled = false
	const frustumGroup = new Group()
	frustumGroup.add( frustum )
	st.group.add( frustumGroup )

	let culling = null
	let handle = null
	if ( stage.isWebGPU ) {
		culling = MeshLineCullingSystem.attach( renderer, scene, { mode: 'auto', chunkSize: 128, cullCamera: ghost } )
		culling.cullCamera = ghost
		handle = culling.add( pass )
	}

	//------------------------------------------------------------------ type
	const glyph = await text( renderer, num( 'culled400k' ).value, { size: 6.2, glow: 1.15 } )
	glyph.traverse( ( o ) => { o.renderOrder = 5 } )
	const glyphCap = await text( renderer, 'points', { kind: 'caps', size: 0.62 } )
	st.group.add( glyph, glyphCap )

	const D = 22
	const chunks = st.hud( await monument( renderer, num( 'cullChunks' ).value, 'chunks · 128 tris', { size: 1.5, captionSize: 0.24, align: 'left' } ), [-14.6, 7.6], [-0.86, 0.82, 0.8], D )
	const draw = st.hud( await monument( renderer, num( 'oneDraw' ).value, stage.isWebGPU ? 'indirect draw' : 'WebGL2 · no compaction', { size: 1.5, captionSize: 0.24, align: 'left' } ), [-14.6, 4.5], [-0.86, 0.6, 0.8], D )
	const liveNum = st.hud( await counter( renderer, '000%', { size: 1.5, align: 'right', css: { color: '#a5f3fc' } } ), [14.6, 7.6], [0.9, -0.52, 0.8], D )
	const liveCap = st.hud( await text( renderer, stage.isWebGPU ? 'drawn · live' : 'WebGL2 · all chunks drawn', { kind: 'caps', size: 0.24, align: 'right', valign: 'top' } ), [14.6, 6.4], [0.9, -0.62, 0.8], D )
	const line = st.hud( await text( renderer, 'Only what you see is drawn.', { kind: 'line', size: 0.46 } ), [0, -8.4], [0, -0.82, 0.82], D )

	// the geoglyph lies flat on the terrain, reading along the screen
	st.onLayout = ( portrait ) => {
		if ( portrait ) {
			// reads from the west camera: top toward +x, the caption on the camera side (-x)
			glyph.rotation.set( -Math.PI / 2, -Math.PI / 2, 0, 'YXZ' )
			glyphCap.rotation.copy( glyph.rotation )
			glyph.position.copy( centre ).add( new Vector3( 1, 0.6, 0 ) )
			glyphCap.position.copy( centre ).add( new Vector3( -4.4, 0.6, 0 ) )
		} else {
			glyph.rotation.set( -Math.PI / 2, 0, 0, 'YXZ' )
			glyphCap.rotation.copy( glyph.rotation )
			glyph.position.copy( centre ).add( new Vector3( 0, 0.6, 2 ) )
			glyphCap.position.copy( centre ).add( new Vector3( 0, 0.6, 7.4 ) )
		}
	}

	// ghost opacity through the MeshLine API (material.opacity is the built uniform: assigning a
	// number to it would detach it and change nothing on screen); only when the value moves
	let ghostOpacity = 0.3
	const setGhost = ( v ) => {
		const q = Math.round( v * 1000 ) / 1000
		if ( q === ghostOpacity ) return
		ghostOpacity = q
		ghostLine.opacity( q )
	}

	//------------------------------------------------------------------ live loop
	const cpos = new Vector3()
	const tangent = new Vector3()
	const rightV = new Vector3()
	const target = new Vector3()
	let flight = 2.2
	let snapTimer = 0
	let pending = false
	let drawnPct = 100
	const readSnapshot = async () => {
		if ( !handle?.active || pending ) return
		pending = true
		try {
			const snap = await handle.readCullingSnapshot()
			if ( snap ) drawnPct = ( 100 * snap.visibleIndexCount ) / Math.max( 1, snap.indexCount )
		} catch {
			// stale snapshot: keep the previous value
		} finally {
			pending = false
		}
	}

	const flyGhost = () => {
		samplePassFrame( flight, cpos, tangent, rightV )
		passCentre( flight + 0.14, target )
		cpos.y += 3.8
		target.y += 4.6
		cpos.multiplyScalar( SCALE ).add( centre )
		target.multiplyScalar( SCALE ).add( centre )
		ghost.position.copy( cpos )
		ghost.lookAt( target )
		ghost.updateMatrixWorld()
	}
	flyGhost()

	st.update = ( { t, dt } ) => {
		// request the readback BEFORE moving the ghost: a snapshot describes the camera last culled for
		snapTimer += dt
		if ( snapTimer > 0.25 ) {
			snapTimer = 0
			readSnapshot()
		}
		flight = ( flight + dt * 0.06 ) % ( Math.PI * 2 )
		flyGhost()
		// the bright frustum only belongs to this station (neighbours can see it while it is resident)
		frustumGroup.visible = t > -0.7 && t < 0.7
		frustumGroup.position.copy( ghost.position )
		frustumGroup.quaternion.copy( ghost.quaternion )
		frustumGroup.scale.set( ghost.aspect, 1, 1 )

		const here = clamp( 1 - Math.abs( t ) * 1.6, 0, 1 )
		const k = clamp( remap( t, -0.6, 0, 0, 1 ), 0, 1 )
		liveNum.setValue( Math.round( drawnPct ) )
		liveNum.opacity.value = here
		liveCap.opacity.value = here * 0.9
		liveCap.reveal.value = k
		chunks.setPresence( here, k )
		draw.setPresence( here, k )
		line.opacity.value = here * 0.9
		line.reveal.value = k
		// the pass, its ghost and the geoglyph fade in over the first 60 % of the flight in (and out the
		// same way): the station is shown the moment the transition starts, so nothing pops
		const fade = clamp( ( 1 - Math.abs( t ) ) * 2.5, 0, 1 )
		uPassFade.value = fade
		setGhost( 0.3 * fade )
		glyph.opacity.value = ( 0.25 + 0.75 * here ) * fade
		glyph.reveal.value = k
		glyphCap.opacity.value = here * 0.8
		glyphCap.reveal.value = k
	}

	const type = [chunks, draw, liveNum, liveCap, line, glyphCap]
	st.hasFossil = true
	st.fossil = ( kf ) => {
		const on = st.resident
		pass.visible = on
		if ( !on ) frustumGroup.visible = false // update() owns it while resident
		for ( const o of type ) o.visible = on
		if ( !on ) {
			setGhost( 0.3 * kf )
			glyph.opacity.value = 0.6 * kf
			glyph.reveal.value = 1
		}
	}
	/**
	 * Loader: one warm render (the culling handle's warm-up draw), then one culling dispatch so the
	 * compute pipelines exist before the station is first shown; then pause until resident.
	 */
	st.warm = async ( warm ) => {
		if ( !culling ) {
			await warm( [st.group] )
			return
		}
		// The handle's first draw (its INDEX|STORAGE warm-up) must be the draw that creates the pass's
		// render object: a render object pre-built by compileAsync skips that geometry update, the
		// compacted index buffer is then created by the culling compute without INDEX usage and every
		// later draw fails validation. So the pass sits out the compile and is built by the warm render.
		const own = Object.prototype.hasOwnProperty.call( renderer, 'compileAsync' ) ? renderer.compileAsync : null
		const compileAsync = renderer.compileAsync
		renderer.compileAsync = function ( ...args ) {
			pass.visible = false
			try {
				return compileAsync.apply( this, args )
			} finally {
				pass.visible = true
			}
		}
		try {
			await warm( [st.group] )
		} finally {
			if ( own ) renderer.compileAsync = own
			else delete renderer.compileAsync
		}
		await culling.update( ghost ) // first culling dispatch: compute pipelines
		culling.options.autoUpdate = false // paused until resident
	}
	// pause the culling system while the station is away: no per-frame frustum work or readbacks
	// (the pass keeps its last compacted draw for the finale fossil)
	st.onResident = ( on ) => {
		if ( culling ) culling.options.autoUpdate = on
	}
	st.debug = { pass, handle, culling, ghost, indexCount, get drawnPct() { return drawnPct } }
}

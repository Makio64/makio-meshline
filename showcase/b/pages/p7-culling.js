/**
 * 07 · Draw What's Seen — the gpuCulling.js alpine pass (400,000 points, 32
 * strands) restyled as a Swiss survey print: bone contours, red road. A
 * detached pass camera glides along the road; MeshLineCullingSystem compacts
 * only the chunks inside its frustum (red hairlines) into one indirect draw.
 * The % is read live from readCullingSnapshot(). WebGL2 draws every chunk.
 */
import { damp, lerp, smoothstep } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import { float, Fn, mix, positionGeometry, smoothstep as tslSmooth, vec3, vec4 } from 'three/tsl'
import { Group, PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu'

import { header, LEFT, P, phases, placer } from '../lib/page.js'
import { C, counter, CSS, figure, mono, stat } from '../lib/type.js'

//------------------------------------------------ copied from demo/src/demos/gpuCulling.js (pure geometry)
const ROAD_STRANDS = 8
const CONTOUR_STRANDS = 24
const STRANDS = ROAD_STRANDS + CONTOUR_STRANDS
const POINTS_PER_STRAND = 12_500
const GHOST_POINTS_PER_STRAND = 360
const PASS_NEAR = 2.5
const PASS_FAR = 46 // shorter and narrower than the demo's 88 / 56° so the hairline frustum stays inside the poster
const PASS_FOV = 50
const ROAD_OFFSETS = [-3.2, -2.6, -1.6, -0.18, 0.18, 1.6, 2.6, 3.2]

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
	const hLen = Math.hypot( dx, dz ) || 1
	const prevX = Math.cos( angle - step ) * passRadius( angle - step ) * 1.34 + Math.sin( ( angle - step ) * 2 + 0.5 ) * 9
	const prevZ = Math.sin( angle - step ) * passRadius( angle - step ) * 0.82 + Math.cos( ( angle - step ) * 3 - 0.3 ) * 7
	const ddx = ( centre.x + dx ) - 2 * centre.x + prevX
	const ddz = ( centre.z + dz ) - 2 * centre.z + prevZ
	const cross = ( dx * ddz - dz * ddx ) / Math.pow( hLen, 3 )
	return Math.max( -0.28, Math.min( 0.28, cross * 32 ) )
}
const mountainProfile = ( angle, side, tier, maxTiers ) => {
	const tierFrac = ( tier + 1 ) / maxTiers
	const p1 = Math.pow( Math.max( 0, Math.cos( angle - 0.35 ) ), 2.0 ) * 22
	const p2 = Math.pow( Math.max( 0, Math.cos( angle - 1.85 ) ), 2.4 ) * 28
	const p3 = Math.pow( Math.max( 0, Math.cos( angle - 3.25 ) ), 2.0 ) * 20
	const p4 = Math.pow( Math.max( 0, Math.cos( angle - 4.65 ) ), 2.3 ) * 26
	const p5 = Math.pow( Math.max( 0, Math.cos( angle - 5.55 ) ), 2.5 ) * 18
	const sidePhase = side > 0 ? 0 : 1.1
	const ridge = 6.5 + ( p1 + p2 + p3 + p4 + p5 ) * ( side > 0 ? 1.0 : 0.78 ) + Math.sin( angle * 5 + sidePhase ) * 3.2 + Math.cos( angle * 9 - tier * 0.4 + sidePhase ) * 1.6
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
			const bank = samplePassFrame( u, centre, tangent, right )
			const offset = i * 3
			if ( isRoad ) {
				const cosB = Math.cos( bank )
				const sinB = Math.sin( bank )
				const lift = isGuardrail ? 0.22 : 0.04
				points[offset] = centre.x + right.x * roadOffset * cosB
				points[offset + 1] = centre.y + roadOffset * sinB + lift
				points[offset + 2] = centre.z + right.z * roadOffset * cosB
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
//------------------------------------------------

// survey print: red road on the valley floor, bone contours that thin out with height
const surveyColor = Fn( ( [base] ) => {
	const y = positionGeometry.y
	const road = float( 1 ).sub( tslSmooth( 2.6, 3.5, y ) )
	const bone = vec3( 0.93, 0.917, 0.89 )
	const red = vec3( 1.0, 0.176, 0.102 )
	const fade = mix( float( 1 ), float( 0.55 ), tslSmooth( 4, 30, y ) )
	return vec4( mix( bone.mul( fade ), red, road ).mul( base.rgb ), 1 )
} )

export default {
	title: "Draw What's Seen",
	subs: 1,
	async build( ctx ) {
		const group = new Group()
		// sized so the pass (x -109..119) clears the '400,000' column on the left and the dots on the right
		const SCALE = 0.084
		const terrain = new Group()
		terrain.scale.setScalar( SCALE )
		terrain.position.set( 5.6, 0.9, 0 )
		group.add( terrain )

		const ghost = new MeshLine()
			.lines( buildPassStrands( GHOST_POINTS_PER_STRAND ), true )
			.lineWidth( 0.05 )
			.color( C.bone )
			.transparent( true )
			.opacity( 0.12 )
			.autoResize()
		ghost.frustumCulled = false
		ghost.renderOrder = -1
		terrain.add( ghost )

		const line = new MeshLine()
			.lines( buildPassStrands( POINTS_PER_STRAND ), true )
			.lineWidth( 0.065 )
			.color( 0xffffff )
			.colorFn( surveyColor )
			.join( { type: 'miter', limit: 3 } )
			.autoResize()
			.build()
		terrain.add( line )
		const indexCount = line.geometry.getIndex().count

		const passCamera = new PerspectiveCamera( PASS_FOV, 16 / 9, PASS_NEAR, PASS_FAR )
		terrain.add( passCamera )

		// red hairline frustum, child of the pass camera's pose
		const tanHalf = Math.tan( ( PASS_FOV * Math.PI ) / 360 )
		const nh = PASS_NEAR * tanHalf
		const fh = PASS_FAR * tanHalf
		const a = 16 / 9
		const corners = [
			[-nh * a, nh, -PASS_NEAR], [nh * a, nh, -PASS_NEAR], [nh * a, -nh, -PASS_NEAR], [-nh * a, -nh, -PASS_NEAR],
			[-fh * a, fh, -PASS_FAR], [fh * a, fh, -PASS_FAR], [fh * a, -fh, -PASS_FAR], [-fh * a, -fh, -PASS_FAR],
		]
		const pairA = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]
		const pairB = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]
		const edges = pairA.map( ( p, i ) => new Float32Array( [...corners[p], ...corners[pairB[i]]] ) )
		const frustum = new MeshLine().lines( edges, false ).lineWidth( 0.07 ).color( C.red ).autoResize()
		frustum.frustumCulled = false
		const frustumHolder = new Group()
		frustumHolder.add( frustum )
		terrain.add( frustumHolder )

		const culling = MeshLineCullingSystem.attach( ctx.renderer, ctx.scene, { mode: 'auto', chunkSize: 128, cullCamera: passCamera } )
		const handle = culling.add( line )

		//------------------------------------------------ numbers
		const big = num( 'culled400k' )
		const chunks = num( 'cullChunks' )
		const fig = await figure( big.value, { size: 3.4, align: 'left' } )
		fig.position.set( LEFT, 6.2, 0 )
		const figLabel = await mono( 'points · 32 strands · one MeshLine', { size: 0.28 } )
		figLabel.position.set( LEFT + 0.1, 4.6, 0 )
		const sChunks = await stat( chunks.value, 'chunks of 128 triangles', { size: 1.4 } )
		sChunks.position.set( LEFT, 2.4, 0 )
		const live = await counter( '000%', { size: 2.2, color: CSS.red, align: 'left', value: 0 } )
		live.position.set( LEFT, -1.0, 0 )
		const liveLabel = await mono( ctx.stage.isWebGPU ? 'triangles drawn · live' : 'WebGL2 · all chunks drawn', { size: 0.28 } )
		liveLabel.position.set( LEFT + 0.1, -2.7, 0 )
		const kick = await mono( 'chunk frustum culling · WebGPU', { size: 0.26, color: CSS.grey } )
		kick.position.set( LEFT + 0.1, -3.4, 0 )
		group.add( fig, figLabel, sChunks, live, liveLabel, kick )

		const head = await header( 7, "Draw What's Seen", 'Only what the camera sees.' )
		group.add( head )

		//------------------------------------------------ portrait re-stack
		const lay = placer()
		lay.put( terrain, -1.0, 8.0, 0.088 ) // clear of the pager dots
		lay.put( fig, P.left, -4.4, 1.12 )
		lay.put( figLabel, P.left + 0.1, -6.6 )
		lay.put( sChunks, P.left, -9.8, 1.1 )
		lay.put( live, P.left, -13.8, 1.1 )
		lay.put( liveLabel, P.left + 0.1, -15.8 )
		lay.put( kick, P.left + 0.1, -17.0 )
		lay.on( ( p ) => head.portrait( p ) )

		//------------------------------------------------ pass camera flight (copied pose logic, simplified)
		const tangent = new Vector3()
		const right = new Vector3()
		const target = new Vector3()
		const worldQuat = new Quaternion()
		let flight = 1.2
		let percent = 0
		let pending = false
		let lastRead = 0
		let tilt = 0
		let yaw = 0 // pointer only (damped)
		let lastPercent = -1
		let lastGhost = -1
		const texts = [fig, figLabel, sChunks, liveLabel, kick]
		const readSnapshot = async () => {
			if ( pending || !handle?.active ) return
			pending = true
			try {
				const snap = await handle.readCullingSnapshot()
				if ( snap && snap.visibleIndexCount !== undefined ) percent = ( 100 * snap.visibleIndexCount ) / indexCount
			} catch {
				// snapshots are best effort
			} finally {
				pending = false
			}
		}

		return {
			group,
			handle,
			culling,
			layout: lay.apply,
			get percent() { return percent },
			// the culling compute runs from a scene hook every frame: only while this page is on screen
			onShow() { culling.options.autoUpdate = true },
			onHide() { culling.options.autoUpdate = false },
			// inspection hook (no effect unless written)
			debug: { get flight() { return flight }, set flight( v ) { flight = v }, passCamera, terrain },
			update( s ) {
				const { b, h, dim } = phases( s )
				// the survey sheet tilts up from edge-on (crane) and lays back down on the way out
				tilt = smoothstep( 0, 0.85, b ) * ( 1 - smoothstep( 0.1, 1, h ) )
				yaw = damp( yaw, ctx.pointer.x * 0.12, 2, s.dt )
				terrain.rotation.set( lerp( 0.02, 1.02, tilt ), yaw * s.focus, 0 )
				terrain.visible = tilt > 0.01
				const ghostA = 0.12 * dim
				if ( ghostA !== lastGhost ) {
					lastGhost = ghostA
					ghost.opacity( ghostA )
				}

				// read before moving: a snapshot describes the pose the last frame was culled for. Twice a
				// second, and only while the page is read (each read maps a small staging buffer)
				if ( s.focus > 0.5 && s.wall < 0.01 && s.t - lastRead > 0.5 ) {
					lastRead = s.t
					readSnapshot()
				}
				// the pass camera is a small simulation (time-driven): it only runs while this page is shown
				terrain.updateMatrixWorld( true )
				terrain.getWorldQuaternion( worldQuat )
				flight += s.dt * 0.045 * ( 0.4 + s.focus )
				const bank = samplePassFrame( flight, passCamera.position, tangent, right )
				passCentre( flight + 0.14, target )
				passCamera.position.y += 3.8
				target.y += 4.6
				// lookAt works in world space: lift the banked up vector and the target out of the sheet
				passCamera.up.set( -right.x * Math.sin( bank * 0.55 ), Math.cos( bank * 0.55 ), -right.z * Math.sin( bank * 0.55 ) ).normalize().applyQuaternion( worldQuat )
				passCamera.lookAt( target.applyMatrix4( terrain.matrixWorld ) )
				passCamera.updateMatrixWorld( true )
				frustumHolder.position.copy( passCamera.position )
				frustumHolder.quaternion.copy( passCamera.quaternion )

				const tIn = smoothstep( 0.35, 0.95, b ) * ( 1 - smoothstep( 0, 0.5, h ) ) * dim
				for ( let i = 0; i < texts.length; i++ ) texts[i].fade( tIn )
				fig.reveal( smoothstep( 0.3, 0.85, b ) )
				sChunks.reveal( smoothstep( 0.5, 0.95, b ) )
				const isLive = ctx.stage.isWebGPU && handle?.active && percent > 0
				live.fade( isLive ? tIn : 0 )
				const pct = Math.round( percent )
				if ( isLive && pct !== lastPercent ) {
					lastPercent = pct
					live.setValue( pct )
				}
				head.fade( smoothstep( 0.2, 0.7, b ) * ( 1 - smoothstep( 0, 0.4, h ) ) * dim )
				head.reveal( smoothstep( 0.2, 0.8, b ) )
			},
		}
	},
}

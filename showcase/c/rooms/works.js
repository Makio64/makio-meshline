/**
 * VI · Great Works — on the wall, a gilded frame hangs the 200,000-point MeshLineGPUPath trace
 * (GPU simplification; wireframe() reveals the retained segments). In the vitrine, the 400,000-point
 * Alpine Pass is chunk-culled by MeshLineCullingSystem against a small travelling camera; culled
 * chunks fall back to a blueprint ghost. Live % comes from readCullingSnapshot().
 * Setup copied from demo/src/demos/gpuPath.js and gpuCulling.js.
 *
 * Built once behind the loader (both wireframe topologies and the culling compute are warmed
 * there). The wireframe shows across the middle of the room's plateau (scroll-driven), or while
 * the painting is hovered. Culling and snapshots only run while the room is on screen.
 */
import { easeOutCubic } from '@shared/math.js'
import { num } from '@shared/numbers.js'
import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { Fn, mix, positionGeometry, smoothstep, vec3, vec4 } from 'three/tsl'
import { Group, PerspectiveCamera, Vector3 } from 'three/webgpu'

import { besideRest, C, capsText, clamp01, FLOOR_Y, frameLine, goldText, lineText, liveCounter, pinToCamera, PLAIN, plinthLine, restCamWorld, spotCone } from '../kit.js'

const path1646 = num( 'gpuPath1646' )
const seg121 = num( 'segments121' )
const culled = num( 'culled400k' )
const drawn = num( 'drawnLive' )

//------------------------------------------------------------------ gpuPath.js data
const shared = { path: null, prepared: false }
const POINT_COUNT = 200_000
const PATH_LENGTH = 100
const LOCAL_TOLERANCE = 0.012
const createLargeOpenPath = () => {
	const points = new Float32Array( POINT_COUNT * 3 )
	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const centered = progress * 2 - 1
		const detailEnvelope = Math.exp( -centered * centered * 18 )
		points[i * 3] = centered * PATH_LENGTH * 0.5
		points[i * 3 + 1] = Math.sin( progress * Math.PI * 4 ) * 0.7
		points[i * 3 + 2] = Math.sin( progress * Math.PI * 24 ) * 2 + Math.sin( progress * Math.PI * 180 ) * detailEnvelope * 4
	}
	return points
}

//------------------------------------------------------------------ gpuCulling.js data (Alpine Pass)
const ROAD_STRANDS = 8
const CONTOUR_STRANDS = 24
const STRANDS = ROAD_STRANDS + CONTOUR_STRANDS
const POINTS_PER_STRAND = 12_500
const GHOST_POINTS = 360
const PASS_NEAR = 2.5
const PASS_FAR = 88
const PASS_FOV = 56
const ROAD_OFFSETS = [-3.2, -2.6, -1.6, -0.18, 0.18, 1.6, 2.6, 3.2]
const passRadius = ( a ) => 58 + Math.sin( a * 2 - 0.45 ) * 11 + Math.cos( a * 3 + 0.7 ) * 8.5
const passHeight = ( a ) => Math.sin( a * 2 - 0.3 ) * 1.8 + Math.cos( a * 3 + 0.85 ) * 0.9
const passCentre = ( a, target ) => {
	const r = passRadius( a )
	return target.set( Math.cos( a ) * r * 1.34 + Math.sin( a * 2 + 0.5 ) * 9, passHeight( a ), Math.sin( a ) * r * 0.82 + Math.cos( a * 3 - 0.3 ) * 7 )
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
	return { lateral: side * ( 4.4 + tierFrac * maxSpan ) * spur, height }
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
			const o = i * 3
			if ( isRoad ) {
				const lift = isGuardrail ? 0.22 : 0.04
				points[o] = centre.x + right.x * roadOffset * Math.cos( bank )
				points[o + 1] = centre.y + roadOffset * Math.sin( bank ) + lift
				points[o + 2] = centre.z + right.z * roadOffset * Math.cos( bank )
			} else {
				const { lateral, height } = mountainProfile( u, side, tier, maxTiers )
				points[o] = centre.x + right.x * lateral
				points[o + 1] = centre.y + height
				points[o + 2] = centre.z + right.z * lateral
			}
		}
		strands.push( points )
	}
	return strands
}
// museum palette: ivory road, travertine slopes warming to gold summits
const passColor = Fn( ( [baseColor] ) => {
	const y = positionGeometry.y
	const road = smoothstep( 3.5, 2.6, y )
	const terrain = mix( vec3( 0.72, 0.66, 0.58 ), vec3( 0.95, 0.72, 0.36 ), smoothstep( 6, 26, y ) )
	return vec4( mix( terrain, vec3( 1.0, 0.97, 0.9 ), road ).mul( baseColor.rgb ).mul( 1.25 ), 1 )
} )

export default {
	slug: 'works',
	title: 'Great Works',
	numeral: 'VI',
	// a little above the vitrine (the Alpine Pass reads from above) and far enough back that the
	// glass case clears the frame edge and the page dots. Phone: painting over vitrine in the lower
	// half, labels pinned on top (pradius / pty)
	rest: { radius: 31, theta: 0.04, phi: 0.2, tx: 0.9, ty: -1.1, ptx: 0, pty: 3.4, pradius: 49, pphi: 0.1 },
	stage: false,
	footnote: `${path1646.value.split( ' → ' )[1]}: CPU-oracle count, not read back · % read live`,

	async create( ctx, root, room ) {
		const { renderer, camera, stage, isWebGPU } = ctx

		//---------------------------------------------------------- painting: GPU path in a gilded frame
		const S_PAINT = 0.14
		const painting = new Group()
		painting.position.set( -6.6, 4.4, -4 )
		root.add( painting )
		const canvas = new Group()
		canvas.scale.setScalar( S_PAINT )
		canvas.rotation.x = -Math.PI / 2 // z wiggles become vertical on the wall
		painting.add( canvas )
		// one GPU path per session: MeshLineGPUPath.dispose() leaves its storage buffers allocated
		// (~6.5 MB per build), so the room borrows it instead of rebuilding it on every visit
		if ( !shared.path ) {
			shared.path = new MeshLineGPUPath( {
				lines: createLargeOpenPath(),
				lineWidth: 0.034,
				color: C.ivory,
				wireframe: false,
				join: { type: 'miter', limit: 3, segments: 8 },
				cap: { type: 'butt', segments: 8 },
			}, {
				chunkSegments: 128,
				simplify: { localTolerance: LOCAL_TOLERANCE },
				variableTopology: false,
			} )
		}
		const path = shared.path
		canvas.add( path )
		path.resize( stage.size.width, stage.size.height )
		if ( !shared.prepared ) shared.prepared = await path.prepare( renderer, camera )
		const prepared = shared.prepared
		const W = PATH_LENGTH * S_PAINT + 1.0
		const H = 12 * S_PAINT + 1.6
		const frames = [0, 0.32, 0.56].map( ( d, i ) => frameLine( W + d, H + d, { lineWidth: i === 1 ? 0.07 : 0.03, intensity: i === 1 ? 1.5 : 1.0 } ) )
		painting.add( ...frames )

		//---------------------------------------------------------- vitrine: 400K-point Alpine Pass, chunk-culled
		const S = 0.052
		const vitrine = new Group()
		vitrine.position.set( 6.6, -4.9, 2.4 )
		root.add( vitrine )
		const model = new Group()
		model.scale.setScalar( S )
		vitrine.add( model )
		const ghost = new MeshLine()
			.lines( buildPassStrands( GHOST_POINTS ), true )
			.lineWidth( 0.02 )
			.color( C.blue )
			.transparent( true )
			.opacity( 0.42 )
		ghost.frustumCulled = false
		ghost.renderOrder = -1
		model.add( ghost )
		const pass = new MeshLine()
			.lines( buildPassStrands( POINTS_PER_STRAND ), true )
			.lineWidth( 0.022 )
			.color( 0xffffff )
			.colorFn( passColor )
			.join( { type: 'miter', limit: 3 } )
			.build()
		model.add( pass )
		const indexCount = pass.geometry.getIndex().count
		// glass box on its plinth (the plinth runs from the floor up to the glass)
		const box = plinthLine( { w: 13.6, h: 3.4, y: 0.6, opacity: 0.28, lineWidth: 0.025 } )
		box.scale.set( 1, 1, 0.68 )
		box.position.y = -0.6
		const base = plinthLine( { w: 13.6, h: vitrine.position.y - FLOOR_Y, y: FLOOR_Y, opacity: 0.45 } )
		base.scale.set( 1, 1, 0.68 )
		vitrine.add( box )
		root.add( base )
		base.position.set( vitrine.position.x, 0, vitrine.position.z )

		// museum lighting, like every other room: one cone on the painting, one on the vitrine
		const cones = [
			spotCone( new Vector3( -6.6, 17, 1.5 ), new Vector3( -6.6, 2.2, -4 ), 7.4, { count: 56, intensity: 0.34 } ),
			spotCone( new Vector3( 7.4, 17.5, 4.5 ), new Vector3( 7.2, FLOOR_Y, 2.4 ), 6.2, { count: 56, intensity: 0.3 } ),
		]
		root.add( ...cones )

		// travelling cull camera + its frustum outline
		const passCam = new PerspectiveCamera( PASS_FOV, 1.6, PASS_NEAR * S, PASS_FAR * S )
		const tanHalf = Math.tan( ( PASS_FOV * Math.PI ) / 360 )
		const nh = PASS_NEAR * S * tanHalf
		const fh = PASS_FAR * S * tanHalf
		const nz = -PASS_NEAR * S
		const fz = -PASS_FAR * S
		const corners = [[-nh, nh, nz], [nh, nh, nz], [nh, -nh, nz], [-nh, -nh, nz], [-fh, fh, fz], [fh, fh, fz], [fh, -fh, fz], [-fh, -fh, fz]]
		const pa = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3]
		const pb = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7]
		const frustum = new MeshLine()
			.lines( pa.map( ( a, i ) => new Float32Array( [...corners[a], ...corners[pb[i]]] ) ), false )
			.lineWidth( 0.018 )
			.color( 0x67e8f9 )
			.autoResize()
		const frustumGroup = new Group()
		frustumGroup.add( frustum )
		root.add( frustumGroup )

		let culling = null
		let handle = null
		if ( isWebGPU ) {
			culling = MeshLineCullingSystem.attach( renderer, ctx.scene, { mode: 'auto', chunkSize: 128, cullCamera: passCam } )
			handle = culling.add( pass )
		}

		//---------------------------------------------------------- labels
		const wallLabel = new Group()
		const headline = await lineText( renderer, 'Masterpieces at scale. One draw each.', 0.6, { align: 'left' } )
		headline.position.set( 0, 0, 0 )
		const pathN = await goldText( renderer, path1646.value, 0.9, { align: 'left' } )
		pathN.position.set( 0, -1.3, 0 )
		const pathL = await capsText( renderer, 'points → segments', 0.16, { align: 'left' } )
		pathL.position.set( 0, -2.1, 0 )
		const segN = await goldText( renderer, seg121.value, 2.2, { align: 'left', glow: 1.6 } )
		segN.position.set( -0.1, -4.0, 0 )
		const segL = await capsText( renderer, 'fewer segments', 0.16, { align: 'left' } )
		segL.position.set( 0, -5.45, 0 )
		wallLabel.add( headline, pathN, pathL, segN, segL )
		wallLabel.position.set( -13.6, 1.0, -3.6 )
		root.add( wallLabel )

		const vitrineLabel = new Group()
		const culledN = await goldText( renderer, culled.value, 0.95, { align: 'left' } )
		culledN.position.set( 0, 0, 0 )
		const culledL = await capsText( renderer, 'points · GPU-culled', 0.16, { align: 'left' } )
		culledL.position.set( 0, -0.8, 0 )
		const liveN = await liveCounter( renderer, '000%', 0.8, { align: 'left' } )
		liveN.position.set( 0, -1.85, 0 )
		const liveL = await capsText( renderer, isWebGPU ? 'drawn · live' : 'WebGPU only · WebGL2 draws all', 0.16, { align: 'left' } )
		liveL.position.set( 0, -2.65, 0 )
		vitrineLabel.add( culledN, culledL, liveN, liveL )
		root.add( vitrineLabel )

		//---------------------------------------------------------- state
		let flight = 2.35
		let wire = false
		let snapTimer = 0
		let snapPending = false
		let livePct = isWebGPU ? null : 100 // null until the first culling snapshot lands
		let wasPortrait = false
		const centre = new Vector3()
		const tangent = new Vector3()
		const right = new Vector3()
		const target = new Vector3()
		const camTarget = new Vector3()
		const offResize = stage.onResize( ( w, h ) => path.resize( w, h ) )

		const readSnapshot = async () => {
			if ( !handle?.active || snapPending ) return
			snapPending = true
			try {
				const snap = await handle.readCullingSnapshot()
				if ( snap ) livePct = ( 100 * snap.visibleIndexCount ) / Math.max( 1, indexCount )
			} catch {
				// a stale snapshot is refused: try again next tick
			} finally {
				snapPending = false
			}
		}

		const allText = [headline, pathN, pathL, segN, segL, culledN, culledL, liveN, liveL]
		const dimText = [pathL, segL, culledL, liveL]

		// WebGPU: the CPU fallback (a second 200K-point line) is never drawn; keep it out of the scene
		// so the warm-up does not upload it to the GPU (re-attached if the GPU path ever fails)
		const fallback = path.fallback
		if ( prepared && fallback?.parent === path ) path.remove( fallback )

		// warm-up behind the loader, as one real frame (not compileAsync: its object hooks would mark
		// the culled pass as warmed up without the INDEX|STORAGE draw its culling compute needs first).
		// The wireframe topology (line list) is its own pipeline; the final warm compiles the solid one.
		// Only the GPU path toggles it: on the CPU fallback (WebGL2) wireframe() rebuilds a 200K-point
		// MeshLine (a ~1 s stall each time), so there the painting stays solid.
		const canWire = !!prepared
		if ( canWire ) path.wireframe( true )
		ctx.renderOnce?.( [root] )
		if ( canWire ) path.wireframe( false )

		return {
			update( f ) {
				const portrait = ctx.portrait()
				if ( portrait !== wasPortrait ) {
					// phone: painting stacked over the vitrine, both centred; 121× beside 1,646
					wasPortrait = portrait
					painting.position.set( portrait ? 0 : -6.6, portrait ? 6.6 : 4.4, -4 )
					painting.scale.setScalar( portrait ? 0.82 : 1 )
					vitrine.position.x = portrait ? 0 : 6.6
					base.position.x = vitrine.position.x
					cones[0].position.x = portrait ? 6.6 : 0
					cones[1].position.x = portrait ? -7.2 : 0
					segN.position.set( portrait ? 7.1 : -0.1, portrait ? -1.3 : -4.0, 0 )
					segN.scale.setScalar( portrait ? 0.42 : 1 )
					segL.position.set( portrait ? 7.1 : 0, portrait ? -2.1 : -5.45, 0 )
					if ( !portrait ) {
						wallLabel.position.set( -13.6, 1.0, -3.6 )
						wallLabel.quaternion.identity()
						wallLabel.scale.setScalar( 1 )
					}
				}
				if ( portrait ) {
					pinToCamera( wallLabel, camera, root, { y: 0.72, width: 10.6, local: f.local } )
					pinToCamera( vitrineLabel, camera, root, { y: 0.47, width: 10.6, local: f.local } )
				} else {
					besideRest( room.def.rest, 2.2, 3.0, vitrineLabel.position, 2.4 )
					vitrineLabel.scale.setScalar( 1 )
					restCamWorld( room.def.rest, root, camTarget )
					vitrineLabel.lookAt( camTarget )
				}

				if ( !path.update( camera ) && fallback && !fallback.parent ) path.add( fallback )
				// wireframe across the middle of the plateau (scroll-driven), or while the painting is hovered
				const hoverPainting = ctx.pointerActive && performance.now() - ctx.lastPointerMove < 2500 && ctx.pointer.x < 0
				const want = canWire && ( hoverPainting || ( f.local === 0 && Math.abs( f.inPage ) < 0.45 ) )
				if ( want !== wire ) {
					wire = want
					path.wireframe( wire )
				}

				// read back first: a snapshot describes the pose the last frame was culled for
				snapTimer += f.dt
				if ( snapTimer > 0.5 ) {
					snapTimer = 0
					readSnapshot()
				}

				// cull camera glides along the pass road inside the vitrine
				flight = ( flight + f.dt * 0.05 ) % ( Math.PI * 2 )
				samplePassFrame( flight, centre, tangent, right )
				passCentre( flight + 0.14, target )
				centre.y += 3.8
				target.y += 4.6
				model.updateMatrixWorld()
				model.localToWorld( centre )
				model.localToWorld( target )
				passCam.position.copy( centre )
				passCam.up.set( 0, 1, 0 )
				passCam.lookAt( target )
				passCam.updateMatrixWorld()
				frustumGroup.position.copy( passCam.position ).sub( root.position )
				frustumGroup.quaternion.copy( passCam.quaternion )
				frustumGroup.scale.set( passCam.aspect, 1, 1 )

				const a = Math.pow( f.presence, 1.5 )
				for ( const tx of allText ) tx.opacity.value = dimText.includes( tx ) ? a * 0.72 : a
				const k = clamp01( ( f.presence - 0.3 ) / 0.7 )
				liveN.setValue( Math.round( ( livePct ?? 0 ) * easeOutCubic( k ) ), PLAIN )
				// the 400K-point pass needs a first INDEX|STORAGE draw before culling (and the readback) start
				if ( isWebGPU && ( !handle?.active || livePct === null ) ) {
					liveN.opacity.value = 0
					liveL.opacity.value = 0
				}
				pathN.reveal.value = clamp01( f.presence * 1.4 - 0.3 )
				const coneK = f.presence * ( portrait ? 0.2 : 1 ) // phone: cones run behind the pinned labels
				cones[0].uIntensity.value = 0.34 * coneK
				cones[1].uIntensity.value = 0.3 * coneK
				headline.reveal.value = clamp01( f.presence * 1.5 - 0.4 )
				ctx.hint( canWire && f.local === 0 && !ctx.pointerActive ? 'scroll or hover the painting: wireframe' : '' )
			},
			stats: () => ( { prepared, status: path.status?.reason, cull: handle?.status ?? null, livePct, indexCount } ),
			debug: { path, culling, handle, pass },
			dispose() {
				offResize()
				if ( handle ) culling.remove( handle )
				culling?.dispose?.()
				path.removeFromParent() // kept for the next visit (see shared.path)
				for ( const o of [ghost, pass, frustum, box, base, ...frames, ...cones] ) o.dispose()
				for ( const tx of allText ) tx.dispose()
			},
		}
	},
}

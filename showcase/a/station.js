/**
 * Station base: anchor on the spine, an up-ish local frame (T along the spine, N up, B side),
 * a rest camera pose in that frame (journey.js turns it into the rig key of the station's page),
 * ride-in/out arc lengths and residency bookkeeping. Station modules fill `group` and override
 * `pose` / `update` as needed. Everything is built behind the loader; at runtime a station is
 * only shown / hidden (never rebuilt) and its update() runs while it is resident.
 *
 * Portrait: `st.portrait = { pull, shift: [x, y], look }` dollies the rest camera back along its view
 * axis (so the centrepiece fits the narrow frame), slides it in its image plane and can re-aim the
 * preset (`look`, station-local [t, n, b]). Flat type is
 * registered with `st.hud( obj, land, port, d )` and re-laid out on resize: `land` is [x, y, s]
 * in world units at depth d (desktop design, 16:10), `port` is [x, y, s] in normalized viewport
 * coordinates (-1..1) for portrait screens.
 */
import { Group, Matrix4, Vector3 } from 'three/webgpu'

const UP = new Vector3( 0, 1, 0 )
const M = new Matrix4()
const REST_FOV = 50 // journey BASE_FOV: the camera is back at this FOV whenever a station dwells
const TAN = Math.tan( ( REST_FOV * Math.PI ) / 360 )
const DESIGN_ASPECT = 1.6

export function baseStation( ctx, index, layout, steps ) {
	const { spine, camera } = ctx
	const L = layout[index]
	const anchorS = spine.anchorS[index]
	const { T, N, B } = spine.frame( anchorS )
	const anchor = spine.at( anchorS )
	const local = ( t, n, b, out = new Vector3() ) => out.copy( anchor ).addScaledVector( T, t ).addScaledVector( N, n ).addScaledVector( B, b )
	const group = new Group()
	group.name = `station:${L.id}`
	group.visible = false
	ctx.scene.add( group )
	const huds = []
	const f = new Vector3()
	const r = new Vector3()
	const u = new Vector3()
	const st = {
		id: L.id,
		index,
		layout: L,
		half: L.half,
		anchorS,
		anchor,
		T,
		N,
		B,
		local,
		group,
		steps,
		rideIn: anchorS - L.half * 0.7,
		rideOut: anchorS + L.half * 0.7,
		headS: anchorS + L.half + 30,
		fog: [24, 110],
		bloom: 0.55,
		preset: { pos: [-8, 3, 20], look: [0, 1, 0] },
		portrait: { pull: 1, shift: [0, 0] },
		resident: false,
		ready: false,
		isPortrait: () => camera.aspect < 0.9,
		/** Fog distances scale with the portrait pull-back so the centrepiece keeps its density. */
		fogScale: () => ( st.isPortrait() ? st.portrait.pull ?? 1 : 1 ),
		/** Rest pose (landscape design). Stations override this. */
		pose( p, pos, look ) {
			local( ...st.preset.pos, pos )
			local( ...( st.isPortrait() && st.portrait.look ? st.portrait.look : st.preset.look ), look )
		},
		/** Rest pose adapted to the viewport (portrait pull-back + image-plane shift). */
		camera( p, pos, look ) {
			st.pose( p, pos, look )
			if ( !st.isPortrait() ) return
			const { pull = 1, shift = [0, 0] } = st.portrait
			pos.sub( look ).multiplyScalar( pull ).add( look )
			if ( shift[0] || shift[1] ) {
				f.subVectors( look, pos ).normalize()
				r.crossVectors( f, UP ).normalize()
				u.crossVectors( r, f ).normalize()
				pos.addScaledVector( r, shift[0] ).addScaledVector( u, shift[1] )
				look.addScaledVector( r, shift[0] ).addScaledVector( u, shift[1] )
			}
		},
		/** Called every frame while resident: { p, t (-1..0..1), sub, dt, elapsed } (p, t, sub are dwell-mapped) */
		update() {},
		/** Finale: show a cheap dimmed fossil (k 0..1). */
		fossil() {},
		/** Camera basis at progress p (defaults to the station's first step). */
		view( p = steps[0] ) {
			const pos = new Vector3()
			const look = new Vector3()
			st.camera( p, pos, look )
			const fw = new Vector3().subVectors( look, pos ).normalize()
			const rt = new Vector3().crossVectors( fw, UP ).normalize()
			const up = new Vector3().crossVectors( rt, fw ).normalize()
			return { pos, look, f: fw, r: rt, u: up }
		},
		/** Place a flat text group in the camera view at (x, y) world units, `d` in front, parallel to the image plane. */
		place( obj, x, y, d, p = steps[0] ) {
			const v = st.view( p )
			obj.position.copy( v.pos ).addScaledVector( v.f, d ).addScaledVector( v.r, x ).addScaledVector( v.u, y )
			st.orient( obj, p )
			return obj
		},
		/** Rotate a flat text group parallel to the station camera's image plane (no perspective slant). */
		orient( obj, p = steps[0] ) {
			const v = st.view( p )
			M.lookAt( v.pos, v.look, UP )
			obj.quaternion.setFromRotationMatrix( M )
			return obj
		},
		/**
		 * Register flat type laid out against the rest camera.
		 * land: [x, y, scale] world units at depth d (16:10 design, squeezed on narrower landscapes).
		 * port: [x, y, scale] normalized viewport coordinates (-1..1, y up) on portrait screens.
		 */
		hud( obj, land, port, d = 20 ) {
			huds.push( { obj, land, port, d } )
			group.add( obj )
			return obj
		},
		/** Re-run every hud placement (after build and on resize). */
		layout() {
			if ( !huds.length && !st.onLayout ) return
			const portrait = st.isPortrait()
			const v = st.view()
			M.lookAt( v.pos, v.look, UP )
			const k = Math.min( 1.25, Math.max( 0.8, camera.aspect / DESIGN_ASPECT ) )
			for ( const h of huds ) {
				let x, y, s
				if ( portrait && h.port ) {
					const halfH = h.d * TAN
					x = h.port[0] * halfH * camera.aspect
					y = h.port[1] * halfH
					s = h.port[2] ?? 1
				} else {
					x = h.land[0] * k
					y = h.land[1]
					s = ( h.land[2] ?? 1 ) * Math.min( 1, k )
				}
				h.obj.position.copy( v.pos ).addScaledVector( v.f, h.d ).addScaledVector( v.r, x ).addScaledVector( v.u, y )
				h.obj.quaternion.setFromRotationMatrix( M )
				h.obj.scale.setScalar( s )
			}
			st.onLayout?.( portrait )
		},
		/** Residency (the page is on screen or about to be): main.js owns group.visible (fossils too). */
		setResident( on ) {
			if ( st.resident === on ) return
			st.resident = on
			st.onResident?.( on )
		},
	}
	return st
}

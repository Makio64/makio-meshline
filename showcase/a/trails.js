/**
 * Cursor = 3 tapered aurora trails (follow.js idea): one multi-line MeshLine, dynamic,
 * rewritten with setPositions() (108 points) while the pointer moves. Lives in camera space,
 * fades when the pointer rests and then costs nothing (hidden, no rewrite).
 */
import { MeshLine } from 'makio-meshline'
import { Fn, mix, uniform, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Vector3 } from 'three/webgpu'

const TRAILS = 3
const POINTS = 36
const DEPTH = 6

export function createTrails( stage ) {
	const { camera, pointer } = stage
	const lines = Array.from( { length: TRAILS }, () => new Float32Array( POINTS * 3 ) )
	const heads = Array.from( { length: TRAILS }, () => new Vector3() )
	const target = new Vector3()
	let energy = 0
	const uEnergy = uniform( 0 )
	let lastX = 0
	let lastY = 0

	// seed real points BEFORE building: an all-zero point list builds an empty geometry (no attributes,
	// so the warm-up could not compile it and the first pointer move would rebuild it)
	// pointer NDC -> camera-local point at DEPTH
	const toLocal = ( out ) => {
		const h = Math.tan( ( camera.fov * Math.PI ) / 360 ) * DEPTH
		return out.set( pointer.x * h * camera.aspect, pointer.y * h, -DEPTH )
	}
	const start = toLocal( new Vector3() )
	for ( let k = 0; k < TRAILS; k++ ) {
		heads[k].copy( start )
		for ( let i = 0; i < POINTS; i++ ) {
			start.toArray( lines[k], i * 3 )
			lines[k][i * 3 + 2] -= ( POINTS - i ) * 0.003 // never two identical points
		}
	}

	const line = new MeshLine()
		.lines( lines, false )
		.dynamic( true )
		.lineWidth( 0.05 )
		.widthCallback( ( t ) => Math.pow( t, 1.6 ) )
		.colorFn( Fn( ( [c, progress] ) => {
			const tint = mix( vec3( 0.13, 0.83, 0.93 ), vec3( 1.0, 0.36, 0.86 ), progress )
			return vec4( tint.mul( progress.mul( 1.6 ) ).mul( c.r ).mul( uEnergy ), 1 )
		} ) )
		.transparent( true )
		.autoResize()
		.build()
	line.material.blending = AdditiveBlending
	line.material.depthWrite = false
	line.material.depthTest = false
	line.frustumCulled = false
	line.renderOrder = 40
	camera.add( line )

	let asleep = false
	function update( dt, elapsed ) {
		const moved = Math.hypot( pointer.x - lastX, pointer.y - lastY )
		lastX = pointer.x
		lastY = pointer.y
		energy = Math.min( 1, energy * Math.exp( -dt * 1.4 ) + moved * 6 )
		uEnergy.value = energy
		// asleep (pointer at rest): no CPU work, no upload, not drawn
		if ( energy <= 0.01 ) {
			if ( !asleep ) {
				asleep = true
				line.visible = false
			}
			return
		}
		toLocal( target )
		if ( asleep ) {
			// waking up: collapse the history onto the pointer so no stale tail flashes
			asleep = false
			for ( let k = 0; k < TRAILS; k++ ) {
				heads[k].copy( target )
				for ( let i = 0; i < POINTS; i++ ) target.toArray( lines[k], i * 3 )
			}
		}
		for ( let k = 0; k < TRAILS; k++ ) {
			const h = heads[k]
			const lag = 10 + k * 5
			const a = elapsed * ( 1.7 + k * 0.6 ) + k * 2.1
			const r = 0.06 + k * 0.05
			h.x += ( target.x + Math.cos( a ) * r - h.x ) * Math.min( 1, dt * lag )
			h.y += ( target.y + Math.sin( a ) * r - h.y ) * Math.min( 1, dt * lag )
			const arr = lines[k]
			arr.copyWithin( 0, 3 ) // oldest first, head last (progress 1 = head)
			h.toArray( arr, ( POINTS - 1 ) * 3 )
			for ( let i = 0; i < POINTS; i++ ) arr[i * 3 + 2] = -DEPTH - ( POINTS - i ) * 0.003
		}
		line.setPositions( lines )
		line.visible = true
	}

	return { line, update, get energy() { return energy } }
}

export default createTrails

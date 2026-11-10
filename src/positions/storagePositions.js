import { clamp, float, floor, Fn, instanceIndex, mix, storage, uint } from 'three/tsl'

/**
 * Build a `gpuPositionNode` that reads line points straight from a storage
 * buffer, so a compute pass or storage upload can move them without rebuilding
 * vertex attributes.
 *
 * The buffer holds one run of `pointsPerLine` points per instance, in instance
 * order (`vec3` or `vec4` items; `w` is ignored). Pair it with
 * `.instances( lineCount ).segments( pointsPerLine - 1 )`.
 *
 * - Pass a `uint` uniform as `head` to treat every run as a ring buffer:
 *   progress 0 then samples the newest slot `head` and progress 1 the oldest.
 * - Pass `toBuffer` + `morph` (a float uniform or TSL node in `0..1`) to morph
 *   every instanced line between two storage buffers (e.g. synoptic isobar or
 *   contour tracks moving from one frame to another) directly in the vertex
 *   shader without a third buffer or compute pass.
 * - Pass `closed` (`true` or a `0..1` TSL node/attribute for mixed open/closed
 *   instanced banks whose closed loops duplicate point 0 at `pointsPerLine - 1`)
 *   so `previous`/`next` samples at the loop seam wrap to the opposite end
 *   segment instead of clamping to a butt cap.
 * - Pass `snap: true` when the line has exactly `pointsPerLine - 1` segments.
 *   Every sample then lands on a stored point, which is read directly: one
 *   storage read instead of two, and exact however long the line is.
 *
 * @param {import('three/webgpu').StorageBufferAttribute} buffer - Point storage (or `from` storage when morphing)
 * @param {object} options
 * @param {number} options.pointsPerLine - Points stored per instance
 * @param {import('three/tsl').ShaderNodeObject<any>} [options.head] - Newest slot for ring-buffer trails
 * @param {import('three/webgpu').StorageBufferAttribute} [options.toBuffer] - Target point storage for GPU morph transitions
 * @param {number | import('three/tsl').ShaderNodeObject<any>} [options.morph] - Interpolation factor `0..1` between `buffer` and `toBuffer`
 * @param {boolean | number | import('three/tsl').ShaderNodeObject<any>} [options.closed] - Loop seam wrapping (`true` or a `0..1` per-instance TSL node)
 * @param {boolean} [options.snap=false] - Read the nearest stored point instead of interpolating
 * @returns {( progress: any ) => any} TSL function for `gpuPositionNode`
 */
export function storagePositions( buffer, { pointsPerLine, head = null, toBuffer = null, morph = null, closed = null, snap = false } = {} ) {
	if ( !buffer?.isStorageBufferAttribute ) {
		throw new Error( 'storagePositions: buffer must be a StorageBufferAttribute' )
	}
	if ( !Number.isSafeInteger( pointsPerLine ) || pointsPerLine < 2 ) {
		throw new Error( 'storagePositions: pointsPerLine must be an integer of at least 2' )
	}
	if ( buffer.itemSize !== 3 && buffer.itemSize !== 4 ) {
		throw new Error( 'storagePositions: buffer items must be vec3 or vec4' )
	}
	if ( buffer.count % pointsPerLine !== 0 ) {
		throw new Error( 'storagePositions: buffer count must be a multiple of pointsPerLine' )
	}
	if ( toBuffer !== null ) {
		if ( !toBuffer?.isStorageBufferAttribute ) {
			throw new Error( 'storagePositions: toBuffer must be a StorageBufferAttribute' )
		}
		if ( toBuffer.itemSize !== buffer.itemSize || toBuffer.count !== buffer.count ) {
			throw new Error( 'storagePositions: toBuffer must match buffer count and itemSize' )
		}
		if ( morph === null || morph === undefined ) {
			throw new Error( 'storagePositions: morph is required when toBuffer is provided' )
		}
	}

	const itemType = buffer.itemSize === 4 ? 'vec4' : 'vec3'
	const points = storage( buffer, itemType, buffer.count ).toReadOnly()
	const toPoints = toBuffer ? storage( toBuffer, itemType, toBuffer.count ).toReadOnly() : null
	const length = uint( pointsPerLine )
	const isPowerOfTwo = ( pointsPerLine & ( pointsPerLine - 1 ) ) === 0
	const lengthMask = isPowerOfTwo ? uint( pointsPerLine - 1 ) : null
	const lastPoint = float( pointsPerLine - 1 )
	const invLastPoint = float( 1 / ( pointsPerLine - 1 ) )

	return Fn( ( [progress] ) => {
		// Progress may leave [0, 1] when the material samples previous/next past
		// an end; clamping the pivot rather than progress extrapolates the end
		// segment instead of collapsing onto the endpoint. When `closed` is set
		// on a loop whose last point duplicates point 0, wrap out-of-range samples
		// modulo `lastPoint` so the seam joins smoothly across segment 0 and N-1.
		const rawP = progress.mul( lastPoint ).toVar()
		let p = rawP
		if ( closed !== null && closed !== false ) {
			const wrappedP = rawP.sub( floor( rawP.mul( invLastPoint ) ).mul( lastPoint ) )
			const outside = rawP.lessThan( 0 ).or( rawP.greaterThan( lastPoint ) )
			p = closed === true
				? outside.select( wrappedP, rawP ).toVar()
				: outside.select( mix( rawP, wrappedP, float( closed ).clamp( 0, 1 ) ), rawP ).toVar()
		}

		// A snapped sample is the stored point nearest to `p`; an interpolated one
		// blends the two points around it.
		const pivot = ( snap ? clamp( p.round(), 0, lastPoint ) : clamp( floor( p ), 0, lastPoint.sub( 1 ) ) ).toVar()
		const t = snap ? null : p.sub( pivot )
		const base = instanceIndex.mul( length )
		const step = pivot.toUint()

		let first
		let second
		if ( head ) {
			const headOffset = uint( head ).add( length ).sub( step ).toVar()
			if ( isPowerOfTwo ) {
				first = base.add( headOffset.bitAnd( lengthMask ) )
				second = base.add( headOffset.sub( uint( 1 ) ).bitAnd( lengthMask ) )
			} else {
				first = base.add( headOffset.mod( length ) )
				second = base.add( headOffset.sub( uint( 1 ) ).mod( length ) )
			}
		} else {
			first = base.add( step ).toVar()
			second = first.add( uint( 1 ) )
		}

		const sample = source => snap
			? source.element( first ).xyz
			: mix( source.element( first ).xyz, source.element( second ).xyz, t )
		const fromSample = sample( points )
		if ( toPoints ) {
			return mix( fromSample, sample( toPoints ), float( morph ) )
		}

		return fromSample
	} )
}

export default storagePositions

import { attribute, cameraProjectionMatrix, cameraWorldMatrix, Discard, float, Fn, max, mix, mod, modelViewMatrix, modelWorldMatrixInverse, normalize, positionGeometry, step, texture, uniform, uv, varying, varyingProperty, vec2, vec3, vec4 } from 'three/tsl'
import { Color, DoubleSide, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu'

// Map a clip-space vec4 into aspect-corrected NDC (xy/w with the X axis
// stretched by aspect). Directions measured in this space correspond 1:1 to
// screen-pixel directions — they're what the miter math consumes.
const fix = Fn( ( [i_immutable, aspect_immutable] ) => {
	const aspect = float( aspect_immutable ).toVar()
	const i = vec4( i_immutable ).toVar()
	const ndc = vec2( i.xy.div( i.w ) ).toVar( 'ndc' )
	const res = vec2( ndc.x.mul( aspect ), ndc.y ).toVar( 'res' )
	return res
} ).setLayout( {
	name: 'fix', type: 'vec2', inputs: [
		{ name: 'i', type: 'vec4' },
		{ name: 'aspect', type: 'float' }
	]
} )

// build these nodes once for all instances
const aSide = attribute( 'side', 'float' )
const aProgress = attribute( 'progress', 'float' )
const aColor = attribute( 'vertexColor', 'vec3' )
const aWidth = attribute( 'width', 'float' )
const vWidth = varyingProperty( 'float', 'vWidth' )
const vProgress = varyingProperty( 'float', 'vProgress' )
const vColor = varyingProperty( 'vec4', 'vColor' )

/**
 * TSL-based NodeMaterial for GPU line rendering. Extends `MeshBasicNodeMaterial`
 * and provides an extensive hook system for customizing every stage of the
 * vertex and fragment shaders via TSL functions.
 */
class MeshLineNodeMaterial extends MeshBasicNodeMaterial {

	constructor() {
		super()
		this.type = 'MeshLineNodeMaterial'
		this.isMeshLineNodeMaterial = true
	}

	/**
	 * Initialize the material from configuration options. Creates uniforms,
	 * configures hooks, and sets up the shader pipeline.
	 * @param {import('./index.d.ts').MeshLineConfigureOptions} options
	 */
	buildLine( options = {} ) {

		this.options = options
		this._segments = options.segments ?? 100
		this._needsWidth = options.needsWidth ?? false

		// classic properties
		this.depthWrite = options.depthWrite ?? true
		this.depthTest = options.depthTest ?? true
		this.wireframe = options.wireframe ?? false

		this.alphaTest = options.alphaTest ?? 0
		this.sizeAttenuation = options.sizeAttenuation ?? true

		// Can be changed dynamically
		this.resolution = uniform( options.resolution ?? new Vector2( 1, 1 ) )
		this.lineWidth = uniform( options.lineWidth ?? 1 )
		this.color = uniform( new Color( options.color ?? 0xffffff ) )
		this.dpr = uniform( options.dpr ?? ( ( typeof window !== 'undefined' ) ? window.devicePixelRatio || 1 : 1 ) )

		// Conditional uniforms - only create what is needed
		if ( options.gradientColor ) {
			this.gradient = uniform( new Color( options.gradientColor ) )
		}

		const hasAlphaFeatures = options.alphaMap != null || ( options.opacity ?? 1 ) < 1
		this.transparent = hasAlphaFeatures || options.transparent
		if ( this.transparent ) {
			this.opacity = uniform( options.opacity ?? 1 )
		}

		if ( options.map ) {
			this.map = texture( options.map )
		}
		if ( options.alphaMap ) {
			this.alphaMap = texture( options.alphaMap )
		}
		if ( options.map || options.alphaMap ) {
			this.mapOffset = uniform( options.mapOffset ?? new Vector2( 0, 0 ) )
			this.repeat = uniform( options.repeat ?? new Vector2( 1, 1 ) )
		}

		if ( options.dashCount ) {
			this.dashCount = uniform( options.dashCount )
			this.dashRatio = uniform( options.dashRatio ?? options.dashLength ?? 0.5 )
			this.dashOffset = uniform( options.dashOffset ?? 0 )
		}

		// Miter is always on. The shader reads `_miterThreshold` (= 2/miterLimit),
		// the lower bound on |dir1+dir2| below which the offset magnitude plateaus.
		this._miterLimit = options.miterLimit ?? 4.0
		this._miterThreshold = uniform( 2 / this._miterLimit )

		// GPU position node (optional)
		this.gpuPositionNode = options.gpuPositionNode ?? null

		// Set default depthWrite based on transparent after all properties are set
		this.depthWrite = options.depthWrite ?? ( this.transparent ? false : true )

		// NODE HOOKS
		this.positionFn = options.positionFn ?? null
		this.previousFn = options.previousFn ?? null
		this.nextFn = options.nextFn ?? null
		this.widthFn = options.widthFn ?? null
		this.normalFn = options.normalFn ?? null
		this.colorFn = options.colorFn ?? null
		this.gradientFn = options.gradientFn ?? null
		this.opacityFn = options.opacityFn ?? null
		this.dashFn = options.dashFn ?? null
		this.uvFn = options.uvFn ?? null
		this.vertexFn = options.vertexFn ?? null
		this.fragmentColorFn = options.fragmentColorFn ?? null
		this.fragmentAlphaFn = options.fragmentAlphaFn ?? null
		this.discardFn = options.discardFn ?? null

		this.needsUpdate = true
	}

	dispose() {
		super.dispose()
	}

	get miterLimit() {
		return this._miterLimit
	}

	set miterLimit( value ) {
		this._miterLimit = value
		if ( this._miterThreshold ) {
			this._miterThreshold.value = 2 / value
		}
	}

	/**
	 * Enable or disable shadow casting. Builds the shadow position node
	 * when enabled.
	 * @param {boolean} enabled
	 */
	setShadow( enabled ) {
		if ( enabled === this._shadowEnabled ) return
		this._shadowEnabled = enabled
		if ( enabled ) {
			this.shadowSide = DoubleSide
			this.buildShadowPositionNode()
		} else {
			this.castShadowPositionNode = null
			this.maskShadowNode = null
			this.shadowNode = null
			this.shadowSide = null
		}
		this.needsUpdate = true
	}

	getLinePositions( progress ) {
		// Get base positions
		let pos = this.gpuPositionNode ? this.gpuPositionNode( progress, float( 0 ) ) : positionGeometry
		let previous = this.gpuPositionNode ? this.gpuPositionNode( progress.sub( 1 / this._segments ), float( 0 ) ) : attribute( 'previous', 'vec3' )
		let next = this.gpuPositionNode ? this.gpuPositionNode( progress.add( 1 / this._segments ), float( 0 ) ) : attribute( 'next', 'vec3' )
		// Apply position modifiers
		if ( this.positionFn ) {
			pos = this.positionFn( pos, progress )
			previous = this.positionFn( previous, progress )
			next = this.positionFn( next, progress )
		}

		if ( this.previousFn ) { previous = this.previousFn( previous, progress ) }
		if ( this.nextFn ) { next = this.nextFn( next, progress ) }

		return { pos, previous, next }
	}

	getLineWidth( width, progress, side ) {
		if ( this._needsWidth || this.widthFn ) {
			width = width.mul( aWidth )
		}
		if ( this.widthFn ) {
			width = this.widthFn( width, progress, side )
		}
		return width
	}

	buildShadowPositionNode() {

		this.castShadowPositionNode = Fn( () => {
			const progress = aProgress
			const side = aSide

			// Get base positions in LOCAL space
			const { pos, previous, next } = this.getLinePositions( progress )

			// Transform to VIEW space
			const posView = modelViewMatrix.mul( vec4( pos, 1.0 ) ).xyz
			const prevView = modelViewMatrix.mul( vec4( previous, 1.0 ) ).xyz
			const nextView = modelViewMatrix.mul( vec4( next, 1.0 ) ).xyz

			// Calculate line direction in VIEW space
			const dir1 = normalize( posView.sub( prevView ) )
			const dir2 = normalize( nextView.sub( posView ) )
			const dir = normalize( dir1.add( dir2 ) )

			// Calculate perpendicular in VIEW space (billboard to camera)
			// In View space, camera is at (0,0,0) looking down -Z
			// We want the vector perpendicular to the line and the view direction (Z axis)
			// This is effectively the 2D normal in the XY plane
			const perp = normalize( vec3( dir.y.negate(), dir.x, 0 ) )

			const w = this.getLineWidth( this.lineWidth.mul( 0.5 ), progress, side )

			// Apply offset in VIEW space
			const posViewNew = posView.add( perp.mul( side.mul( w ) ) )

			// Transform back to LOCAL space
			const worldPos = cameraWorldMatrix.mul( vec4( posViewNew, 1.0 ) )
			return modelWorldMatrixInverse.mul( worldPos ).xyz
		} )()

		this.maskShadowNode = null

		// Add a shadow mask for dashed lines during the shadow pass
		if ( this.dashCount ) {
			this.maskShadowNode = Fn( () => {
				const vProg = varying( aProgress )
				let cyclePosition = mod( vProg.mul( this.dashCount ).add( this.dashOffset ), float( 1 ) ).toVar( 'cyclePosition' )

				if ( this.dashFn ) {
					cyclePosition.assign( this.dashFn( cyclePosition, vProg, varying( aSide ) ) )
				}

				const dashMask = step( cyclePosition, this.dashRatio )
				return dashMask.greaterThan( 0.001 )
			} )()
		}
	}

	setup( builder ) {
		this.setupShaders( builder )
		super.setup( builder )
	}

	setupShaders( { } ) {

		// Cache frequently-used attributes to prevent duplicate GPU computation
		const progress = aProgress.toVar( 'varProgress' )
		const side = aSide.toVar( 'varSide' )

		// Get base positions first
		const { pos, previous, next } = this.getLinePositions( progress )

		this.vertexNode = Fn( () => {

			let color = vec4( this.color, 1 ).toVar( 'color' )

			if ( this.options.needsVertexColor ) {
				color.rgb.mulAssign( aColor )
			}

			if ( this.colorFn ) {
				color.assign( this.colorFn( color, progress, side ) )
			}

			vColor.assign( color )

			// Only assign vProgress if needed to reduce varying bandwidth
			if ( this.gradient || this.dashCount || this.gradientFn || this.dashFn ) {
				vProgress.assign( progress )
			}

			const aspect = this.resolution.x.div( this.resolution.y ).toVar( 'aspect' )
			const mvpMatrix = cameraProjectionMatrix.mul( modelViewMatrix ).toVar( 'mvpMatrix' )
			const finalPosition = mvpMatrix.mul( vec4( pos, 1.0 ) ).toVar( 'finalPosition' )
			const prevPos = mvpMatrix.mul( vec4( previous, 1.0 ) ).toVar( 'prevPos' )
			const nextPos = mvpMatrix.mul( vec4( next, 1.0 ) ).toVar( 'nextPos' )

			// Direction vectors in aspect-corrected NDC (post perspective divide).
			// This is the space the miter math measures pixel-accurate offsets in.
			// Sharp CPU-side polyline corners that could otherwise collapse the
			// bisector under oblique perspective are handled upstream by the
			// geometry's `smoothSharpBends` pass (on by default).
			// At open endpoints, reuse the real segment direction instead of the
			// extrapolated neighbour direction; this keeps single-segment GPU lines
			// from tapering when the extrapolated point projects badly.
			const currentP = fix( finalPosition, aspect ).toVar( 'currentP' )
			const prevP = fix( prevPos, aspect ).toVar( 'prevP' )
			const nextP = fix( nextPos, aspect ).toVar( 'nextP' )
			const delta1Raw = currentP.sub( prevP ).toVar( 'delta1Raw' )
			const delta2Raw = nextP.sub( currentP ).toVar( 'delta2Raw' )
			const atStart = float( 1 ).sub( step( float( 0.0001 ), progress ) ).toVar( 'atStart' )
			const atEnd = step( float( 0.9999 ), progress ).toVar( 'atEnd' )
			const delta1 = mix( delta1Raw, delta2Raw, atStart ).toVar( 'delta1' )
			const delta2 = mix( delta2Raw, delta1Raw, atEnd ).toVar( 'delta2' )

			const w = this.getLineWidth( this.lineWidth, progress, side ).toVar( 'w' )

			vWidth.assign( w )

			// Miter offset. |dir1+dir2| = 2·cos(α/2) for interior bend α.
			// Magnitude: w/max(|dir1+dir2|, 2/miterLimit) — monotonic, plateaus at
			// miterLimit·w/2 for sharp bends. Direction: unit perpendicular of the
			// bisector, with perp(dir1) as a fallback for near-180° reversals.
			const minDirectionLength = float( 0.0001 )
			const delta1Len = delta1.length().toVar( 'delta1Len' )
			const delta2Len = delta2.length().toVar( 'delta2Len' )
			const dirFallback = vec2( 1, 0 ).toVar( 'dirFallback' )
			const dir1Raw = delta1.div( max( delta1Len, minDirectionLength ) ).toVar( 'dir1Raw' )
			const dir2Raw = delta2.div( max( delta2Len, minDirectionLength ) ).toVar( 'dir2Raw' )
			const dir1 = mix(
				mix( dirFallback, dir2Raw, step( minDirectionLength, delta2Len ) ),
				dir1Raw,
				step( minDirectionLength, delta1Len )
			).toVar( 'dir1' )
			const dir2 = mix( dir1, dir2Raw, step( minDirectionLength, delta2Len ) ).toVar( 'dir2' )
			const dirSum = dir1.add( dir2 ).toVar( 'dirSum' )
			const dirSumLen = dirSum.length().toVar( 'dirSumLen' )

			const perpRaw = vec2( dirSum.y.negate(), dirSum.x ).toVar( 'perpRaw' )
			const perpFallback = vec2( dir1.y.negate(), dir1.x ).toVar( 'perpFallback' )
			const unitPerp = mix(
				perpFallback,
				perpRaw.div( max( dirSumLen, float( 0.0001 ) ) ),
				step( float( 0.001 ), dirSumLen )
			).toVar( 'unitPerp' )

			const miterHalfWidth = w.div( max( dirSumLen, this._miterThreshold ) ).toVar( 'miterHalfWidth' )

			const normal = vec4( 0, 0, 0, 1 ).toVar( 'normal' )
			normal.xy.assign( unitPerp.mul( miterHalfWidth ) )

			// Apply normal modifier if provided. Pass the unit bisector for backward
			// compatibility with existing normalFn hooks.
			if ( this.normalFn ) {
				const dir = vec2( unitPerp.y, unitPerp.x.negate() ).toVar( 'dir' )
				normal.assign( this.normalFn( normal, dir, dir1, dir2, progress, side ) )
			}

			if ( this.sizeAttenuation ) {
				// `lineWidth` is a full view/world-space width. Project the offset as
				// a direction (w = 0), so perspective naturally attenuates with depth.
				normal.xy.assign( cameraProjectionMatrix.mul( vec4( normal.xy, 0, 0 ) ).xy )
			} else {
				// `lineWidth` is a full CSS-pixel width. `resolution` is also CSS-sized:
				// the canvas still uses more physical pixels on high-DPR screens, but
				// the visible CSS size stays stable instead of being multiplied twice.
				normal.x.divAssign( aspect )
				normal.xy.mulAssign( finalPosition.w.mul( 2 ).div( this.resolution.y ) )
			}

			finalPosition.xy.addAssign( normal.xy.mul( side ) )

			// Apply vertex modifier if provided
			if ( this.vertexFn ) {
				finalPosition.assign( this.vertexFn( finalPosition, normal, progress, side ) )
			}

			return finalPosition
		} )()
		let uvCoords
		if ( ( this.map && this.map.value ) || ( this.alphaMap && this.alphaMap.value ) || this.uvFn ) {
			uvCoords = uv().mul( this.repeat || vec2( 1, 1 ) ).add( this.mapOffset || vec2( 0, 0 ) ).toVar( 'uvCoords' )

			// Apply UV modifier if provided
			if ( this.uvFn ) {
				uvCoords = this.uvFn( uvCoords, vProgress, side )
			}
		}
		// Color node
		this.colorNode = Fn( () => {
			let color = vColor.toVar( 'color' )
			if ( this.gradient ) {
				let gradientFactor = vProgress.toVar( 'gradientFactor' )

				// Apply gradient modifier if provided
				if ( this.gradientFn ) {
					gradientFactor.assign( this.gradientFn( gradientFactor, side ) )
				}

				color.rgb.assign( mix( color.rgb, this.gradient, gradientFactor ) )
			}

			if ( this.map && this.map.value ) {
				color.mulAssign( this.map.sample( uvCoords ) )
			}

			// Apply fragment color modifier if provided
			if ( this.fragmentColorFn ) {
				color.assign( this.fragmentColorFn( color, uvCoords, vProgress, side ) )
			}

			return color
		} )()

		// Opacity node
		this.opacityNode = Fn( () => {
			let alpha = float( 1 ).toVar( 'alpha' )

			if ( this.alphaMap && this.alphaMap.value ) {
				alpha.mulAssign( this.alphaMap.sample( uvCoords ).r )
			}

			if ( this.opacity ) {
				alpha.mulAssign( this.opacity )
			}

			// Apply opacity modifier if provided
			if ( this.opacityFn ) {
				alpha.assign( this.opacityFn( alpha, vProgress, side ) )
			}

			Discard( alpha.lessThan( this.alphaTest ) )

			if ( this.dashCount ) {
				let cyclePosition = mod( vProgress.mul( this.dashCount ).add( this.dashOffset ), float( 1 ) ).toVar( 'cyclePosition' )

				// Apply dash modifier if provided
				if ( this.dashFn ) {
					cyclePosition.assign( this.dashFn( cyclePosition, vProgress, side ) )
				}

				// dashRatio represents a dash portion: 0.1 = 10% dash, 90% gap
				const dashMask = step( cyclePosition, this.dashRatio )
				Discard( dashMask.lessThan( 0.001 ) )
			}

			if ( this.discardFn ) {
				Discard( this.discardFn( vProgress, side, uvCoords ) )
			}

			// Apply fragment alpha modifier if provided
			if ( this.fragmentAlphaFn ) {
				alpha.assign( this.fragmentAlphaFn( alpha, uvCoords, vProgress, side ) )
			}

			return alpha
		} )()

	}

	copy( source ) {
		super.copy( source )

		// Copy classic material properties
		this.transparent = source.transparent
		this.depthWrite = source.depthWrite
		this.depthTest = source.depthTest
		this.wireframe = source.wireframe

		// Copy feature flags
		this.alphaTest = source.alphaTest
		this.sizeAttenuation = source.sizeAttenuation

		// Copy uniform values
		this.lineWidth.value = source.lineWidth.value

		// Copy uniforms (guard on source having the uniform)
		if ( source.opacity ) this.opacity.value = source.opacity.value
		if ( source.map ) this.map.value = source.map.value
		if ( source.alphaMap ) this.alphaMap.value = source.alphaMap.value
		if ( source.gradient ) this.gradient.value = source.gradient.value
		if ( source.dashCount ) this.dashCount.value = source.dashCount.value
		if ( source.dashRatio ) this.dashRatio.value = source.dashRatio.value
		if ( source.dashOffset ) this.dashOffset.value = source.dashOffset.value
		if ( source._miterLimit !== undefined && this._miterThreshold ) {
			this.miterLimit = source._miterLimit
		}
		if ( source.color ) this.color.value.copy( source.color.value )
		if ( source.resolution ) this.resolution.value.copy( source.resolution.value )
		if ( source.repeat ) this.repeat.value.copy( source.repeat.value )
		if ( source.mapOffset ) this.mapOffset.value.copy( source.mapOffset.value )
		if ( source.dpr ) this.dpr.value = source.dpr.value

		// Copy node hooks
		this.positionFn = source.positionFn
		this.previousFn = source.previousFn
		this.nextFn = source.nextFn
		this.widthFn = source.widthFn
		this.normalFn = source.normalFn
		this.colorFn = source.colorFn
		this.gradientFn = source.gradientFn
		this.opacityFn = source.opacityFn
		this.dashFn = source.dashFn
		this.uvFn = source.uvFn
		this.vertexFn = source.vertexFn
		this.fragmentColorFn = source.fragmentColorFn
		this.fragmentAlphaFn = source.fragmentAlphaFn
		this.discardFn = source.discardFn
		this.gpuPositionNode = source.gpuPositionNode

		return this
	}

	static get type() {
		return 'MeshLineNodeMaterial'
	}

}

export { MeshLineNodeMaterial }
export default MeshLineNodeMaterial
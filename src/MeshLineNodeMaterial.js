import { attribute, cameraProjectionMatrix, cameraWorldMatrix, dFdx, dFdy, Discard, dot, float, Fn, max, min, mix, mod, modelViewMatrix, modelWorldMatrixInverse, positionGeometry, step, texture, uint, uniform, uv, varying, varyingProperty, vec2, vec3, vec4, vertexIndex } from 'three/tsl'
import { Color, DoubleSide, MeshBasicNodeMaterial, Vector2 } from 'three/webgpu'

const DEFAULT_MITER_LIMIT = 4
const MAX_MITER_LIMIT = 1e6
// Aspect-corrected NDC is already post-projection. A 1e-4 cutoff is roughly
// 0.04 CSS pixels on a 720px viewport and incorrectly classifies valid dense
// path segments as degenerate. Keep only a Float32-scale guard here: exact
// duplicate projections still take the finite fallback, while subpixel
// segments retain their real direction and stay connected.
export const SCREEN_DIRECTION_EPSILON = 1e-7
export const SCREEN_REVERSAL_DOT_THRESHOLD = Math.fround( -Math.cos( Math.PI / 180 ) )

const sanitizeMiterLimit = value => {
	const limit = Number( value ?? DEFAULT_MITER_LIMIT )
	if ( !Number.isFinite( limit ) ) return DEFAULT_MITER_LIMIT
	return Math.max( 1, Math.min( limit, MAX_MITER_LIMIT ) )
}

// Map a clip-space vec4 into aspect-corrected NDC (xy/w with the X axis
// stretched by aspect). Directions measured in this space correspond 1:1 to
// screen-pixel directions — they're what the miter math consumes.
const fix = Fn( ( [i_immutable, aspect_immutable] ) => {
	const aspect = float( aspect_immutable ).toVar()
	const i = vec4( i_immutable ).toVar()
	// A centerline point can touch/cross the camera plane before raster clipping.
	// Keep the shader finite there; exact segment trimming needs variable segment
	// topology, but a signed epsilon prevents NaN/Inf from contaminating the join.
	const signedEpsilon = mix( float( -1e-6 ), float( 1e-6 ), step( float( 0 ), i.w ) ).toVar( 'signedEpsilon' )
	const safeW = mix( signedEpsilon, i.w, step( float( 1e-6 ), i.w.abs() ) ).toVar( 'safeW' )
	const ndc = vec2( i.xy.div( safeW ) ).toVar( 'ndc' )
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
const aJoinRole = attribute( 'joinRole', 'float' )
const aProgress = attribute( 'progress', 'float' )
const aColor = attribute( 'vertexColor', 'vec3' )
const aWidth = attribute( 'width', 'float' )
const vProgress = varyingProperty( 'float', 'vProgress' )
const vColor = varyingProperty( 'vec4', 'vColor' )
const vertexSide = float( 1 ).sub( float( vertexIndex.bitAnd( uint( 1 ) ) ).mul( 2 ) )
// Billboard geometry stores [incoming+, incoming-, outgoing+, outgoing-] for
// every logical point. The sign owns the incident body and the magnitude owns
// the side, so both survive BufferGeometry.toNonIndexed(). A missing attribute
// reads as zero, retaining the old indexed-geometry fallback.
const indexedOutgoingVertex = vertexIndex.bitAnd( uint( 2 ) ).notEqual( uint( 0 ) )
const hasJoinRole = aJoinRole.abs().greaterThan( float( 0.5 ) )
const outgoingVertex = hasJoinRole.select(
	aJoinRole.greaterThan( float( 0 ) ),
	indexedOutgoingVertex
)
const encodedSide = hasJoinRole.select(
	aJoinRole.abs().lessThan( float( 1.5 ) ).select( float( 1 ), float( -1 ) ),
	vertexSide
)

// Normalized stroke coordinate, after rreusser/webgpu-instanced-lines' `lineCoord`.
//   x: signed position inside an end cap. The billboard profile emits no cap
//      topology, so it is a compile-time zero today and is reserved for caps.
//   y: normalized position across the emitted cross-section. -1 and +1 land
//      exactly on the two silhouette edges, 0 on the mid-line between them.
// It is a silhouette coordinate, not a distance. The emitted edge sits at
// `lineWidth / 2` only on a straight run; at a bend of deviation a the miter
// pushes it to `lineWidth / ( 2 cos( a / 2 ) )`, bounded by the miter limit, and
// past that limit it falls back to `lineWidth / 2`. So do not read
// `lineCoord.y` as "signed distance in half-widths". `y` is also
// the mid-line rather than the centerline whenever a `widthFn`/`normalFn`
// hook makes the cross-section asymmetric — both receive `side`.
export const lineCoord = vec2( float( 0 ), varying( encodedSide, 'vLineCoord' ) )

// Half a device pixel of outward padding, so an antialiased edge has real
// geometry to fade across instead of eroding the stroke it is smoothing.
const AA_EDGE_PADDING_PX = 0.5
// Never emit a stroke narrower than one device pixel: a sub-pixel quad misses
// most pixel centers and drops out in bands. Below that width the fade is
// carried by `vAaCoverage` instead of by the geometry.
const AA_MINIMUM_HALF_PX = 0.5
const vAaCoord = varyingProperty( 'float', 'vAaCoord' )
const vAaCoverage = varyingProperty( 'float', 'vAaCoverage' )

/**
 * TSL-based NodeMaterial for GPU line rendering. Extends `MeshBasicNodeMaterial`
 * and provides an extensive hook system for customizing every stage of the
 * vertex and fragment shaders via TSL functions.
 */
class MeshLineNodeMaterial extends MeshBasicNodeMaterial {

	constructor( options = null ) {
		super()
		this.type = 'MeshLineNodeMaterial'
		this.isMeshLineNodeMaterial = true
		if ( options ) this.buildLine( options )
	}

	/**
	 * Initialize the material from configuration options. Creates uniforms,
	 * configures hooks, and sets up the shader pipeline.
	 * @param {import('./index.d.ts').MeshLineConfigureOptions} options
	 */
	buildLine( options = {} ) {
		const lineWidth = Number( options.lineWidth ?? 1 )
		if ( !Number.isFinite( lineWidth ) || !Number.isFinite( Math.fround( lineWidth ) ) || lineWidth < 0 ) {
			throw new Error( '[MeshLineNodeMaterial] lineWidth must be a Float32-representable non-negative number' )
		}
		const resolution = options.resolution ?? new Vector2( 1, 1 )
		if ( !Number.isFinite( resolution.x ) || !Number.isFinite( resolution.y ) || resolution.x <= 0 || resolution.y <= 0 ) {
			throw new Error( '[MeshLineNodeMaterial] resolution must contain finite dimensions greater than zero' )
		}
		if ( typeof options.opacity === 'number' && ( !Number.isFinite( options.opacity ) || options.opacity < 0 || options.opacity > 1 ) ) {
			throw new Error( '[MeshLineNodeMaterial] opacity must be within [0, 1]' )
		}
		if ( options.alphaTest !== undefined && ( !Number.isFinite( options.alphaTest ) || options.alphaTest < 0 || options.alphaTest > 1 ) ) {
			throw new Error( '[MeshLineNodeMaterial] alphaTest must be within [0, 1]' )
		}
		if ( options.dpr !== undefined && ( !Number.isFinite( options.dpr ) || options.dpr <= 0 ) ) {
			throw new Error( '[MeshLineNodeMaterial] dpr must be greater than zero' )
		}
		if ( options.dashCount != null && ( !Number.isFinite( options.dashCount ) || options.dashCount < 0 ) ) {
			throw new Error( '[MeshLineNodeMaterial] dashCount must be a finite non-negative number or null' )
		}
		if ( options.dashRatio != null && ( !Number.isFinite( options.dashRatio ) || options.dashRatio < 0 || options.dashRatio > 1 ) ) {
			throw new Error( '[MeshLineNodeMaterial] dashRatio must be within [0, 1]' )
		}

		this.options = { ...options }
		this._segments = options.segments ?? 100
		this._needsWidth = options.needsWidth ?? false
		this._needsProgress = options.needsProgress ?? true
		this._needsVaryingColor = !!( options.needsVertexColor || options.colorFn )
		this._needsEndpointMetadata = !!(
			options.needsEndpointMetadata ||
			options.gpuPositionNode ||
			options.positionFn ||
			options.previousFn ||
			options.nextFn
		)
		this._endpointAttribute = this._needsEndpointMetadata ? attribute( 'endpoint', 'vec4' ) : null
		this.gradient = null
		this.opacity = null
		this.map = null
		this.alphaMap = null
		this.mapOffset = null
		this.repeat = null
		this.dashCount = null
		this.dashRatio = null
		this.dashOffset = null

		// classic properties
		this.depthWrite = options.depthWrite ?? true
		this.depthTest = options.depthTest ?? true
		this.wireframe = options.wireframe ?? false

		this.alphaTest = options.alphaTest ?? 0
		this.sizeAttenuation = options.sizeAttenuation ?? true

		// Can be changed dynamically
		this.resolution = uniform( resolution )
		this.lineWidth = uniform( lineWidth )
		this.color = uniform( new Color( options.color ?? 0xffffff ) )
		this.dpr = uniform( options.dpr ?? ( ( typeof window !== 'undefined' ) ? window.devicePixelRatio || 1 : 1 ) )

		// Conditional uniforms - only create what is needed
		if ( options.gradientColor != null ) {
			this.gradient = uniform( new Color( options.gradientColor ) )
		}

		// Analytic edge coverage is written into alpha, so it is invisible unless
		// the pipeline actually blends: three drops the blend state entirely for
		// an opaque NormalBlending material. Opting in therefore implies
		// transparency, which is also why this is off by default — MSAA already
		// antialiases the billboard silhouette, since the silhouette is the geometry.
		this.antialias = options.antialias ?? false

		const hasAlphaFeatures = options.alphaMap != null || ( options.opacity ?? 1 ) < 1 || this.antialias
		this.transparent = hasAlphaFeatures || ( options.transparent ?? false )
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
		this._miterLimit = sanitizeMiterLimit( options.miterLimit )
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

		if ( this._shadowEnabled ) this.buildShadowPositionNode()
		this.needsUpdate = true
	}

	dispose() {
		super.dispose()
	}

	get miterLimit() {
		return this._miterLimit
	}

	set miterLimit( value ) {
		this._miterLimit = sanitizeMiterLimit( value )
		if ( this.options ) this.options.miterLimit = this._miterLimit
		if ( this._miterThreshold ) {
			this._miterThreshold.value = 2 / this._miterLimit
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

	getLinePositions( progress, endpoint ) {
		let previousProgress = progress
		let nextProgress = progress
		if ( this._needsEndpointMetadata ) {
			const previousProgressOpen = progress.sub( endpoint.z ).clamp( 0, 1 )
			const nextProgressOpen = progress.add( endpoint.w ).clamp( 0, 1 )
			const previousProgressClosed = mod( progress.sub( endpoint.z ).add( 1 ), float( 1 ) )
			const nextProgressClosed = mod( progress.add( endpoint.w ), float( 1 ) )
			previousProgress = mix( previousProgressOpen, previousProgressClosed, endpoint.y ).toVar( 'previousProgress' )
			nextProgress = mix( nextProgressOpen, nextProgressClosed, endpoint.y ).toVar( 'nextProgress' )
		}

		// Get base positions
		let pos = this.gpuPositionNode ? this.gpuPositionNode( progress, float( 0 ) ) : positionGeometry
		let previous = this.gpuPositionNode ? this.gpuPositionNode( previousProgress, float( 0 ) ) : attribute( 'previous', 'vec3' )
		let next = this.gpuPositionNode ? this.gpuPositionNode( nextProgress, float( 0 ) ) : attribute( 'next', 'vec3' )
		// Apply position modifiers
		if ( this.positionFn ) {
			pos = this.positionFn( pos, progress )
			previous = this.positionFn( previous, previousProgress )
			next = this.positionFn( next, nextProgress )
		}

		if ( this.previousFn ) { previous = this.previousFn( previous, previousProgress ) }
		if ( this.nextFn ) { next = this.nextFn( next, nextProgress ) }

		return { pos, previous, next }
	}

	getLineWidth( width, progress, side ) {
		if ( this._needsWidth ) {
			width = width.mul( aWidth )
		}
		if ( this.widthFn ) {
			width = this.widthFn( width, progress, side )
		}
		return width
	}

	buildShadowPositionNode() {
		const shadowSide = this.options?.needsSide ? aSide : encodedSide

		this.castShadowPositionNode = Fn( () => {
			const progress = this._needsProgress ? aProgress : float( 0 )
			const side = shadowSide
			const endpoint = this._endpointAttribute ?? float( 0 )
			const endpointMarker = this._needsEndpointMetadata ? endpoint.x : float( 0 )

			// Get base positions in LOCAL space
			const { pos, previous, next } = this.getLinePositions( progress, endpoint )

			// Transform to VIEW space
			const posView = modelViewMatrix.mul( vec4( pos, 1.0 ) ).xyz
			const prevView = modelViewMatrix.mul( vec4( previous, 1.0 ) ).xyz
			const nextView = modelViewMatrix.mul( vec4( next, 1.0 ) ).xyz
			const posClip = cameraProjectionMatrix.mul( vec4( posView, 1.0 ) ).toVar( 'shadowPosClip' )
			const prevClip = cameraProjectionMatrix.mul( vec4( prevView, 1.0 ) ).toVar( 'shadowPrevClip' )
			const nextClip = cameraProjectionMatrix.mul( vec4( nextView, 1.0 ) ).toVar( 'shadowNextClip' )
			const posScreen = fix( posClip, float( 1 ) ).toVar( 'shadowPosScreen' )
			const prevScreen = fix( prevClip, float( 1 ) ).toVar( 'shadowPrevScreen' )
			const nextScreen = fix( nextClip, float( 1 ) ).toVar( 'shadowNextScreen' )
			const screenDelta1 = posScreen.sub( prevScreen ).toVar( 'shadowScreenDelta1' )
			const screenDelta2 = nextScreen.sub( posScreen ).toVar( 'shadowScreenDelta2' )
			const screenMinimumLength = float( SCREEN_DIRECTION_EPSILON )
			const screenDelta1Length = screenDelta1.length().toVar( 'shadowScreenDelta1Length' )
			const screenDelta2Length = screenDelta2.length().toVar( 'shadowScreenDelta2Length' )
			const screenDirection1 = screenDelta1.div( max( screenDelta1Length, screenMinimumLength ) ).toVar( 'shadowScreenDirection1' )
			const screenDirection2 = screenDelta2.div( max( screenDelta2Length, screenMinimumLength ) ).toVar( 'shadowScreenDirection2' )
			const projectedReversal = screenDelta1Length.greaterThanEqual( screenMinimumLength )
				.and( screenDelta2Length.greaterThanEqual( screenMinimumLength ) )
				.and( dot( screenDirection1, screenDirection2 ).lessThanEqual( float( SCREEN_REVERSAL_DOT_THRESHOLD ) ) )

			// Calculate a finite line direction in VIEW space. Open endpoints and
			// projected reversals reuse the owning physical body's direction, matching
			// the visible pass without reconnecting the duplicated join pairs.
			const delta1Raw = posView.sub( prevView ).toVar( 'shadowDelta1Raw' )
			const delta2Raw = nextView.sub( posView ).toVar( 'shadowDelta2Raw' )
			const reversalStart = outgoingVertex.and( projectedReversal ).select( float( 1 ), float( 0 ) )
			const reversalEnd = outgoingVertex.not().and( projectedReversal ).select( float( 1 ), float( 0 ) )
			const atStart = max( max( endpointMarker.negate(), float( 0 ) ), reversalStart ).toVar( 'shadowAtStart' )
			const atEnd = max( max( endpointMarker, float( 0 ) ), reversalEnd ).toVar( 'shadowAtEnd' )
			const delta1 = mix( delta1Raw, delta2Raw, atStart ).toVar( 'shadowDelta1' )
			const delta2 = mix( delta2Raw, delta1Raw, atEnd ).toVar( 'shadowDelta2' )
			const minimumLength = float( 0.0001 )
			const delta1Length = delta1.length().toVar( 'shadowDelta1Length' )
			const delta2Length = delta2.length().toVar( 'shadowDelta2Length' )
			const directionFallback = vec3( 1, 0, 0 ).toVar( 'shadowDirectionFallback' )
			const dir1Raw = delta1.div( max( delta1Length, minimumLength ) ).toVar( 'shadowDir1Raw' )
			const dir2Raw = delta2.div( max( delta2Length, minimumLength ) ).toVar( 'shadowDir2Raw' )
			const dir1 = mix(
				mix( directionFallback, dir2Raw, step( minimumLength, delta2Length ) ),
				dir1Raw,
				step( minimumLength, delta1Length )
			).toVar( 'shadowDir1' )
			const dir2 = mix( dir1, dir2Raw, step( minimumLength, delta2Length ) ).toVar( 'shadowDir2' )
			const directionSum = dir1.add( dir2 ).toVar( 'shadowDirectionSum' )
			const directionSumLength = directionSum.length().toVar( 'shadowDirectionSumLength' )
			const bodyDirection = outgoingVertex.select( dir2, dir1 ).toVar( 'shadowBodyDirection' )
			const directionBlend = directionSumLength.smoothstep(
				this._miterThreshold.mul( 0.75 ),
				this._miterThreshold
			).toVar( 'shadowDirectionBlend' )
			const blendedDirection = mix(
				bodyDirection,
				directionSum.div( max( directionSumLength, minimumLength ) ),
				directionBlend
			).toVar( 'shadowBlendedDirection' )
			const blendedDirectionLength = blendedDirection.length().toVar( 'shadowBlendedDirectionLength' )
			const dir = mix(
				bodyDirection,
				blendedDirection.div( max( blendedDirectionLength, minimumLength ) ),
				step( minimumLength, blendedDirectionLength )
			).toVar( 'shadowDir' )

			// Calculate perpendicular in VIEW space (billboard to camera)
			// In View space, camera is at (0,0,0) looking down -Z
			// We want the vector perpendicular to the line and the view direction (Z axis)
			// This is effectively the 2D normal in the XY plane
			const perpendicularRaw = vec3( dir.y.negate(), dir.x, 0 ).toVar( 'shadowPerpendicularRaw' )
			const perpendicularLength = perpendicularRaw.length().toVar( 'shadowPerpendicularLength' )
			const perp = mix(
				vec3( 1, 0, 0 ),
				perpendicularRaw.div( max( perpendicularLength, minimumLength ) ),
				step( minimumLength, perpendicularLength )
			).toVar( 'shadowPerpendicular' )

			const bodyScreenLength = outgoingVertex.select( screenDelta2Length, screenDelta1Length )
			const bodyVisible = step( screenMinimumLength, bodyScreenLength )
			const w = this.getLineWidth( this.lineWidth.mul( 0.5 ), progress, side ).mul( bodyVisible )

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
					cyclePosition.assign( this.dashFn( cyclePosition, vProg, varying( shadowSide ) ) )
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
		const progress = ( this._needsProgress ? aProgress : float( 0 ) ).toVar( 'varProgress' )
		const lineSide = this.options.needsSide ? aSide : encodedSide
		const side = lineSide.toVar( 'varSide' )
		// Fragment hooks need an interpolated float. Reusing the IndexNode there
		// would expose the provoking vertex's integer index for the whole triangle.
		const fragmentSide = varying( lineSide, 'vSide' )
		const endpoint = this._endpointAttribute ? this._endpointAttribute.toVar( 'varEndpoint' ) : float( 0 )
		const endpointMarker = this._needsEndpointMetadata ? endpoint.x : float( 0 )

		// Get base positions first
		const { pos, previous, next } = this.getLinePositions( progress, endpoint )

		this.vertexNode = Fn( () => {

			if ( this._needsVaryingColor ) {
				const color = vec4( this.color, 1 ).toVar( 'color' )

				if ( this.options.needsVertexColor ) {
					color.rgb.mulAssign( aColor )
				}

				if ( this.colorFn ) {
					color.assign( this.colorFn( color, progress, side ) )
				}

				vColor.assign( color )
			}

			// Only assign vProgress if needed to reduce varying bandwidth
			if ( this.gradient || this.dashCount || this.gradientFn || this.opacityFn || this.dashFn || this.uvFn || this.fragmentColorFn || this.fragmentAlphaFn || this.discardFn ) {
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
			// bisector under oblique perspective can be handled upstream by opting
			// into the geometry's `smoothSharpBends` pass.
			// At open endpoints, reuse the real segment direction instead of the
			// extrapolated neighbour direction; this keeps single-segment GPU lines
			// from tapering when the extrapolated point projects badly.
			const currentP = fix( finalPosition, aspect ).toVar( 'currentP' )
			const prevP = fix( prevPos, aspect ).toVar( 'prevP' )
			const nextP = fix( nextPos, aspect ).toVar( 'nextP' )
			const delta1Raw = currentP.sub( prevP ).toVar( 'delta1Raw' )
			const delta2Raw = nextP.sub( currentP ).toVar( 'delta2Raw' )
			const minDirectionLength = float( SCREEN_DIRECTION_EPSILON )
			const delta1RawLen = delta1Raw.length().toVar( 'delta1RawLen' )
			const delta2RawLen = delta2Raw.length().toVar( 'delta2RawLen' )
			const projectedDir1 = delta1Raw.div( max( delta1RawLen, minDirectionLength ) ).toVar( 'projectedDir1' )
			const projectedDir2 = delta2Raw.div( max( delta2RawLen, minDirectionLength ) ).toVar( 'projectedDir2' )
			const projectedReversal = delta1RawLen.greaterThanEqual( minDirectionLength )
				.and( delta2RawLen.greaterThanEqual( minDirectionLength ) )
				.and( dot( projectedDir1, projectedDir2 ).lessThanEqual( float( SCREEN_REVERSAL_DOT_THRESHOLD ) ) )
			const reversalStart = outgoingVertex.and( projectedReversal ).select( float( 1 ), float( 0 ) )
			const reversalEnd = outgoingVertex.not().and( projectedReversal ).select( float( 1 ), float( 0 ) )
			const atStart = max( max( endpointMarker.negate(), float( 0 ) ), reversalStart ).toVar( 'atStart' )
			const atEnd = max( max( endpointMarker, float( 0 ) ), reversalEnd ).toVar( 'atEnd' )
			const delta1 = mix( delta1Raw, delta2Raw, atStart ).toVar( 'delta1' )
			const delta2 = mix( delta2Raw, delta1Raw, atEnd ).toVar( 'delta2' )

			const w = this.getLineWidth( this.lineWidth, progress, side ).toVar( 'w' )

			// Miter offset. |dir1+dir2| = 2·cos(α/2) for interior bend α.
			// Once a miter would exceed the configured limit, the duplicated join rows
			// separate toward their owning incident bodies. This leaves a bounded butt
			// fallback instead of swapping strip sides or manufacturing a miter spike.
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
			const bodyDirection = outgoingVertex.select( dir2, dir1 ).toVar( 'bodyDirection' )
			const perpFallback = vec2( bodyDirection.y.negate(), bodyDirection.x ).toVar( 'perpFallback' )
			const miterBlend = dirSumLen.smoothstep(
				this._miterThreshold.mul( 0.75 ),
				this._miterThreshold
			).toVar( 'miterBlend' )
			const blendedPerp = mix(
				perpFallback,
				perpRaw.div( max( dirSumLen, float( 0.0001 ) ) ),
				miterBlend
			).toVar( 'blendedPerp' )
			const blendedPerpLength = blendedPerp.length().toVar( 'blendedPerpLength' )
			const unitPerp = mix(
				perpFallback,
				blendedPerp.div( max( blendedPerpLength, float( 0.0001 ) ) ),
				step( float( 0.0001 ), blendedPerpLength )
			).toVar( 'unitPerp' )

			const miterHalfWidth = mix(
				w.mul( 0.5 ),
				w.div( max( dirSumLen, this._miterThreshold ) ),
				miterBlend
			).toVar( 'miterHalfWidth' )

			const normal = vec4( 0, 0, 0, 1 ).toVar( 'normal' )
			normal.xy.assign( unitPerp.mul( miterHalfWidth ) )

			// Apply normal modifier if provided. Supported joins still pass their unit
			// bisector; a bounded fallback passes the owning body's direction so hooks
			// follow the same frame as the physical cross-section.
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

			if ( this.antialias ) {
				// Measure the emitted half-extent in device pixels, pad it outward by
				// half a pixel, and rescale the coordinate so |vAaCoord| == 1 still
				// marks the *unpadded* edge. The fragment band is then centred on the
				// real silhouette instead of eaten out of the stroke.
				const halfNdc = normal.xy.div( max( finalPosition.w.abs(), float( 1e-6 ) ) ).toVar( 'halfNdc' )
				const halfPx = vec2(
					halfNdc.x.mul( this.resolution.x ),
					halfNdc.y.mul( this.resolution.y )
				).mul( float( 0.5 ).mul( this.dpr ) ).length().toVar( 'halfPx' )
				// The pad rides along the miter bisector, so at a corner only
				// cos(theta/2) of it lands perpendicular to the stroke. Divide that
				// back out, bounded by the miter limit — which already bounds how far
				// the bisector itself may stretch. |dirSum| / 2 is cos(theta/2), and
				// the fallback cross-section has no bisector stretch to undo.
				const cosHalfAngle = mix(
					float( 1 ),
					max( dirSumLen.mul( 0.5 ), this._miterThreshold.mul( 0.5 ) ),
					miterBlend
				).toVar( 'cosHalfAngle' )
				const edgePad = float( AA_EDGE_PADDING_PX ).div( max( cosHalfAngle, float( 1e-4 ) ) ).toVar( 'edgePad' )
				const paddedHalfPx = max( halfPx, float( AA_MINIMUM_HALF_PX ) ).add( edgePad ).toVar( 'paddedHalfPx' )
				const aaScale = paddedHalfPx.div( max( halfPx, float( 1e-6 ) ) ).toVar( 'aaScale' )
				normal.xy.mulAssign( aaScale )
				vAaCoord.assign( side.mul( aaScale ) )
				// A stroke thinner than one device pixel can no longer lose width to
				// the geometry clamp above, so fade it by its true coverage instead.
				vAaCoverage.assign( min( float( 1 ), halfPx.mul( 2 ) ) )
			}

			// Collapse a vertex whose own incident body has no projected length onto
			// its centerline rather than pushing it outside the frustum. A join-fill
			// triangle spans two different bodies, so an off-frustum sentinel on one
			// pair would stretch a wedge across the viewport. Gate the offset (a
			// select, never a multiply — NaN * 0 is still NaN) so `normalFn`,
			// `sizeAttenuation` and `vertexFn` keep running on the collapsed row.
			// This matches what the shadow path already does with `bodyVisible`.
			const bodyLength = outgoingVertex.select( delta2RawLen, delta1RawLen )
			const bodyVisible = bodyLength.greaterThanEqual( minDirectionLength )
			finalPosition.xy.addAssign( bodyVisible.select( normal.xy, vec2( 0 ) ).mul( side ) )

			// Apply vertex modifier if provided
			if ( this.vertexFn ) {
				finalPosition.assign( this.vertexFn( finalPosition, normal, progress, side ) )
			}

			// `bodyVisible` used to double as the NaN sink for the whole vertex, so
			// keep an explicit one now that it only gates the offset. NaN fails every
			// comparison, so the self-equality test is false exactly when it matters.
			const positionFinite = finalPosition.x.equal( finalPosition.x )
				.and( finalPosition.y.equal( finalPosition.y ) )
				.and( finalPosition.z.equal( finalPosition.z ) )
				.and( finalPosition.w.equal( finalPosition.w ) )
			return positionFinite.select( finalPosition, vec4( 2, 2, 2, 1 ) )
		} )()
		let uvCoords
		if ( ( this.map && this.map.value ) || ( this.alphaMap && this.alphaMap.value ) || this.uvFn || this.fragmentColorFn || this.fragmentAlphaFn || this.discardFn ) {
			uvCoords = uv().mul( this.repeat || vec2( 1, 1 ) ).add( this.mapOffset || vec2( 0, 0 ) ).toVar( 'uvCoords' )

			// Apply UV modifier if provided
			if ( this.uvFn ) {
				uvCoords = this.uvFn( uvCoords, vProgress, fragmentSide )
			}
		}
		// Color node
		this.colorNode = Fn( () => {
			let color = ( this._needsVaryingColor ? vColor : vec4( this.color, 1 ) ).toVar( 'color' )
			if ( this.gradient ) {
				let gradientFactor = vProgress.toVar( 'gradientFactor' )

				// Apply gradient modifier if provided
				if ( this.gradientFn ) {
					gradientFactor.assign( this.gradientFn( gradientFactor, fragmentSide ) )
				}

				color.rgb.assign( mix( color.rgb, this.gradient, gradientFactor ) )
			}

			if ( this.map && this.map.value ) {
				color.mulAssign( this.map.sample( uvCoords ) )
			}

			// Apply fragment color modifier if provided
			if ( this.fragmentColorFn ) {
				color.assign( this.fragmentColorFn( color, uvCoords, vProgress, fragmentSide ) )
			}

			return color
		} )()

		// Opacity node
		this.opacityNode = Fn( () => {
			let alpha = float( 1 ).toVar( 'alpha' )

			if ( this.antialias ) {
				// Evaluated before any Discard so the derivative stays in uniform
				// control flow. `fwidth` is the Manhattan sum and overestimates the
				// gradient by up to sqrt(2) on diagonal edges, which would blur them;
				// take the real gradient length instead. Coverage under a box filter
				// is linear in distance, so no smoothstep here either.
				// Differentiate the SIGNED coordinate: dFdx( abs( v ) ) folds toward zero
				// in any 2x2 quad straddling the mid-line, and on a two-pixel padded
				// strip that is most of them, so the gradient under-reads and coverage
				// clamps to 1 wherever the centerline happens to fall.
				const gradient = vec2( dFdx( vAaCoord ), dFdy( vAaCoord ) ).length().toVar( 'aaGradient' )
				const edge = vAaCoord.abs().toVar( 'aaEdge' )
				// `(1 - edge) / gradient + 0.5` is the distance in pixels from this
				// sample to the nearer edge, offset to the pixel centre — box coverage
				// for a strip wider than the filter. A narrower strip is capped by its
				// own width, which is what `vAaCoverage` carries, so the two combine
				// with min(): multiplying them would attenuate a sub-pixel line twice.
				const coverage = float( 1 ).sub( edge ).div( max( gradient, float( 1e-6 ) ) )
					.add( 0.5 ).clamp( 0, 1 )
				alpha.mulAssign( min( coverage, vAaCoverage ) )
			}

			if ( this.alphaMap && this.alphaMap.value ) {
				alpha.mulAssign( this.alphaMap.sample( uvCoords ).r )
			}

			if ( this.opacity ) {
				alpha.mulAssign( this.opacity )
			}

			// Apply opacity modifier if provided
			if ( this.opacityFn ) {
				alpha.assign( this.opacityFn( alpha, vProgress, fragmentSide ) )
			}

			if ( this.dashCount ) {
				let cyclePosition = mod( vProgress.mul( this.dashCount ).add( this.dashOffset ), float( 1 ) ).toVar( 'cyclePosition' )

				// Apply dash modifier if provided
				if ( this.dashFn ) {
					cyclePosition.assign( this.dashFn( cyclePosition, vProgress, fragmentSide ) )
				}

				// dashRatio represents a dash portion: 0.1 = 10% dash, 90% gap
				const dashMask = step( cyclePosition, this.dashRatio )
				Discard( dashMask.lessThan( 0.001 ) )
			}

			if ( this.discardFn ) {
				Discard( this.discardFn( vProgress, fragmentSide, uvCoords ) )
			}

			// Apply fragment alpha modifier if provided
			if ( this.fragmentAlphaFn ) {
				alpha.assign( this.fragmentAlphaFn( alpha, uvCoords, vProgress, fragmentSide ) )
			}

			return alpha
		} )()

	}

	copy( source ) {
		super.copy( source )

		if ( source.options ) {
			this.buildLine( { ...source.options } )
		}

		// Copy classic material properties
		this.transparent = source.transparent
		this.depthWrite = source.depthWrite
		this.depthTest = source.depthTest
		this.wireframe = source.wireframe

		// Copy feature flags
		this.alphaTest = source.alphaTest
		this.sizeAttenuation = source.sizeAttenuation
		this.antialias = source.antialias

		// Copy uniform values
		if ( source.lineWidth && this.lineWidth ) this.lineWidth.value = source.lineWidth.value

		// Copy uniforms (guard on source having the uniform)
		if ( source.opacity && this.opacity ) this.opacity.value = source.opacity.value
		if ( source.map && this.map ) this.map.value = source.map.value
		if ( source.alphaMap && this.alphaMap ) this.alphaMap.value = source.alphaMap.value
		if ( source.gradient && this.gradient ) this.gradient.value.copy( source.gradient.value )
		if ( source.dashCount && this.dashCount ) this.dashCount.value = source.dashCount.value
		if ( source.dashRatio && this.dashRatio ) this.dashRatio.value = source.dashRatio.value
		if ( source.dashOffset && this.dashOffset ) this.dashOffset.value = source.dashOffset.value
		if ( source._miterLimit !== undefined && this._miterThreshold ) {
			this.miterLimit = source._miterLimit
		}
		if ( source.color && this.color ) this.color.value.copy( source.color.value )
		if ( source.resolution && this.resolution ) this.resolution.value.copy( source.resolution.value )
		if ( source.repeat && this.repeat ) this.repeat.value.copy( source.repeat.value )
		if ( source.mapOffset && this.mapOffset ) this.mapOffset.value.copy( source.mapOffset.value )
		if ( source.dpr && this.dpr ) this.dpr.value = source.dpr.value

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

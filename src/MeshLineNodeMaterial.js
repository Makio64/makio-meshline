import { Color, Vector2, MeshBasicNodeMaterial } from 'three/webgpu'
import { float, vec4, vec2, Fn, uniform, uv, modelViewMatrix, normalize, positionGeometry, cameraProjectionMatrix, attribute, varyingProperty, Discard, step, mix, texture, mod, abs, max, dot, clamp, smoothstep, sin, cos } from 'three/tsl'

const fix = Fn( ( [i_immutable, aspect_immutable] ) => {
	const aspect = float( aspect_immutable ).toVar()
	const i = vec4( i_immutable ).toVar()
	const ndc = vec2( i.xy.div( i.w ) ).toVar( 'ndc' )
	const res = vec2( ndc.x.mul( aspect ), ndc.y ).toVar( 'res' )
	return res
} ).setLayout( { name: 'fix', type: 'vec2', inputs: [
	{ name: 'i', type: 'vec4' },
	{ name: 'aspect', type: 'float' }
] } )

class MeshLineNodeMaterial extends MeshBasicNodeMaterial {

	constructor() {
		super()
		this.type = 'MeshLineNodeMaterial'
		this.isMeshLineNodeMaterial = true
	}

	buildLine( options = {} ) {

		this.options = options
		
		// classic properties
		this.depthWrite = options.depthWrite ?? true
		this.depthTest = options.depthTest ?? true
		this.wireframe = options.wireframe ?? false

		this.alphaTest = options.alphaTest ?? 0
		this.sizeAttenuation = options.sizeAttenuation ?? true
		this.useMiterLimit = options.useMiterLimit ?? false

		// Can be changed dynamically
		this.resolution = uniform( options.resolution ?? new Vector2( 1, 1 ) )
		this.lineWidth = uniform( options.lineWidth ?? 1 )
		this.color = uniform( new Color( options.color ?? 0xffffff ) )
		this.dpr = uniform( options.dpr ?? ( ( typeof window !== 'undefined' ) ? window.devicePixelRatio || 1 : 1 ) )

		// Conditional uniforms - only create what is needed
		if ( options.gradientColor ) {
			this.gradient = uniform( new Color( options.gradientColor ) )
		}

		const hasAlphaFeatures = options.alphaMap != null || ( options.opacity ?? 1 ) < 1 || this.alphaTest > 0
		this.transparent = hasAlphaFeatures || options.transparent
		if ( this.transparent || this.alphaTest > 0 ) {
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

		if ( this.useMiterLimit ) {
			this.miterLimit = uniform( options.miterLimit ?? 4.0 )
		}

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

	setup( builder ) {
		this.setupShaders( builder )
		super.setup( builder )
	}

	setupShaders( {  } ) {

		// Only declare counters if needed
		let counters
		if ( this.options.needsCounter || this.gradient || this.dashCount || this.gpuPositionNode || 
			 this.widthFn || this.colorFn || this.dashFn ) {
			counters = attribute( 'counters', 'float' ).toVar( 'aCounters' )
		}
		
		let segments = this.options.lines?.length / 3 || 1
		
		// Apply position modifiers if provided
		let pos = this.gpuPositionNode ? this.gpuPositionNode( counters, 0 ) : positionGeometry
		if ( this.positionFn ) {
			pos = this.positionFn( pos, counters )
		}
		
		let previous = this.gpuPositionNode ? this.gpuPositionNode( counters.sub( 1 / segments ) ) : attribute( 'previous', 'vec3' ).toVar( 'aPrevious' )
		if ( this.previousFn ) {
			previous = this.previousFn( previous, counters )
		}
		
		let next = this.gpuPositionNode ? this.gpuPositionNode( counters.add( 1 / segments ) ) : attribute( 'next', 'vec3' ).toVar( 'aNext' )
		if ( this.nextFn ) {
			next = this.nextFn( next, counters )
		}

		const side = attribute( 'side', 'float' ).toVar( 'aSide' )
		let width
		if ( this.options.needsWidth || this.widthFn ) {
			width = attribute( 'width', 'float' ).toVar( 'aWidth' )
		}

		// Make these available as varyings for fragment shader
		varyingProperty( 'float', 'vSide' ).assign( side )
		if ( width ) {
			varyingProperty( 'float', 'vWidth' ).assign( width )
		}

		this.vertexNode = Fn( () => {

			let vertexColor = vec4( this.color, 1 ).toVar( 'vertexColor' )
			
			if ( this.colorFn ) {
				vertexColor.assign( this.colorFn( vertexColor, counters, side ) )
			}
			
			varyingProperty( 'vec4', 'vColor' ).assign( vertexColor )

			// Only assign vCounters if needed to reduce varying bandwidth
			if ( this.gradient || this.dashCount || this.gradientFn || this.dashFn ) {
				varyingProperty( 'float', 'vCounters' ).assign( counters )
			}

			const aspect = this.resolution.x.div( this.resolution.y ).toVar( 'aspect' )
			const mvpMatrix = cameraProjectionMatrix.mul( modelViewMatrix ).toVar( 'mvpMatrix' )
			const finalPosition = mvpMatrix.mul( vec4( pos, 1.0 ) ).toVar( 'finalPosition' )
			const prevPos = mvpMatrix.mul( vec4( previous, 1.0 ) ).toVar( 'prevPos' )
			const nextPos = mvpMatrix.mul( vec4( next, 1.0 ) ).toVar( 'nextPos' )

			// screen-space transformations
			const currentP = fix( finalPosition, aspect ).toVar( 'currentP' )
			const prevP = fix( prevPos, aspect ).toVar( 'prevP' )
			const nextP = fix( nextPos, aspect ).toVar( 'nextP' )

			let w = this.lineWidth.mul( this.dpr ).toVar( 'w' )
			if ( width ) {
				w.mulAssign( width )
			}
			
			// Apply width modifier if provided
			if ( this.widthFn ) {
				w.assign( this.widthFn( w, counters, side ) )
			}
			
			// Calculate the miter direction
			const dir1 = normalize( currentP.sub( prevP ) ).toVar( 'dir1' )
			const dir2 = normalize( nextP.sub( currentP ) ).toVar( 'dir2' )
			const dir = normalize( dir1.add( dir2 ) ).toVar( 'dir' )

			// Calculate final normal based on whether miter limit is enabled
			let normal = vec4( 0, 0, 0, 1 ).toVar( 'normal' )

			if ( this.useMiterLimit ) {
				// Calculate miter length
				const miterLength = float( 1 ).div( max( dot( dir1, dir ), float( 0.01 ) ) ).toVar( 'miterLength' )
				const limitedMiterLength = miterLength.min( this.miterLimit ).toVar( 'limitedMiterLength' )

				// Advanced normal (perp to bisector, scaled by limited miter length)
				const advancedNormal = vec2( dir.y.negate(), dir.x ).mul( limitedMiterLength ).toVar( 'advancedNormal' )

				// Use advanced normal for consistent thickness
				normal.xy.assign( advancedNormal )
				normal.xy.mulAssign( w.mul( 0.5 ) )
			} else {
				// Simple approach only
				normal.xy.assign( vec2( dir.y.negate(), dir.x ) )
				normal.xy.mulAssign( w.mul( 0.5 ) )
			}

			// Apply normal modifier if provided
			if ( this.normalFn ) {
				normal.assign( this.normalFn( normal, dir, dir1, dir2, counters, side ) )
			}

			if ( this.sizeAttenuation ) {
				normal.xy.mulAssign( finalPosition.w )
				normal.xy.divAssign( vec4( this.resolution, 0., 1. ).mul( cameraProjectionMatrix ).xy.mul( aspect ) )
			}

			// un-stretch X
			normal.x.divAssign( aspect )

			finalPosition.xy.addAssign( normal.xy.mul( side ) )
			
			// Apply vertex modifier if provided
			if ( this.vertexFn ) {
				finalPosition.assign( this.vertexFn( finalPosition, normal, counters, side ) )
			}
			
			return finalPosition
		} )()

		let vCounters
		if ( this.gradient || this.dashCount || this.gradientFn || this.dashFn ) {
			vCounters = varyingProperty( 'float', 'vCounters' ).toVar()
		}
		
		let uvCoords
		if ( ( this.map && this.map.value ) || ( this.alphaMap && this.alphaMap.value ) || this.uvFn ) {
			uvCoords = uv().mul( this.repeat || vec2( 1, 1 ) ).add( this.mapOffset || vec2( 0, 0 ) ).toVar( 'uvCoords' )
			
			// Apply UV modifier if provided
			if ( this.uvFn ) {
				uvCoords.assign( this.uvFn( uvCoords, vCounters, varyingProperty( 'float', 'vSide' ) ) )
			}
		}

		// Color node
		this.colorNode = Fn( () => {

			let color = varyingProperty( 'vec4', 'vColor' ).toVar( 'color' )

			if ( this.gradient ) {
				let gradientFactor = vCounters.toVar( 'gradientFactor' )
				
				// Apply gradient modifier if provided
				if ( this.gradientFn ) {
					gradientFactor.assign( this.gradientFn( gradientFactor, varyingProperty( 'float', 'vSide' ) ) )
				}
				
				color.rgb.assign( mix( color.rgb, this.gradient, gradientFactor ) )
			}

			if ( this.map && this.map.value ) {
				color.mulAssign( this.map.sample( uvCoords ) )
			}
			
			// Apply fragment color modifier if provided
			if ( this.fragmentColorFn ) {
				color.assign( this.fragmentColorFn( color, uvCoords, vCounters, varyingProperty( 'float', 'vSide' ) ) )
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
				alpha.assign( this.opacityFn( alpha, vCounters, varyingProperty( 'float', 'vSide' ) ) )
			}

			Discard( alpha.lessThan( this.alphaTest ) )

			if ( this.dashCount ) {
				let cyclePosition = mod( vCounters.mul( this.dashCount ).add( this.dashOffset ), float( 1 ) ).toVar( 'cyclePosition' )
				
				// Apply dash modifier if provided
				if ( this.dashFn ) {
					cyclePosition.assign( this.dashFn( cyclePosition, vCounters, varyingProperty( 'float', 'vSide' ) ) )
				}
				
				// dashRatio represents a dash portion: 0.1 = 10% dash, 90% gap
				const dashMask = step( cyclePosition, this.dashRatio )
				Discard( dashMask.lessThan( 0.001 ) )
			}

			if ( this.discardFn ) {
				Discard( this.discardFn( vCounters, varyingProperty( 'float', 'vSide' ), uvCoords ) )
			}
			
			// Apply fragment alpha modifier if provided
			if ( this.fragmentAlphaFn ) {
				alpha.assign( this.fragmentAlphaFn( alpha, uvCoords, vCounters, varyingProperty( 'float', 'vSide' ) ) )
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
		this.useMiterLimit = source.useMiterLimit

		// Copy uniform values
		this.lineWidth.value = source.lineWidth.value

		// Copy uniforms
		this.opacity?.value && ( this.opacity.value = source.opacity.value )
		this.map?.value && ( this.map.value = source.map.value )
		this.alphaMap?.value && ( this.alphaMap.value = source.alphaMap.value )
		this.gradient?.value && ( this.gradient.value = source.gradient.value )
		this.dashCount?.value && ( this.dashCount.value = source.dashCount.value )
		this.dashRatio?.value && ( this.dashRatio.value = source.dashRatio.value )
		this.dashOffset?.value && ( this.dashOffset.value = source.dashOffset.value )
		this.miterLimit?.value && ( this.miterLimit.value = source.miterLimit.value )
		source.color?.value && this.color.value.copy( source.color.value )
		source.resolution?.value && this.resolution.value.copy( source.resolution.value )
		source.repeat?.value && this.repeat.value.copy( source.repeat.value )
		source.mapOffset?.value && this.mapOffset.value.copy( source.mapOffset.value )

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

		return this
	}

	static get type() {
		return 'MeshLineNodeMaterial'
	}

}

export { MeshLineNodeMaterial }
export default MeshLineNodeMaterial
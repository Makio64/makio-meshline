import { NodeMaterial, Color, Vector2 } from 'three/webgpu'
import { float, vec4, vec2, Fn, uniform, uv, modelViewMatrix, normalize, positionGeometry, cameraProjectionMatrix, attribute, varyingProperty, Discard, step, mix, texture, mod } from 'three/tsl'

// Fix function to avoid recreation
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

class MeshLineNodeMaterial extends NodeMaterial {

	constructor( parameters = {} ) {
		super()

		// Auto-detect features based on provided parameters
		const hasCustomOpacity = parameters.opacity !== undefined && parameters.opacity < 1
		const hasAlphaMap = parameters.alphaMap !== undefined && parameters.alphaMap !== null

		// Auto-set transparency when needed
		const needsTransparency = hasAlphaMap || hasCustomOpacity || ( parameters.transparent === true )

		// classic properties
		this.transparent = parameters.transparent ?? needsTransparency
		this.depthWrite = parameters.depthWrite ?? true
		this.depthTest = parameters.depthTest ?? true
		this.wireframe = parameters.wireframe ?? false

		this.alphaTest = parameters.alphaTest ?? 1
		this.sizeAttenuation = parameters.sizeAttenuation ?? true

		// Can be changed dynamically
		this.resolution = uniform( parameters.resolution ?? new Vector2( 1 ) )
		this.lineWidth = uniform( parameters.lineWidth ?? 1 )
		this.color = uniform( new Color( parameters.color ?? 0xffffff ) )
		this.gradient = uniform( parameters.gradient ?? null )
		this.opacity = uniform( parameters.opacity ?? 1 )
		this.map = texture( parameters.map ?? null )
		this.alphaMap = texture( parameters.alphaMap ?? null )
		this.mapOffset = uniform( parameters.mapOffset ?? new Vector2( 0, 0 ) )
		this.repeat = uniform( parameters.repeat ?? new Vector2( 1, 1 ) )
		this.dashCount = uniform( parameters.dashCount ?? null )
		this.dashRatio = uniform( parameters.dashRatio ?? parameters.dashLength ?? null )
		this.dashOffset = uniform( parameters.dashOffset ?? 0 )

	}

	dispose() {
		super.dispose()
	}

	setup( builder ) {
		this.setupShaders( builder )
		super.setup( builder )
	}

	setupShaders( {  } ) {

		const previous = attribute( 'previous', 'vec3' ).toVar( 'aPrevious' )
		const next = attribute( 'next', 'vec3' ).toVar( 'aNext' )
		const side = attribute( 'side', 'float' ).toVar( 'aSide' )
		const width = attribute( 'width', 'float' ).toVar( 'aWidth' )

		// Only declare counters if needed
		let counters
		if ( this.gradient.value || this.dashCount.value ) {
			counters = attribute( 'counters', 'float' ).toVar( 'aCounters' )
		}

		this.vertexNode = Fn( () => {

			varyingProperty( 'vec4', 'vColor' ).assign( vec4( this.color, 1 ) )

			// Only assign vCounters if needed to reduce varying bandwidth
			if ( this.gradient.value || this.dashCount.value ) {
				varyingProperty( 'float', 'vCounters' ).assign( counters )
			}

			const aspect = this.resolution.x.div( this.resolution.y ).toVar( 'aspect' )

			const mvpMatrix = cameraProjectionMatrix.mul( modelViewMatrix ).toVar( 'mvpMatrix' )
			const finalPosition = mvpMatrix.mul( vec4( positionGeometry, 1.0 ) ).toVar( 'finalPosition' )
			const prevPos = mvpMatrix.mul( vec4( previous, 1.0 ) ).toVar( 'prevPos' )
			const nextPos = mvpMatrix.mul( vec4( next, 1.0 ) ).toVar( 'nextPos' )

			// screen-space transformations
			const currentP = fix( finalPosition, aspect ).toVar( 'currentP' )
			const prevP = fix( prevPos, aspect ).toVar( 'prevP' )
			const nextP = fix( nextPos, aspect ).toVar( 'nextP' )

			const w = this.lineWidth.mul( width ).toVar( 'w' )

			const dir1 = normalize( currentP.sub( prevP ) ).toVar( 'dir1' )
			const dir2 = normalize( nextP.sub( currentP ) ).toVar( 'dir2' )
			const dir = normalize( dir1.add( dir2 ) ).toVar( 'dir' )

			// build normal in screen-space
			const normal = vec4( dir.y.negate(), dir.x, 0., 1. ).toVar( 'normal' )
			normal.xy.mulAssign( w.mul( .5 ) )

			if( this.sizeAttenuation ) {
				normal.xy.mulAssign( finalPosition.w )
				normal.xy.divAssign( vec4( this.resolution, 0., 1. ).mul( cameraProjectionMatrix ).xy.mul( aspect ) )
			}

			// un-stretch X
			normal.x.divAssign( aspect )

			finalPosition.xy.addAssign( normal.xy.mul( side ) )
			return finalPosition
		} )()

		this.fragmentNode = Fn( () => {

			if( this.discardConditionNode ) {
				Discard( this.discardConditionNode )
			}

			let vCounters
			if( this.gradient.value || this.dashCount.value ) {
				vCounters = varyingProperty( 'float', 'vCounters' ).toVar()
			}

			let diffuseColor = varyingProperty( 'vec4', 'vColor'  ).toVar( 'diffuseColor' )

			if( this.colorNode ) {
				diffuseColor.mulAssign( this.colorNode )
			}
			if( this.gradient.value ) {
				diffuseColor.rgb.assign( mix( diffuseColor.rgb, this.gradient, vCounters ) )
			}

			let uvCoords
			if( this.map.value || this.alphaMap.value ) {
				uvCoords = uv().mul( this.repeat ).add( this.mapOffset ).toVar( 'uvCoords' )
			}
			if ( this.map.value ) {
				diffuseColor.mulAssign( this.map.sample( uvCoords ) )
			}
			if ( this.alphaMap.value ) {
				diffuseColor.a.mulAssign( this.alphaMap.sample( uvCoords ).b )
			}

			if ( this.alphaTest < 1 ) {
				Discard( diffuseColor.a.lessThan( this.alphaTest ) )
			}

			if( this.dashCount.value ) {
				const cyclePosition = mod( vCounters.mul( this.dashCount ).add( this.dashOffset ), float( 1 ) )
				// dashLength represents a dash portion: 0.1 = 10% dash, 90% gap
				const dashMask = step( cyclePosition, this.dashRatio )
				Discard( dashMask.lessThan( 0.001 ) )
			}

			// Apply opacity
			diffuseColor.a.mulAssign( this.opacity )
			if( this.opacityNode ) {
				diffuseColor.a.mulAssign( this.opacityNode )
			}

			return diffuseColor

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
		this.opacity.value = source.opacity.value
		this.map.value = source.map.value
		this.alphaMap.value = source.alphaMap.value
		this.gradient.value = source.gradient.value
		this.dashCount.value = source.dashCount.value
		this.dashRatio.value = source.dashRatio.value
		this.dashOffset.value = source.dashOffset.value

		// Copy object uniforms with optional chaining
		source.color.value && this.color.value.copy( source.color.value )
		source.resolution.value && this.resolution.value.copy( source.resolution.value )
		source.repeat.value && this.repeat.value.copy( source.repeat.value )
		source.mapOffset.value && this.mapOffset.value.copy( source.mapOffset.value )

		return this
	}

	static get type() {
		return 'MeshLineNodeMaterial'
	}

}

export { MeshLineNodeMaterial }
export default MeshLineNodeMaterial

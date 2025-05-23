import { Color, Vector2 } from 'three'
import { NodeMaterial } from 'three/webgpu'
import { float, vec4, vec2, Fn, uniform, uv, modelViewMatrix, normalize, If, positionGeometry, cameraProjectionMatrix, attribute, varyingProperty, Discard, step, mix, texture, ceil, mod, cross, vec3 } from 'three/tsl'

class MeshLineNodeMaterial extends NodeMaterial {

	static get type() {
		return 'MeshLineNodeMaterial'
	}

	constructor( parameters = {} ) {
		super()

		// classic properties
		this.transparent = parameters.transparent ?? this.opacity.value < 1
		this.depthWrite = parameters.depthWrite ?? !this.transparent
		this.depthTest = parameters.depthTest ?? !this.transparent
		this.wireframe = parameters.wireframe ?? false

		// needs to rebuilt material on change, needsUpdate = true
		this.useMap = parameters.useMap ?? 0
		this.useAlphaMap = parameters.useAlphaMap
		this.useDash = parameters.useDash ?? false
		this.useGradient = parameters.useGradient ?? false
		this.alphaTest = parameters.alphaTest
		this.sizeAttenuation =  parameters.sizeAttenuation ?? true

		// dynamic change
		this.lineWidth = uniform( parameters.lineWidth ?? 1 )
		this.map = uniform( parameters.map ?? null )
		this.alphaMap = uniform( parameters.alphaMap ?? null )
		this.color = uniform( new Color( parameters.color ?? 0xffffff ) )
		this.gradient = uniform( parameters.gradient ?? new Color( 0xff0000 ) )
		this.opacity = uniform( parameters.opacity ?? 1 )
		this.resolution = uniform( parameters.resolution ?? new Vector2( 1 ) )
		this.dashArray = uniform( parameters.dashArray ?? 0 )
		this.dashOffset = uniform( parameters.dashOffset ?? 0 )
		this.dashRatio = uniform( parameters.dashRatio ?? 0.5 )
		this.repeat = uniform( parameters.repeat ?? new Vector2( 1, 1 ) )

	}

	dispose() {
		super.dispose()
	}

	setup( builder ) {
		this.setupShaders( builder )
		super.setup( builder )
	}

	setupShaders( {  } ) {

		const resolution = this.resolution
		const lineWidth = this.lineWidth
		const color = this.color
		const opacity = this.opacity

		const alphaTest = this.alphaTest
		const repeat = this.repeat
		const alphaMap = this.alphaMap
		const gradient = this.gradient

		const fix = Fn( ( [i_immutable, aspect_immutable] ) => {
			const aspect = float( aspect_immutable ).toVar()
			const i = vec4( i_immutable ).toVar()
			const ndc = vec2( i.xy.div( i.w ) ).toVar( 'ndc' )
			const res = vec2( ndc.x.mul( aspect ), ndc.y ).toVar( 'res' )
			return res
		} ).setLayout( { name: 'fix', type: 'vec2', inputs: [
			{ name: 'i', type: 'vec4' },
			{ name: 'aspect', type: 'float' }
		]
		} )

		const previous = attribute( 'previous', 'vec3' ).toVar( 'aPrevious' )
		const next = attribute( 'next', 'vec3' ).toVar( 'aNext' )
		const side = attribute( 'side', 'float' ).toVar( 'aSide' )
		const width = attribute( 'width', 'float' ).toVar( 'aWidth' )
		const counters = attribute( 'counters', 'float' ).toVar( 'aCounters' )

		this.vertexNode = Fn( () => {

			varyingProperty( 'vec4', 'vColor' ).assign( vec4( color, opacity ) )
			varyingProperty( 'float', 'vCounters' ).assign( counters )

			const aspect = resolution.x.div( resolution.y ).toVar( 'aspect' )
			const m = cameraProjectionMatrix.mul( modelViewMatrix ).toVar( 'm' )
			const finalPosition = m.mul( vec4( positionGeometry, 1.0 ) ).toVar()
			const prevPos = m.mul( vec4( previous, 1.0 ) ).toVar( 'prevPos' )
			const nextPos = m.mul( vec4( next, 1.0 ) ).toVar( 'nextPos' )

			const currentP = fix( finalPosition, aspect ).toVar( 'currentP' )
			const prevP = fix( prevPos, aspect ).toVar( 'prevP' )
			const nextP = fix( nextPos, aspect ).toVar( 'nextP' )

			const w = lineWidth.mul( width ).toVar( 'w' )

			const dir1 = normalize( currentP.sub( prevP ) ).toVar( 'dir1' )
			const dir2 = normalize( nextP.sub( currentP ) ).toVar( 'dir2' )
			const dir = normalize( dir1.add( dir2 ) ).toVar( 'dir' )

			// build normal in screen-space
			const normal = vec4( dir.y.negate(), dir.x, 0., 1. ).toVar( 'normal' )
			normal.xy.mulAssign( float( .5 ).mul( w ) )

			if( this.sizeAttenuation ) {

				normal.xy.mulAssign( finalPosition.w )
				normal.xy.divAssign( vec4( resolution, 0., 1. ).mul( cameraProjectionMatrix ).xy.mul( aspect ) )

			}

			// un-stretch X
			normal.x.divAssign( aspect )

			finalPosition.xy.addAssign( normal.xy.mul( side ) )
			return finalPosition
		} )()

		this.fragmentNode = Fn( () => {
			const vCounters = varyingProperty( 'float', 'vCounters' ).toVar()

			let diffuseColor = varyingProperty( 'vec4', 'vColor'  ).toVar( 'diffuseColor' )

			if( this.colorNode ) {
				diffuseColor.mulAssign( this.colorNode )
			}
			if( this.useGradient ) {
				diffuseColor.rgb.assign( mix( diffuseColor.rgb, gradient, vCounters ) )
			}

			if( this.useMap ) {
				diffuseColor.mulAssign( texture( this.map.value, uv().yx.mul( repeat ) ) )
			}

			if( this.useAlphaMap ) {
				diffuseColor.a.mulAssign( texture( this.alphaMap.value, uv().yx.mul( repeat ) ).b )
			}

			if( alphaTest < 1 ) {
				Discard( diffuseColor.a.lessThan( alphaTest ) )
			}

			if( this.useDash ) {
				diffuseColor.a.mulAssign( ceil( mod( vCounters.add( this.dashOffset ), this.dashArray ).sub( this.dashArray.mul( this.dashRatio ) ) ) )
			}

			diffuseColor.a.mulAssign( opacity )
			if( this.opacityNode ) {
				diffuseColor.a.mulAssign( this.opacityNode )
			}
			return diffuseColor

		} )()

	}


	copy( source ) {
		super.copy( source )
		this.lineWidth.value = source.lineWidth.value
		this.map.value = source.map.value
		this.useMap = source.useMap
		this.alphaMap.value = source.alphaMap.value
		this.useAlphaMap = source.useAlphaMap
		this.color.value.copy( source.color.value )
		this.gradient.value = source.gradient.value
		this.opacity.value = source.opacity.value
		this.resolution.value.copy( source.resolution.value )
		this.sizeAttenuation = source.sizeAttenuation
		this.dashArray.value = source.dashArray.value
		this.dashOffset.value = source.dashOffset.value
		this.dashRatio.value = source.dashRatio.value
		this.useDash = source.useDash
		this.useGradient = source.useGradient
		this.alphaTest = source.alphaTest
		this.repeat.value.copy( source.repeat.value )
		return this
	}
}

export { MeshLineNodeMaterial }
export default MeshLineNodeMaterial

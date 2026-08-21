import { MeshLine } from 'makio-meshline'
import { CatmullRomCurve3, Fog, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import { attribute, Fn } from 'three/tsl'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import random from '@/makio/utils/random'

const BAGUETTE_COUNT = 30
const SEGMENTS = 64
const BILLBOARD_VERTICES_PER_POINT = 4
const PATH_POINTS = 8
const SPREAD = 40
const BAGUETTE_LENGTH = 10
const BAGUETTE_SPEED = 0.03

class FlyingBaguettesExample {
	constructor() {
		this.curves = []
		this.baguettes = []
		this.lineArrays = []
		this.lineIndices = new Float32Array( SEGMENTS * BILLBOARD_VERTICES_PER_POINT * BAGUETTE_COUNT )
		this.line = null
		this.texture = null
		this.samplePoint = new Vector3()

		let vertexOffset = 0
		for ( let lineIndex = 0; lineIndex < BAGUETTE_COUNT; lineIndex++ ) {
			const points = Array.from( { length: PATH_POINTS }, () => new Vector3(
				random( -SPREAD, SPREAD ),
				random( -SPREAD, SPREAD ),
				random( -SPREAD, SPREAD )
			) )
			const curve = new CatmullRomCurve3( points, true, 'catmullrom', 0.5 )
			const baguette = {
				positions: new Float32Array( SEGMENTS * 3 ),
				progress: random( 0, 1 ),
				speed: BAGUETTE_SPEED,
				curveLength: curve.getLength(),
			}

			this.curves.push( curve )
			this.baguettes.push( baguette )
			this.lineArrays.push( baguette.positions )

			for ( let i = 0; i < SEGMENTS * BILLBOARD_VERTICES_PER_POINT; i++ ) {
				this.lineIndices[vertexOffset++] = lineIndex
			}
		}
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 30 )
		stage3d.control.autoRotate = true
		stage3d.control.autoRotateSpeed = 0.3
		stage3d.scene.fog = new Fog( 0x000000, 20, 60 )

		this.texture = new TextureLoader().load( '/textures/baguette.png' )
		this.texture.colorSpace = SRGBColorSpace
		this.createLine()

		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createLine() {
		this.updatePositions( 0 )

		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 1.4 )
			.map( this.texture )
			.alphaTest( 0.1 )
			.colorFn( Fn( ( [color] ) => {
				const lineIndex = attribute( 'lineIndex', 'float' )
				const brightness = lineIndex.div( BAGUETTE_COUNT ).mul( 0.7 ).add( 0.3 )
				return color.mul( brightness )
			} ) )

		this.line.addVertexAttribute( 'lineIndex', 1 )
		this.line.setVertexValues( 'lineIndex', this.lineIndices )

		stage3d.add( this.line )
	}

	updatePositions( dt ) {
		this.baguettes.forEach( ( baguette, baguetteIndex ) => {
			const curve = this.curves[baguetteIndex]
			baguette.progress += baguette.speed * dt * 0.001
			if ( baguette.progress > 1 ) baguette.progress -= 1

			for ( let i = 0; i < SEGMENTS; i++ ) {
				const segmentDistance = i / ( SEGMENTS - 1 ) * BAGUETTE_LENGTH
				const startDistance = baguette.progress * baguette.curveLength
				let pointDistance = startDistance - segmentDistance

				if ( pointDistance < 0 ) pointDistance += baguette.curveLength
				if ( pointDistance > baguette.curveLength ) pointDistance -= baguette.curveLength

				const pathProgress = pointDistance / baguette.curveLength
				const position = curve.getPoint( pathProgress, this.samplePoint )
				const offset = i * 3

				baguette.positions[offset] = position.x
				baguette.positions[offset + 1] = position.y
				baguette.positions[offset + 2] = position.z
			}
		} )
	}

	update = ( dt ) => {
		this.updatePositions( dt )
		this.line.setPositions( this.lineArrays )
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		stage3d.control.dispose()
		this.line.dispose()

		stage3d.scene.fog = null

		this.texture.dispose()
	}

}

export default FlyingBaguettesExample

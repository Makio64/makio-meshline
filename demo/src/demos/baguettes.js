import { BufferAttribute, CatmullRomCurve3, Fog, SRGBColorSpace, TextureLoader, Vector3 } from 'three'
import { attribute, Fn } from 'three/tsl'

import { MeshLine } from 'makio-meshline'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import random from '@/makio/utils/random'

const BAGUETTE_COUNT = 30
const SEGMENTS = 64
const PATH_POINTS = 8
const SPREAD = 40
const BAGUETTE_LENGTH = 10  // Absolute length in world units
const BAGUETTE_SPEED = 0.03  // Speed for all baguettes

class FlyingBaguettes {
	constructor() {
		this.baguettes = []
		this.curves = []
		
		// Generate random looping paths using Catmull-Rom curves
		for ( let i = 0; i < BAGUETTE_COUNT; i++ ) {
			// Create random path points for smooth curves
			const pathPoints = []
			for ( let j = 0; j < PATH_POINTS; j++ ) {
				pathPoints.push( new Vector3(
					random( -SPREAD, SPREAD ),
					random( -SPREAD, SPREAD ),
					random( -SPREAD, SPREAD )
				) )
			}
			
			// Create a smooth looping curve using CatmullRomCurve3
			const curve = new CatmullRomCurve3( pathPoints, true, 'catmullrom', 0.5 )
			this.curves.push( curve )
			
			// Store the curve's total length for absolute distance calculations
			const curveLength = curve.getLength()
			
			// Initialize baguette data with brightness variation
			this.baguettes.push( {
				positions: new Float32Array( SEGMENTS * 3 ),
				progress: random( 0, 1 ),
				speed: BAGUETTE_SPEED,
				curveLength: curveLength,
				brightness: random( 0.3, 1.0 ) // Darkness variation
			} )
		}
		
		// Prepare line arrays
		this.lineArrays = this.baguettes.map( b => b.positions )
		
		// Create lineIndex attribute data for identifying each baguette
		const totalVertices = SEGMENTS * 2 * BAGUETTE_COUNT // 2 vertices per segment point
		this.lineIndices = new Float32Array( totalVertices )
		let vertexOffset = 0
		for ( let i = 0; i < BAGUETTE_COUNT; i++ ) {
			for ( let j = 0; j < SEGMENTS * 2; j++ ) {
				this.lineIndices[ vertexOffset++ ] = i
			}
		}
	}

	// -------------------------------------------------- INIT
	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 30 )
		stage3d.control.autoRotate = true
		stage3d.control.autoRotateSpeed = 0.3
		
		// Add fog to fade to black
		stage3d.scene.fog = new Fog( 0x000000, 20, 60 )
		
		let txt = new TextureLoader().load( '/textures/baguette.png' )
		txt.colorSpace = SRGBColorSpace
		// Create meshline with multiple baguettes
		this.line = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 1.4 )
			.map( txt )
			.alphaTest( 0.1 )
		
		// Add custom attribute for line identification
		this.line.geometry.setAttribute( 'lineIndex', 
			new BufferAttribute( this.lineIndices, 1 ) )
		
		// Apply color function to vary darkness per baguette
		this.line.colorFn( Fn( ( [color] ) => {
			const lineIdx = attribute( 'lineIndex', 'float' )
			// Simple approach: use line index to calculate brightness
			// Each baguette gets progressively darker
			const brightness = lineIdx.div( BAGUETTE_COUNT ).mul( 0.7 ).add( 0.3 )
			return color.mul( brightness )
		} ) )

		stage3d.add( this.line )
		
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	// -------------------------------------------------- UPDATE LOOP
	update = ( dt ) => {
		this.baguettes.forEach( ( baguette, baguetteIndex ) => {
			// Update progress
			baguette.progress += baguette.speed * dt * 0.001
			if ( baguette.progress > 1 ) baguette.progress -= 1
			
			const curve = this.curves[ baguetteIndex ]
			
			// Generate baguette trail with constant absolute length
			for ( let i = 0; i < SEGMENTS; i++ ) {
				// Calculate distance along curve for this segment
				const segmentDistance = ( i / ( SEGMENTS - 1 ) ) * BAGUETTE_LENGTH
				
				// Calculate the starting position in curve distance
				const startDistance = baguette.progress * baguette.curveLength
				let pointDistance = startDistance - segmentDistance
				
				// Wrap around for looping
				if ( pointDistance < 0 ) pointDistance += baguette.curveLength
				if ( pointDistance > baguette.curveLength ) pointDistance -= baguette.curveLength
				
				// Convert distance back to normalized parameter (0-1)
				const pathProgress = pointDistance / baguette.curveLength
				
				// Get smooth position from curve
				const pos = curve.getPoint( pathProgress )
				
				baguette.positions[ i * 3 ] = pos.x
				baguette.positions[ i * 3 + 1 ] = pos.y
				baguette.positions[ i * 3 + 2 ] = pos.z
			}
		} )
		
		this.line.setPositions( this.lineArrays )
	}

	onResize = () => {
		this.line?.resize()
	}

	// -------------------------------------------------- CLEANUP
	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		stage3d.control.dispose()
		this.line?.dispose()
		this.line = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new FlyingBaguettes()
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { stage } from '@/makio/core/stage'
import { MeshLine, squarePositions } from 'meshline'
import { MathUtils } from 'three/webgpu'
import { smoothstep } from '@/makio/utils/math'
import { StaticDrawUsage } from 'three'

const gridSize = 64 // 50x50 grid = 2500 lines
const spacing = 0.2 // Distance between stalks
const jitter = 0.15
const lineSegments = 3 // number of segments per line

class RicefieldExample {
	constructor() {
		this.lines = null
		this.time = 0
		this.lineArrays = []
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 20 )
		stage3d.camera.position.set( 0, 5, 15 )
		stage3d.camera.lookAt( 0, 0, 0 )
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	initScene() {
		// Generate lines with random heights and small random base angles
		this.lineArrays = []
		for ( let x = 0; x < gridSize; x++ ) {
			for ( let z = 0; z < gridSize; z++ ) {
				const height = 2 + Math.random() * .5
				const baseX = ( x - gridSize / 2 ) * spacing + ( Math.random() - .5 ) * jitter
				const baseZ = ( z - gridSize / 2 ) * spacing + ( Math.random() - .5 ) * jitter
				const positions = new Float32Array( new Array( lineSegments * 3 ) )
				for ( let i = 0; i < lineSegments; i++ ) {
					positions[i * 3] = baseX
					positions[i * 3 + 1] = i * height / lineSegments
					positions[i * 3 + 2] = baseZ
				}
				this.lineArrays.push( positions )
			}
		}

		this.lines = new MeshLine( {
			lines: this.lineArrays,
			isClose: false,
			color: 0x000000, // black at bottom
			gradientColor: 0xffffff, // white at top
			lineWidth: 0.1,
			widthCallback: ( t ) => ( 1 - smoothstep( 0.3, 1, t ) ), // taper to 0 at top
			verbose: true,
			usage: StaticDrawUsage
		} )
		stage3d.add( this.lines )

		this.fieldLine = new MeshLine( {
			lines: squarePositions( 13.5, 10 ),
			isClose: true,
			color: 0xffffff, // black at bottom
			lineWidth: 0.2,
			useMiterLimit: true,
			miterLimit: 8,
			usage: StaticDrawUsage
		} )
		this.fieldLine.rotation.x = Math.PI / 2
		stage3d.add( this.fieldLine )
	}

	update = ( dt ) => {
		this.time += dt * 0.001 // slow animation
		const windStrength = Math.sin( this.time ) * 0.5 + 0.5 // 0-1
		const windDir = this.time * 0.2 // slowly changing direction

		// Update positions with wind
		// for ( let i = 0; i < this.lineArrays.length; i++ ) {
		// 	const arr = this.lineArrays[i]
		// 	const height = arr[4] // y of top point
		// 	const windOffset = windStrength * height * 0.3 // taller stalks bend more
		// 	arr[3] = arr[0] + Math.cos( windDir ) * windOffset // top x
		// 	arr[5] = arr[2] + Math.sin( windDir ) * windOffset // top z
		// }

		// this.lines.geometry.setPositions( this.lineArrays )
	}

	onResize = () => {
		this.lines?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		if ( this.lines ) {
			stage3d.remove( this.lines )
			this.lines.dispose()
			this.lines = null
		}
		if ( this.fieldLine ) {
			stage3d.remove( this.fieldLine )
			this.fieldLine.dispose()
			this.fieldLine = null
		}
		stage3d.control.dispose()
		this.lineArrays = []
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new RicefieldExample() 
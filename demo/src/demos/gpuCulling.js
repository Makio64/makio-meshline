import { MeshLine } from 'makio-meshline'
import MeshLineCullingSystem from 'makio-meshline/gpu-culling'

import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINT_COUNT = 300_000
const PATH_LENGTH = 800

const createLongPath = () => {
	const points = new Float32Array( POINT_COUNT * 3 )

	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const angle = progress * Math.PI * 12
		const offset = i * 3
		points[offset] = ( progress - 0.5 ) * PATH_LENGTH
		points[offset + 1] = Math.sin( angle * 0.37 ) * 5
		points[offset + 2] = Math.sin( angle ) * 22 + Math.sin( angle * 2.31 ) * 3
	}

	return points
}

class GpuCullingExample {
	constructor() {
		this.text = 'Drag to orbit · automatic native-WebGPU chunk culling'
		this.line = null
		this.culling = null
		this.handle = null
		this.control = null
		this.metrics = null
	}

	async init() {
		await stage3d.initRender( { background: 0x050914 } )

		stage3d.camera.near = 0.1
		stage3d.camera.far = 180
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, 34 )
		this.control.minRadius = 12
		this.control.maxRadius = 75
		this.control._phi = 1.02
		this.control._theta = 0.15
		this.control.update()
		stage3d.control = this.control

		this.line = new MeshLine()
			.lines( createLongPath() )
			.lineWidth( 0.42 )
			.color( 0x22D3EE )
			.join( { type: 'miter', limit: 3 } )
			.build()
		stage3d.add( this.line )

		const requested = new URLSearchParams( window.location.search ).get( 'culling' ) !== '0'
		if ( requested ) {
			this.culling = MeshLineCullingSystem.attach( stage3d.renderer, stage3d.scene, {
				mode: 'auto',
				chunkSize: 128,
			} )
			this.handle = this.culling.add( this.line )
		}

		this.metrics = {
			requested,
			backend: stage3d.renderer.backend?.isWebGPUBackend === true ? 'webgpu' : 'webgl2',
			pointCount: POINT_COUNT,
			indexCount: this.line.geometry.getIndex().count,
			get status() {
				return window.__meshLineCullingHandle?.status ?? null
			},
		}
		window.__meshLineCullingHandle = this.handle
		window.__meshLineCullingMetrics = this.metrics

		if ( requested && !this.handle?.enabled ) {
			this.text = `GPU culling fallback · ${this.handle?.reason ?? 'unavailable'}`
		}
	}

	dispose() {
		this.culling?.dispose()
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		if ( window.__meshLineCullingHandle === this.handle ) window.__meshLineCullingHandle = null

		this.line = null
		this.culling = null
		this.handle = null
		this.control = null
	}

}

export default GpuCullingExample

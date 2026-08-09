import MeshLineGPUPath from 'makio-meshline/gpu-path'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const POINT_COUNT = 200_000
const PATH_LENGTH = 100

const createLargeOpenPath = () => {
	const points = new Float32Array( POINT_COUNT * 3 )

	for ( let i = 0; i < POINT_COUNT; i++ ) {
		const progress = i / ( POINT_COUNT - 1 )
		const centered = progress * 2 - 1
		const detailEnvelope = Math.exp( -centered * centered * 18 )
		const offset = i * 3

		points[offset] = centered * PATH_LENGTH * 0.5
		points[offset + 1] = Math.sin( progress * Math.PI * 4 ) * 0.7
		points[offset + 2] = Math.sin( progress * Math.PI * 24 ) * 2
			+ Math.sin( progress * Math.PI * 180 ) * detailEnvelope * 4
	}

	return points
}

class GpuPathExample {
	constructor() {
		this.text = 'Production GPU path · guaranteed local tolerance · automatic CPU fallback'
		this.path = null
		this.control = null
		this.status = null
	}

	async init() {
		const query = new URLSearchParams( window.location.search )
		const reportMetrics = query.get( 'metrics' ) === '1'
		const gpuRequested = query.get( 'gpu' ) !== '0'
		const simplifyRequested = query.get( 'simplify' ) !== '0'
		const topologyMode = ['fixed', 'variable', 'bevel', 'round'].includes( query.get( 'topology' ) )
			? query.get( 'topology' )
			: 'fixed'
		const capType = ['butt', 'square', 'round'].includes( query.get( 'cap' ) )
			? query.get( 'cap' )
			: 'butt'
		const joinType = topologyMode === 'bevel' || topologyMode === 'round' ? topologyMode : 'miter'
		await stage3d.initRender( { background: 0x050913 } )

		stage3d.camera.near = 0.1
		stage3d.camera.far = 250
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, 84 )
		this.control.minRadius = 16
		this.control.maxRadius = 140
		this.control._phi = 1.02
		this.control._theta = 0.24
		this.control.target.x = 8
		this.control.update()
		stage3d.control = this.control

		this.path = new MeshLineGPUPath( {
			lines: createLargeOpenPath(),
			lineWidth: 0.32,
			color: 0x22d3ee,
			join: { type: joinType, limit: 3, segments: 8 },
			cap: { type: capType, segments: 8 },
		}, {
			chunkSegments: 128,
			simplify: simplifyRequested ? { localTolerance: 0.012 } : false,
			variableTopology: topologyMode === 'variable',
		} )
		this.status = this.path.status
		window.__meshLineGPUPathMetrics = this.status

		// Add the wrapper before preparation so its complete CPU MeshLine remains
		// visible throughout initialization and on every unsupported/failure path.
		stage3d.add( this.path )
		this.onResize()
		const prepared = gpuRequested ? await this.path.prepare( stage3d.renderer, stage3d.camera ) : false

		stage.onResize.add( this.onResize )
		stage.onUpdate.add( this.update )
		if ( !gpuRequested ) this.text = 'CPU full-detail path · GPU preparation skipped by query'
		else if ( prepared && this.status.topology === 'variable-triangles' ) {
			this.text = `GPU variable topology · ${joinType} joins · ${capType} caps · full detail`
		} else if ( prepared && !simplifyRequested ) this.text = 'GPU full-detail path · derived segment records · zero compute dispatches'
		else if ( !prepared ) this.text = `GPU path fallback · ${this.status.reason}`
		if ( reportMetrics ) console.info( `[gpuPath] ${JSON.stringify( this.status )}` )
	}

	onResize = () => {
		this.path?.resize( stage.width, stage.height )
	}

	update = () => {
		this.path?.update( stage3d.camera )
	}

	dispose() {
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.update )
		this.path?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		if ( window.__meshLineGPUPathMetrics === this.status ) window.__meshLineGPUPathMetrics = null
		this.path = null
		this.control = null
		this.status = null
	}

	show() {}
	hide( cb ) { if ( cb ) cb() }
}

export default new GpuPathExample()

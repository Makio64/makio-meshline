import { MeshLine } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'
import { markRaw, reactive } from 'vue'

import GpuPathUI from '@/components/GpuPath.vue'
import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'

const POINT_COUNT = 200_000
const PATH_LENGTH = 100
const SOURCE_SEGMENT_COUNT = POINT_COUNT - 1
const LOCAL_TOLERANCE = 0.012
// Fixed-data diagnostic from the matching CPU oracle. The runtime deliberately
// avoids reading the selected count back from the GPU.
const EXPECTED_RETAINED_SEGMENTS = 1_646

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

const requestedMode = ( gpuRequested, simplifyRequested, topologyMode, capType ) => {
	if ( !gpuRequested ) return 'cpu'
	if ( topologyMode !== 'fixed' || capType !== 'butt' ) return 'gpu-topology'
	return simplifyRequested ? 'gpu-simplified' : 'gpu-raw'
}

class GpuPathExample {
	constructor() {
		this.text = ''
		this.uiComponent = markRaw( GpuPathUI )
		this.ui = reactive( {
			mode: 'gpu-simplified',
			backend: 'loading',
			reason: 'Preparing the requested path',
			pointCount: POINT_COUNT,
			sourceSegmentCount: SOURCE_SEGMENT_COUNT,
			expectedRetainedSegments: EXPECTED_RETAINED_SEGMENTS,
			localTolerance: LOCAL_TOLERANCE,
			joinType: 'miter',
			capType: 'butt',
			wireframe: false,
		} )
		this.points = null
		this.path = null
		this.grid = null
		this.bloom = null
		this.control = null
		this.status = null
		this._buildToken = 0
	}

	async init() {
		const query = new URLSearchParams( window.location.search )
		const reportMetrics = query.get( 'metrics' ) === '1'
		const gpuRequested = query.get( 'gpu' ) !== '0'
		const simplifyRequested = query.get( 'simplify' ) !== '0'
		const wireframe = query.get( 'wireframe' ) === '1' || query.get( 'wireframe' ) === 'true'
		const topologyMode = ['fixed', 'variable', 'bevel', 'round'].includes( query.get( 'topology' ) )
			? query.get( 'topology' )
			: 'fixed'
		const capType = ['butt', 'square', 'round'].includes( query.get( 'cap' ) )
			? query.get( 'cap' )
			: 'butt'
		const joinType = topologyMode === 'bevel' || topologyMode === 'round' ? topologyMode : 'miter'
		this.points = createLargeOpenPath()
		Object.assign( this.ui, {
			mode: requestedMode( gpuRequested, simplifyRequested, topologyMode, capType ),
			joinType,
			capType,
			wireframe,
		} )
		await stage3d.initRender( { background: 0x02050C } )

		stage3d.camera.near = 0.1
		stage3d.camera.far = 250
		stage3d.camera.updateProjectionMatrix()

		this.control = new OrbitControl( stage3d.camera, 56 )
		this.control.minRadius = 2
		this.control.maxRadius = 140
		this.control.minPhi = 0.2
		this.control._phi = 0.62
		this.control._theta = Math.PI * 0.5
		this.control.update()
		stage3d.control = this.control
		this.createGrid()

		await this._rebuildPath( {
			gpuRequested,
			simplifyRequested,
			topologyMode,
			joinType,
			capType,
		} )

		this.bloom = createBloomPipeline( { strength: 0.65, radius: 0.35, threshold: 0.12 } )
		stage.onResize.add( this.onResize )
		stage.onUpdate.add( this.update )
		window.addEventListener( 'keydown', this.onKeyDown )
		if ( reportMetrics ) console.info( `[gpuPath] ${JSON.stringify( this.status )}` )
	}

	async _rebuildPath( { gpuRequested, simplifyRequested, topologyMode = 'fixed', joinType = 'miter', capType = 'butt' } ) {
		const token = ++this._buildToken
		const previousPath = this.path

		const nextPath = new MeshLineGPUPath( {
			lines: this.points,
			lineWidth: 0.24,
			color: 0x22d3ee,
			wireframe: this.ui.wireframe,
			join: { type: joinType, limit: 3, segments: 8 },
			cap: { type: capType, segments: 8 },
		}, {
			chunkSegments: 128,
			simplify: simplifyRequested ? { localTolerance: LOCAL_TOLERANCE } : false,
			variableTopology: topologyMode === 'variable',
		} )

		// Add the wrapper before preparation so its complete CPU MeshLine remains
		// visible throughout initialization and on every unsupported/failure path.
		stage3d.add( nextPath )
		nextPath.resize( stage.width, stage.height )
		const prepared = gpuRequested ? await nextPath.prepare( stage3d.renderer, stage3d.camera ) : false
		if ( token !== this._buildToken || !this.points ) {
			nextPath.dispose()
			return
		}

		previousPath?.dispose()
		this.path = nextPath
		this.status = nextPath.status
		window.__meshLineGPUPathMetrics = this.status
		Object.assign( this.ui, {
			backend: !gpuRequested ? 'cpu-requested' : prepared ? 'gpu' : 'cpu-fallback',
			reason: !gpuRequested ? 'GPU preparation was deliberately skipped' : this.status.reason,
			joinType: prepared ? this.status.join : joinType,
			capType: prepared ? this.status.cap : capType,
		} )
	}

	createGrid() {
		const lines = []
		for ( let z = -15; z <= 15; z += 5 ) lines.push( [-70, -3, z, 70, -3, z] )
		for ( let x = -70; x <= 70; x += 5 ) lines.push( [x, -3, -15, x, -3, 15] )
		this.grid = new MeshLine()
			.lines( lines, false )
			.lineWidth( 0.05 )
			.color( 0x1E3A5F )
		stage3d.add( this.grid )
	}

	getModeHref = mode => {
		const url = new URL( window.location.href )
		url.searchParams.delete( 'gpu' )
		url.searchParams.delete( 'simplify' )
		url.searchParams.delete( 'topology' )
		url.searchParams.delete( 'cap' )

		if ( mode === 'gpu-raw' ) url.searchParams.set( 'simplify', '0' )
		else if ( mode === 'cpu' ) url.searchParams.set( 'gpu', '0' )

		return url.toString()
	}

	setMode = async mode => {
		if ( mode === this.ui.mode || !this.points ) return
		this.ui.mode = mode
		this.ui.backend = 'loading'
		const href = this.getModeHref( mode )
		window.history?.replaceState?.( null, '', href )
		await this._rebuildPath( {
			gpuRequested: mode !== 'cpu',
			simplifyRequested: mode === 'gpu-simplified',
			topologyMode: 'fixed',
			joinType: 'miter',
			capType: 'butt',
		} )
	}

	setWireframe = enabled => {
		const active = Boolean( enabled )
		this.ui.wireframe = active
		this.path?.wireframe( active )
		const url = new URL( window.location.href )
		if ( active ) url.searchParams.set( 'wireframe', '1' )
		else url.searchParams.delete( 'wireframe' )
		window.history?.replaceState?.( null, '', url.toString() )
	}

	toggleWireframe = () => {
		this.setWireframe( !this.ui.wireframe )
	}

	onKeyDown = event => {
		if ( event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ) return
		const tag = event.target?.tagName
		if ( tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ) return
		if ( event.key === 'w' || event.key === 'W' ) {
			event.preventDefault()
			this.toggleWireframe()
		}
	}

	onResize = () => {
		this.path?.resize( stage.width, stage.height )
		this.grid?.resize()
	}

	update = () => {
		const active = this.path?.update( stage3d.camera )
		if ( this.ui.backend === 'gpu' && active === false ) {
			Object.assign( this.ui, {
				backend: 'cpu-fallback',
				reason: this.path.status.reason,
			} )
		}
	}

	dispose() {
		this._buildToken++
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'keydown', this.onKeyDown )
		this.path?.dispose()
		this.bloom?.dispose()
		stage3d.remove( this.grid )
		this.grid?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		if ( window.__meshLineGPUPathMetrics === this.status ) window.__meshLineGPUPathMetrics = null
		this.points = null
		this.path = null
		this.grid = null
		this.bloom = null
		this.control = null
		this.status = null
	}

}

export default GpuPathExample

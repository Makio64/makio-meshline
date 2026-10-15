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
// Chunk 776 selects stride 32, making it a useful real-data close-up: the HUD
// can show 129 dense samples becoming four tolerance-bounded straight pieces.
const PREVIEW_CHUNK_START = 99_328
const PREVIEW_SEGMENT_COUNT = 128
const PREVIEW_STRIDE = 32

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

const createSimplificationPreview = points => {
	const samples = []
	let minimum = Infinity
	let maximum = -Infinity

	for ( let local = 0; local <= PREVIEW_SEGMENT_COUNT; local++ ) {
		const value = points[( PREVIEW_CHUNK_START + local ) * 3 + 2]
		samples.push( value )
		minimum = Math.min( minimum, value )
		maximum = Math.max( maximum, value )
	}

	const range = Math.max( maximum - minimum, 1e-6 )
	const source = samples.map( ( value, local ) => ( {
		x: 4 + local / PREVIEW_SEGMENT_COUNT * 92,
		y: 29 - ( value - minimum ) / range * 23,
	} ) )
	const selected = source.filter( ( _, local ) => local % PREVIEW_STRIDE === 0 )

	return {
		source,
		selected,
		sourceSampleCount: PREVIEW_SEGMENT_COUNT + 1,
		selectedChordCount: PREVIEW_SEGMENT_COUNT / PREVIEW_STRIDE,
	}
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
			preview: null,
		} )
		this.path = null
		this.grid = null
		this.bloom = null
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
		const points = createLargeOpenPath()
		Object.assign( this.ui, {
			mode: requestedMode( gpuRequested, simplifyRequested, topologyMode, capType ),
			joinType,
			capType,
			preview: createSimplificationPreview( points ),
		} )
		await stage3d.initRender( { background: 0x02050C } )

		stage3d.camera.near = 0.1
		stage3d.camera.far = 250
		stage3d.camera.updateProjectionMatrix()

		// Look down on the path like an oscilloscope trace: the dense middle of the
		// curve reads as a burst in the signal, offset right of the explainer panel.
		this.control = new OrbitControl( stage3d.camera, 62 )
		this.control.minRadius = 16
		this.control.maxRadius = 140
		this.control.minPhi = 0.2
		this.control._phi = 0.62
		this.control._theta = Math.PI * 0.5
		this.control.target.x = window.innerWidth >= 1100 ? -16 : 0
		this.control.update()
		stage3d.control = this.control
		this.createGrid()

		this.path = new MeshLineGPUPath( {
			lines: points,
			lineWidth: 0.16,
			color: 0x22d3ee,
			join: { type: joinType, limit: 3, segments: 8 },
			cap: { type: capType, segments: 8 },
		}, {
			chunkSegments: 128,
			simplify: simplifyRequested ? { localTolerance: LOCAL_TOLERANCE } : false,
			variableTopology: topologyMode === 'variable',
		} )
		this.status = this.path.status
		window.__meshLineGPUPathMetrics = this.status

		// Add the wrapper before preparation so its complete CPU MeshLine remains
		// visible throughout initialization and on every unsupported/failure path.
		stage3d.add( this.path )
		this.onResize()
		const prepared = gpuRequested ? await this.path.prepare( stage3d.renderer, stage3d.camera ) : false

		this.bloom = createBloomPipeline( { strength: 0.65, radius: 0.35, threshold: 0.12 } )
		stage.onResize.add( this.onResize )
		stage.onUpdate.add( this.update )
		Object.assign( this.ui, {
			backend: !gpuRequested ? 'cpu-requested' : prepared ? 'gpu' : 'cpu-fallback',
			reason: !gpuRequested ? 'GPU preparation was deliberately skipped' : this.status.reason,
			joinType: prepared ? this.status.join : joinType,
			capType: prepared ? this.status.cap : capType,
		} )
		if ( reportMetrics ) console.info( `[gpuPath] ${JSON.stringify( this.status )}` )
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
		stage.onResize.remove( this.onResize )
		stage.onUpdate.remove( this.update )
		this.path?.dispose()
		this.bloom?.dispose()
		stage3d.remove( this.grid )
		this.grid?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		if ( window.__meshLineGPUPathMetrics === this.status ) window.__meshLineGPUPathMetrics = null
		this.path = null
		this.grid = null
		this.bloom = null
		this.control = null
		this.status = null
	}

}

export default GpuPathExample

/**
 * GPU Path & Simplification — 200,000-point path with multi-stride GPU simplification.
 * Demonstrates: MeshLineGPUPath, .prepare( renderer, camera ), .setSimplificationTolerance( tolerance ),
 * .wireframe( enabled ), and automatic CPU fallback.
 */
import { MeshLine, straightLineBetween } from 'makio-meshline'
import MeshLineGPUPath from 'makio-meshline/gpu-path'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoControls } from '@/utils/demoControls'
import { createDemoHint } from '@/utils/demoHint'
import { clampSimplify, MAX_SIMPLIFY, pick, readQuery, resolveSimplify, writeSimplify, writeWireframe } from '@/utils/gpuPathQuery'
import { linePoints } from '@/utils/points'

const POINT_COUNT = 200_000
const PATH_LENGTH = 100
const SOURCE_SEGMENT_COUNT = POINT_COUNT - 1

const BACKENDS = {
	'loading': { label: 'Loading', tone: '#778896' },
	'gpu': { label: 'WebGPU', tone: '#48ecc4' },
	'cpu-fallback': { label: 'CPU fallback', tone: '#ffb54c' },
}

const pathPoint = progress => {
	const centered = progress * 2 - 1
	const detailEnvelope = Math.exp( -centered * centered * 18 )
	return [
		centered * PATH_LENGTH * 0.5,
		Math.sin( progress * Math.PI * 4 ) * 0.7,
		Math.sin( progress * Math.PI * 24 ) * 2 + Math.sin( progress * Math.PI * 180 ) * detailEnvelope * 4,
	]
}

const formatCount = value => value.toLocaleString( 'en-US' )

const statusText = ( backend, simplify ) => {
	const { segments } = resolveSimplify( simplify )
	const reduction = ( 100 - segments / SOURCE_SEGMENT_COUNT * 100 ).toFixed( 1 )
	const segmentLabel = backend === 'gpu' && simplify > 0
		? `${formatCount( segments )} (−${reduction}%)`
		: formatCount( SOURCE_SEGMENT_COUNT )
	return `${formatCount( POINT_COUNT )} pts · ${segmentLabel} segs · ${BACKENDS[backend].label}`
}

export default class GpuPathExample {
	points = linePoints( POINT_COUNT, pathPoint )
	backend = 'loading'
	buildToken = 0
	updatingTolerance = false
	pendingTolerance = null

	async init() {
		const query = readQuery()
		this.simplify = query.simplify
		this.wireframe = query.wireframe

		const token = this.buildToken
		await stage3d.initRender( { background: 0x02050C, near: 0.1, far: 250 } )
		// The visitor may have left while the first renderer was starting.
		if ( token !== this.buildToken ) return

		stage3d.orbit( 56, { phi: 0.62, minPhi: 0.2, minRadius: 2, maxRadius: 140 } )
		this.createGrid()
		this.createUI()

		await this.buildPath( query )

		createBloomPipeline( { strength: 0.65, radius: 0.35, threshold: 0.12 } )
		if ( query.metrics ) console.info( `[gpuPath] ${JSON.stringify( this.path?.status )}` )
	}

	async buildPath( { tolerance = 0, topology = 'fixed', cap = 'butt', enableSimplify = tolerance > 0 } ) {
		const token = ++this.buildToken

		const path = new MeshLineGPUPath( {
			lines: this.points,
			lineWidth: 0.24,
			color: 0x22d3ee,
			wireframe: this.wireframe,
			join: { type: pick( topology, ['miter', 'bevel', 'round'] ), limit: 3 },
			cap,
		}, {
			simplify: enableSimplify ? { localTolerance: tolerance } : false,
			variableTopology: topology === 'variable',
		} )

		// Add the wrapper before preparation so its complete CPU MeshLine remains
		// visible throughout initialization and on every unsupported/failure path.
		stage3d.add( path )
		path.resize( stage.width, stage.height )
		const prepared = await path.prepare( stage3d.renderer, stage3d.camera )
		if ( token !== this.buildToken ) {
			path.dispose()
			return
		}

		this.path?.dispose()
		this.path = path
		window.__meshLineGPUPathMetrics = path.status
		this.setBackend( prepared ? 'gpu' : 'cpu-fallback' )
	}

	createGrid() {
		const lines = []
		for ( let z = -15; z <= 15; z += 5 ) lines.push( straightLineBetween( [-70, -3, z], [70, -3, z] ) )
		for ( let x = -70; x <= 70; x += 5 ) lines.push( straightLineBetween( [x, -3, -15], [x, -3, 15] ) )

		stage3d.add( new MeshLine()
			.lines( lines )
			.lineWidth( 0.05 )
			.color( 0x1E3A5F )
			.autoResize() )
	}

	createUI() {
		this.controls = createDemoControls( [
			{
				id: 'simplify',
				label: 'Simplify',
				min: 0,
				max: MAX_SIMPLIFY,
				step: 1,
				value: this.simplify,
				format: value => `${value}%`,
				ariaValueText: value => `Simplification ${value} percent`,
				onInput: value => this.setSimplify( value ),
				onChange: value => writeSimplify( clampSimplify( value ) ),
			},
			'divider',
			{ id: 'wireframe', label: 'Wireframe', key: 'W', pressed: this.wireframe, onClick: this.toggleWireframe },
		], { accent: '#43e9ff', label: 'GPU path controls' } )

		// The backend can change without a click, so the status is announced.
		this.hint = createDemoHint( statusText( this.backend, this.simplify ), {
			accent: BACKENDS[this.backend].tone,
			hideAfter: 0,
			attributes: { 'aria-live': 'polite' },
		} )
	}

	setBackend( backend ) {
		this.backend = backend
		this.hint.setText( statusText( backend, this.simplify ) )
		this.hint.setAccent( BACKENDS[backend].tone )
	}

	async setSimplify( value, commit = false ) {
		const simplify = clampSimplify( value )
		if ( simplify === this.simplify ) return
		this.simplify = simplify
		this.controls.setValue( 'simplify', simplify )
		if ( commit ) writeSimplify( simplify )

		const { tolerance } = resolveSimplify( simplify )
		this.hint.setText( statusText( this.backend, this.simplify ) )
		this.pendingTolerance = tolerance
		if ( this.updatingTolerance ) return

		this.updatingTolerance = true
		const token = this.buildToken
		if ( !this.path?.gpuOptions.simplify ) {
			this.pendingTolerance = null
			await this.buildPath( { tolerance, enableSimplify: true } )
		}
		while ( this.pendingTolerance !== null && token === this.buildToken && this.path?.gpuOptions.simplify ) {
			const nextTolerance = this.pendingTolerance
			this.pendingTolerance = null
			await this.path.setSimplificationTolerance( nextTolerance )
		}
		this.updatingTolerance = false
		if ( token !== this.buildToken || !this.path ) return
		window.__meshLineGPUPathMetrics = this.path.status
		this.setBackend( this.path.status.active ? 'gpu' : 'cpu-fallback' )
	}

	toggleWireframe = () => {
		this.wireframe = !this.wireframe
		this.path?.wireframe( this.wireframe )
		this.controls.setPressed( 'wireframe', this.wireframe )
		writeWireframe( this.wireframe )
	}

	onResize = () => {
		this.path?.resize( stage.width, stage.height )
	}

	update = () => {
		const active = this.path?.update( stage3d.camera )
		if ( this.backend === 'gpu' && !active ) this.setBackend( 'cpu-fallback' )
	}

	dispose() {
		// An init() or prepare() still in flight stops when it resumes.
		this.buildToken++
		this.pendingTolerance = null
		window.__meshLineGPUPathMetrics = null
	}
}

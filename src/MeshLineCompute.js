import { clamp, float, floor, Fn, instanceIndex, length, Loop, max, mix, normalize, sin, smoothstep, storage, uniform, vec3 } from 'three/tsl'
import { StorageBufferAttribute, Vector3 } from 'three/webgpu'

import MeshLine from './MeshLine.js'
import { straightLine } from './positions/straightLine.js'

const TAU = Math.PI * 2
const FAR_MOUSE = new Vector3( 100000, 100000, 100000 )
const _mouseTarget = new Vector3()

const COMPUTE_MANAGED_KEYS = new Set( [
	'curveCount',
	'pointsPerCurve',
	'curveLength',
	'bounds',
	'damping',
	'curlStrength',
	'flowSpeed',
	'homeStrength',
	'mouseStrength',
	'mouseRadius',
	'audioLevel',
	'depthStrength',
	'textureStrength',
	'mode',
	'mouse',
	'mouseTarget',
	'lines',
	'segments',
	'closed',
	'gpuPositionNode',
	'instanceCount',
	'needsPrevious',
	'needsNext',
] )

const MODE_VALUES = {
	autonomous: 0,
	follow: 1,
	field: 2,
}

function clampInt( value, min, fallback ) {
	const number = Number( value )
	if ( !Number.isFinite( number ) ) return fallback
	return Math.max( min, Math.floor( number ) )
}

function hash01( value ) {
	const s = Math.sin( value * 127.1 + 311.7 ) * 43758.5453123
	return s - Math.floor( s )
}

function readVector3Like( value, target ) {
	if ( !value ) return target
	if ( Array.isArray( value ) ) {
		target.set( value[0] ?? 0, value[1] ?? 0, value[2] ?? 0 )
		return target
	}
	target.set( value.x ?? 0, value.y ?? 0, value.z ?? 0 )
	return target
}

/**
 * WebGPU-only curve engine that keeps curve point state in storage buffers and
 * renders it through the regular MeshLine ribbon material.
 */
export default class MeshLineCompute extends MeshLine {

	constructor( options = {} ) {
		super()
		this._disposeMeshLine = this.dispose
		this.dispose = this._disposeCompute

		this.type = 'MeshLineCompute'
		this.isMeshLineCompute = true

		this._computeOptions = {
			curveCount: 128,
			pointsPerCurve: 32,
			curveLength: 4,
			bounds: 12,
			damping: 0.94,
			curlStrength: 4,
			flowSpeed: 1,
			homeStrength: 1.4,
			mouseStrength: 8,
			mouseRadius: 5,
			audioLevel: 0,
			depthStrength: 0,
			textureStrength: 0,
			mode: 0,
		}

		this._time = 0
		this._computeBuilt = false
		this._computeNode = null
		this._distanceComputeNode = null
		this._distanceSampleNode = null
		this._warnedNoCompute = false
		this._storageCount = 0
		this._bufferCurveCount = 0
		this._bufferPointsPerCurve = 0

		this._uTime = uniform( 0 )
		this._uDelta = uniform( 1 / 60 )
		this._uMouse = uniform( FAR_MOUSE.clone() )
		this._uBounds = uniform( this._computeOptions.bounds )
		this._uDamping = uniform( this._computeOptions.damping )
		this._uCurlStrength = uniform( this._computeOptions.curlStrength )
		this._uFlowSpeed = uniform( this._computeOptions.flowSpeed )
		this._uHomeStrength = uniform( this._computeOptions.homeStrength )
		this._uMouseStrength = uniform( this._computeOptions.mouseStrength )
		this._uMouseRadius = uniform( this._computeOptions.mouseRadius )
		this._uAudioLevel = uniform( this._computeOptions.audioLevel )
		this._uDepthStrength = uniform( this._computeOptions.depthStrength )
		this._uTextureStrength = uniform( this._computeOptions.textureStrength )
		this._uMode = uniform( this._computeOptions.mode )

		this._options.frustumCulled = false
		this.configure( options )
	}

	configure( options = {} ) {
		if ( !this._computeOptions ) {
			return super.configure( options )
		}

		const meshOptions = { ...options }
		for ( const key of COMPUTE_MANAGED_KEYS ) delete meshOptions[key]

		if ( options.curveCount !== undefined ) this.curveCount( options.curveCount )
		if ( options.pointsPerCurve !== undefined ) this.pointsPerCurve( options.pointsPerCurve )
		else if ( options.segments !== undefined ) this.pointsPerCurve( options.segments + 1 )
		if ( options.curveLength !== undefined ) this.curveLength( options.curveLength )
		if ( options.bounds !== undefined ) this.bounds( options.bounds )
		if ( options.damping !== undefined ) this.damping( options.damping )
		if ( options.curlStrength !== undefined ) this.curlStrength( options.curlStrength )
		if ( options.flowSpeed !== undefined ) this.flowSpeed( options.flowSpeed )
		if ( options.homeStrength !== undefined ) this.homeStrength( options.homeStrength )
		if ( options.mouseStrength !== undefined ) this.mouseStrength( options.mouseStrength )
		if ( options.mouseRadius !== undefined ) this.mouseRadius( options.mouseRadius )
		if ( options.audioLevel !== undefined ) this.audioLevel( options.audioLevel )
		if ( options.depthStrength !== undefined ) this.depthStrength( options.depthStrength )
		if ( options.textureStrength !== undefined ) this.textureStrength( options.textureStrength )
		if ( options.mode !== undefined ) this.mode( options.mode )
		if ( options.mouse !== undefined || options.mouseTarget !== undefined ) this.mouse( options.mouse ?? options.mouseTarget )

		super.configure( meshOptions )
		return this
	}

	curveCount( value ) {
		const next = clampInt( value, 1, this._computeOptions.curveCount )
		if ( next !== this._computeOptions.curveCount ) {
			this._computeOptions.curveCount = next
			this._built = false
			this._computeBuilt = false
		}
		return this
	}

	pointsPerCurve( value ) {
		const next = clampInt( value, 2, this._computeOptions.pointsPerCurve )
		if ( next !== this._computeOptions.pointsPerCurve ) {
			this._computeOptions.pointsPerCurve = next
			this._built = false
			this._computeBuilt = false
		}
		return this
	}

	curveLength( value ) {
		this._computeOptions.curveLength = Number.isFinite( value ) ? value : this._computeOptions.curveLength
		this._built = false
		this._computeBuilt = false
		return this
	}

	bounds( value ) {
		this._computeOptions.bounds = Number.isFinite( value ) ? Math.max( 0.001, value ) : this._computeOptions.bounds
		this._uBounds.value = this._computeOptions.bounds
		this._built = false
		this._computeBuilt = false
		return this
	}

	damping( value ) {
		this._computeOptions.damping = Number.isFinite( value ) ? Math.max( 0, Math.min( value, 1 ) ) : this._computeOptions.damping
		this._uDamping.value = this._computeOptions.damping
		return this
	}

	curlStrength( value ) {
		this._computeOptions.curlStrength = Number.isFinite( value ) ? value : this._computeOptions.curlStrength
		this._uCurlStrength.value = this._computeOptions.curlStrength
		return this
	}

	flowSpeed( value ) {
		this._computeOptions.flowSpeed = Number.isFinite( value ) ? value : this._computeOptions.flowSpeed
		this._uFlowSpeed.value = this._computeOptions.flowSpeed
		return this
	}

	homeStrength( value ) {
		this._computeOptions.homeStrength = Number.isFinite( value ) ? value : this._computeOptions.homeStrength
		this._uHomeStrength.value = this._computeOptions.homeStrength
		return this
	}

	mouseStrength( value ) {
		this._computeOptions.mouseStrength = Number.isFinite( value ) ? value : this._computeOptions.mouseStrength
		this._uMouseStrength.value = this._computeOptions.mouseStrength
		return this
	}

	mouseRadius( value ) {
		this._computeOptions.mouseRadius = Number.isFinite( value ) ? Math.max( 0.001, value ) : this._computeOptions.mouseRadius
		this._uMouseRadius.value = this._computeOptions.mouseRadius
		return this
	}

	audioLevel( value ) {
		this._computeOptions.audioLevel = Number.isFinite( value ) ? Math.max( 0, value ) : this._computeOptions.audioLevel
		this._uAudioLevel.value = this._computeOptions.audioLevel
		return this
	}

	depthStrength( value ) {
		this._computeOptions.depthStrength = Number.isFinite( value ) ? value : this._computeOptions.depthStrength
		this._uDepthStrength.value = this._computeOptions.depthStrength
		return this
	}

	textureStrength( value ) {
		this._computeOptions.textureStrength = Number.isFinite( value ) ? value : this._computeOptions.textureStrength
		this._uTextureStrength.value = this._computeOptions.textureStrength
		return this
	}

	mode( value ) {
		const next = typeof value === 'string' ? MODE_VALUES[value] ?? 0 : value
		this._computeOptions.mode = Number.isFinite( next ) ? next : 0
		this._uMode.value = this._computeOptions.mode
		return this
	}

	mouse( value ) {
		readVector3Like( value, _mouseTarget )
		this._uMouse.value.copy( _mouseTarget )
		return this
	}

	clearMouse() {
		this._uMouse.value.copy( FAR_MOUSE )
		return this
	}

	build() {
		this._ensureComputeStorage()

		const pointsPerCurve = this._computeOptions.pointsPerCurve
		this._options.lines = straightLine( 1, pointsPerCurve - 1 )
		this._options.closed = false
		this._options.segments = pointsPerCurve - 1
		this._options.instanceCount = this._computeOptions.curveCount
		this._options.gpuPositionNode = this._createPositionNode()
		this._options.smoothSharpBends = false
		this._options.frustumCulled = false

		super.build()
		return this
	}

	step( renderer, delta = 1 / 60 ) {
		this.ensureBuilt()

		if ( !renderer || typeof renderer.compute !== 'function' ) {
			if ( !this._warnedNoCompute ) {
				console.warn( 'MeshLineCompute.step: WebGPURenderer.compute() is required. This class is WebGPU-only.' )
				this._warnedNoCompute = true
			}
			return false
		}

		const safeDelta = Math.max( 0.0001, Math.min( Number( delta ) || 1 / 60, 1 / 15 ) )
		this._time += safeDelta
		this._uTime.value = this._time
		this._uDelta.value = safeDelta

		renderer.compute( this._computeNode )
		renderer.compute( this._distanceComputeNode )
		return true
	}

	arcLengthNode( progress ) {
		this._ensureComputeStorage()
		return this._distanceSampleNode( progress )
	}

	reset() {
		if ( !this._positionBuffer ) return this
		this._seedStorageArrays()
		return this
	}

	get positionBuffer() {
		return this._positionBuffer
	}

	get velocityBuffer() {
		return this._velocityBuffer
	}

	get baseBuffer() {
		return this._baseBuffer
	}

	get seedBuffer() {
		return this._seedBuffer
	}

	get distanceBuffer() {
		return this._distanceBuffer
	}

	_ensureComputeStorage() {
		const curveCount = this._computeOptions.curveCount
		const pointsPerCurve = this._computeOptions.pointsPerCurve
		const totalPoints = curveCount * pointsPerCurve
		const changed = !this._positionBuffer || curveCount !== this._bufferCurveCount || pointsPerCurve !== this._bufferPointsPerCurve

		if ( changed ) {
			this._positionBuffer = new StorageBufferAttribute( totalPoints, 3 )
			this._velocityBuffer = new StorageBufferAttribute( totalPoints, 3 )
			this._baseBuffer = new StorageBufferAttribute( totalPoints, 4 )
			this._seedBuffer = new StorageBufferAttribute( totalPoints, 4 )
			this._distanceBuffer = new StorageBufferAttribute( totalPoints, 1 )
			this._storageCount = totalPoints
			this._bufferCurveCount = curveCount
			this._bufferPointsPerCurve = pointsPerCurve
		}

		if ( changed || !this._computeBuilt ) {
			this._seedStorageArrays()
			this._computeNode = this._createComputeNode()
			this._distanceComputeNode = this._createDistanceComputeNode()
			this._distanceSampleNode = this._createDistanceSampleNode()
			this._computeBuilt = true
		}
	}

	_seedStorageArrays() {
		const curveCount = this._computeOptions.curveCount
		const pointsPerCurve = this._computeOptions.pointsPerCurve
		const bounds = this._computeOptions.bounds
		const curveLength = this._computeOptions.curveLength
		const position = this._positionBuffer.array
		const velocity = this._velocityBuffer.array
		const base = this._baseBuffer.array
		const seed = this._seedBuffer.array
		const distance = this._distanceBuffer.array

		for ( let curveIndex = 0; curveIndex < curveCount; curveIndex++ ) {
			const curveRatio = curveCount === 1 ? 0 : curveIndex / ( curveCount - 1 )
			const goldenAngle = curveIndex * 2.399963229728653
			const spiralRadius = ( 0.14 + Math.sqrt( curveRatio ) * 0.5 ) * bounds
			const arcSpan = 0.34 + hash01( curveIndex + 41.2 ) * 0.62
			const depth = ( hash01( curveIndex + 2.1 ) - 0.5 ) * bounds * 0.18
			const verticalLift = ( hash01( curveIndex + 8.4 ) - 0.5 ) * bounds * 0.12
			const curveSeed = hash01( curveIndex + 17.3 )
			const phase = hash01( curveIndex + 91.7 ) * TAU
			let lastX = 0
			let lastY = 0
			let lastZ = 0
			let accumulatedDistance = 0

			for ( let i = 0; i < pointsPerCurve; i++ ) {
				const pointRatio = pointsPerCurve === 1 ? 0 : i / ( pointsPerCurve - 1 )
				const centered = pointRatio - 0.5
				const angle = goldenAngle + centered * arcSpan
				const breathing = Math.sin( pointRatio * Math.PI )
				const radius = spiralRadius + breathing * curveLength * ( 0.26 + curveSeed * 0.2 )
				const ribbonWave = Math.sin( pointRatio * TAU + phase ) * curveLength * 0.13
				const x = Math.cos( angle ) * radius
				const y = Math.sin( angle ) * radius * 0.64 + verticalLift + ribbonWave
				const z = depth + centered * curveLength * 0.34 + Math.cos( pointRatio * TAU + phase ) * curveLength * 0.08
				const pointIndex = curveIndex * pointsPerCurve + i
				const p3 = pointIndex * 3
				const p4 = pointIndex * 4

				position[p3] = x
				position[p3 + 1] = y
				position[p3 + 2] = z
				velocity[p3] = ( hash01( pointIndex + 11.5 ) - 0.5 ) * 0.08
				velocity[p3 + 1] = ( hash01( pointIndex + 21.5 ) - 0.5 ) * 0.08
				velocity[p3 + 2] = ( hash01( pointIndex + 31.5 ) - 0.5 ) * 0.08
				base[p4] = x
				base[p4 + 1] = y
				base[p4 + 2] = z
				base[p4 + 3] = pointRatio
				seed[p4] = curveSeed
				seed[p4 + 1] = phase / TAU
				seed[p4 + 2] = hash01( pointIndex + 73.2 )
				seed[p4 + 3] = curveRatio

				if ( i > 0 ) {
					accumulatedDistance += Math.hypot( x - lastX, y - lastY, z - lastZ )
				}
				distance[pointIndex] = accumulatedDistance
				lastX = x
				lastY = y
				lastZ = z
			}
		}

		this._positionBuffer.needsUpdate = true
		this._velocityBuffer.needsUpdate = true
		this._baseBuffer.needsUpdate = true
		this._seedBuffer.needsUpdate = true
		this._distanceBuffer.needsUpdate = true
	}

	_createPositionNode() {
		const pointsPerCurve = this._computeOptions.pointsPerCurve
		const storageCount = this._storageCount
		const positions = storage( this._positionBuffer, 'vec3', storageCount )
		const lastPoint = float( pointsPerCurve - 1 )

		return Fn( ( [progress] ) => {
			// Allow out-of-range progress so the material's previous/next sampling at
			// progress ± 1/segments linearly extrapolates instead of collapsing to pos at the endpoints.
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const curveOffset = float( instanceIndex ).mul( pointsPerCurve ).toVar()
			const index0 = curveOffset.add( pivot ).toUint().toVar()
			const index1 = curveOffset.add( pivot.add( 1 ) ).toUint().toVar()

			return mix( positions.element( index0 ), positions.element( index1 ), t )
		} )
	}

	_createDistanceSampleNode() {
		const pointsPerCurve = this._computeOptions.pointsPerCurve
		const storageCount = this._storageCount
		const distances = storage( this._distanceBuffer, 'float', storageCount )
		const lastPoint = float( pointsPerCurve - 1 )

		return Fn( ( [progress] ) => {
			const p = clamp( progress, 0, 1 ).mul( lastPoint ).toVar()
			const point0 = floor( p ).toVar()
			const point1 = clamp( point0.add( 1 ), 0, lastPoint ).toVar()
			const mixValue = p.sub( point0 ).toVar()
			const curveOffset = float( instanceIndex ).mul( pointsPerCurve ).toVar()
			const index0 = curveOffset.add( point0 ).toUint().toVar()
			const index1 = curveOffset.add( point1 ).toUint().toVar()

			return mix( distances.element( index0 ), distances.element( index1 ), mixValue )
		} )
	}

	_createDistanceComputeNode() {
		const count = this._storageCount
		const curveCount = this._computeOptions.curveCount
		const pointsPerCurve = this._computeOptions.pointsPerCurve
		const positions = storage( this._positionBuffer, 'vec3', count )
		const distances = storage( this._distanceBuffer, 'float', count )

		return Fn( () => {
			const curveOffset = float( instanceIndex ).mul( pointsPerCurve ).toVar( 'distanceCurveOffset' )
			const accumulatedDistance = float( 0 ).toVar( 'accumulatedDistance' )
			const firstIndex = curveOffset.toUint().toVar( 'firstDistanceIndex' )
			distances.element( firstIndex ).assign( accumulatedDistance )

			Loop( pointsPerCurve - 1, ( { i } ) => {
				const index0 = curveOffset.add( i ).toUint().toVar( 'distanceIndex0' )
				const index1 = curveOffset.add( i ).add( 1 ).toUint().toVar( 'distanceIndex1' )
				const point0 = positions.element( index0 ).toVar( 'distancePoint0' )
				const point1 = positions.element( index1 ).toVar( 'distancePoint1' )
				accumulatedDistance.addAssign( length( point1.sub( point0 ) ) )
				distances.element( index1 ).assign( accumulatedDistance )
			} )
		} )().compute( curveCount )
	}

	_createComputeNode() {
		const count = this._storageCount
		const positions = storage( this._positionBuffer, 'vec3', count )
		const velocities = storage( this._velocityBuffer, 'vec3', count )
		const bases = storage( this._baseBuffer, 'vec4', count )
		const seeds = storage( this._seedBuffer, 'vec4', count )

		const position = positions.element( instanceIndex )
		const velocity = velocities.element( instanceIndex )
		const base = bases.element( instanceIndex )
		const seed = seeds.element( instanceIndex )

		return Fn( () => {
			const pointProgress = base.w.toVar( 'pointProgress' )
			const phase = seed.x.mul( TAU ).add( this._uTime.mul( this._uFlowSpeed ) ).toVar( 'phase' )
			// Per-curve offset only — sampling the flow field with seed.z (per-point random) made
			// adjacent points on the same curve push in different directions, producing zigzag.
			const curveOffset = vec3( seed.y, seed.x, seed.w ).mul( 3.7 ).toVar( 'curveOffset' )
			const local = position.mul( 0.075 ).add( curveOffset ).add( pointProgress.mul( 1.7 ) ).toVar( 'local' )
			const flow = vec3(
				sin( local.y.add( phase ) ).add( sin( local.z.mul( 1.7 ).sub( phase.mul( 0.7 ) ) ) ),
				sin( local.z.add( phase.mul( 1.17 ) ) ).sub( sin( local.x.mul( 1.3 ).add( phase.mul( 0.3 ) ) ) ),
				sin( local.x.sub( phase.mul( 0.83 ) ) ).add( sin( local.y.mul( 1.9 ).add( phase ) ) )
			).mul( 0.5 ).toVar( 'flow' )

			const mode = this._uMode.toVar( 'mode' )
			const autonomousWeight = float( 1 ).sub( clamp( mode.abs(), 0, 1 ) ).toVar( 'autonomousWeight' )
			const followWeight = float( 1 ).sub( clamp( mode.sub( 1 ).abs(), 0, 1 ) ).toVar( 'followWeight' )
			const fieldWeight = float( 1 ).sub( clamp( mode.sub( 2 ).abs(), 0, 1 ) ).toVar( 'fieldWeight' )

			const toMouse = this._uMouse.sub( position ).toVar( 'toMouse' )
			const mouseDistance = length( toMouse ).toVar( 'mouseDistance' )
			const mouseFalloff = float( 1 ).sub( smoothstep( 0, this._uMouseRadius, mouseDistance ) ).toVar( 'mouseFalloff' )
			const mouseDirection = normalize( toMouse ).toVar( 'mouseDirection' )
			const headBias = float( 1 ).sub( pointProgress ).mul( 0.85 ).add( 0.15 ).toVar( 'headBias' )
			const audioBoost = this._uAudioLevel.mul( 1.5 ).add( 1 ).toVar( 'audioBoost' )
			const textureBoost = this._uTextureStrength.mul( seed.z.sub( 0.5 ) ).toVar( 'textureBoost' )
			const depthLift = vec3( 0, this._uDepthStrength.mul( pointProgress.sub( 0.5 ) ), 0 ).toVar( 'depthLift' )

			const flowAmount = autonomousWeight.add( fieldWeight.mul( 1.8 ) ).add( followWeight.mul( 0.35 ) ).toVar( 'flowAmount' )
			const mouseAmount = followWeight.mul( 2.5 ).add( autonomousWeight.mul( 0.8 ) ).add( fieldWeight.mul( 0.35 ) ).toVar( 'mouseAmount' )
			const homeAmount = autonomousWeight.add( fieldWeight.mul( 0.45 ) ).add( followWeight.mul( 0.12 ) ).toVar( 'homeAmount' )

			const homeForce = base.xyz.sub( position ).mul( this._uHomeStrength.mul( homeAmount ) ).toVar( 'homeForce' )
			const flowForce = normalize( flow ).mul( this._uCurlStrength.mul( flowAmount ).mul( audioBoost ).add( textureBoost ) ).toVar( 'flowForce' )
			const mouseForce = mouseDirection.mul( mouseFalloff.mul( this._uMouseStrength ).mul( mouseAmount ).mul( headBias ) ).toVar( 'mouseForce' )
			const force = homeForce.add( flowForce ).add( mouseForce ).add( depthLift ).toVar( 'force' )

			velocity.addAssign( force.mul( this._uDelta ) )
			velocity.mulAssign( this._uDamping )
			const maxSpeed = max( 0.2, this._uBounds.mul( 0.5 ) )
			velocity.assign( clamp( velocity, vec3( maxSpeed.negate() ), vec3( maxSpeed ) ) )
			position.addAssign( velocity.mul( this._uDelta ) )
			position.assign( clamp( position, vec3( this._uBounds.negate() ), vec3( this._uBounds ) ) )
		} )().compute( count )
	}

	_disposeCompute = () => {
		this._computeNode = null
		this._distanceComputeNode = null
		this._distanceSampleNode = null
		this._positionBuffer = null
		this._velocityBuffer = null
		this._baseBuffer = null
		this._seedBuffer = null
		this._distanceBuffer = null
		this._computeBuilt = false
		this._disposeMeshLine?.()
	}
}

export { MeshLineCompute }
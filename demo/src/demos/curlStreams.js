import { MeshLine } from 'makio-meshline'
import { clamp, cos, float, floor, Fn, instanceIndex, length, Loop, max, mix, sin, smoothstep, storage, sub, uniform, vec3, vec4 } from 'three/tsl'
import { Plane, Raycaster, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { onMove } from '@/makio/utils/input/mouse'

const STREAM_COUNT = 64
const TRAIL_LENGTH = 64               // longer trails so each segment is short relative to its width
const TOTAL_POINTS = STREAM_COUNT * TRAIL_LENGTH
const STEP_DT = 0.1
const FIELD_FREQ = 0.45
const ATTRACTOR_RADIUS = 7

const intersectPoint = new Vector3()

class CurlStreamsExample {
	constructor() {
		this.line = null
		this.positionBuffer = null
		this.shiftNode = null
		this.advectNode = null
		this.uTime = uniform( 0 )
		this.raycaster = new Raycaster()
		this.mouse = new Vector2()
		this.groundPlane = new Plane( new Vector3( 0, 1, 0 ), 0 )
		this.mouseUniform = uniform( new Vector3( 1000, 0, 1000 ) )
		this.mouseRadius = uniform( 3.5 )
		this.mouseStrength = uniform( 6.0 )
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 14 )
		stage3d.control.maxRadius = 30
		stage3d.control.minRadius = 5
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
		onMove.add( this.onMouseMove )
	}

	initScene() {
		this.positionBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this._seedStreams()

		const positions = storage( this.positionBuffer, 'vec3', TOTAL_POINTS )

		// Pass 1: shift each stream's trail down one slot.
		this.shiftNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( TRAIL_LENGTH ).toVar()
			Loop( TRAIL_LENGTH - 1, ( { i } ) => {
				const dst = baseOffset.add( float( TRAIL_LENGTH - 1 ).sub( i ) ).toUint().toVar()
				const src = baseOffset.add( float( TRAIL_LENGTH - 2 ).sub( i ) ).toUint().toVar()
				positions.element( dst ).assign( positions.element( src ) )
			} )
		} )().compute( STREAM_COUNT )

		// Pass 2: advect the head along the curl field, write to slot 0.
		this.advectNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( TRAIL_LENGTH ).toVar()
			const headIdx = baseOffset.toUint().toVar()
			const prevIdx = baseOffset.add( 1 ).toUint().toVar()

			const p = positions.element( prevIdx ).toVar()

			// Pseudo curl-noise: sum of sines. Time-varying phase makes the field swirl over time.
			const f = float( FIELD_FREQ )
			const t = this.uTime.toVar()
			const vx = sin( p.y.mul( f ).add( t.mul( 0.6 ) ) ).mul( cos( p.z.mul( f ) ) )
			const vy = sin( p.z.mul( f ).add( t.mul( 0.8 ) ) ).mul( cos( p.x.mul( f ) ) ).mul( 0.6 )
			const vz = sin( p.x.mul( f ).sub( t.mul( 0.5 ) ) ).mul( cos( p.y.mul( f ) ) )
			const flow = vec3( vx, vy, vz ).mul( 1.4 )

			// Mouse repulsion: 3D push-away from cursor world-pos with smooth falloff.
			const toParticle = sub( p, this.mouseUniform ).toVar()
			const mouseDist = length( toParticle ).toVar()
			const falloff = smoothstep( this.mouseRadius, float( 0 ), mouseDist )
			const safeDir = toParticle.div( max( mouseDist, float( 0.001 ) ) )
			const mousePush = safeDir.mul( falloff ).mul( this.mouseStrength )

			// Soft pull-back toward origin once the particle drifts past ATTRACTOR_RADIUS.
			const r = length( p ).toVar()
			const pullStrength = clamp( r.sub( ATTRACTOR_RADIUS ), 0, 4 ).mul( 0.4 )
			const pull = p.div( max( r, float( 0.001 ) ) ).mul( pullStrength.negate() )

			const next = p.add( flow.add( pull ).add( mousePush ).mul( STEP_DT ) )
			positions.element( headIdx ).assign( next )
		} )().compute( STREAM_COUNT )

		const positionNode = Fn( ( [progress] ) => {
			const lastPoint = float( TRAIL_LENGTH - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const baseOffset = float( instanceIndex ).mul( TRAIL_LENGTH ).toVar()
			const i0 = baseOffset.add( pivot ).toUint().toVar()
			const i1 = baseOffset.add( pivot.add( 1 ) ).toUint().toVar()
			return mix( positions.element( i0 ), positions.element( i1 ), t )
		} )

		const colorNode = Fn( ( [color, progress] ) => {
			const idx = float( instanceIndex )
			const ratio = idx.div( STREAM_COUNT - 1 )
			const violet = vec3( 0.42, 0.18, 0.85 )
			const green = vec3( 0.2, 0.95, 0.55 )
			const tint = mix( violet, green, ratio )
			return vec4( tint.mul( progress.oneMinus().mul( 0.85 ).add( 0.15 ) ), 1 )
		} )

		const widthNode = Fn( ( [width, progress] ) => {
			return width.mul( progress.oneMinus().mul( 0.9 ).add( 0.1 ) )
		} )

		this.line = new MeshLine()
			.instances( STREAM_COUNT )
			.segments( TRAIL_LENGTH - 1 )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.widthFn( widthNode )
			.lineWidth( 0.25 )
			.color( 0xffffff )
			.transparent( true )
			.opacity( 0.9 )

		stage3d.add( this.line )
	}

	_seedStreams() {
		const arr = this.positionBuffer.array
		for ( let s = 0; s < STREAM_COUNT; s++ ) {
			// Initial seed inside the attractor radius, distributed uniformly on a sphere.
			const u = Math.random()
			const v = Math.random()
			const phi = Math.acos( 2 * u - 1 )
			const theta = 2 * Math.PI * v
			const r = ATTRACTOR_RADIUS * Math.cbrt( Math.random() ) * 0.8
			const x = r * Math.sin( phi ) * Math.cos( theta )
			const y = r * Math.sin( phi ) * Math.sin( theta )
			const z = r * Math.cos( phi )
			for ( let i = 0; i < TRAIL_LENGTH; i++ ) {
				const k = ( s * TRAIL_LENGTH + i ) * 3
				arr[k] = x
				arr[k + 1] = y
				arr[k + 2] = z
			}
		}
		this.positionBuffer.needsUpdate = true
	}

	update = ( dt ) => {
		if ( !this.line || !stage3d.renderer ) return
		this.uTime.value += dt * 0.001
		stage3d.renderer.compute( this.shiftNode )
		stage3d.renderer.compute( this.advectNode )
	}

	onResize = () => {
		this.line?.resize()
	}

	onMouseMove = ( mouseData ) => {
		this.mouse.x = mouseData.normalizedX
		this.mouse.y = -mouseData.normalizedY
		this.raycaster.setFromCamera( this.mouse, stage3d.camera )
		intersectPoint.set( 0, 0, 0 )
		this.raycaster.ray.intersectPlane( this.groundPlane, intersectPoint )
		if ( intersectPoint && !( intersectPoint.x == 0 && intersectPoint.z == 0 && intersectPoint.y == 0 ) ) {
			this.mouseUniform.value.set( intersectPoint.x, 0, intersectPoint.z )
		}
	}

	show() {
		stage.onUpdate.add( this.update )
	}

	hide( cb ) {
		stage.onUpdate.remove( this.update )
		if ( cb ) cb()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		onMove.remove( this.onMouseMove )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
		this.positionBuffer = null
		this.shiftNode = null
		this.advectNode = null
		stage3d.control?.dispose()
	}
}

export default CurlStreamsExample

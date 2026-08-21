import { MeshLine } from 'makio-meshline'
import { clamp, float, floor, Fn, instanceIndex, length, Loop, max, mix, smoothstep, storage, uniform, vec3, vec4 } from 'three/tsl'
import { Plane, Raycaster, StorageBufferAttribute, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { onMove } from '@/makio/utils/input/mouse'

const ROPE_COUNT = 16
const POINTS_PER_ROPE = 32
const TOTAL_POINTS = ROPE_COUNT * POINTS_PER_ROPE
const REST_LENGTH = 0.4
const STIFFNESS = 90
const GRAVITY = -24
const DAMPING = 0.94
const SUBSTEPS = 4
// PHYSICS_SPEED compensates for the per-frame slowdown caused by substepping
// (each substep advances dt/SUBSTEPS, so force·dt² shrinks by SUBSTEPS² and the
// frame-total force impulse is SUBSTEPS× smaller than a single-step integration).
const PHYSICS_SPEED = 1.6
const STEP_DT = ( 1 / 60 * PHYSICS_SPEED ) / SUBSTEPS
const MOUSE_RADIUS = 2.5
const MOUSE_STRENGTH = 130
const FAR_MOUSE = new Vector3( 1e5, 1e5, 1e5 )

const _pointerNDC = new Vector2()
const _pointerWorld = new Vector3()
const _interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )

class VerletRopesExample {
	constructor() {
		this.line = null
		this.positionBuffer = null
		this.prevBuffer = null
		this.computeNode = null
		this.uMouse = uniform( FAR_MOUSE.clone() )
		this.raycaster = new Raycaster()
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 18 )
		stage3d.control.maxRadius = 40
		stage3d.control.minRadius = 8
		stage3d.control._phi = Math.PI * 0.5
		this.initScene()
		onMove.add( this.onMouseMove )
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		this.positionBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this.prevBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this._seedRopes()

		const positions = storage( this.positionBuffer, 'vec3', TOTAL_POINTS )
		const prevPositions = storage( this.prevBuffer, 'vec3', TOTAL_POINTS )

		// One compute thread per rope. We iterate bottom-up so each point reads its `above`
		// neighbour from the OLD (pre-frame) buffer state — Jacobi-equivalent propagation
		// at one link per frame, which avoids the runaway amplification of Gauss-Seidel.
		this.computeNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const dtSq = float( STEP_DT * STEP_DT )

			Loop( POINTS_PER_ROPE - 1, ( { i } ) => {
				// reversed = N-1, N-2, ..., 1 → process bottom point first, anchor neighbour last.
				const reversed = float( POINTS_PER_ROPE - 1 ).sub( i ).toVar()
				const idx = baseOffset.add( reversed ).toUint().toVar()
				const aboveIdx = baseOffset.add( reversed ).sub( 1 ).toUint().toVar()

				const cur = positions.element( idx ).toVar()
				const prev = prevPositions.element( idx ).toVar()
				const above = positions.element( aboveIdx ).toVar()

				// Verlet velocity carry with damping.
				const vel = cur.sub( prev ).mul( DAMPING ).toVar()

				// Spring restoring force toward the rest distance from the point above.
				const delta = cur.sub( above ).toVar()
				const dist = max( length( delta ), float( 0.0001 ) ).toVar()
				const stretch = dist.sub( REST_LENGTH ).toVar()
				const spring = delta.div( dist ).mul( stretch ).mul( -STIFFNESS ).toVar()

				// Mouse repulsion within MOUSE_RADIUS.
				const toMouse = this.uMouse.sub( cur ).toVar()
				const mDist = max( length( toMouse ), float( 0.0001 ) ).toVar()
				const falloff = float( 1 ).sub( smoothstep( 0, MOUSE_RADIUS, mDist ) ).toVar()
				const mouseForce = toMouse.div( mDist ).mul( falloff ).mul( -MOUSE_STRENGTH ).toVar()

				const force = spring.add( vec3( 0, GRAVITY, 0 ) ).add( mouseForce ).toVar()
				const next = cur.add( vel ).add( force.mul( dtSq ) ).toVar()

				prevPositions.element( idx ).assign( cur )
				positions.element( idx ).assign( next )
			} )
		} )().compute( ROPE_COUNT )

		const positionNode = Fn( ( [progress] ) => {
			const lastPoint = float( POINTS_PER_ROPE - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
			const i0 = baseOffset.add( pivot ).toUint().toVar()
			const i1 = baseOffset.add( pivot.add( 1 ) ).toUint().toVar()
			return mix( positions.element( i0 ), positions.element( i1 ), t )
		} )

		const colorNode = Fn( ( [color, progress] ) => {
			const idx = float( instanceIndex )
			const ratio = idx.div( ROPE_COUNT - 1 )
			const top = vec3( 0.95, 0.62, 0.2 )
			const bottom = vec3( 0.18, 0.32, 0.78 )
			const verticalTint = mix( top, bottom, progress )
			const ropeTint = vec3( 1, 1, 1 ).mul( float( 1 ).sub( ratio.mul( 0.25 ) ) )
			return vec4( verticalTint.mul( ropeTint ), 1 )
		} )

		this.line = new MeshLine()
			.instances( ROPE_COUNT )
			.segments( POINTS_PER_ROPE - 1 )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.lineWidth( 0.55 )
			.join( { limit: 1.15 } )
			.color( 0xffffff )
			.transparent( true )
			.opacity( 0.92 )

		stage3d.add( this.line )
	}

	_seedRopes() {
		const positions = this.positionBuffer.array
		const prevs = this.prevBuffer.array
		const span = 22
		for ( let r = 0; r < ROPE_COUNT; r++ ) {
			const xAnchor = ( r / ( ROPE_COUNT - 1 ) - 0.5 ) * span
			const yAnchor = 6
			for ( let i = 0; i < POINTS_PER_ROPE; i++ ) {
				const k = ( r * POINTS_PER_ROPE + i ) * 3
				const y = yAnchor - i * REST_LENGTH
				positions[k] = xAnchor
				positions[k + 1] = y
				positions[k + 2] = 0
				prevs[k] = xAnchor
				prevs[k + 1] = y
				prevs[k + 2] = 0
			}
		}
		this.positionBuffer.needsUpdate = true
		this.prevBuffer.needsUpdate = true
	}

	onMouseMove = ( mouseData ) => {
		_pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.raycaster.setFromCamera( _pointerNDC, stage3d.camera )
		if ( this.raycaster.ray.intersectPlane( _interactionPlane, _pointerWorld ) ) {
			this.uMouse.value.copy( _pointerWorld )
		}
	}

	update = () => {
		if ( !this.line || !stage3d.renderer ) return
		// Substep so each compute pass advances dt/SUBSTEPS — keeps stiff springs stable.
		for ( let s = 0; s < SUBSTEPS; s++ ) {
			stage3d.renderer.compute( this.computeNode )
		}
	}

	onResize = () => {
		this.line?.resize()
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
		onMove.remove( this.onMouseMove )
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
		this.positionBuffer = null
		this.prevBuffer = null
		this.computeNode = null
		stage3d.control?.dispose()
	}
}

export default VerletRopesExample

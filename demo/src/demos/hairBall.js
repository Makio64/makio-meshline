import { MeshLine } from 'makio-meshline'
import { clamp, cos, float, floor, Fn, instanceIndex, length, Loop, max, mix, sin, storage, uniform, vec3, vec4 } from 'three/tsl'
import { StorageBufferAttribute, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const STRAND_COUNT = 256
const POINTS_PER_STRAND = 12
const TOTAL_POINTS = STRAND_COUNT * POINTS_PER_STRAND
const SPHERE_RADIUS = 2.0
const REST_LENGTH = 0.11
const STIFFNESS = 90
const GRAVITY = -16
const DAMPING = 0.86
const SUBSTEPS = 4
const PHYSICS_SPEED = 1.35
const STEP_DT = ( 1 / 60 * PHYSICS_SPEED ) / SUBSTEPS
const WIND_STRENGTH = 6.5
const _tmp = new Vector3()

class HairBallExample {
	constructor() {
		this.line = null
		this.positionBuffer = null
		this.prevBuffer = null
		this.anchorBuffer = null
		this.computeNode = null
		this.uWind = uniform( 0 )
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 8 )
		stage3d.control.maxRadius = 24
		stage3d.control.minRadius = 4
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		this.positionBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this.prevBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		// One anchor per strand. Stored as vec4 (xyz = anchor, w = unused) for storage alignment.
		this.anchorBuffer = new StorageBufferAttribute( STRAND_COUNT, 4 )
		this._seedHair()

		const positions = storage( this.positionBuffer, 'vec3', TOTAL_POINTS )
		const prevPositions = storage( this.prevBuffer, 'vec3', TOTAL_POINTS )
		const anchors = storage( this.anchorBuffer, 'vec4', STRAND_COUNT )

		this.computeNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_STRAND ).toVar()
			const anchor = anchors.element( instanceIndex ).toVar()

			// Pin slot 0 to the anchor every step.
			positions.element( baseOffset.toUint() ).assign( anchor.xyz )
			prevPositions.element( baseOffset.toUint() ).assign( anchor.xyz )

			const dtSq = float( STEP_DT * STEP_DT )

			// Bottom-up iteration so each point reads its anchor-side neighbour from the
			// OLD buffer state — Jacobi-equivalent, propagates one link per frame.
			Loop( POINTS_PER_STRAND - 1, ( { i } ) => {
				const reversed = float( POINTS_PER_STRAND - 1 ).sub( i ).toVar()
				const idx = baseOffset.add( reversed ).toUint().toVar()
				const aboveIdx = baseOffset.add( reversed ).sub( 1 ).toUint().toVar()

				const cur = positions.element( idx ).toVar()
				const prev = prevPositions.element( idx ).toVar()
				const above = positions.element( aboveIdx ).toVar()

				const vel = cur.sub( prev ).mul( DAMPING ).toVar()

				const delta = cur.sub( above ).toVar()
				const dist = max( length( delta ), float( 0.0001 ) ).toVar()
				const spring = delta.div( dist ).mul( dist.sub( REST_LENGTH ) ).mul( -STIFFNESS ).toVar()

				// Wind: a sweeping sine in world space. uWind advances linearly each frame.
				const windPhase = this.uWind.add( cur.x.mul( 0.6 ) ).add( cur.z.mul( 0.4 ) )
				const wind = vec3(
					sin( windPhase ),
					cos( windPhase.mul( 0.7 ) ).mul( 0.25 ),
					cos( windPhase ),
				).mul( WIND_STRENGTH )

				const force = spring.add( vec3( 0, GRAVITY, 0 ) ).add( wind ).toVar()
				const next = cur.add( vel ).add( force.mul( dtSq ) ).toVar()

				prevPositions.element( idx ).assign( cur )
				positions.element( idx ).assign( next )
			} )
		} )().compute( STRAND_COUNT )

		const positionNode = Fn( ( [progress] ) => {
			const lastPoint = float( POINTS_PER_STRAND - 1 )
			const p = progress.mul( lastPoint ).toVar()
			const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
			const t = p.sub( pivot ).toVar()
			const baseOffset = float( instanceIndex ).mul( POINTS_PER_STRAND ).toVar()
			const i0 = baseOffset.add( pivot ).toUint().toVar()
			const i1 = baseOffset.add( pivot.add( 1 ) ).toUint().toVar()
			return mix( positions.element( i0 ), positions.element( i1 ), t )
		} )

		const colorNode = Fn( ( [color, progress] ) => {
			// Gradient from anchor (root) to tip; root is dark amber, tip is bright cyan.
			const root = vec3( 0.32, 0.18, 0.06 )
			const tip = vec3( 0.55, 0.92, 1.0 )
			return vec4( mix( root, tip, progress ), 1 )
		} )

		const widthNode = Fn( ( [width, progress] ) => {
			// Hair tapers toward the tip.
			return width.mul( progress.oneMinus().mul( 0.85 ).add( 0.15 ) )
		} )

		this.line = new MeshLine()
			.instances( STRAND_COUNT )
			.segments( POINTS_PER_STRAND - 1 )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.widthFn( widthNode )
			.lineWidth( 0.2 )
			.color( 0xffffff )
			.transparent( true )
			.opacity( 0.86 )

		stage3d.add( this.line )
	}

	_seedHair() {
		const positions = this.positionBuffer.array
		const prevs = this.prevBuffer.array
		const anchors = this.anchorBuffer.array
		const golden = Math.PI * ( 3 - Math.sqrt( 5 ) )

		for ( let s = 0; s < STRAND_COUNT; s++ ) {
			// Fibonacci sphere distribution for evenly-spaced anchors.
			const ratio = s / ( STRAND_COUNT - 1 )
			const y = 1 - 2 * ratio
			const r = Math.sqrt( 1 - y * y )
			const theta = golden * s
			_tmp.set( Math.cos( theta ) * r, y, Math.sin( theta ) * r ).multiplyScalar( SPHERE_RADIUS )

			anchors[s * 4] = _tmp.x
			anchors[s * 4 + 1] = _tmp.y
			anchors[s * 4 + 2] = _tmp.z
			anchors[s * 4 + 3] = 0

			// Initial strand extends along the surface normal so it looks like a spike at start.
			const nx = _tmp.x / SPHERE_RADIUS
			const ny = _tmp.y / SPHERE_RADIUS
			const nz = _tmp.z / SPHERE_RADIUS
			for ( let i = 0; i < POINTS_PER_STRAND; i++ ) {
				const k = ( s * POINTS_PER_STRAND + i ) * 3
				const offset = i * REST_LENGTH
				const x = _tmp.x + nx * offset
				const y2 = _tmp.y + ny * offset
				const z = _tmp.z + nz * offset
				positions[k] = x
				positions[k + 1] = y2
				positions[k + 2] = z
				prevs[k] = x
				prevs[k + 1] = y2
				prevs[k + 2] = z
			}
		}
		this.positionBuffer.needsUpdate = true
		this.prevBuffer.needsUpdate = true
		this.anchorBuffer.needsUpdate = true
	}

	update = ( dt ) => {
		if ( !this.line || !stage3d.renderer ) return
		this.uWind.value += ( dt * 0.001 ) * 0.7
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
		window.removeEventListener( 'resize', this.onResize )
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
		this.positionBuffer = null
		this.prevBuffer = null
		this.anchorBuffer = null
		this.computeNode = null
		stage3d.control?.dispose()
	}
}

export default new HairBallExample()

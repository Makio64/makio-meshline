import { MeshLine } from 'makio-meshline'
import { clamp, float, floor, Fn, instanceIndex, Loop, mix, storage, vec3, vec4 } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

const INSTANCE_COUNT = 24
const TRAIL_LENGTH = 192             // points per trail
const TOTAL_POINTS = INSTANCE_COUNT * TRAIL_LENGTH

// Lorenz attractor parameters (classic chaotic regime).
const SIGMA = 10
const RHO = 28
const BETA = 8 / 3
const STEP_DT = 0.008

class LorenzTrailsExample {
	constructor() {
		this.line = null
		this.positionBuffer = null
		this.shiftNode = null
		this.integrateNode = null
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 80 )
		stage3d.control.maxRadius = 200
		stage3d.control.minRadius = 30
		this.initScene()
		window.addEventListener( 'resize', this.onResize )
	}

	initScene() {
		this.positionBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this._seedTrails()

		const positions = storage( this.positionBuffer, 'vec3', TOTAL_POINTS )

		// Pass 1: shift trail down one slot. Slot 0 is the head, slot N-1 is the tail.
		// Iterating high → low avoids overwriting a slot we still need to read.
		this.shiftNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( TRAIL_LENGTH ).toVar()
			Loop( TRAIL_LENGTH - 1, ( { i } ) => {
				const dst = baseOffset.add( float( TRAIL_LENGTH - 1 ).sub( i ) ).toUint().toVar()
				const src = baseOffset.add( float( TRAIL_LENGTH - 2 ).sub( i ) ).toUint().toVar()
				positions.element( dst ).assign( positions.element( src ) )
			} )
		} )().compute( INSTANCE_COUNT )

		// Pass 2: integrate Lorenz one Euler step using the previous head (now in slot 1)
		// and write the new head into slot 0.
		this.integrateNode = Fn( () => {
			const baseOffset = float( instanceIndex ).mul( TRAIL_LENGTH ).toVar()
			const headIdx = baseOffset.toUint().toVar()
			const prevIdx = baseOffset.add( 1 ).toUint().toVar()

			const p = positions.element( prevIdx ).toVar()
			const dx = float( SIGMA ).mul( p.y.sub( p.x ) )
			const dy = p.x.mul( float( RHO ).sub( p.z ) ).sub( p.y )
			const dz = p.x.mul( p.y ).sub( float( BETA ).mul( p.z ) )

			positions.element( headIdx ).assign( p.add( vec3( dx, dy, dz ).mul( STEP_DT ) ) )
		} )().compute( INSTANCE_COUNT )

		// gpuPositionNode: progress 0 → head (newest), progress 1 → tail (oldest).
		// Pivot-clamp pattern lets the material's previous/next sampling extrapolate cleanly off the ends.
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
			// Bright at the head, fade toward the tail.
			const fade = progress.oneMinus()
			const idx = float( instanceIndex )
			const ratio = idx.div( INSTANCE_COUNT - 1 )
			const cool = vec3( 0.18, 0.74, 1.0 )
			const hot = vec3( 1.0, 0.42, 0.62 )
			return vec4( cool.mul( ratio.oneMinus() ).add( hot.mul( ratio ) ).mul( fade ), 1 )
		} )

		const widthNode = Fn( ( [width, progress] ) => {
			// Taper toward the tail so older points are thinner.
			return width.mul( progress.oneMinus().mul( 0.85 ).add( 0.15 ) )
		} )

		this.line = new MeshLine()
			.instances( INSTANCE_COUNT )
			.segments( TRAIL_LENGTH - 1 )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.widthFn( widthNode )
			.lineWidth( 0.7 )
			.color( 0xffffff )
			.transparent( true )
			.opacity( 0.85 )

		stage3d.add( this.line )
	}

	_seedTrails() {
		const arr = this.positionBuffer.array
		// Start every instance at (1,1,1) but pre-integrate by a different number of steps
		// so they land at distinct points on the attractor and diverge from there.
		for ( let i = 0; i < INSTANCE_COUNT; i++ ) {
			let x = 1
			let y = 1 + i * 0.001
			let z = 1
			const warmup = 200 + i * 220
			for ( let k = 0; k < warmup; k++ ) {
				const dx = SIGMA * ( y - x )
				const dy = x * ( RHO - z ) - y
				const dz = x * y - BETA * z
				x += dx * STEP_DT
				y += dy * STEP_DT
				z += dz * STEP_DT
			}
			for ( let j = 0; j < TRAIL_LENGTH; j++ ) {
				const k = ( i * TRAIL_LENGTH + j ) * 3
				arr[k] = x
				arr[k + 1] = y
				arr[k + 2] = z
			}
		}
		this.positionBuffer.needsUpdate = true
	}

	update = () => {
		if ( !this.line || !stage3d.renderer ) return
		stage3d.renderer.compute( this.shiftNode )
		stage3d.renderer.compute( this.integrateNode )
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
		this.shiftNode = null
		this.integrateNode = null
		stage3d.control?.dispose()
	}
}

export default LorenzTrailsExample

import { MeshLine, storagePositions } from 'makio-meshline'
import { cos, float, Fn, instanceIndex, Loop, storage, uint, uniform, vec3, vec4 } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { WebGPURequiredError } from '@/utils/demoFailure'
import { createDemoHint } from '@/utils/demoHint'

const INSTANCE_COUNT = 64
const TRAIL_LENGTH = 256             // points per trail
const TOTAL_POINTS = INSTANCE_COUNT * TRAIL_LENGTH

// Lorenz attractor parameters (classic chaotic regime).
const SIGMA = 10
const RHO = 28
const BETA = 8 / 3
const STEP_DT = 0.006
// Integration runs at a fixed rate, so the flow looks the same at 60 and 120 Hz.
const STEP_INTERVAL = 1000 / 60
const MAX_STEPS_PER_FRAME = 4
const AUTO_ORBIT_SPEED = 0.00005

const lorenzStep = ( x, y, z ) => [
	x + SIGMA * ( y - x ) * STEP_DT,
	y + ( x * ( RHO - z ) - y ) * STEP_DT,
	z + ( x * y - BETA * z ) * STEP_DT,
]

class LorenzTrailsExample {
	constructor() {
		this.line = null
		this.positionBuffer = null
		this.integrateNode = null
		// Each trail is a ring buffer: `head` is the newest slot, so a frame writes
		// only its new samples instead of shifting every point down the trail.
		this.head = uniform( 0, 'uint' )
		this.steps = uniform( 1, 'uint' )
		this.accumulator = 0
		this.control = null
		this.hint = null
	}

	async init() {
		await stage3d.initRender( { background: 0x02030A } )
		if ( !stage3d.isWebGPU ) {
			throw new WebGPURequiredError( 'Lorenz Trails integrates its trails in WebGPU compute shaders, and this browser is running the WebGL2 fallback.' )
		}
		this.control = new OrbitControl( stage3d.camera, 86 )
		this.control.maxRadius = 200
		this.control.minRadius = 30
		this.control._phi = 1.25
		// The attractor's wings sit around z = 25; orbit its centre, not the origin.
		this.control.target.set( 0, 0, 25 )
		this.control.cameraOffset.set( 0, 0, 25 )
		stage3d.control = this.control
		stage3d.camera.far = 400
		stage3d.camera.updateProjectionMatrix()
		this.initScene()
		// The demo bar's caption explains the ring buffer; the hint only says how to interact.
		this.hint = createDemoHint( 'Drag to orbit', {
			accent: '#a78bfa',
			hideAfter: 10000,
		} )
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	initScene() {
		this.positionBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this.seedTrails()

		const positions = storage( this.positionBuffer, 'vec3', TOTAL_POINTS )
		const length = uint( TRAIL_LENGTH )

		// One thread per trail integrates `steps` Euler steps from the current head
		// and appends them after it, wrapping around the ring.
		this.integrateNode = Fn( () => {
			const base = instanceIndex.mul( length ).toVar()
			const p = positions.element( base.add( this.head ) ).toVar()
			Loop( { start: uint( 1 ), end: this.steps.add( 1 ), type: 'uint' }, ( { i } ) => {
				const dx = float( SIGMA ).mul( p.y.sub( p.x ) )
				const dy = p.x.mul( float( RHO ).sub( p.z ) ).sub( p.y )
				const dz = p.x.mul( p.y ).sub( float( BETA ).mul( p.z ) )
				p.addAssign( vec3( dx, dy, dz ).mul( STEP_DT ) )
				positions.element( base.add( this.head.add( i ).mod( length ) ) ).assign( p )
			} )
		} )().compute( INSTANCE_COUNT )

		// progress 0 → head (newest), progress 1 → tail (oldest).
		const positionNode = storagePositions( this.positionBuffer, { pointsPerLine: TRAIL_LENGTH, head: this.head } )

		const colorNode = Fn( ( [color, progress] ) => {
			// A spread of warm-to-cool hues per trail, bright at the head.
			const ratio = float( instanceIndex ).div( INSTANCE_COUNT - 1 )
			const hue = vec3( 0.5 ).add( vec3( 0.5 ).mul( cos( vec3( ratio.mul( 0.7 ).add( 0.55 ) ).add( vec3( 0.0, 0.15, 0.3 ) ).mul( Math.PI * 2 ) ) ) )
			const fade = progress.oneMinus().pow( 1.6 )
			return vec4( hue.mul( fade.mul( 0.92 ).add( 0.08 ) ), 1 )
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
			.lineWidth( 0.55 )
			.color( 0xffffff )

		stage3d.add( this.line )
	}

	/**
	 * Start every trail already full: integrate a distinct warm-up per trail, then
	 * record its next TRAIL_LENGTH states oldest-first so slot TRAIL_LENGTH - 1 is
	 * the head. The first frame shows complete trails instead of collapsed dots.
	 */
	seedTrails() {
		const array = this.positionBuffer.array
		for ( let trail = 0; trail < INSTANCE_COUNT; trail++ ) {
			let x = 1
			let y = 1 + trail * 0.001
			let z = 1
			const warmup = 400 + trail * 97
			for ( let step = 0; step < warmup; step++ ) [x, y, z] = lorenzStep( x, y, z )
			for ( let slot = 0; slot < TRAIL_LENGTH; slot++ ) {
				const offset = ( trail * TRAIL_LENGTH + slot ) * 3
				array[offset] = x
				array[offset + 1] = y
				array[offset + 2] = z
				;[x, y, z] = lorenzStep( x, y, z )
			}
		}
		this.head.value = TRAIL_LENGTH - 1
		this.positionBuffer.needsUpdate = true
	}

	update = dt => {
		if ( !this.line || !stage3d.renderer ) return
		const elapsed = Math.min( dt, 100 )
		if ( !this.control?._isDown ) this.control._theta += elapsed * AUTO_ORBIT_SPEED

		this.accumulator += elapsed
		const steps = Math.min( MAX_STEPS_PER_FRAME, Math.floor( this.accumulator / STEP_INTERVAL ) )
		if ( steps === 0 ) return
		this.accumulator = Math.min( this.accumulator - steps * STEP_INTERVAL, STEP_INTERVAL )
		this.steps.value = steps
		stage3d.renderer.compute( this.integrateNode )
		// The dispatch above is queued before this frame's draw, which already
		// reads the advanced head.
		this.head.value = ( this.head.value + steps ) % TRAIL_LENGTH
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		this.hint?.remove()
		this.hint = null
		stage3d.remove( this.line )
		this.integrateNode?.dispose?.()
		this.line?.dispose()
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.line = null
		this.positionBuffer = null
		this.integrateNode = null
		this.control = null
	}
}

export default LorenzTrailsExample

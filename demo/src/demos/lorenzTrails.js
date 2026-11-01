/**
 * Lorenz Trails — 64 chaotic attractor ring-buffer trails read directly from a GPU StorageBufferAttribute.
 * Demonstrates: storagePositions( storageAttr, { pointsPerLine, head } ), .gpuPositionNode( fn ),
 * .instances( count ), and WebGPU compute integration.
 */
import { MeshLine, storagePositions } from 'makio-meshline'
import { cos, float, Fn, instanceIndex, Loop, storage, uint, uniform, vec3, vec4 } from 'three/tsl'
import { StorageBufferAttribute } from 'three/webgpu'

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

const lorenzStep = ( x, y, z ) => [
	x + SIGMA * ( y - x ) * STEP_DT,
	y + ( x * ( RHO - z ) - y ) * STEP_DT,
	z + ( x * y - BETA * z ) * STEP_DT,
]

export default class LorenzTrailsExample {
	// Each trail is a ring buffer: `head` is the newest slot, so a frame writes
	// only its new samples instead of shifting every point down the trail.
	head = uniform( 0, 'uint' )
	steps = uniform( 1, 'uint' )
	accumulator = 0

	async init() {
		await stage3d.initRender( { background: 0x02030A, far: 400 } )
		if ( !stage3d.isWebGPU ) {
			throw new WebGPURequiredError( 'Lorenz Trails integrates its trails in WebGPU compute shaders, and this browser is running the WebGL2 fallback.' )
		}
		// The attractor's wings sit around z = 25; orbit its centre, not the origin.
		stage3d.orbit( 86, {
			target: [0, 0, 25],
			cameraOffset: [0, 0, 25],
			phi: 1.25,
			minRadius: 30,
			maxRadius: 200,
			autoRotate: 0.00005,
		} )
		this.initScene()
		createDemoHint( 'Drag to orbit', { accent: '#a78bfa', hideAfter: 10000 } )
	}

	initScene() {
		this.positionBuffer = new StorageBufferAttribute( TOTAL_POINTS, 3 )
		this.seedTrails()

		const positions = storage( this.positionBuffer, 'vec3', TOTAL_POINTS )
		const length = uint( TRAIL_LENGTH )

		// One thread per trail integrates `steps` Euler steps from the current head
		// and appends them after it, wrapping around the ring.
		this.integrateNode = stage3d.own( Fn( () => {
			const base = instanceIndex.mul( length ).toVar()
			const p = positions.element( base.add( this.head ) ).toVar()
			Loop( { start: uint( 1 ), end: this.steps.add( 1 ), type: 'uint' }, ( { i } ) => {
				const dx = float( SIGMA ).mul( p.y.sub( p.x ) )
				const dy = p.x.mul( float( RHO ).sub( p.z ) ).sub( p.y )
				const dz = p.x.mul( p.y ).sub( float( BETA ).mul( p.z ) )
				p.addAssign( vec3( dx, dy, dz ).mul( STEP_DT ) )
				positions.element( base.add( this.head.add( i ).mod( length ) ) ).assign( p )
			} )
		} )().compute( INSTANCE_COUNT ) )

		stage3d.add( new MeshLine()
			.instances( INSTANCE_COUNT )
			.segments( TRAIL_LENGTH - 1 )
			// progress 0 → head (newest), progress 1 → tail (oldest).
			.gpuPositionNode( storagePositions( this.positionBuffer, { pointsPerLine: TRAIL_LENGTH, head: this.head } ) )
			.colorFn( Fn( ( [, progress] ) => {
				// A spread of warm-to-cool hues per trail, bright at the head.
				const ratio = float( instanceIndex ).div( INSTANCE_COUNT - 1 )
				const phase = vec3( 0, 0.15, 0.3 ).add( ratio.mul( 0.7 ).add( 0.55 ) )
				const hue = cos( phase.mul( Math.PI * 2 ) ).mul( 0.5 ).add( 0.5 )
				return vec4( hue.mul( progress.oneMinus().pow( 1.6 ).mul( 0.92 ).add( 0.08 ) ), 1 )
			} ) )
			// Taper toward the tail so older points are thinner.
			.widthFn( Fn( ( [width, progress] ) => width.mul( progress.oneMinus().mul( 0.85 ).add( 0.15 ) ) ) )
			.lineWidth( 0.55 )
			.autoResize() )
	}

	/**
	 * Start every trail already full: integrate a distinct warm-up per trail, then
	 * record its next TRAIL_LENGTH states oldest-first so slot TRAIL_LENGTH - 1 is
	 * the head. The first frame shows complete trails instead of collapsed dots.
	 */
	seedTrails() {
		const { array } = this.positionBuffer
		for ( let trail = 0; trail < INSTANCE_COUNT; trail++ ) {
			let point = [1, 1 + trail * 0.001, 1]
			for ( let step = 0; step < 400 + trail * 97; step++ ) point = lorenzStep( ...point )
			for ( let slot = 0; slot < TRAIL_LENGTH; slot++ ) {
				array.set( point, ( trail * TRAIL_LENGTH + slot ) * 3 )
				point = lorenzStep( ...point )
			}
		}
		this.head.value = TRAIL_LENGTH - 1
		this.positionBuffer.needsUpdate = true
	}

	update = dt => {
		this.accumulator += dt
		const steps = Math.min( MAX_STEPS_PER_FRAME, Math.floor( this.accumulator / STEP_INTERVAL ) )
		if ( steps === 0 ) return
		this.accumulator = Math.min( this.accumulator - steps * STEP_INTERVAL, STEP_INTERVAL )
		this.steps.value = steps
		stage3d.renderer.compute( this.integrateNode )
		// The dispatch above is queued before this frame's draw, which already
		// reads the advanced head.
		this.head.value = ( this.head.value + steps ) % TRAIL_LENGTH
	}
}

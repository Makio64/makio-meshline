import { MeshLine } from 'makio-meshline'
import { attribute, cos, float, Fn, instanceIndex, mod, sin, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Vector2 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { onDown, onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'

const RING_COUNT = 150
const RING_SEGMENTS = 192
const TUNNEL_LENGTH = 90
const RING_SPACING = TUNNEL_LENGTH / RING_COUNT
const RING_RADIUS = 2.6
const LINE_WIDTH = 0.05
const CRUISE_SPEED = 5
const WARP_SPEED = 30
const PALETTE_SECONDS = 7
// Pairs of colors the tunnel drifts through; each new ring samples the current pair.
const PALETTES = [
	[0x22D3EE, 0x8B5CF6],
	[0xF472B6, 0xFB923C],
	[0x34D399, 0x22D3EE],
	[0xA78BFA, 0xF472B6],
	[0xFACC15, 0xF97316],
]
const PETALS = [3, 4, 5, 6, 8]

const colorA = new Color()
const colorB = new Color()

class GpuInstanceExample {
	constructor() {
		this.line = null
		this.bloom = null
		this.hint = null
		this.styles = new Float32Array( RING_COUNT * 4 )
		this.generations = new Int32Array( RING_COUNT )
		this.travel = 0
		this.time = 0
		this.speed = CRUISE_SPEED
		this.warp = false
		this.spawnSerial = 0
		this.pointer = new Vector2()
		this.look = new Vector2()
		this.uTravel = uniform( 0 )
		this.uTime = uniform( 0 )
		this.uMorph = uniform( 0 )
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
	}

	async init() {
		await stage3d.initRender( { background: 0x02030A } )
		stage3d.camera.near = 0.1
		stage3d.camera.far = 120
		stage3d.camera.fov = 62
		stage3d.camera.position.set( 0, 0, 3 )
		stage3d.camera.lookAt( 0, 0, -30 )
		stage3d.camera.updateProjectionMatrix()

		for ( let ring = 0; ring < RING_COUNT; ring++ ) {
			this.generations[ring] = this.getGeneration( ring )
			this.writeRingStyle( ring )
		}

		this.createTunnel()
		this.bloom = createBloomPipeline( { strength: 0.55, radius: 0.4, threshold: 0.05 } )
		this.hint = createDemoHint( `${RING_COUNT} rings · one draw · GPU positions — hold to warp`, { accent: '#a78bfa' } )

		onMove.add( this.onPointerMove )
		onDown.add( this.onPointerDown )
		onUp.add( this.onPointerUp )
		onLeave.add( this.onPointerUp )
		stage.onUpdate.add( this.update )
		window.addEventListener( 'resize', this.onResize )
	}

	createTunnel() {
		const ringStyle = attribute( 'ringStyle', 'vec4' )

		// Every ring scrolls toward the camera and wraps back to the far end. The CPU
		// runs the same arithmetic to know which rings it must recolor.
		const ringDepth = Fn( () => {
			const travel = float( instanceIndex ).mul( RING_SPACING ).add( this.uTravel )
			return mod( travel, TUNNEL_LENGTH ).sub( TUNNEL_LENGTH )
		} )

		const positionNode = Fn( ( [progress] ) => {
			const z = ringDepth().toVar()
			const farness = z.negate().div( TUNNEL_LENGTH ).toVar()
			const angle = progress.mul( Math.PI * 2 ).toVar()
			// Morph each ring between a circle and a flower; the twist makes the
			// petals spiral down the tunnel.
			const petal = sin( angle.mul( ringStyle.w ) ).mul( this.uMorph.mul( 0.2 ) )
			const breathing = sin( z.mul( 0.17 ).add( this.uTime.mul( 0.9 ) ) ).mul( 0.07 )
			const radius = float( RING_RADIUS ).mul( petal.add( breathing ).add( 1 ) )
			const twist = angle.add( z.mul( 0.05 ) ).add( this.uTime.mul( 0.25 ) )
			const bend = farness.mul( farness )
			const center = vec3(
				sin( z.mul( 0.035 ).add( this.uTime.mul( 0.37 ) ) ).mul( bend.mul( 16 ) ),
				cos( z.mul( 0.028 ).add( this.uTime.mul( 0.29 ) ) ).mul( bend.mul( 10 ) ),
				z,
			)
			return center.add( vec3( cos( twist ).mul( radius ), sin( twist ).mul( radius ), 0 ) )
		} )

		const colorNode = Fn( ( [, progress] ) => {
			const z = ringDepth()
			const fadeIn = smoothstep( -TUNNEL_LENGTH, -TUNNEL_LENGTH * 0.3, z ).pow( 2 )
			const fadeOut = float( 1 ).sub( smoothstep( -6, -0.5, z ) )
			const sparkle = sin( progress.mul( Math.PI * 2 ).mul( ringStyle.w ).sub( this.uTime.mul( 3 ) ) ).mul( 0.25 ).add( 0.85 )
			// Additive blending: darkening the color is the fade, no sorting needed.
			return vec4( ringStyle.rgb.mul( fadeIn.mul( fadeOut ).mul( sparkle ) ), 1 )
		} )

		this.line = new MeshLine()
			.instances( RING_COUNT )
			.segments( RING_SEGMENTS )
			.closed( true )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.lineWidth( LINE_WIDTH )
			.setFrustumCulled( false )
			.build()

		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false

		// Fill the CPU array before the first upload; later frames only rewrite the
		// rings that wrapped, through setInstanceValues().
		const styleAttribute = this.line.addInstanceAttribute( 'ringStyle', 4 )
		styleAttribute.array.set( this.styles )
		stage3d.add( this.line )
	}

	getGeneration( ring ) {
		return Math.floor( ( ring * RING_SPACING + this.travel ) / TUNNEL_LENGTH )
	}

	writeRingStyle( ring ) {
		const epoch = Math.floor( this.time / PALETTE_SECONDS )
		const [first, second] = PALETTES[epoch % PALETTES.length]
		const stripe = Math.sin( this.spawnSerial * 0.42 ) * 0.5 + 0.5
		colorA.setHex( first )
		colorB.setHex( second )
		colorA.lerp( colorB, stripe )

		const offset = ring * 4
		this.styles[offset] = colorA.r
		this.styles[offset + 1] = colorA.g
		this.styles[offset + 2] = colorA.b
		this.styles[offset + 3] = PETALS[epoch % PETALS.length]
		this.spawnSerial++
	}

	update = ( dt ) => {
		const delta = Math.min( dt, 100 ) * 0.001
		const cruise = this.reducedMotion ? CRUISE_SPEED * 0.25 : CRUISE_SPEED
		const targetSpeed = this.warp && !this.reducedMotion ? WARP_SPEED : cruise
		this.speed = MathUtils.damp( this.speed, targetSpeed, this.warp ? 2.5 : 1.6, delta )
		this.travel += this.speed * delta
		this.time += delta

		this.recycleRings()

		this.uTravel.value = this.travel % TUNNEL_LENGTH
		this.uTime.value = this.time
		this.uMorph.value = Math.sin( this.time * 0.35 ) * 0.5 + 0.5

		this.look.x = MathUtils.damp( this.look.x, this.pointer.x, 2.2, delta )
		this.look.y = MathUtils.damp( this.look.y, this.pointer.y, 2.2, delta )
		const camera = stage3d.camera
		camera.position.set( this.look.x * 0.9, -this.look.y * 0.6, 3 )
		camera.lookAt( this.look.x * 4, -this.look.y * 3, -30 )
		camera.rotateZ( this.look.x * -0.12 )
	}

	// Rings wrap one after another, so the changed instances form short
	// contiguous runs: upload exactly those runs instead of the whole buffer.
	recycleRings() {
		let runStart = -1
		for ( let ring = 0; ring <= RING_COUNT; ring++ ) {
			let changed = false
			if ( ring < RING_COUNT ) {
				const generation = this.getGeneration( ring )
				if ( generation !== this.generations[ring] ) {
					this.generations[ring] = generation
					this.writeRingStyle( ring )
					changed = true
				}
			}
			if ( changed && runStart < 0 ) runStart = ring
			if ( !changed && runStart >= 0 ) {
				this.line.setInstanceValues( 'ringStyle', this.styles.subarray( runStart * 4, ring * 4 ), runStart )
				runStart = -1
			}
		}
	}

	onPointerMove = ( mouseData ) => {
		this.pointer.set( mouseData.normalizedX, mouseData.normalizedY )
	}

	onPointerDown = () => {
		this.warp = true
		this.hint?.hide()
	}

	onPointerUp = () => {
		this.warp = false
	}

	onResize = () => {
		this.line?.resize()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		onMove.remove( this.onPointerMove )
		onDown.remove( this.onPointerDown )
		onUp.remove( this.onPointerUp )
		onLeave.remove( this.onPointerUp )
		window.removeEventListener( 'resize', this.onResize )
		this.hint?.remove()
		this.hint = null
		this.bloom?.dispose()
		this.bloom = null
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
	}

}

export default GpuInstanceExample

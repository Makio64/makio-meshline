/**
 * Instanced Warp Tunnel — 150 procedural rosette rings rendered in a single instanced draw call.
 * Demonstrates: .instances( count ), .segments( count ), .closed( true ), .gpuPositionNode( fn ),
 * and a custom instance attribute via .addInstanceAttribute( name, components ),
 * rewritten ring by ring with .setInstanceValues( name, values, start ).
 */
import { MeshLine } from 'makio-meshline'
import { attribute, cos, float, Fn, instanceIndex, mod, sin, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Vector2 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { onDown, onLeave, onMove, onUp } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'

const RING_COUNT = 150
const TUNNEL_LENGTH = 90
const RING_SPACING = TUNNEL_LENGTH / RING_COUNT
const RING_RADIUS = 2.6
const CRUISE_SPEED = 5
const WARP_SPEED = 90
const PALETTE_SECONDS = 7
// Styles the tunnel drifts through; each new ring samples the current one.
const PALETTES = [
	{ from: new Color( 0x22D3EE ), to: new Color( 0x8B5CF6 ), petals: 3 },
	{ from: new Color( 0xF472B6 ), to: new Color( 0xFB923C ), petals: 4 },
	{ from: new Color( 0x34D399 ), to: new Color( 0x22D3EE ), petals: 5 },
	{ from: new Color( 0xA78BFA ), to: new Color( 0xF472B6 ), petals: 6 },
	{ from: new Color( 0xFACC15 ), to: new Color( 0xF97316 ), petals: 8 },
]

const ringColor = new Color()
const style = new Float32Array( 4 )

export default class GpuInstanceExample {
	generations = new Int32Array( RING_COUNT ) // how many times each ring has wrapped
	travel = 0
	speed = CRUISE_SPEED
	warp = false
	spawnSerial = 0
	pointer = new Vector2()
	look = new Vector2()
	uTravel = uniform( 0 )
	uTime = uniform( 0 )
	uMorph = uniform( 0 )

	async init() {
		await stage3d.initRender( { background: 0x02030A, fov: 62, near: 0.1, far: 120 } )

		this.createTunnel()
		createBloomPipeline( { strength: 0.55, radius: 0.4, threshold: 0.05 } )
		const hint = createDemoHint( `${RING_COUNT} rings · one draw · GPU positions — hold to warp`, { accent: '#a78bfa', hideAfter: 0 } )

		const stopWarp = () => { this.warp = false }
		stage3d.listen( onMove, mouse => this.pointer.set( mouse.normalizedX, mouse.normalizedY ) )
		stage3d.listen( onDown, () => {
			this.warp = true
			hint.hide()
		} )
		stage3d.listen( onUp, stopWarp )
		stage3d.listen( onLeave, stopWarp )
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
			const fadeOut = smoothstep( -6, -0.5, z ).oneMinus()
			const sparkle = sin( progress.mul( Math.PI * 2 ).mul( ringStyle.w ).sub( this.uTime.mul( 3 ) ) ).mul( 0.25 ).add( 0.85 )
			// Additive blending: darkening the color is the fade, no sorting needed.
			return vec4( ringStyle.rgb.mul( fadeIn.mul( fadeOut ).mul( sparkle ) ), 1 )
		} )

		this.line = new MeshLine()
			.instances( RING_COUNT )
			.segments( 192 )
			.closed( true )
			.gpuPositionNode( positionNode )
			.colorFn( colorNode )
			.lineWidth( 0.05 )
			.autoResize()
			.build()

		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false

		this.line.addInstanceAttribute( 'ringStyle', 4 )
		for ( let ring = 0; ring < RING_COUNT; ring++ ) this.writeRingStyle( ring )
		stage3d.add( this.line )
	}

	writeRingStyle( ring ) {
		const epoch = Math.floor( this.uTime.value / PALETTE_SECONDS )
		const { from, to, petals } = PALETTES[epoch % PALETTES.length]
		const stripe = Math.sin( this.spawnSerial * 0.42 ) * 0.5 + 0.5
		ringColor.lerpColors( from, to, stripe ).toArray( style )
		style[3] = petals
		this.line.setInstanceValues( 'ringStyle', style, ring )
		this.spawnSerial++
	}

	// Only the rings that wrapped are rewritten; neighbours written in the same
	// frame merge into one upload inside MeshLine.
	recycleRings() {
		for ( let ring = 0; ring < RING_COUNT; ring++ ) {
			const generation = Math.floor( ( ring * RING_SPACING + this.travel ) / TUNNEL_LENGTH )
			if ( generation === this.generations[ring] ) continue
			this.generations[ring] = generation
			this.writeRingStyle( ring )
		}
	}

	update = dt => {
		const delta = dt * 0.001
		const cruise = reducedMotion.matches ? CRUISE_SPEED * 0.25 : CRUISE_SPEED
		const targetSpeed = this.warp && !reducedMotion.matches ? WARP_SPEED : cruise
		this.speed = MathUtils.damp( this.speed, targetSpeed, this.warp ? 2.5 : 1.6, delta )
		this.travel += this.speed * delta
		this.uTime.value += delta

		this.recycleRings()

		this.uTravel.value = this.travel % TUNNEL_LENGTH
		this.uMorph.value = Math.sin( this.uTime.value * 0.35 ) * 0.5 + 0.5

		this.look.x = MathUtils.damp( this.look.x, this.pointer.x, 2.2, delta )
		this.look.y = MathUtils.damp( this.look.y, this.pointer.y, 2.2, delta )
		const camera = stage3d.camera
		camera.position.set( this.look.x * 0.9, -this.look.y * 0.6, 3 )
		camera.lookAt( this.look.x * 4, -this.look.y * 3, -30 )
		camera.rotateZ( this.look.x * -0.12 )
	}
}

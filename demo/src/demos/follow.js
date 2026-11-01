/**
 * Cursor Trails — 14 spring-driven aurora ribbons chasing the pointer in a single draw call.
 * Demonstrates: .lines( lineArrays, false ), .dynamic( true ), .setPositions( lineArrays ),
 * .widthCallback( fn ), and custom per-vertex attributes via .addVertexAttribute().
 */
import { MeshLine, sineWavePositions } from 'makio-meshline'
import { attribute, color, Fn, mix, smoothstep, uv, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, Color, MathUtils, Vector3 } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { isMobile, reducedMotion } from '@/makio/utils/detect'
import { mouse, onMove } from '@/makio/utils/input/mouse'
import random from '@/makio/utils/random'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'
import { times } from '@/utils/points'

const NUM_POINTS = 64
const NUM_LINES = 14
const BILLBOARD_VERTICES_PER_POINT = 4
// Keep a resting trail non-degenerate so its dynamic buffers retain capacity.
const TOPOLOGY_EPSILON = 0.0001
const AURORA_PALETTE = [0x00FFB2, 0x36E6FF, 0x7C9CFF, 0xC084FC, 0x5BFFD0, 0x9DFF5B, 0x22D3EE]
const START_ARCH = sineWavePositions( 0.5, NUM_POINTS, 0.5, 3.6 )

const force = new Vector3()

function writePointsToArray( points, positions ) {
	for ( let i = 0; i < NUM_POINTS; i++ ) {
		points[i].toArray( positions, i * 3 )
		positions[i * 3] -= i * TOPOLOGY_EPSILON
	}
}

function seedLine( index ) {
	const points = times( NUM_POINTS, i => new Vector3().fromArray( START_ARCH, i * 3 ) )
	const positions = new Float32Array( NUM_POINTS * 3 )
	writePointsToArray( points, positions )

	// Each trail orbits the leader on its own radius and spin, so the bundle
	// braids into a rope of light instead of a single smeared stroke.
	return {
		points,
		positions,
		angle: index / NUM_LINES * Math.PI * 2,
		orbitRadius: random( 0.28, 0.78 ),
		orbitSpeed: random( 1.1, 2.2 ) * ( index % 2 ? 1 : -1 ),
		phase: random( 0, Math.PI * 2 ),
		velocity: new Vector3(),
		spring: random( 0.04, 0.08 ),
		friction: random( 0.8, 0.9 ),
	}
}

const backgroundGlow = Fn( () => {
	const glow = smoothstep( 0.1, 0.9, uv().sub( 0.5 ).length() ).oneMinus()
	return vec4( mix( color( 0x010208 ), color( 0x061226 ), glow ), 1 )
} )

export default class FollowExample {
	lines = times( NUM_LINES, seedLine )
	lineArrays = this.lines.map( line => line.positions )
	target = new Vector3()
	mouseSpeed = 0
	currentLineWidth = 0.05
	pointerActiveUntil = 0
	time = 0

	async init() {
		await stage3d.initRender( { background: 0x01040A } )
		stage3d.camera.position.z = 12
		this.onResize()
		stage3d.scene.backgroundNode = backgroundGlow()
		this.createLine()
		createBloomPipeline( { strength: 0.75, radius: 0.45, threshold: 0.12 } )

		const action = isMobile ? 'Touch and move' : 'Move to lead'
		this.hint = createDemoHint( `${action} · speed controls width`, { accent: '#76ffb2', hideAfter: 7000 } )
		stage3d.listen( onMove, this.onMouseMove )
	}

	createLine() {
		this.meshline = new MeshLine()
			.lines( this.lineArrays, false )
			.lineWidth( 0.05 )
			.dynamic( true )
			// Bevel joins keep fast, tight turns from spiking into long miters.
			.join( 'bevel' )
			// Point 0 leads: a short rounded head, then a long fading tail.
			.widthCallback( t => {
				const head = Math.sqrt( Math.min( t / 0.05, 1 ) )
				return Math.max( head * ( 1 - t ) ** 1.25, 0.02 )
			} )
			.colorFn( Fn( ( [, progress] ) => {
				const lineColor = attribute( 'lineColor', 'vec3' )
				const hot = mix( vec3( 1 ), lineColor, smoothstep( 0, 0.08, progress ) )
				// Additive blending: fading to black is the transparency.
				return vec4( hot.mul( progress.oneMinus().pow( 0.9 ).mul( 0.85 ) ), 1 )
			} ) )
			.autoResize()
			.build()

		this.meshline.material.blending = AdditiveBlending
		this.meshline.material.depthWrite = false

		// Every vertex of a trail shares one palette color.
		const colors = times( NUM_LINES, index => {
			const rgb = new Color( AURORA_PALETTE[index % AURORA_PALETTE.length] ).toArray()
			return times( NUM_POINTS * BILLBOARD_VERTICES_PER_POINT, () => rgb )
		} )
		this.meshline.addVertexAttribute( 'lineColor', 3 )
		this.meshline.setVertexValues( 'lineColor', new Float32Array( colors.flat( 2 ) ) )

		stage3d.add( this.meshline )
	}

	update = dt => {
		const frameScale = dt / 16.67
		this.time += dt * 0.001
		const pointerActive = performance.now() < this.pointerActiveUntil
		if ( reducedMotion.matches && !pointerActive ) return
		// Autopilot traces a slow figure eight inside the view until the visitor takes over.
		if ( !pointerActive ) {
			this.target.set(
				Math.sin( this.time * 0.9 ) * Math.min( 4.2, this.halfWidth * 0.72 ),
				Math.sin( this.time * 1.8 ) * Math.min( 2.4, this.halfHeight * 0.5 ),
				0
			)
		}

		const follow = 1 - Math.pow( 1 - 0.26, frameScale )
		for ( const line of this.lines ) this.moveLine( line, frameScale, follow )
		this.meshline.setPositions( this.lineArrays )

		const speed = pointerActive
			? Math.hypot( mouse.moveX, mouse.moveY ) / ( dt / 16 || 1 ) * 0.003
			: 0.045 + Math.sin( this.time * 0.9 ) ** 2 * 0.04
		const smoothing = 1 - Math.pow( 1 - 0.15, frameScale )
		this.mouseSpeed = MathUtils.lerp( this.mouseSpeed, speed, smoothing )
		const targetWidth = MathUtils.clamp( this.mouseSpeed, 0.035, 0.2 )
		this.currentLineWidth = MathUtils.lerp( this.currentLineWidth, targetWidth, smoothing )
		this.meshline.lineWidth( this.currentLineWidth )
	}

	moveLine( line, frameScale, follow ) {
		const { points, velocity } = line
		const head = points[0]

		// Tail first: each point chases where its neighbour was last frame.
		for ( let i = NUM_POINTS - 1; i > 0; i-- ) points[i].lerp( points[i - 1], follow )

		const orbit = line.angle + this.time * line.orbitSpeed
		const radius = line.orbitRadius * ( 0.65 + Math.sin( this.time * 0.8 + line.phase ) * 0.35 )
		force.set( Math.cos( orbit ) * radius, Math.sin( orbit ) * radius, Math.sin( orbit * 0.5 + line.phase ) * 0.4 )
		force.add( this.target ).sub( head ).multiplyScalar( line.spring * frameScale )
		velocity.add( force ).multiplyScalar( Math.pow( line.friction, frameScale ) )
		head.addScaledVector( velocity, frameScale )

		writePointsToArray( points, line.positions )
	}

	onMouseMove = () => {
		this.pointerActiveUntil = performance.now() + 1800
		this.hint.hide()
		this.target.set( mouse.normalizedX * this.halfWidth, -mouse.normalizedY * this.halfHeight, 0 )
	}

	// The camera faces the trails head-on: this is half the view on their z = 0 plane.
	onResize = () => {
		const { aspect, fov, position } = stage3d.camera
		this.halfHeight = Math.tan( fov * MathUtils.DEG2RAD / 2 ) * position.length()
		this.halfWidth = this.halfHeight * aspect
	}
}

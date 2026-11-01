/**
 * Verlet Ropes — 52 interactive hanging cords with PBD physics and Catmull-Rom GPU spline sampling.
 * Demonstrates: .instances( count ), .segments( count ), .gpuPositionNode( fn ) reading a
 * StorageBufferAttribute, and round cord shading via .colorFn( fn ) + .widthFn( fn ).
 * The solver is in utils/verletRopesPhysics.js, the mouse in utils/verletRopesPointer.js.
 */
import { MeshLine, straightLineBetween } from 'makio-meshline'
import { abs, clamp, dot, float, floor, Fn, instanceIndex, length, max, min, mix, smoothstep, sqrt, uv, vec2, vec3, vec4 } from 'three/tsl'
import { MathUtils } from 'three/webgpu'

import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'
import { ANCHOR_SPAN_X, ANCHOR_SPAN_Z, createRopeCompute, createRopeStepper, createRopeUniforms, FLOOR_Y, PLUCK_RADIUS, POINTER_WAKE_RADIUS, POINTS_PER_ROPE, RAILS, ROPE_COUNT, seedRopes, stepRopesCpu } from '@/utils/verletRopesPhysics'
import { coarsePointer, RopePointer } from '@/utils/verletRopesPointer'

const FIBER_WIDTH = 0.48
const BEAD_SWELL = 1.65
const RAIL_LIFT = 0.12
const MAX_FRAME_DT = 0.05

const hintText = () => coarsePointer.matches || window.innerWidth <= 600
	? 'Drag to orbit · tap to pluck'
	: 'Move to brush · drag to orbit · click to pluck'

// Which of the 14 physics points a progress along the rope falls between.
const ropeSegment = progress => {
	const lastPoint = float( POINTS_PER_ROPE - 1 )
	const p = progress.mul( lastPoint ).toVar()
	const pivot = clamp( floor( p ), 0, lastPoint.sub( 1 ) ).toVar()
	const t = p.sub( pivot ).toVar()
	const baseOffset = float( instanceIndex ).mul( POINTS_PER_ROPE ).toVar()
	return { lastPoint, pivot, t, baseOffset }
}

// Smooth Catmull-Rom spline evaluation across the 14 physics points.
const ropePosition = positions => Fn( ( [progress] ) => {
	const { lastPoint, pivot, t, baseOffset } = ropeSegment( progress )
	const i0 = baseOffset.add( max( pivot.sub( 1 ), 0 ) ).toUint().toVar()
	const i1 = baseOffset.add( pivot ).toUint().toVar()
	const i2 = baseOffset.add( min( pivot.add( 1 ), lastPoint ) ).toUint().toVar()
	const i3 = baseOffset.add( min( pivot.add( 2 ), lastPoint ) ).toUint().toVar()
	const p0 = positions.element( i0 ).xyz.toVar()
	const p1 = positions.element( i1 ).xyz.toVar()
	const p2 = positions.element( i2 ).xyz.toVar()
	const p3 = positions.element( i3 ).xyz.toVar()
	const t2 = t.mul( t ).toVar()
	const t3 = t2.mul( t ).toVar()
	return p1.mul( 2 )
		.add( p2.sub( p0 ).mul( t ) )
		.add( p0.mul( 2 ).sub( p1.mul( 5 ) ).add( p2.mul( 4 ) ).sub( p3 ).mul( t2 ) )
		.add( p1.mul( 3 ).sub( p0 ).sub( p2.mul( 3 ) ).add( p3 ).mul( t3 ) )
		.mul( 0.5 )
} )

// A tinted round cord with a pale bead at the tip, hot where it stretches and glowing near the pointer.
const ropeColor = ( positions, ropeData, sim ) => Fn( ( [, progress, side] ) => {
	const { pivot, t, baseOffset } = ropeSegment( progress )
	const i0 = baseOffset.add( pivot ).toUint().toVar()
	const i1 = baseOffset.add( pivot.add( 1 ) ).toUint().toVar()
	const p0 = positions.element( i0 ).xyz.toVar()
	const p1 = positions.element( i1 ).xyz.toVar()
	const samplePosition = mix( p0, p1, t ).toVar()
	const data = ropeData.element( instanceIndex ).toVar()
	const anchor = data.xyz.toVar()
	const restLength = data.w.toVar()

	const xRatio = clamp( anchor.x.div( ANCHOR_SPAN_X ).add( 0.5 ), 0, 1 )
	const zRatio = clamp( anchor.z.div( ANCHOR_SPAN_Z ).add( 0.5 ), 0, 1 )
	const cyan = vec3( 0.16, 0.82, 1.0 )
	const violet = vec3( 0.54, 0.38, 1.0 )
	const coral = vec3( 1.0, 0.38, 0.62 )
	const gold = vec3( 1.0, 0.76, 0.34 )
	const spanTint = mix( mix( cyan, violet, smoothstep( 0, 0.55, xRatio ) ), coral, smoothstep( 0.45, 1, xRatio ) )
	const fiber = mix( spanTint, gold, zRatio.mul( 0.38 ) )

	const edgeDist = clamp( side.abs(), 0, 1 )
	const cylinderProfile = sqrt( max( edgeDist.mul( edgeDist ).oneMinus(), 0.04 ) )
	const cylinderShade = cylinderProfile.mul( 0.72 ).add( 0.28 )
	const depthCue = mix( 0.72, 1.12, zRatio )
	const verticalGradient = progress.pow( 1.35 ).mul( 0.76 ).add( 0.28 )
	const bead = smoothstep( 0.91, 0.975, progress )
	const cordColor = fiber.mul( verticalGradient ).mul( cylinderShade ).mul( depthCue )
	const baseColor = mix( cordColor, vec3( 1.0, 0.95, 0.86 ), bead.mul( 0.85 ) ).toVar()

	const strain = clamp( abs( length( p1.sub( p0 ) ).div( restLength ).sub( 1 ) ).mul( 6.5 ), 0, 1 ).toVar()
	const strainedColor = mix( baseColor, vec3( 1.0, 0.52, 0.16 ), strain.mul( 0.65 ) ).toVar()

	const toPoint = samplePosition.sub( sim.rayOrigin ).toVar()
	const alongRay = clamp( dot( toPoint, sim.rayDir ), 2, 42 )
	const closestOnRay = sim.rayOrigin.add( sim.rayDir.mul( alongRay ) )
	const rayDist = length( samplePosition.sub( closestOnRay ) )
	const pointerGlow = smoothstep( 0, POINTER_WAKE_RADIUS, rayDist ).oneMinus().mul( sim.pointerEngage )
	const pluckDist = length( samplePosition.sub( sim.pluckOrigin ) )
	const pluckGlow = smoothstep( 0, PLUCK_RADIUS, pluckDist ).oneMinus().mul( sim.pluck )
	const highlight = max( pointerGlow.mul( 0.55 ), pluckGlow.mul( 0.8 ) )
	return vec4( mix( strainedColor, vec3( 1.0, 0.94, 0.72 ), highlight ), 1 )
} )

const ropeWidth = Fn( ( [width, progress] ) => {
	const taper = progress.mul( 0.18 ).add( 0.82 )
	const swell = smoothstep( 0.92, 0.972, progress ).mul( smoothstep( 0.985, 1, progress ).oneMinus() )
	return width.mul( swell.mul( BEAD_SWELL ).add( taper.mul( FIBER_WIDTH ) ) )
} )

// The same profile as ropeWidth, for the WebGL2 fallback's widthCallback.
const ropeWidthCpu = progress => {
	const taper = 0.82 + 0.18 * progress
	const swell = MathUtils.smoothstep( progress, 0.92, 0.972 ) * ( 1 - MathUtils.smoothstep( progress, 0.985, 1 ) )
	return FIBER_WIDTH * taper + swell * BEAD_SWELL
}

const backdrop = ( { pointerEngage, pluck } ) => Fn( () => {
	const centered = uv().sub( vec2( 0.5 ) ).toVar()
	const vignette = smoothstep( 0.2, 0.82, length( centered.mul( vec2( 0.82, 1.15 ) ) ) )
	const vertical = smoothstep( 0, 1, uv().y )
	const base = mix( vec3( 0.004, 0.008, 0.024 ), vec3( 0.014, 0.008, 0.036 ), vertical )
	const centerGlow = smoothstep( 0.05, 0.68, length( centered ) ).oneMinus()
	const pulseGlow = vec3( 0.08, 0.03, 0.05 ).mul( pointerEngage.mul( 0.25 ).add( pluck.mul( 0.35 ) ) )
	const color = base.add( vec3( 0.012, 0.01, 0.036 ).mul( centerGlow ) ).add( pulseGlow )
	return vec4( color.mul( vignette.mul( 0.46 ).oneMinus() ), 1 )
} )

export default class VerletRopesExample {
	sim = createRopeUniforms()

	async init() {
		await stage3d.initRender( { background: 0x050817 } )
		const control = stage3d.orbit( 18.5, {
			target: [0, -0.35, 0],
			theta: 1.04,
			phi: 1.18,
			minRadius: 10.5,
			maxRadius: 28,
			minPhi: 0.48,
			maxPhi: 1.82,
			autoRotate: 0.000035,
		} )

		this.createRopes()
		this.createFrame()
		stage3d.scene.backgroundNode = backdrop( this.sim )()
		createBloomPipeline( { strength: 0.42, radius: 0.28, threshold: 0.32 } )

		this.hint = createDemoHint( hintText(), { accent: '#7de3ff', hideAfter: 7000 } )
		this.pointer = new RopePointer( this.sim, control, this.hint )
		this.advance = createRopeStepper( this.sim, this.pointer, this.solve )
	}

	createRopes() {
		this.ropes = seedRopes()
		this.line = ( stage3d.isWebGPU ? this.createGpuRopes() : this.createCpuRopes() )
			.lineWidth( 0.28 )
			.join( { type: 'bevel', limit: 1.4 } )
			.setFrustumCulled( false )
			.autoResize()
		stage3d.add( this.line )
	}

	// WebGPU: a compute shader moves the points and the vertex shader reads them from storage.
	createGpuRopes() {
		const { computeNode, positions, ropeData } = createRopeCompute( this.ropes, this.sim )
		this.solve = () => stage3d.renderer.compute( computeNode )

		return new MeshLine()
			.instances( ROPE_COUNT )
			.segments( 38 )
			.gpuPositionNode( ropePosition( positions ) )
			.colorFn( ropeColor( positions, ropeData, this.sim ) )
			.widthFn( ropeWidth )
	}

	// WebGL2: the CPU moves the points and uploads them each frame.
	createCpuRopes() {
		this.solve = () => stepRopesCpu( this.ropes, this.sim )

		return new MeshLine()
			.lines( this.ropes.lines, false )
			.dynamic( true )
			.vertexColors( this.ropes.colors )
			.widthCallback( ropeWidthCpu )
	}

	createFrame() {
		// 3D overhead trellis: 4 parallel rails in Z plus 2 connecting side beams.
		const halfSpanX = ANCHOR_SPAN_X * 0.54
		const rails = RAILS.map( ( { y, z } ) => straightLineBetween( [-halfSpanX, y + RAIL_LIFT, z], [halfSpanX, y + RAIL_LIFT, z] ) )
		const sideBeam = x => new Float32Array( RAILS.flatMap( ( { y, z } ) => [x, y + RAIL_LIFT, z] ) )

		stage3d.add( new MeshLine()
			.lines( [...rails, sideBeam( -halfSpanX ), sideBeam( halfSpanX )], false )
			.lineWidth( 0.11 )
			.color( 0xffd27a )
			.gradientColor( 0x7ddfff )
			.antialias( true )
			.opacity( 0.78 )
			.autoResize() )

		// Subtle 3D ground frame at FLOOR_Y so perspective depth and height are immediately legible.
		const halfX = ANCHOR_SPAN_X * 0.56
		const halfZ = ANCHOR_SPAN_Z * 0.58
		const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]]
		const outline = new Float32Array( corners.flatMap( ( [x, z] ) => [x * halfX, FLOOR_Y, z * halfZ] ) )
		const rows = RAILS.map( ( { z } ) => straightLineBetween( [-halfX, FLOOR_Y, z], [halfX, FLOOR_Y, z] ) )

		stage3d.add( new MeshLine()
			.lines( [outline, ...rows], false )
			.lineWidth( 0.055 )
			.color( 0x3b689c )
			.gradientColor( 0x6247aa )
			.antialias( true )
			.opacity( 0.28 )
			.autoResize() )
	}

	update = dt => {
		const frameDt = Math.min( dt * 0.001, MAX_FRAME_DT )
		this.pointer.update( frameDt )
		this.advance( frameDt )
		if ( !stage3d.isWebGPU ) this.line.setPositions( this.ropes.lines )
	}

	// The hint's wording depends on the viewport.
	onResize = () => this.hint.setText( hintText() )
}

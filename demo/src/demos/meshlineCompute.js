/**
 * GPU Compute Curves — autonomous and interactive curve simulation in WebGPU compute shaders.
 * Demonstrates: MeshLineCompute, mode ('autonomous' | 'follow' | 'field'), stiffness,
 * mouseStrength, curlStrength, arcLengthNode( progress ), and TSL widthFn / colorFn / fragmentAlphaFn.
 */
import { MeshLineCompute } from 'makio-meshline'
import { color, float, Fn, instanceIndex, mix, mod, smoothstep, uniform, uv, vec4 } from 'three/tsl'
import { AdditiveBlending, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'
import { markRaw, reactive } from 'vue'

import MeshlineCompute from '@/components/MeshlineCompute.vue'
import { stage } from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { onMove } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { WebGPURequiredError } from '@/utils/demoFailure'

const BACKGROUND = 0x010208
const AUTO_ROTATE_SPEED = 0.00005

const raycaster = new Raycaster()
const pointerNDC = new Vector2()
const pointerWorld = new Vector3()
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ) )

const backgroundGlow = Fn( () => {
	const glow = smoothstep( 0, 0.75, uv().sub( 0.5 ).length() ).oneMinus()
	return vec4( mix( color( BACKGROUND ), color( 0x0B0820 ), glow ), 1 )
} )

export default class MeshLineComputeExample {
	uiComponent = markRaw( MeshlineCompute )
	isCompactGui = false
	params = reactive( {
		open: true,
		mode: 'autonomous',
		curveCount: 140,
		curlStrength: 0.7,
		mouseStrength: 12,
		stiffness: 1,
		dashSpacing: 2.2,
	} )
	dashSpacing = uniform( 2.2 )
	dashPhase = uniform( 0 )

	async init() {
		await stage3d.initRender( { background: BACKGROUND, far: 200 } )
		if ( !stage3d.isWebGPU ) {
			throw new WebGPURequiredError( 'MeshLineCompute simulates its curves in WebGPU compute shaders, and this browser is running the WebGL2 fallback.' )
		}
		// Look down on the spiral disc at an angle, like a galaxy.
		stage3d.orbit( 21, { phi: 1.05, minRadius: 11, maxRadius: 42 } )
		stage3d.scene.backgroundNode = backgroundGlow()

		this.createLine()
		createBloomPipeline( { strength: 0.8, radius: 0.45, threshold: 0.05 } )
		this.syncGuiLayout()
		stage3d.listen( onMove, this.onMouseMove )
	}

	createLine() {
		this.line?.dispose()
		this.dashPhase.value = 0

		const { curveCount } = this.params
		this.line = new MeshLineCompute( {
			mode: this.params.mode,
			curveCount,
			curlStrength: this.params.curlStrength,
			mouseStrength: this.params.mouseStrength,
			stiffness: this.params.stiffness,
			pointsPerCurve: 64,
			curveLength: 5,
			bounds: 13,
			flowSpeed: 0.45,
			homeStrength: 2.2,
			mouseRadius: 6,
			lineWidth: 3,
			sizeAttenuation: false,
		} )
			.widthFn( Fn( ( [width, progress] ) => {
				const taper = smoothstep( 0, 0.2, progress ).mul( smoothstep( 0.7, 1, progress ).oneMinus() )
				return width.mul( taper.mul( 0.9 ).add( 0.1 ) )
			} ) )
			// Curves are seeded on a golden-angle spiral from the core outward, so the
			// curve index doubles as a radius: a warm core cooling to a violet rim.
			.colorFn( Fn( ( [, progress] ) => {
				const radius = float( instanceIndex ).div( curveCount - 1 )
				const core = mix( color( 0xFFE7B0 ), color( 0xFF7A9E ), smoothstep( 0, 0.35, radius ) )
				const rim = mix( core, color( 0x5B8CFF ), smoothstep( 0.3, 0.75, radius ) )
				const tint = mix( rim, color( 0x9B6BFF ), smoothstep( 0.7, 1, radius ) )
				return vec4( tint.mul( progress.mul( 0.35 ).oneMinus() ), 1 )
			} ) )
			// Fragment hooks add a uv stream by default; this one never reads it.
			.needsUV( false )
			// Pulses travel along each curve by real arc length, so they keep their
			// spacing while the solver stretches and bends the curve.
			.fragmentAlphaFn( Fn( ( [alpha, , progress, side] ) => {
				const arcDistance = this.line.arcLengthNode( progress ).toVar()
				const cycle = mod( arcDistance.div( this.dashSpacing ).add( this.dashPhase ), 1 ).toVar()
				const pulse = smoothstep( 0, 0.1, cycle ).mul( smoothstep( 0.35, 0.7, cycle ).oneMinus() )
				const feather = smoothstep( 0.35, 1, side.abs() ).oneMinus()
				return alpha.mul( feather ).mul( pulse.mul( 0.65 ).add( 0.35 ) )
			} ) )
			.transparent( true )
			.autoResize()

		this.line.material.blending = AdditiveBlending
		stage3d.add( this.line )
	}

	setMode( mode ) {
		this.params.mode = mode
		this.line.mode( mode )
	}

	setCurveCount( count, commit = false ) {
		this.params.curveCount = count
		if ( commit ) this.createLine()
	}

	setMouseStrength( value ) {
		this.params.mouseStrength = value
		this.line.mouseStrength( value )
	}

	setCurlStrength( value ) {
		this.params.curlStrength = value
		this.line.curlStrength( value )
	}

	setStiffness( value ) {
		this.params.stiffness = value
		this.line.stiffness( value )
	}

	setDashSpacing( value ) {
		this.params.dashSpacing = value
		this.dashSpacing.value = value
	}

	syncGuiLayout() {
		const compact = stage.width <= 700
		if ( compact && !this.isCompactGui ) this.params.open = false
		this.isCompactGui = compact
	}

	onResize = () => {
		this.syncGuiLayout()
	}

	onMouseMove = mouse => {
		pointerNDC.set( mouse.normalizedX, -mouse.normalizedY )
		raycaster.setFromCamera( pointerNDC, stage3d.camera )
		if ( raycaster.ray.intersectPlane( interactionPlane, pointerWorld ) ) this.line.mouse( pointerWorld )
	}

	update = dt => {
		const delta = Math.min( dt * 0.001, 1 / 15 )
		this.line.step( stage3d.renderer, delta )
		this.dashPhase.value -= delta * 0.35
		// Keeps turning under a drag, unlike OrbitControl.autoRotate.
		if ( !reducedMotion.matches ) stage3d.control.theta += dt * AUTO_ROTATE_SPEED
	}
}

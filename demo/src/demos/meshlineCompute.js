import GUI from 'lil-gui'
import { MeshLineCompute } from 'makio-meshline'
import { color, float, Fn, instanceIndex, mix, mod, smoothstep, uniform, uv, vec4 } from 'three/tsl'
import { AdditiveBlending, Plane, Raycaster, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { onMove } from '@/makio/utils/input/mouse'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'

const pointerNDC = new Vector2()
const pointerWorld = new Vector3()
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )
const AUTO_ROTATE_SPEED = 0.00005

const MODE_LABELS = {
	Galaxy: 'autonomous',
	Follow: 'follow',
	Field: 'field',
}

class MeshLineComputeExample {
	constructor() {
		this.line = null
		this.gui = null
		this.bloom = null
		this.hint = null
		this.dashPhaseUniform = uniform( 0 )
		this.raycaster = new Raycaster()
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
		this.params = {
			mode: 'autonomous',
			curveCount: 140,
			curlStrength: 0.7,
			mouseStrength: 12,
			dashSpacing: 2.2,
		}
		this.dashSpacingUniform = uniform( this.params.dashSpacing )
	}

	async init() {
		await stage3d.initRender( { background: 0x010208 } )
		stage3d.control = new OrbitControl( stage3d.camera, 21 )
		stage3d.control.maxRadius = 42
		stage3d.control.minRadius = 11
		// Look down on the spiral disc at an angle, like a galaxy.
		stage3d.control._phi = 1.05
		stage3d.control._theta = Math.PI * 0.5
		stage3d.scene.backgroundNode = Fn( () => {
			const glow = float( 1 ).sub( smoothstep( 0, 0.75, uv().sub( 0.5 ).length() ) )
			return vec4( mix( color( 0x010208 ), color( 0x0B0820 ), glow ), 1 )
		} )()
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()
		this.createLine()
		this.bloom = createBloomPipeline( { strength: 0.8, radius: 0.45, threshold: 0.05 } )
		this.createGui()
		this.hint = createDemoHint( 'Move to stir · curves simulated in WebGPU compute', { accent: '#ff7a9e', hideAfter: 8000 } )
		onMove.add( this.onMouseMove )
		window.addEventListener( 'resize', this.onResize )
	}

	createLine() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		this.dashSpacingUniform.value = this.params.dashSpacing
		this.dashPhaseUniform.value = 0

		const curveCount = this.params.curveCount
		const line = new MeshLineCompute( {
			curveCount,
			pointsPerCurve: 64,
			curveLength: 5,
			bounds: 13,
			damping: 0.94,
			curlStrength: this.params.curlStrength,
			flowSpeed: 0.45,
			homeStrength: 2.2,
			mouseStrength: this.params.mouseStrength,
			mouseRadius: 6,
			mode: this.params.mode,
			lineWidth: 3,
			sizeAttenuation: false,
		} )

		line
			.widthFn( Fn( ( [width, progress] ) => {
				const taper = smoothstep( 0, 0.2, progress ).mul( float( 1 ).sub( smoothstep( 0.7, 1, progress ) ) )
				return width.mul( taper.mul( 0.9 ).add( 0.1 ) )
			} ) )
			// Curves are seeded on a golden-angle spiral from the core outward, so the
			// curve index doubles as a radius: a warm core cooling to a violet rim.
			.colorFn( Fn( ( [, progress] ) => {
				const radius = float( instanceIndex ).div( Math.max( curveCount - 1, 1 ) )
				const core = mix( color( 0xFFE7B0 ), color( 0xFF7A9E ), smoothstep( 0, 0.35, radius ) )
				const rim = mix( core, color( 0x5B8CFF ), smoothstep( 0.3, 0.75, radius ) )
				const tint = mix( rim, color( 0x9B6BFF ), smoothstep( 0.7, 1, radius ) )
				return vec4( tint.mul( float( 1 ).sub( progress.mul( 0.35 ) ) ), 1 )
			} ) )
			// Pulses travel along each curve by real arc length, so they keep their
			// spacing while the solver stretches and bends the curve.
			.fragmentAlphaFn( Fn( ( [alpha, uvCoords, progress] ) => {
				const arcDistance = line.arcLengthNode( progress ).toVar()
				const cycle = mod( arcDistance.div( this.dashSpacingUniform ).add( this.dashPhaseUniform ), 1 ).toVar()
				const pulse = smoothstep( 0, 0.1, cycle ).mul( float( 1 ).sub( smoothstep( 0.35, 0.7, cycle ) ) )
				const across = uvCoords.y.sub( 0.5 ).abs().mul( 2 )
				const feather = float( 1 ).sub( smoothstep( 0.35, 1, across ) )
				return alpha.mul( feather ).mul( pulse.mul( 0.65 ).add( 0.35 ) )
			} ) )
			.transparent( true )
			.build()

		this.line = line
		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false
		stage3d.add( this.line )
	}

	createGui() {
		const urlParams = new URLSearchParams( window.location.search )
		const hasNoMenu = urlParams.has( 'noUI' )
		this.gui = new GUI( { width: hasNoMenu ? 220 : 260 } )
		this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		if ( hasNoMenu || stage.width <= 700 ) this.gui.close()
		this.gui.add( this.params, 'mode', MODE_LABELS ).onChange( value => this.line?.mode( value ) )
		this.gui.add( this.params, 'curveCount', 16, 320, 1 ).onFinishChange( () => this.createLine() )
		this.gui.add( this.params, 'mouseStrength', 0, 24, 0.1 ).onChange( value => this.line?.mouseStrength( value ) )
		this.gui.add( this.params, 'curlStrength', 0, 5, 0.05 ).onChange( value => this.line?.curlStrength( value ) )
		this.gui.add( this.params, 'dashSpacing', 0.5, 4, 0.01 ).onChange( value => {
			this.dashSpacingUniform.value = value
		} )
	}

	onMouseMove = ( mouseData ) => {
		pointerNDC.set( mouseData.normalizedX, -mouseData.normalizedY )
		this.raycaster.setFromCamera( pointerNDC, stage3d.camera )
		if ( this.raycaster.ray.intersectPlane( interactionPlane, pointerWorld ) ) {
			this.line?.mouse( pointerWorld )
		}
	}

	update = ( dt ) => {
		const delta = Math.min( dt * 0.001, 1 / 15 )
		this.line?.step( stage3d.renderer, delta )
		this.dashPhaseUniform.value -= delta * 0.35
		if ( !this.reducedMotion && stage3d.control ) stage3d.control._theta += Math.min( dt, 100 ) * AUTO_ROTATE_SPEED
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
		this.gui?.destroy()
		this.gui = null
		this.hint?.remove()
		this.hint = null
		this.bloom?.dispose()
		this.bloom = null
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
		stage3d.control?.dispose()
		stage3d.scene.backgroundNode = null
	}
}

export default MeshLineComputeExample

import GUI from 'lil-gui'
import { MeshLineCompute } from 'makio-meshline'
import { float, Fn, mix, mod, smoothstep, uniform, uv, vec3, vec4 } from 'three/tsl'
import { AdditiveBlending, CanvasTexture, Color, Plane, Raycaster, RepeatWrapping, Vector2, Vector3 } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { onMove } from '@/makio/utils/input/mouse'

const pointerNDC = new Vector2()
const pointerWorld = new Vector3()
const interactionPlane = new Plane( new Vector3( 0, 0, 1 ), 0 )

const MODE_LABELS = {
	Autonomous: 'autonomous',
	Follow: 'follow',
	Field: 'field',
}

class MeshLineComputeExample {
	constructor() {
		this.line = null
		this.gui = null
		this.texture = null
		this.dashSpacingUniform = null
		this.dashPhaseUniform = uniform( 0 )
		this.raycaster = new Raycaster()
		this.params = {
			mode: 'follow',
			curveCount: 64,
			curlStrength: 2.5,
			mouseStrength: 14,
			dashSpacing: 1.5,
		}
		this.dashSpacingUniform = uniform( this.params.dashSpacing )
	}

	async init() {
		await stage3d.initRender()
		stage3d.control = new OrbitControl( stage3d.camera, 22 )
		stage3d.control.maxRadius = 42
		stage3d.control.minRadius = 11
		stage3d.control._phi = Math.PI * 0.52
		stage3d.control._theta = Math.PI * 0.5
		stage3d.scene.backgroundNode = Fn( () => {
			const gradient = uv().y
			const bottom = vec3( 0.004, 0.006, 0.015 )
			const top = vec3( 0.026, 0.013, 0.04 )
			return vec4( mix( bottom, top, gradient ), 1 )
		} )()
		stage3d.camera.far = 200
		stage3d.camera.updateProjectionMatrix()
		this.texture = this.createRibbonTexture()
		this.createLine()
		this.createGui()
		onMove.add( this.onMouseMove )
		window.addEventListener( 'resize', this.onResize )
	}

	createLine() {
		if ( this.line ) {
			stage3d.remove( this.line )
			this.line.dispose()
		}

		const colorA = new Color( 0x8fe8ff )
		const colorB = new Color( 0xffc15a )

		this.dashSpacingUniform.value = this.params.dashSpacing
		this.dashPhaseUniform.value = 0

		const line = new MeshLineCompute( {
			curveCount: this.params.curveCount,
			pointsPerCurve: 48,
			curveLength: 5.5,
			bounds: 12,
			damping: 0.94,
			curlStrength: this.params.curlStrength,
			flowSpeed: 0.8,
			homeStrength: 1.0,
			mouseStrength: this.params.mouseStrength,
			mouseRadius: 7,
			mode: this.params.mode,
			lineWidth: 2.4,
			sizeAttenuation: false,
			color: colorA,
			gradientColor: colorB,
			map: this.texture,
			transparent: true,
			opacity: 0.7,
		} )

		line
			.widthFn( Fn( ( [width, progress] ) => {
				const taper = smoothstep( 0, 0.15, progress ).mul( float( 1 ).sub( smoothstep( 0.85, 1, progress ) ) )
				return width.mul( taper.mul( 0.85 ).add( 0.15 ) )
			} ) )
			.fragmentAlphaFn( Fn( ( [alpha, uvCoords, progress] ) => {
				const arcDistance = line.arcLengthNode( progress ).toVar()
				const cycle = mod( arcDistance.div( this.dashSpacingUniform ).add( this.dashPhaseUniform ), 1 ).toVar()
				const dashIn = smoothstep( 0, 0.08, cycle )
				const dashOut = float( 1 ).sub( smoothstep( 0.55, 0.63, cycle ) )
				const dashMask = dashIn.mul( dashOut ).mul( 0.45 ).add( 0.55 )
				const across = uvCoords.y.sub( 0.5 ).abs().mul( 2 )
				const feather = float( 1 ).sub( smoothstep( 0.45, 1, across ) )
				return alpha.mul( feather ).mul( dashMask )
			} ) )
			.build()

		this.line = line

		this.line.material.blending = AdditiveBlending
		this.line.material.depthWrite = false
		stage3d.add( this.line )
	}

	createRibbonTexture() {
		const canvas = document.createElement( 'canvas' )
		canvas.width = 256
		canvas.height = 16
		const ctx = canvas.getContext( '2d' )
		const gradient = ctx.createLinearGradient( 0, 0, canvas.width, 0 )
		gradient.addColorStop( 0, '#8fe8ff' )
		gradient.addColorStop( 0.28, '#eefcff' )
		gradient.addColorStop( 0.55, '#9bf0ff' )
		gradient.addColorStop( 0.76, '#ffd18b' )
		gradient.addColorStop( 1, '#f7a84f' )
		ctx.fillStyle = gradient
		ctx.fillRect( 0, 0, canvas.width, canvas.height )

		for ( let x = 0; x < canvas.width; x += 64 ) {
			ctx.fillStyle = 'rgba(255,255,255,0.08)'
			ctx.fillRect( x, 0, 2, canvas.height )
		}

		const texture = new CanvasTexture( canvas )
		texture.wrapS = RepeatWrapping
		texture.wrapT = RepeatWrapping
		texture.repeat.set( 2, 1 )
		return texture
	}

	createGui() {
		const urlParams = new URLSearchParams( window.location.search )
		const hasNoMenu = urlParams.has( 'noUI' )
		this.gui = new GUI( { width: hasNoMenu ? 220 : 280 } )
		this.gui.domElement.style.right = hasNoMenu ? '0' : '60px'
		if ( hasNoMenu ) this.gui.close()
		this.gui.add( this.params, 'mode', MODE_LABELS ).onChange( value => this.line?.mode( value ) )
		this.gui.add( this.params, 'curveCount', 16, 200, 1 ).onFinishChange( () => this.createLine() )
		this.gui.add( this.params, 'mouseStrength', 0, 24, 0.1 ).onChange( value => this.line?.mouseStrength( value ) )
		this.gui.add( this.params, 'curlStrength', 0, 5, 0.05 ).onChange( value => this.line?.curlStrength( value ) )
		this.gui.add( this.params, 'dashSpacing', 0.5, 3, 0.01 ).onChange( value => {
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
		this.dashPhaseUniform.value -= delta * 0.24
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
		stage3d.remove( this.line )
		this.line?.dispose()
		this.line = null
		this.texture?.dispose()
		this.texture = null
		stage3d.control?.dispose()
		stage3d.scene.backgroundNode = null
	}
}

export default new MeshLineComputeExample()
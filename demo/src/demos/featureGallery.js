import { animate, utils } from 'animejs'
import { circlePositions, lineCoord, MeshLine } from 'makio-meshline'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { color, float, Fn, fract, mix, screenUV, sin, smoothstep, step, time, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, RepeatWrapping } from 'three/webgpu'

import { stage } from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'
import { getFeatureGalleryLayout } from '@/utils/featureGalleryLayout'

const BASE_POSITIONS = circlePositions( 64 )
const REVEAL_DURATION = 1.1
const REVEAL_STAGGER = 0.07
const HOLD_DURATION = 4.5
const CELL_TILT = 0.22

// Reusable TSL hooks keep the gallery cells as close as possible to application
// code: set the hook once before the line builds and animate with `time` on the
// GPU rather than rebuilding material graphs every frame.
const taperWidth = Fn( ( [width, progress] ) => {
	// The swell travels around the ring; sin() is zero at both ends of the
	// wrapped phase, so the closed seam stays continuous.
	const phase = fract( progress.add( time.mul( 0.08 ) ) )
	return width.mul( sin( phase.mul( Math.PI ) ).mul( 0.8 ).add( 0.2 ) )
} )

const sculptGradient = Fn( ( [factor] ) => {
	const contour = factor.add( sin( factor.mul( Math.PI * 4 ).add( time.mul( 1.1 ) ) ).mul( 0.14 ) )
	return smoothstep( 0.22, 0.78, contour )
} )

const fadeEnds = Fn( ( [alpha, progress] ) => {
	return alpha
		.mul( smoothstep( 0, 0.14, progress ) )
		.mul( smoothstep( 0.86, 1, progress ).oneMinus() )
} )

const shiftingDash = Fn( ( [cyclePosition, progress] ) => {
	const offset = sin( progress.mul( Math.PI * 8 ).add( time.mul( 1.4 ) ) ).mul( 0.16 )
	return fract( cyclePosition.add( offset ) )
} )

const scrollingUV = Fn( ( [coords] ) => {
	return vec2( coords.x.add( time.mul( 0.12 ) ), coords.y )
} )

const rimGlow = Fn( ( [baseColor] ) => {
	const edge = lineCoord.y.abs()
	const rim = smoothstep( 0.35, 0.92, edge )
	return mix( baseColor.mul( 0.28 ), vec3( 0.86, 0.98, 1.0 ), rim )
} )

const LINE_CONFIGS = [
	{
		title: 'Basic',
		color: 0xCE4257,
		closed: true,
		lineWidth: 0.2,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0xce4257 )\n  .lineWidth( 0.2 )`,
	},
	{
		title: 'Width Hook',
		color: 0x9FD8A4,
		closed: true,
		lineWidth: 0.65,
		widthFn: taperWidth,
		hook: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .lineWidth( 0.65 )\n  .widthFn( Fn( ( [width, progress] ) => {\n    const phase = fract( progress.add( time.mul( 0.08 ) ) )\n    return width.mul( sin( phase.mul( Math.PI ) ).mul( 0.8 ).add( 0.2 ) )\n  } ) )`,
	},
	{
		title: 'Open End',
		color: 0xFCD581,
		closed: false,
		lineWidth: 0.3,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), false )\n  .color( 0xfcd581 )\n  .lineWidth( 0.3 )`,
	},
	{
		title: 'Wireframe',
		color: 0x0A99FF,
		closed: true,
		lineWidth: 0.3,
		wireframe: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0x0a99ff )\n  .lineWidth( 0.3 )\n  .wireframe( true )`,
	},
	{
		title: 'lineCoord Rim',
		color: 0x38BDF8,
		closed: true,
		lineWidth: 0.48,
		fragmentColorFn: rimGlow,
		hook: true,
		snippet: `import { lineCoord, MeshLine } from 'makio-meshline'\n\nnew MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0x38bdf8 )\n  .lineWidth( 0.48 )\n  .fragmentColorFn( Fn( ( [baseColor] ) => {\n    const edge = lineCoord.y.abs()\n    return mix( baseColor.mul( 0.28 ), vec3( 0.86, 0.98, 1 ), smoothstep( 0.35, 0.92, edge ) )\n  } ) )`,
	},
	{
		title: 'Dashed 8',
		color: 0xF35B04,
		closed: true,
		lineWidth: 0.3,
		dash: { count: 8, ratio: 0.6 },
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0xf35b04 )\n  .lineWidth( 0.3 )\n  .dash( { count: 8, ratio: 0.6 } )`,
	},
	{
		title: 'Dash Hook',
		color: 0x7678ED,
		closed: true,
		lineWidth: 0.36,
		dash: { count: 12, ratio: 0.42 },
		dashFn: shiftingDash,
		hook: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .dash( { count: 12, ratio: 0.42 } )\n  .dashFn( Fn( ( [cyclePosition, progress] ) => {\n    const offset = sin( progress.mul( Math.PI * 8 ).add( time.mul( 1.4 ) ) ).mul( 0.16 )\n    return fract( cyclePosition.add( offset ) )\n  } ) )`,
	},
	{
		title: 'Long Dashes',
		color: 0x00FF80,
		closed: true,
		lineWidth: 0.5,
		dash: { count: 6, ratio: 0.8 },
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0x00ff80 )\n  .lineWidth( 0.5 )\n  .dash( { count: 6, ratio: 0.8 } )`,
	},
	{
		title: 'UV Hook',
		color: 0xFFFFFF,
		closed: true,
		lineWidth: 0.42,
		map: 'signals',
		uvFn: scrollingUV,
		hook: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .map( signalTexture )\n  .uvFn( Fn( ( [coords] ) => vec2( coords.x.add( time.mul( 0.12 ) ), coords.y ) ) )`,
	},
	{
		title: 'Dash + Gradient',
		color: 0x00FF00,
		closed: true,
		lineWidth: 0.4,
		dash: { count: 10, ratio: 0.7 },
		gradientColor: 0xFF0000,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0x00ff00 )\n  .gradientColor( 0xff0000 )\n  .dash( { count: 10, ratio: 0.7 } )`,
	},
	{
		title: 'Gradient Hook',
		color: 0xFF00FF,
		closed: true,
		lineWidth: 0.32,
		gradientColor: 0x00FFFF,
		gradientFn: sculptGradient,
		hook: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0xff00ff )\n  .gradientColor( 0x00ffff )\n  .gradientFn( Fn( ( [factor] ) => {\n    const contour = factor.add( sin( factor.mul( Math.PI * 4 ).add( time.mul( 1.1 ) ) ).mul( 0.14 ) )\n    return smoothstep( 0.22, 0.78, contour )\n  } ) )`,
	},
	{
		title: 'Gradient',
		color: 0xFFFF00,
		closed: true,
		lineWidth: 0.3,
		gradientColor: 0x0000FF,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0xffff00 )\n  .gradientColor( 0x0000ff )\n  .lineWidth( 0.3 )`,
	},
	{
		title: 'Opacity Hook',
		color: 0x8080FF,
		closed: false,
		lineWidth: 0.55,
		opacityFn: fadeEnds,
		transparent: true,
		background: true,
		hook: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), false )\n  .transparent( true )\n  .opacityFn( Fn( ( [alpha, progress] ) =>\n    alpha.mul( smoothstep( 0, 0.14, progress ) ).mul( smoothstep( 0.86, 1, progress ).oneMinus() )\n  ) )`,
	},
	{
		title: 'Alpha Map',
		color: 0xFF00FF,
		closed: true,
		lineWidth: 0.3,
		alphaMap: 'alpha',
		background: true,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0xff00ff )\n  .alphaMap( alphaTexture )`,
	},
	{
		title: 'CSS Pixel Width',
		color: 0x80FF80,
		closed: true,
		lineWidth: 5,
		sizeAttenuation: false,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .lineWidth( 5 )\n  .sizeAttenuation( false )\n  .autoResize()`,
	},
	{
		title: 'Thick Dash + Gradient',
		color: 0xFFFFFF,
		closed: true,
		lineWidth: 0.5,
		dash: { count: 8, ratio: 0.5 },
		gradientColor: 0xFF0000,
		snippet: `new MeshLine()\n  .lines( circlePositions( 64 ), true )\n  .color( 0xffffff )\n  .gradientColor( 0xff0000 )\n  .lineWidth( 0.5 )\n  .dash( { count: 8, ratio: 0.5 } )`,
	},
]

class FeatureGalleryExample {
	constructor() {
		this.cells = []
		this.lines = []
		this.labels = []
		this.backgroundPlanes = []
		this.textures = null
		this.cssRenderer = null
		this.control = null
		this.layout = null
		this.bloom = null
		this.hint = null
		this.inspector = null
		this.inspectorStyle = null
		this.selectedIndex = -1
		this.hideChrome = new URLSearchParams( window.location.search ).has( 'noUI' )
		this.time = 0
		this.labelsRevealed = false
		this.reducedMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches === true
	}

	async init() {
		await stage3d.initRender( { background: 0x02040A } )
		// Drag orbits the whole gallery so every option can be seen off-axis;
		// zoom and pan stay locked because the layout owns the camera distance.
		this.control = new OrbitControl( stage3d.camera, 20 )
		this.control.blockZoom = true
		this.control.blockPan = true
		stage3d.control = this.control
		this.createBackground()
		this.createCssRenderer()
		this.createInspector()
		this.createScene()
		this.bloom = createBloomPipeline( { strength: 0.38, radius: 0.4, threshold: 0.24 } )
		await this.warmUp()
		window.addEventListener( 'resize', this.onResize )
		stage.onUpdate.add( this.update )
	}

	createBackground() {
		// A soft navy pool behind the grid gives the glow something to sit in.
		stage3d.scene.backgroundNode = Fn( () => {
			const distance = screenUV.sub( 0.5 ).mul( vec2( 1.25, 1 ) ).length()
			const glow = float( 1 ).sub( smoothstep( 0.05, 0.75, distance ) )
			return vec4( mix( color( 0x02040A ), color( 0x0B1630 ), glow.mul( glow ) ), 1 )
		} )()
	}

	createCssRenderer() {
		this.cssRenderer = new CSS2DRenderer()
		this.cssRenderer.domElement.style.position = 'absolute'
		this.cssRenderer.domElement.style.top = '0px'
		this.cssRenderer.domElement.style.pointerEvents = 'none'
		document.body.appendChild( this.cssRenderer.domElement )
		this.onResize()
	}

	createInspector() {
		if ( this.hideChrome ) return
		const style = document.createElement( 'style' )
		style.textContent = `
			.FeatureGalleryInspector {
				position: fixed;
				left: calc( 18px + var( --sail, 0px ) );
				bottom: calc( 62px + var( --saib, 0px ) );
				z-index: 25;
				width: min( 420px, calc( 100vw - 36px ) );
				padding: 12px 14px;
				border-radius: 14px;
				background: rgba( 8, 13, 23, 0.88 );
				border: 1px solid rgba( 103, 232, 249, 0.28 );
				box-shadow: 0 16px 38px rgba( 0, 0, 0, 0.45 );
				backdrop-filter: blur( 14px );
				-webkit-backdrop-filter: blur( 14px );
				color: rgba( 255, 255, 255, 0.92 );
				font: 500 12px/1.45 'Inter', system-ui, -apple-system, sans-serif;
			}
			.FeatureGalleryInspector[hidden] {
				display: none;
			}
			.FeatureGalleryInspector-header {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 8px;
				margin-bottom: 8px;
			}
			.FeatureGalleryInspector-title {
				font-weight: 700;
				font-size: 13px;
				color: #e0f2fe;
			}
			.FeatureGalleryInspector-actions {
				display: inline-flex;
				align-items: center;
				gap: 6px;
			}
			.FeatureGalleryInspector-btn {
				padding: 4px 9px;
				border-radius: 999px;
				border: 1px solid rgba( 255, 255, 255, 0.16 );
				background: rgba( 255, 255, 255, 0.07 );
				color: rgba( 255, 255, 255, 0.88 );
				font: 600 11px/1 'Inter', system-ui, sans-serif;
				text-decoration: none;
				cursor: pointer;
			}
			.FeatureGalleryInspector-btn:hover {
				background: rgba( 103, 232, 249, 0.18 );
				border-color: rgba( 103, 232, 249, 0.45 );
				color: #ffffff;
			}
			.FeatureGalleryInspector-code {
				margin: 0;
				padding: 9px 11px;
				border-radius: 10px;
				background: rgba( 2, 6, 14, 0.78 );
				border: 1px solid rgba( 255, 255, 255, 0.08 );
				color: #bae6fd;
				font: 500 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
				overflow-x: auto;
				white-space: pre;
			}
		`
		document.head.appendChild( style )
		this.inspectorStyle = style

		const panel = document.createElement( 'aside' )
		panel.className = 'FeatureGalleryInspector'
		panel.hidden = true
		panel.innerHTML = `
			<div class="FeatureGalleryInspector-header">
				<span class="FeatureGalleryInspector-title"></span>
				<div class="FeatureGalleryInspector-actions">
					<button type="button" class="FeatureGalleryInspector-btn" data-action="copy">Copy</button>
					<a class="FeatureGalleryInspector-btn" href="/sandbox">Sandbox</a>
					<button type="button" class="FeatureGalleryInspector-btn" data-action="close" aria-label="Close snippet">✕</button>
				</div>
			</div>
			<pre class="FeatureGalleryInspector-code"></pre>
		`
		panel.addEventListener( 'click', event => {
			const button = event.target.closest( '[data-action]' )
			if ( !button ) return
			const action = button.getAttribute( 'data-action' )
			if ( action === 'close' ) {
				this.selectCell( -1 )
			} else if ( action === 'copy' && this.selectedIndex >= 0 ) {
				const snippet = LINE_CONFIGS[this.selectedIndex]?.snippet ?? ''
				navigator.clipboard?.writeText( snippet ).then( () => {
					button.textContent = 'Copied'
					setTimeout( () => { button.textContent = 'Copy' }, 1400 )
				} ).catch( () => {} )
			}
		} )
		document.body.appendChild( panel )
		this.inspector = panel
	}

	selectCell( index ) {
		this.selectedIndex = this.selectedIndex === index ? -1 : index
		this.labels.forEach( ( label, i ) => {
			const active = i === this.selectedIndex
			const isHook = LINE_CONFIGS[i]?.hook
			label.element.style.boxShadow = active ? '0 0 0 2px #38bdf8' : 'none'
			label.element.style.borderColor = active
				? '#38bdf8'
				: ( isHook ? 'rgba(103, 232, 249, 0.38)' : 'rgba(255, 255, 255, 0.14)' )
		} )
		if ( !this.inspector ) return
		if ( this.selectedIndex < 0 ) {
			this.inspector.hidden = true
			return
		}
		const config = LINE_CONFIGS[this.selectedIndex]
		this.inspector.querySelector( '.FeatureGalleryInspector-title' ).textContent = config.title
		this.inspector.querySelector( '.FeatureGalleryInspector-code' ).textContent = config.snippet
		this.inspector.hidden = false
	}

	createScene() {
		this.clearScene()
		this.textures = this.createTextures()

		LINE_CONFIGS.forEach( ( config, index ) => {
			// Each cell pivots on its own, so the line and its checker card tilt
			// together while the label stays level underneath.
			const cell = new Group()
			stage3d.add( cell )
			this.cells.push( cell )

			const line = this.createLine( config )
			line.userData.featureGalleryIndex = index
			cell.add( line )
			this.lines.push( line )

			if ( config.background ) {
				const plane = new Mesh(
					new PlaneGeometry( 2.2, 2.2 ),
					new MeshBasicMaterial( { map: this.textures.checker, transparent: true, opacity: 0 } )
				)
				plane.position.z = -0.3
				plane.userData.featureGalleryIndex = index
				cell.add( plane )
				this.backgroundPlanes.push( plane )
			}

			const element = document.createElement( 'button' )
			element.type = 'button'
			element.className = 'line-label'
			element.textContent = config.title
			element.title = `Inspect ${config.title} code`
			element.style.color = 'rgba(255, 255, 255, 0.9)'
			element.style.fontFamily = "'Inter', system-ui, sans-serif"
			element.style.fontSize = '12px'
			element.style.fontWeight = '500'
			element.style.backgroundColor = 'rgba(0, 0, 0, 0.72)'
			element.style.border = '1px solid rgba(255, 255, 255, 0.14)'
			element.style.padding = '2px 7px'
			element.style.borderRadius = '999px'
			element.style.textAlign = 'center'
			element.style.minWidth = '60px'
			element.style.whiteSpace = 'nowrap'
			element.style.cursor = this.hideChrome ? 'default' : 'pointer'
			element.style.pointerEvents = this.hideChrome ? 'none' : 'auto'
			// Labels wait for their line: they fade in with the first reveal.
			element.style.opacity = '0'
			if ( config.hook ) {
				element.style.color = '#cffafe'
				element.style.backgroundColor = 'rgba(8, 47, 73, 0.84)'
				element.style.border = '1px solid rgba(103, 232, 249, 0.38)'
			}
			if ( !this.hideChrome ) {
				element.addEventListener( 'click', event => {
					event.stopPropagation()
					this.selectCell( index )
				} )
			}

			const label = new CSS2DObject( element )
			label.userData.featureGalleryIndex = index
			stage3d.add( label )
			this.labels.push( label )
		} )

		this.applyLayout()
	}

	createTextures() {
		const createTexture = ( width, height, repeatX, repeatY, draw ) => {
			const canvas = document.createElement( 'canvas' )
			canvas.width = width
			canvas.height = height
			const ctx = canvas.getContext( '2d' )

			if ( ctx ) {
				draw( ctx, width, height )
			}

			const texture = new CanvasTexture( canvas )
			texture.wrapS = RepeatWrapping
			texture.wrapT = RepeatWrapping
			texture.repeat.set( repeatX, repeatY )
			return texture
		}

		return {
			// A dim checker still reads as "transparency" without blooming.
			checker: createTexture( 64, 64, 2, 2, ( ctx, width ) => {
				const squareSize = width / 8
				for ( let x = 0; x < 8; x++ ) {
					for ( let y = 0; y < 8; y++ ) {
						ctx.fillStyle = ( x + y ) % 2 === 0 ? '#3a4458' : '#151b28'
						ctx.fillRect( x * squareSize, y * squareSize, squareSize, squareSize )
					}
				}
			} ),
			signals: createTexture( 128, 32, 5, 1, ( ctx, width, height ) => {
				const gradient = ctx.createLinearGradient( 0, 0, width, 0 )
				gradient.addColorStop( 0, '#071b2d' )
				gradient.addColorStop( 0.45, '#22d3ee' )
				gradient.addColorStop( 0.7, '#f0fdfa' )
				gradient.addColorStop( 1, '#071b2d' )
				ctx.fillStyle = gradient
				ctx.fillRect( 0, 0, width, height )
				ctx.fillStyle = 'rgba(255, 255, 255, 0.85)'
				ctx.fillRect( width * 0.68, 0, width * 0.055, height )
			} ),
			alpha: createTexture( 32, 32, 6, 1, ( ctx, width, height ) => {
				const gradient = ctx.createLinearGradient( 0, 0, width, 0 )
				gradient.addColorStop( 0, '#000000' )
				gradient.addColorStop( 0.3, '#000000' )
				gradient.addColorStop( 0.7, '#ffffff' )
				gradient.addColorStop( 1, '#ffffff' )
				ctx.fillStyle = gradient
				ctx.fillRect( 0, 0, width, height )
			} )
		}
	}

	createLine( config ) {
		const line = new MeshLine()
			.lines( BASE_POSITIONS, config.closed )
			.color( config.color )
			.lineWidth( config.lineWidth )
			.wireframe( config.wireframe ?? false )

		line.percent1 = uniform( 0 )
		line.percent2 = uniform( 1 )
		line.discardFn( Fn( () => {
			return step( uv().x, line.percent1 ).mul( step( uv().x.oneMinus(), line.percent2 ) ).lessThan( 0.00001 )
		} ) )

		if ( config.dash ) line.dash( config.dash )
		if ( config.gradientColor ) line.gradientColor( config.gradientColor )
		if ( config.map ) line.map( this.textures[config.map] )
		if ( config.opacity !== undefined ) line.opacity( config.opacity )
		if ( config.alphaMap ) line.alphaMap( this.textures[config.alphaMap] )
		if ( 'sizeAttenuation' in config ) line.sizeAttenuation( config.sizeAttenuation )
		if ( config.transparent ) line.transparent( true )
		if ( config.widthFn ) line.widthFn( config.widthFn )
		if ( config.gradientFn ) line.gradientFn( config.gradientFn )
		if ( config.opacityFn ) line.opacityFn( config.opacityFn )
		if ( config.dashFn ) line.dashFn( config.dashFn )
		if ( config.uvFn ) line.uvFn( config.uvFn )
		if ( config.fragmentColorFn ) line.fragmentColorFn( config.fragmentColorFn )

		// Build now rather than on first render so warmUp() compiles every cell.
		return line.build()
	}

	/**
	 * Render one hidden frame and wait for the GPU: the reveal then starts with
	 * every pipeline compiled instead of the lines popping in seconds later.
	 */
	async warmUp() {
		stage3d.render()
		await stage3d.renderer?.backend?.device?.queue?.onSubmittedWorkDone?.()
	}

	clearScene() {
		this.lines.forEach( line => {
			utils.remove( [line, line.percent1, line.percent2].filter( Boolean ) )
			line.dispose()
		} )
		this.backgroundPlanes.forEach( plane => {
			utils.remove( plane.material )
			plane.geometry.dispose()
			plane.material.dispose()
		} )
		this.cells.forEach( cell => stage3d.remove( cell ) )
		this.labels.forEach( label => {
			stage3d.remove( label )
		} )

		this.cells = []
		this.lines = []
		this.labels = []
		this.backgroundPlanes = []
		this.disposeTextures()
	}

	disposeTextures() {
		if ( !this.textures ) {
			return
		}

		Object.values( this.textures ).forEach( texture => texture.dispose() )
		this.textures = null
	}

	update = ( dt ) => {
		if ( !this.reducedMotion ) this.time += Math.min( dt, 100 ) * 0.001
		const t = this.time
		this.cells.forEach( ( cell, index ) => {
			// A slow, out-of-phase sway shows the ribbons in perspective; each ring
			// also turns in place so dashes, gaps and maps keep moving.
			const seed = index * 1.73
			cell.rotation.x = Math.sin( t * 0.5 + seed ) * CELL_TILT
			cell.rotation.y = Math.cos( t * 0.37 + seed * 1.31 ) * CELL_TILT
			this.lines[index].rotation.z = t * ( 0.1 + ( index % 3 ) * 0.035 ) * ( index % 2 === 0 ? -1 : 1 )
		} )
		this.cssRenderer?.render( stage3d.scene, stage3d.camera )
	}

	onResize = () => {
		this.cssRenderer?.setSize( stage.width, stage.height )
		this.applyLayout()
		this.lines.forEach( line => line.resize() )
	}

	applyLayout() {
		if ( this.lines.length === 0 ) return

		this.layout = getFeatureGalleryLayout( {
			width: stage.width,
			height: stage.height,
			count: this.lines.length,
			fov: stage3d.camera.fov,
		} )

		const { cameraDistance, itemScale, labelOffset, portrait, positions } = this.layout
		this.cells.forEach( ( cell, index ) => {
			const position = positions[index]
			cell.position.set( position.x, position.y, 0 )
			cell.scale.setScalar( itemScale )
		} )
		this.labels.forEach( ( label, index ) => {
			const position = positions[index]
			label.position.set( position.x, position.y - labelOffset, 0 )
			label.element.style.fontSize = portrait ? '10px' : '12px'
			label.element.style.padding = portrait ? '1px 5px' : '2px 7px'
		} )

		if ( this.control ) {
			this.control.radius = cameraDistance
			this.control._radius = cameraDistance
			this.control.update()
		}
	}

	/** Cells reveal along the grid diagonal, so the draw-in sweeps across it. */
	getRevealDelay( index ) {
		const columns = this.layout?.columns ?? 4
		return ( Math.floor( index / columns ) + index % columns ) * REVEAL_STAGGER
	}

	show() {
		if ( !this.labelsRevealed ) {
			this.labelsRevealed = true
			this.labels.forEach( ( label, index ) => {
				label.element.style.transition = `opacity .7s ease ${this.getRevealDelay( index ) + 0.2}s`
				label.element.style.opacity = '1'
			} )
			this.backgroundPlanes.forEach( plane => {
				animate( plane.material, { opacity: 1, duration: 0.7, delay: this.getRevealDelay( plane.userData.featureGalleryIndex ), ease: 'outQuad' } )
			} )
			this.hint = createDemoHint( 'Cyan labels are TSL hooks · click any label for code · drag to orbit', { accent: '#67e8f9', hideAfter: 12000 } )
		}

		const lastIndex = this.lines.length - 1
		this.lines.forEach( ( line, index ) => {
			const delay = this.getRevealDelay( index )
			line.percent1.value = -0.01
			line.percent2.value = 1.01
			animate( line.percent1, { duration: REVEAL_DURATION, value: 1.01, delay, ease: 'inOutQuad' } )
			// Reduced motion draws the gallery once and keeps it.
			if ( this.reducedMotion ) return
			animate( line.percent2, {
				duration: REVEAL_DURATION,
				value: -0.01,
				delay: HOLD_DURATION + delay,
				ease: 'inOutQuad',
				onComplete: index === lastIndex ? () => this.show() : undefined
			} )
		} )
	}

	hide( cb ) {
		this.hint?.hide()
		this.selectCell( -1 )
		this.backgroundPlanes.forEach( plane => {
			plane.visible = false
		} )
		this.labels.forEach( label => {
			label.visible = false
		} )

		this.lines.forEach( ( line, index, lines ) => {
			utils.remove( [line, line.percent1, line.percent2].filter( Boolean ) )
			animate( line.percent2, {
				duration: 0.2,
				value: 0,
				delay: index * 0.02,
				ease: 'easeOut',
				onComplete: index === lines.length - 1 ? cb : undefined
			} )
		} )
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		window.removeEventListener( 'resize', this.onResize )
		this.clearScene()
		this.bloom?.dispose()
		this.bloom = null
		this.hint?.remove()
		this.hint = null
		this.inspector?.remove()
		this.inspector = null
		this.inspectorStyle?.remove()
		this.inspectorStyle = null
		stage3d.scene.backgroundNode = null

		if ( this.cssRenderer?.domElement.parentNode ) {
			this.cssRenderer.domElement.parentNode.removeChild( this.cssRenderer.domElement )
		}
		this.cssRenderer = null
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.control = null
		this.layout = null
	}
}

export default FeatureGalleryExample

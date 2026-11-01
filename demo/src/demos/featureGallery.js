/**
 * Feature Gallery — 16 side-by-side specimens of MeshLine styling and TSL hooks.
 * Demonstrates: gradients, dashes, texture and alpha maps, wireframe, CSS-pixel widths, lineCoord,
 * and the widthFn, dashFn, uvFn, gradientFn, opacityFn, fragmentColorFn and discardFn hooks.
 */
import { animate, utils } from 'animejs'
import { circlePositions, lineCoord, MeshLine } from 'makio-meshline'
import { color, float, Fn, fract, mix, screenUV, sin, smoothstep, time, uniform, vec2, vec3, vec4 } from 'three/tsl'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three/webgpu'
import { markRaw, ref } from 'vue'

import FeatureGalleryUI from '@/components/FeatureGallery.vue'
import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { reducedMotion } from '@/makio/utils/detect'
import { createBloomPipeline } from '@/utils/bloomPipeline'
import { createDemoHint } from '@/utils/demoHint'
import { createLabel, createLabelRenderer } from '@/utils/featureGalleryLabels'
import { getFeatureGalleryLayout } from '@/utils/featureGalleryLayout'
import { createGalleryTextures } from '@/utils/featureGalleryTextures'

const BACKGROUND = 0x02040A
const REVEAL_DURATION = 1.1
const REVEAL_STAGGER = 0.07
const HOLD_DURATION = 4.5
const CELL_TILT = 0.22

// A soft navy pool behind the grid gives the glow something to sit in.
const backgroundGlow = Fn( () => {
	const distance = screenUV.sub( 0.5 ).mul( vec2( 1.25, 1 ) ).length()
	const glow = float( 1 ).sub( smoothstep( 0.05, 0.75, distance ) )
	return vec4( mix( color( BACKGROUND ), color( 0x0B1630 ), glow.mul( glow ) ), 1 )
} )

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

const fadeEnds = Fn( ( [alpha, progress] ) => alpha
	.mul( smoothstep( 0, 0.14, progress ) )
	.mul( smoothstep( 0.86, 1, progress ).oneMinus() ) )

const shiftingDash = Fn( ( [cyclePosition, progress] ) => {
	const offset = sin( progress.mul( Math.PI * 8 ).add( time.mul( 1.4 ) ) ).mul( 0.16 )
	return fract( cyclePosition.add( offset ) )
} )

const scrollingUV = Fn( ( [coords] ) => vec2( coords.x.add( time.mul( 0.12 ) ), coords.y ) )

const rimGlow = Fn( ( [baseColor] ) => {
	const edge = lineCoord.y.abs()
	const rim = smoothstep( 0.35, 0.92, edge )
	return mix( baseColor.mul( 0.28 ), vec3( 0.86, 0.98, 1.0 ), rim )
} )

// `hook` tints the label cyan, `open` leaves the ring unclosed, `background` adds a checker card.
const CELLS = [
	{ title: 'Basic', style: line => line.color( 0xCE4257 ).lineWidth( 0.2 ) },
	{ title: 'Width Hook', hook: true, style: line => line.color( 0x9FD8A4 ).lineWidth( 0.65 ).widthFn( taperWidth ) },
	{ title: 'Open End', open: true, style: line => line.color( 0xFCD581 ) },
	{ title: 'Wireframe', style: line => line.color( 0x0A99FF ).wireframe( true ) },
	{ title: 'lineCoord Rim', hook: true, style: line => line.color( 0x38BDF8 ).lineWidth( 0.48 ).fragmentColorFn( rimGlow ) },
	{ title: 'Dashed 8', style: line => line.color( 0xF35B04 ).dash( { count: 8, ratio: 0.6 } ) },
	{ title: 'Dash Hook', hook: true, style: line => line.color( 0x7678ED ).lineWidth( 0.36 ).dash( { count: 12, ratio: 0.42 } ).dashFn( shiftingDash ) },
	{ title: 'Long Dashes', style: line => line.color( 0x00FF80 ).lineWidth( 0.5 ).dash( { count: 6, ratio: 0.8 } ) },
	{ title: 'UV Hook', hook: true, style: ( line, { signals } ) => line.lineWidth( 0.42 ).map( signals ).uvFn( scrollingUV ) },
	{ title: 'Dash + Gradient', style: line => line.color( 0x00FF00 ).lineWidth( 0.4 ).dash( { count: 10, ratio: 0.7 } ).gradientColor( 0xFF0000 ) },
	{ title: 'Gradient Hook', hook: true, style: line => line.color( 0xFF00FF ).lineWidth( 0.32 ).gradientColor( 0x00FFFF ).gradientFn( sculptGradient ) },
	{ title: 'Gradient', style: line => line.color( 0xFFFF00 ).gradientColor( 0x0000FF ) },
	{ title: 'Opacity Hook', hook: true, open: true, background: true, style: line => line.color( 0x8080FF ).lineWidth( 0.55 ).transparent( true ).opacityFn( fadeEnds ) },
	{ title: 'Alpha Map', background: true, style: ( line, { alpha } ) => line.color( 0xFF00FF ).alphaMap( alpha ) },
	{ title: 'CSS Pixel Width', style: line => line.color( 0x80FF80 ).lineWidth( 5 ).sizeAttenuation( false ) },
	{ title: 'Thick Dash + Gradient', style: line => line.lineWidth( 0.5 ).dash( { count: 8, ratio: 0.5 } ).gradientColor( 0xFF0000 ) },
]

export default class FeatureGalleryExample {
	uiComponent = markRaw( FeatureGalleryUI )
	// Title of the cell whose code FeatureGallery.vue shows.
	selected = ref( null )
	time = 0

	async init() {
		await stage3d.initRender( { background: BACKGROUND } )
		stage3d.scene.backgroundNode = backgroundGlow()
		// Drag orbits the whole gallery so every option can be seen off-axis;
		// zoom and pan stay locked because the layout owns the camera distance.
		stage3d.orbit( 20, { blockZoom: true, blockPan: true } )

		this.cssRenderer = createLabelRenderer()
		this.createCells()
		this.onResize()
		createBloomPipeline( { strength: 0.38, radius: 0.4, threshold: 0.24 } )

		// Render one hidden frame and wait for the GPU: the reveal then starts with
		// every pipeline compiled instead of the lines popping in seconds later.
		stage3d.render()
		await stage3d.renderer.backend.device?.queue.onSubmittedWorkDone()
	}

	createCells() {
		const textures = createGalleryTextures()
		const planeGeometry = new PlaneGeometry( 2.2, 2.2 )
		this.cells = CELLS.map( config => this.createCell( config, textures, planeGeometry ) )
	}

	createCell( config, textures, planeGeometry ) {
		const drawn = uniform( 0 )
		const kept = uniform( 1 )
		// A running tween would otherwise re-enter reveal() once the demo is gone.
		stage3d.own( () => utils.remove( [drawn, kept] ) )

		const line = new MeshLine()
			.lines( circlePositions( 64 ), !config.open )
			// Keeps UVs to the cells that map a texture: discardFn alone would add them to all.
			.needsUV( false )
			// `drawn` draws the line in from its start, then `kept` erases it from that same end.
			.discardFn( Fn( ( [progress] ) => progress.greaterThan( drawn ).or( progress.lessThan( kept.oneMinus() ) ) ) )
			.autoResize()
		// Build now rather than on first render so the warm-up frame compiles every cell.
		config.style( line, textures ).build()

		// Each cell pivots on its own, so the line and its checker card tilt
		// together while the label stays level underneath.
		const group = new Group().add( line )
		const label = createLabel( config, title => this.select( title ) )
		stage3d.add( group, label )

		const cell = { title: config.title, group, line, label, drawn, kept }
		if ( !config.background ) return cell

		cell.plane = new Mesh( planeGeometry, new MeshBasicMaterial( { map: textures.checker, transparent: true, opacity: 0 } ) )
		cell.plane.position.z = -0.3
		group.add( cell.plane )
		return cell
	}

	select( title ) {
		this.selected.value = this.selected.value === title ? null : title
		for ( const cell of this.cells ) {
			cell.label.element.classList.toggle( 'is-active', cell.title === this.selected.value )
		}
	}

	/** Cells reveal along the grid diagonal, so the draw-in sweeps across it. */
	revealDelay( index ) {
		return ( Math.floor( index / this.columns ) + index % this.columns ) * REVEAL_STAGGER
	}

	show() {
		this.cells.forEach( ( { label, plane }, index ) => {
			const delay = this.revealDelay( index )
			label.element.style.transition = `opacity .7s ease ${delay + 0.2}s`
			label.element.style.opacity = '1'
			if ( plane ) animate( plane.material, { opacity: 1, duration: 0.7, delay, ease: 'outQuad' } )
		} )
		createDemoHint( 'Cyan labels are TSL hooks · click any label for code · drag to orbit', { accent: '#67e8f9', hideAfter: 12000 } )
		this.reveal()
	}

	reveal() {
		this.cells.forEach( ( { drawn, kept }, index ) => {
			const delay = this.revealDelay( index )
			drawn.value = -0.01
			kept.value = 1.01
			animate( drawn, { duration: REVEAL_DURATION, value: 1.01, delay, ease: 'inOutQuad' } )
			// Reduced motion draws the gallery once and keeps it.
			if ( reducedMotion.matches ) return
			animate( kept, {
				duration: REVEAL_DURATION,
				value: -0.01,
				delay: HOLD_DURATION + delay,
				ease: 'inOutQuad',
				onComplete: index === CELLS.length - 1 ? () => this.reveal() : undefined,
			} )
		} )
	}

	update = dt => {
		if ( !reducedMotion.matches ) this.time += dt * 0.001
		for ( let index = 0; index < CELLS.length; index++ ) {
			const { group, line } = this.cells[index]
			// A slow, out-of-phase sway shows the ribbons in perspective; each ring
			// also turns in place so dashes, gaps and maps keep moving.
			const seed = index * 1.73
			group.rotation.x = Math.sin( this.time * 0.5 + seed ) * CELL_TILT
			group.rotation.y = Math.cos( this.time * 0.37 + seed * 1.31 ) * CELL_TILT
			line.rotation.z = this.time * ( 0.1 + ( index % 3 ) * 0.035 ) * ( index % 2 === 0 ? -1 : 1 )
		}
		this.cssRenderer.render( stage3d.scene, stage3d.camera )
	}

	onResize = () => {
		const { cameraDistance, columns, itemScale, labelOffset, portrait, positions } = getFeatureGalleryLayout( stage )

		this.columns = columns
		this.cssRenderer.setSize( stage.width, stage.height )
		this.cells.forEach( ( { group, label }, index ) => {
			const { x, y } = positions[index]
			group.position.set( x, y, 0 )
			group.scale.setScalar( itemScale )
			label.position.set( x, y - labelOffset, 0 )
			label.element.classList.toggle( 'is-portrait', portrait )
		} )

		// Update now: the warm-up frame renders before the control's first tick.
		stage3d.control.snapRadius( cameraDistance )
		stage3d.control.update()
	}
}

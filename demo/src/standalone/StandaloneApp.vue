<template>
	<main class="Standalone">
		<a
			ref="brand"
			class="Standalone__brand Standalone__pill"
			:class="{ 'is-teasing': teasing }"
			href="https://meshline.makio.io"
			target="_blank"
			rel="noopener"
			@click.prevent="tease"
		>
			<span class="Standalone__label">MakioMeshline <b>V2</b> <span class="Standalone__tag">Preview</span></span>
			<span class="Standalone__soon" aria-live="polite">{{ teasing ? 'Soon' : '' }}</span>
		</a>
		<nav class="Standalone__author Standalone__pill" aria-label="Author">
			<span class="Standalone__by">By Makio64</span>
			<a :href="links.x" target="_blank" rel="noopener" aria-label="Makio64 on X" title="X">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.75 3h3.07l-6.7 7.66L22 21h-6.17l-4.83-6.32L5.46 21H2.39l7.17-8.2L2 3h6.33l4.37 5.77Zm-1.08 16.17h1.7L7.4 4.74H5.58Z" /></svg>
			</a>
			<a :href="links.linkedin" target="_blank" rel="noopener" aria-label="David Ronai on LinkedIn" title="LinkedIn">
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0Z" /></svg>
			</a>
		</nav>
		<section v-if="failure" class="Standalone__failure" role="alert">
			<h1>{{ failure.title }}</h1>
			<p>{{ failure.summary }}</p>
			<p>{{ failure.guidance[0] }}</p>
			<details>
				<summary>Technical details</summary>
				<code>{{ failure.detail }}</code>
			</details>
			<button type="button" @click="reload">Reload {{ name }}</button>
		</section>
		<component :is="example.uiComponent" v-else-if="ready && example.uiComponent" :api="example" />
	</main>
</template>

<script setup>
import { markRaw, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { describeDemoFailure } from '@/utils/demoFailure'

import { firstCompleteFrame, installFastStart } from './fastStart'
import { adoptLoader } from './loader'

// One demo of the gallery as an app of its own, under the brand and author pills.
const props = defineProps( {
	// The demo's class, as the gallery loads it from src/demos/.
	demo: { type: Function, required: true },
	// What the loading line, the reload button and the console call the app.
	name: { type: String, required: true },
	// URL of the app's pipeline recording (scripts/capture-pipelines.mjs), compiled ahead of the scene.
	pipelines: { type: String, default: '' },
} )

// Before the demo creates its renderer. The loader (index.html) follows the compiles.
const loader = adoptLoader( document.getElementById( 'standalone-loader' ) )
installFastStart( { recording: props.pipelines, onProgress: loader.set } )

// How long the brand says "Soon" when clicked, in milliseconds.
const TEASE = 1400

const links = {
	x: 'https://x.com/makio64',
	linkedin: 'https://www.linkedin.com/in/davidronai/',
}

const example = markRaw( new props.demo() )
const ready = ref( false )
const failure = shallowRef( null )
let disposed = false
let watchedDevice
let watchedCanvas

const reload = () => window.location.reload()

// V2 is not out yet: the brand shakes its head, says so, and goes back to what it was.
const brand = ref( null )
const teasing = ref( false )
let teaseTimer = 0
const tease = () => {
	clearTimeout( teaseTimer )
	teasing.value = true
	teaseTimer = setTimeout( () => teasing.value = false, TEASE )
	if ( window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) return
	brand.value?.animate(
		[0, -7, 6, -5, 4, -2, 0].map( x => ( { transform: `translateX(${x}px)` } ) ),
		{ duration: 480, easing: 'ease-out' },
	)
}

const dispose = () => {
	if ( disposed ) return
	disposed = true
	stage3d.pause()
	example.dispose?.()
	stage3d.clearDemo()
}

const fail = error => {
	if ( disposed || failure.value ) return
	console.error( `[${props.name}]`, error )
	failure.value = describeDemoFailure( ready.value ? 'render' : 'init', error, stage3d.backend )
	loader.leave()
	dispose()
}

const onError = event => fail( event.error || event.reason || event.message )
const onContextLost = event => {
	event.preventDefault()
	fail( new Error( 'The WebGL rendering context was lost.' ) )
}

onMounted( async () => {
	window.addEventListener( 'error', onError )
	window.addEventListener( 'unhandledrejection', onError )
	try {
		await example.init()
		if ( disposed ) return
		if ( example.update ) stage3d.listen( stage.onUpdate, example.update )
		if ( example.onResize ) stage3d.listen( stage.onResize, example.onResize )
		watchedCanvas = stage3d.renderer.domElement
		watchedDevice = stage3d.renderer.backend?.device
		watchedCanvas.addEventListener( 'webglcontextlost', onContextLost )
		watchedDevice?.addEventListener( 'uncapturederror', onError )
		watchedDevice?.lost.then( info => {
			if ( info.reason !== 'destroyed' ) fail( new Error( info.message || 'The GPU device was lost.' ) )
		} )
		// The canvas, hint and controls show with the first frame that has everything in it.
		await firstCompleteFrame( stage3d.renderer )
		if ( disposed ) return
		document.documentElement.dataset.ready = ''
		ready.value = true
		loader.leave()
	} catch ( error ) {
		fail( error )
	}
} )

onBeforeUnmount( () => {
	clearTimeout( teaseTimer )
	window.removeEventListener( 'error', onError )
	window.removeEventListener( 'unhandledrejection', onError )
	watchedCanvas?.removeEventListener( 'webglcontextlost', onContextLost )
	watchedDevice?.removeEventListener( 'uncapturederror', onError )
	dispose()
} )
</script>

<style lang="stylus">
// Each app sets its own page background on :root, the color its scene opens on.
:root
	--sait env(safe-area-inset-top, 0px)
	--saib env(safe-area-inset-bottom, 0px)
	--sail env(safe-area-inset-left, 0px)
	--sair env(safe-area-inset-right, 0px)
	font-family 'Inter', system-ui, -apple-system, sans-serif
	color #f4f5f7
	-webkit-font-smoothing antialiased

html, body, #app, .Standalone
	width 100%
	height 100%
	margin 0
	overflow hidden

html
	touch-action none

.three
	position absolute
	inset 0
	z-index -1

// Until the first complete frame, the canvas only has part of the scene (fastStart.js),
// and the page is the loader's black, edges included.
html:not([data-ready])
	background #0e0d0b
	.three, body > .DemoHint, body > .DemoControls
		visibility hidden

// Same pill as the demo HUDs and the demo site's corner button.
.Standalone__pill
	position fixed
	top calc(18px + var(--sait))
	z-index 30
	box-sizing border-box
	display inline-flex
	align-items center
	gap 6px
	min-height 40px
	padding 4px 15px
	border-radius 999px
	background rgba(8, 9, 12, 0.7)
	border 1px solid rgba(255, 255, 255, 0.1)
	box-shadow 0 12px 30px rgba(0, 0, 0, 0.3)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	color rgba(244, 245, 247, 0.78)
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	letter-spacing -0.01em
	white-space nowrap
	user-select none

	a
		color inherit
		text-decoration none

.Standalone__brand
	left calc(18px + var(--sail))
	color #ffffff
	font-weight 600
	text-decoration none
	transition border-color 0.16s ease

	b
		font-weight 700

	.Standalone__label
		display inline-flex
		align-items center
		gap 6px
		transition opacity 0.18s ease

	.Standalone__tag
		padding 3px 7px
		border-radius 999px
		background rgba(255, 255, 255, 0.12)
		color rgba(244, 245, 247, 0.78)
		font-size 10px
		font-weight 600
		letter-spacing 0.04em
		text-transform uppercase

	// Over the label, so the pill keeps its width.
	.Standalone__soon
		position absolute
		inset 0
		display grid
		place-items center
		font-weight 700
		letter-spacing 0.16em
		text-transform uppercase
		opacity 0
		transition opacity 0.18s ease
		pointer-events none

	&.is-teasing
		.Standalone__label
			opacity 0

		.Standalone__soon
			opacity 1

	&:hover,
	&:focus-visible
		border-color rgba(255, 255, 255, 0.24)
		outline none

.Standalone__author
	right calc(18px + var(--sair))
	gap 2px
	padding-right 6px

	.Standalone__by
		margin-right 6px

	a
		display grid
		place-items center
		width 28px
		height 28px
		border-radius 999px
		transition background 0.16s ease, color 0.16s ease

		&:hover,
		&:focus-visible
			background rgba(255, 255, 255, 0.12)
			color #ffffff
			outline none

	svg
		width 14px
		height 14px
		fill currentColor

// The loader (index.html, loader.js), as the ultra-msdf-threejs gallery's: a hairline that fills
// over a tracked label and a figure, in its gold on its near-black, centred over the whole page.
// It takes the clicks until it fades, so nothing hidden under it can be hit.
.StandaloneLoader
	position fixed
	inset 0
	z-index 40
	display grid
	place-content center
	grid-template-columns unquote( 'min(280px, calc(100% - 48px))' )
	gap 11px
	background #0e0d0b
	color #c6a876
	&.is-done
		pointer-events none

.StandaloneLoader__line
	position relative
	height 1px
	overflow hidden
	// The track: the gold, faint.
	&::before
		content ''
		position absolute
		inset 0
		background currentcolor
		opacity 0.26
	> i
		position absolute
		inset 0
		background currentcolor
		transform scaleX(0)
		transform-origin 0 50%
		transition transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1)
	// A glint keeps a long shader wait visibly alive, without inventing progress.
	&::after
		content ''
		position absolute
		inset 0
		background linear-gradient(90deg, transparent 38%, currentcolor 50%, transparent 62%)
		opacity 0.7
		animation loader-glint 1.6s linear infinite
		will-change transform

.StandaloneLoader.is-done .StandaloneLoader__line::after
	display none

@keyframes loader-glint
	from
		transform translateX(-60%)
	to
		transform translateX(60%)

.StandaloneLoader__status
	display flex
	justify-content center
	gap 0.5em
	font 500 9.5px/1 'Helvetica Neue', Helvetica, Arial, sans-serif
	letter-spacing 0.46em
	text-transform uppercase
	white-space nowrap
	> span
		color #9c9589
	// Three tracked digits reserved: 9, 10 and 100 never shift the label.
	> b
		min-width calc(3ch + 0.6em)
		font-weight 500
		letter-spacing 0.2em
		text-align right
		font-variant-numeric tabular-nums

@media (prefers-reduced-motion: reduce)
	.StandaloneLoader__line::after
		display none

.Standalone__failure
	position fixed
	left 50%
	top 50%
	transform translate(-50%, -50%)
	box-sizing border-box
	width unquote( 'min(560px, calc(100vw - 32px))' )
	max-height calc(100vh - 32px)
	overflow auto
	padding 28px
	border-radius 18px
	background #141a20
	box-shadow 0 20px 80px rgba(0, 0, 0, 0.3)
	line-height 1.5

	h1
		margin-top 0
		line-height 1.15

	details
		margin 18px 0

	code
		display block
		margin-top 8px
		overflow-wrap anywhere

	button
		padding 10px 16px
		border 0
		border-radius 999px
		font inherit
		cursor pointer

@media (max-width: 640px)
	.Standalone__pill
		top calc(12px + var(--sait))
		min-height 34px
		padding 4px 11px
		font-size 11px

	.Standalone__brand
		left calc(12px + var(--sail))

		span
			padding 2px 6px
			font-size 9px

	.Standalone__author
		right calc(12px + var(--sair))
		padding-right 4px

		.Standalone__by
			margin-right 2px

		a
			width 24px
			height 24px
</style>

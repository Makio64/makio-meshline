<template>
	<div class="ExampleView view">
		<section v-if="failure" class="DemoFailure" role="alert" aria-live="assertive">
			<div class="DemoFailure__card">
				<span class="DemoFailure__eyebrow">{{ failure.eyebrow }}</span>
				<h1>{{ failure.title }}</h1>
				<p class="DemoFailure__summary">{{ failure.summary }}</p>
				<ul>
					<li v-for="guidance in failure.guidance" :key="guidance">{{ guidance }}</li>
				</ul>
				<details>
					<summary>Technical details</summary>
					<code>{{ failure.detail }}</code>
				</details>
				<div class="DemoFailure__actions">
					<button type="button" @click="reloadDemo">Reload demo</button>
					<button type="button" class="secondary" @click="openExamples">Browse examples</button>
				</div>
			</div>
		</section>
		<template v-else>
			<div v-if="text" class="instruction" v-html="text" />
			<component :is="example && example.uiComponent" v-if="example && example.uiComponent" :api="example" class="bottom" />
		</template>
		<CodeButton v-if="codeUrl" :href="codeUrl" />
	</div></template>

<script>
import { markRaw } from 'vue'

import { resolveDemoMeta } from '@/demoMeta'
import stage3d from '@/makio/three/stage3d'
import { contentLoaded, menuOpen } from '@/store'
import { describeDemoFailure } from '@/utils/demoFailure'

export default {
	name: 'ExampleView',
	data: function() {
		return {
			text: '',
			example: null,
			codeUrl: '',
			failure: null,
			isUnmounting: false,
			isInitialized: false,
			hasDisposed: false,
			watchedCanvas: null,
			watchedDevice: null,
			deviceWatchToken: null,
		}
	},
	async mounted() {
		this.installGlobalFailureSignals()
		const id = this.$router.params.id
		const demo = resolveDemoMeta( id ) || resolveDemoMeta( 'basic' )
		if ( !demo?.load ) {
			this.presentFailure( 'load', new Error( `No demo module registered for "${id}"` ) )
			return
		}

		const sourcePath = demo.sourcePath || `demo/src/demos/${demo.sourceFile}`
		this.codeUrl = `https://github.com/Makio64/makio-meshline/blob/main/${sourcePath}`

		let module
		try {
			module = await demo.load()
		} catch ( error ) {
			this.presentFailure( 'load', error )
			return
		}
		if ( this.isUnmounting ) return

		try {
			// Opt out of Vue reactivity: Three.js caches geometries/materials in internal
			// WeakMaps, and a deep-reactive demo would double-insert raw+proxy versions.
			const Demo = module.default
			if ( typeof Demo !== 'function' ) throw new Error( `Demo "${demo.id}" must export a class` )
			this.example = markRaw( new Demo() )
			await this.example.init()
			if ( this.isUnmounting ) {
				this.disposeExample()
				return
			}
			this.isInitialized = true
			this.bindRendererFailureSignals()
		} catch ( error ) {
			this.presentFailure( 'init', error )
			return
		}

		this.text = this.example.text || ''
		contentLoaded.value = true
		this.transitionIn()
	},
	beforeUnmount() {
		this.isUnmounting = true
		this.removeGlobalFailureSignals()
		this.removeRendererFailureSignals()
		this.disposeExample()
	},
	methods: {
		installGlobalFailureSignals() {
			window.addEventListener( 'error', this.onWindowError )
			window.addEventListener( 'unhandledrejection', this.onUnhandledRejection )
		},
		removeGlobalFailureSignals() {
			window.removeEventListener( 'error', this.onWindowError )
			window.removeEventListener( 'unhandledrejection', this.onUnhandledRejection )
		},
		bindRendererFailureSignals() {
			this.removeRendererFailureSignals()

			this.watchedCanvas = stage3d.renderer?.domElement || null
			this.watchedCanvas?.addEventListener( 'webglcontextlost', this.onWebGLContextLost )

			this.watchedDevice = stage3d.renderer?.backend?.device || null
			this.watchedDevice?.addEventListener?.( 'uncapturederror', this.onGPUUncapturedError )

			if ( this.watchedDevice?.lost ) {
				const token = {}
				this.deviceWatchToken = token
				this.watchedDevice.lost.then( info => {
					if ( this.deviceWatchToken !== token || this.isUnmounting || info?.reason === 'destroyed' ) return
					const reason = info?.message || info?.reason || 'The GPU device was lost.'
					this.presentFailure( 'render', new Error( reason ) )
				} )
			}
		},
		removeRendererFailureSignals() {
			this.watchedCanvas?.removeEventListener( 'webglcontextlost', this.onWebGLContextLost )
			this.watchedDevice?.removeEventListener?.( 'uncapturederror', this.onGPUUncapturedError )
			this.watchedCanvas = null
			this.watchedDevice = null
			this.deviceWatchToken = null
		},
		onWindowError( event ) {
			const error = event.error || event.message || 'A required demo asset failed to load.'
			const phase = this.isInitialized ? 'render' : this.example ? 'init' : 'load'
			this.presentFailure( phase, error )
		},
		onUnhandledRejection( event ) {
			const phase = this.isInitialized ? 'render' : this.example ? 'init' : 'load'
			this.presentFailure( phase, event.reason || 'An asynchronous demo task failed.' )
		},
		onWebGLContextLost( event ) {
			event.preventDefault()
			this.presentFailure( 'render', new Error( 'The WebGL rendering context was lost.' ) )
		},
		onGPUUncapturedError( event ) {
			this.presentFailure( 'render', event.error || new Error( 'The GPU reported an uncaptured validation error.' ) )
		},
		presentFailure( phase, error ) {
			if ( this.isUnmounting || this.failure ) return

			console.error( `[meshline demo] ${phase} failure`, error )
			this.failure = describeDemoFailure( phase, error, stage3d.backend )
			this.text = ''
			contentLoaded.value = true
			this.removeRendererFailureSignals()
			this.disposeExample()
		},
		disposeExample() {
			if ( !this.example || this.hasDisposed ) return
			try {
				this.example.dispose?.()
			} catch ( error ) {
				console.error( '[meshline demo] Failed to clean up the demo after an error:', error )
			}
			this.hasDisposed = true
			this.isInitialized = false
		},
		reloadDemo() {
			window.location.reload()
		},
		openExamples() {
			if ( new URL( window.location.href ).searchParams.has( 'noUI' ) ) {
				window.location.assign( '/examples/basic' )
				return
			}
			menuOpen.value = true
		},
		transitionIn() {
			this.example?.show?.()
		},
		transitionOut( cb ) {
			if ( this.example?.hide ) this.example.hide( cb )
			else cb?.()
		},
	},
}
</script>

<style lang="stylus" scoped>
.ExampleView
	.title
		font-size 3rem
	.subtitle
		font-size 1.5rem
	.bottom
		position absolute
		bottom 10px
	.instruction
		user-select none
		pointer-events none

.DemoFailure
	position fixed
	inset 0
	z-index 2000
	box-sizing border-box
	display grid
	place-items center
	padding calc(72px + var(--sait, 0px)) calc(18px + var(--sair, 0px)) calc(72px + var(--saib, 0px)) calc(18px + var(--sail, 0px))
	overflow auto
	background radial-gradient(circle at 50% 35%, rgba(24, 38, 58, 0.96), rgba(3, 6, 12, 0.98) 72%)
	color #f8fafc
	text-align left

.DemoFailure__card
	box-sizing border-box
	width min(100%, 620px)
	padding clamp(22px, 5vw, 38px)
	border 1px solid rgba(148, 163, 184, 0.22)
	border-radius 20px
	background rgba(7, 12, 22, 0.82)
	box-shadow 0 28px 90px rgba(0, 0, 0, 0.42)
	backdrop-filter blur(16px)

	h1
		margin 8px 0 12px
		font-size clamp(26px, 5vw, 42px)
		line-height 1.05
		letter-spacing -0.035em

	ul
		margin 18px 0
		padding-left 20px
		color rgba(226, 232, 240, 0.78)
		font-size 14px
		line-height 1.55

	li + li
		margin-top 7px

	details
		margin-top 18px
		padding 11px 13px
		border 1px solid rgba(148, 163, 184, 0.15)
		border-radius 10px
		background rgba(15, 23, 42, 0.58)
		color rgba(226, 232, 240, 0.7)
		font-size 12px

	summary
		cursor pointer
		font-weight 650

	code
		display block
		margin-top 10px
		font-family 'Roboto Mono', monospace
		line-height 1.5
		overflow-wrap anywhere

.DemoFailure__eyebrow
	display block
	color #7dd3fc
	font-size 11px
	font-weight 750
	letter-spacing 0.13em
	text-transform uppercase

.DemoFailure__summary
	margin 0
	color rgba(241, 245, 249, 0.84)
	font-size clamp(15px, 2vw, 17px)
	line-height 1.5

.DemoFailure__actions
	display flex
	flex-wrap wrap
	gap 10px
	margin-top 22px

	button
		min-height 42px
		padding 0 17px
		border 1px solid rgba(125, 211, 252, 0.45)
		border-radius 11px
		background #e0f2fe
		color #082f49
		font 700 13px/1 system-ui, sans-serif
		cursor pointer

		&.secondary
			background rgba(30, 41, 59, 0.65)
			color #e2e8f0
			border-color rgba(148, 163, 184, 0.28)

		&:focus-visible
			outline 2px solid #38bdf8
			outline-offset 3px
</style>

<template>
	<div class="view">
		<TinyRouter v-if="basicLoaded" :routes="routes" :redirects="redirects" />
		<BurgerButton v-if="!hideMenu" color="white" spacing="10" />
		<MenuFullscreen v-if="!hideMenu" />
	</div>
</template>

<script>
import { engine } from 'animejs'
import { defineAsyncComponent, markRaw } from 'vue'
import { TinyRouter } from 'vue-tiny-router'
import { loadTranslations } from 'vue-tiny-translation'

import { contentLoaded, menuOpen } from '@/store'

import { detectLang } from './makio/utils/detect'
engine.timeUnit = 's'

const ExampleView = markRaw( defineAsyncComponent( () => import( '@/ExampleView' ) ) )

const VISITED_KEY = 'meshline-demo-visited'

// True only the first time this browser opens the demo site.
const isFirstVisit = () => {
	try {
		if ( localStorage.getItem( VISITED_KEY ) ) return false
		localStorage.setItem( VISITED_KEY, '1' )
		return true
	} catch {
		return false
	}
}

export default {
	name: 'App',
	data() {
		return {
			basicLoaded: false,
			// `/` redirects to the first demo; deep links skip the welcome gallery.
			landedOnRoot: window.location.pathname === '/',
		}
	},
	watch: {
		contentLoaded( loaded ) {
			if ( loaded && this.landedOnRoot && !this.hideMenu && isFirstVisit() ) menuOpen.value = true
		},
	},
	computed: {
		hideMenu() {
			return new URL( location.href ).searchParams.has( 'noUI' )
		},
		routes() {
			return [
				{
					path: '/examples/:id',
					component: ExampleView,
				},
			]
		},
		redirects() {
			return {
				'/': '/examples/basic'
			}
		},
		contentLoaded() {
			return contentLoaded.value
		},
	},
	async mounted() {
		await loadTranslations( '/translations/' + detectLang( ['en', 'fr'] ) + '.json' )
		this.basicLoaded = true
	},
	components: {
		TinyRouter
	}
}
</script>

<style lang="stylus">

:root {
	// Safe Area Inset sent by Webview Custom Code (Android & iOS)
  --webviewt: var(--android-safe-area-inset-top, var(--ios-safe-area-inset-top))
  --webviewb: var(--android-safe-area-inset-bottom, var(--ios-safe-area-inset-bottom))
  --webviewl: var(--android-safe-area-inset-left, var(--ios-safe-area-inset-left))
  --webviewr: var(--android-safe-area-inset-right, var(--ios-safe-area-inset-right))

  --sait: var(--webviewt, env(safe-area-inset-top))
  --saib: var(--webviewb, env(safe-area-inset-bottom))
  --sail: var(--webviewl, env(safe-area-inset-left))
  --sair: var(--webviewr, env(safe-area-inset-right))
}

body, html, #app
	// user-select none
	height 100%
	min-height 100%
	margin 0
	padding 0
	overflow hidden
	scroll-behavior smooth
	@media screen and (prefers-reduced-motion: reduce)
		scroll-behavior: auto

html
	touch-action none // Disable Pinch Zoom
	-webkit-font-smoothing antialiased
	-moz-osx-font-smoothing grayscale
	text-align center
	background #000
	font-family 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif

	.view
		color #fff
		display flex
		min-height 100%
		flex-direction column
		justify-content center
		align-items center

	.loader
		user-select none
		pointer-events none
		position absolute
		z-index 10000
		top calc(50% - 37px)
		left calc(50% - 37px)
		transition all 1.5s ease
		&.hide
			transform scale(1.2)
			opacity 0

	.three
		position absolute
		inset 0
		z-index -1
</style>

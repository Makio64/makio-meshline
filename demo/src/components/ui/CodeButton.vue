<template>
	<nav
		class="CodeButton"
		:class="{ 'is-telling': telling }"
		aria-label="Demo navigation and source"
	>
		<div
			v-if="current"
			class="CodeButton-center"
			@pointerenter="tell( true )"
			@pointerleave="tell( false )"
			@focusin="tell( true )"
			@focusout="tell( false )"
		>
			<p class="CodeButton-about">{{ current.blurb }}</p>
			<div class="CodeButton-bar">
				<a
					v-if="prevDemo"
					class="CodeButton-nav"
					:href="`/examples/${prevDemo.id}`"
					:title="`Previous: ${prevDemo.title} (←)`"
					:aria-label="`Previous demo: ${prevDemo.title}`"
				>‹</a>
				<button
					type="button"
					class="CodeButton-title"
					:title="browseTitle"
					@click="openMenu"
				>
					<span class="CodeButton-titleText">{{ current.title }}</span>
				</button>
				<a
					v-if="nextDemo"
					class="CodeButton-nav"
					:href="`/examples/${nextDemo.id}`"
					:title="`Next: ${nextDemo.title} (→)`"
					:aria-label="`Next demo: ${nextDemo.title}`"
				>›</a>
			</div>
		</div>
		<a
			class="CodeButton-source"
			:href="href"
			target="_blank"
			rel="noopener noreferrer"
			:title="title"
			:aria-label="title"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path fill="none" d="M0 0h24v24H0V0z" />
				<path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z" />
			</svg>
			<span class="CodeButton-sourceLabel">Code</span>
		</a>
	</nav>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { demoSections } from '@/demoCatalog'
import { menuDemoMeta, resolveDemoMeta } from '@/demoMeta'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

defineProps( {
	href: { type: String, required: true },
	title: { type: String, default: 'View source code' },
} )

// Every demo navigation reloads the page, so the route is read once.
const routeId = window.location.pathname.split( '/' ).filter( Boolean ).at( -1 ) || 'basic'
const current = resolveDemoMeta( routeId ) || resolveDemoMeta( 'basic' )
const index = menuDemoMeta.findIndex( demo => demo.id === current?.id )
const neighbour = step => index < 0 ? null : menuDemoMeta[( index + step + menuDemoMeta.length ) % menuDemoMeta.length]
const prevDemo = neighbour( -1 )
const nextDemo = neighbour( 1 )
const section = demoSections.find( item => item.id === current?.section )
const browseTitle = index >= 0
	? `${section.title} · ${index + 1} / ${menuDemoMeta.length} · browse all demos (M)`
	: 'Browse all demos (M)'

// The caption says what the demo shows: on arrival, then whenever the bar is hovered or focused.
const INTRO_MS = 6000
const telling = ref( true )
let introTimer = 0
let hovering = false

const tell = on => {
	hovering = on
	if ( on ) telling.value = true
	else if ( !introTimer ) telling.value = false
}

const openMenu = () => {
	menuOpen.value = true
}

const onKey = ( key, event ) => {
	if ( menuOpen.value || event?.metaKey || event?.ctrlKey || event?.altKey || event?.shiftKey ) return
	const target = event?.target
	if ( ['INPUT', 'TEXTAREA', 'SELECT'].includes( target?.tagName ) || target?.isContentEditable ) return
	const demo = key === 'ArrowLeft' ? prevDemo : key === 'ArrowRight' ? nextDemo : null
	if ( !demo ) return
	event?.preventDefault()
	window.location.assign( `/examples/${demo.id}` )
}

onMounted( () => {
	keyboard.onDown.add( onKey )
	introTimer = window.setTimeout( () => {
		introTimer = 0
		if ( !hovering ) telling.value = false
	}, INTRO_MS )
} )

onBeforeUnmount( () => {
	keyboard.onDown.remove( onKey )
	window.clearTimeout( introTimer )
} )
</script>

<style lang="stylus" scoped>
.CodeButton
	color rgba( 244, 245, 247, 0.86 )
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	user-select none

.CodeButton-center
	position fixed
	z-index 1000
	left 50%
	bottom calc( 18px + var( --saib, 0px ) )
	transform translateX( -50% )
	display flex
	flex-direction column
	align-items center
	gap 8px
	max-width calc( 100vw - 36px )
	pointer-events none

.CodeButton-about
	box-sizing border-box
	max-width 360px
	margin 0
	padding 8px 12px
	border-radius 10px
	background rgba( 8, 9, 12, 0.66 )
	backdrop-filter blur( 12px )
	-webkit-backdrop-filter blur( 12px )
	color rgba( 244, 245, 247, 0.76 )
	font 400 12px/1.45 'Inter', system-ui, -apple-system, sans-serif
	text-align center
	opacity 0
	transform translateY( 4px )
	transition opacity 0.35s ease, transform 0.35s ease

.is-telling .CodeButton-about
	opacity 1
	transform none

.CodeButton-bar
	display inline-flex
	align-items center
	gap 2px
	padding 4px 6px
	border-radius 999px
	background rgba( 8, 9, 12, 0.7 )
	border 1px solid rgba( 255, 255, 255, 0.1 )
	box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
	backdrop-filter blur( 14px )
	-webkit-backdrop-filter blur( 14px )
	pointer-events auto

.CodeButton-nav,
.CodeButton-title
	display inline-flex
	align-items center
	justify-content center
	gap 5px
	min-height 30px
	padding 0 9px
	border 0
	border-radius 999px
	background transparent
	color rgba( 244, 245, 247, 0.72 )
	font inherit
	text-decoration none
	cursor pointer
	transition background 0.16s ease, color 0.16s ease

	&:hover,
	&:focus-visible
		background rgba( 255, 255, 255, 0.1 )
		color #ffffff
		outline none

.CodeButton-nav
	min-width 28px
	padding 0 7px
	font-size 16px
	line-height 1

.CodeButton-title
	max-width 200px
	color rgba( 244, 245, 247, 0.92 )

.CodeButton-titleText
	overflow hidden
	text-overflow ellipsis
	white-space nowrap

.CodeButton-source
	position fixed
	z-index 1000
	bottom calc( 18px + var( --saib, 0px ) )
	right calc( 18px + var( --sair, 0px ) )
	box-sizing border-box
	display inline-flex
	align-items center
	justify-content center
	gap 5px
	min-height 40px
	padding 4px 13px
	border-radius 999px
	background rgba( 8, 9, 12, 0.7 )
	border 1px solid rgba( 255, 255, 255, 0.1 )
	box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
	backdrop-filter blur( 14px )
	-webkit-backdrop-filter blur( 14px )
	color rgba( 244, 245, 247, 0.78 )
	font inherit
	text-decoration none
	cursor pointer
	pointer-events auto
	transition background 0.16s ease, border-color 0.16s ease, color 0.16s ease

	&:hover,
	&:focus-visible
		background rgba( 20, 23, 32, 0.86 )
		border-color rgba( 255, 255, 255, 0.24 )
		color #ffffff
		outline none

@media (max-width: 640px)
	.CodeButton-center
		bottom calc( 12px + var( --saib, 0px ) )
		max-width calc( 100vw - 112px )

	.CodeButton-about
		max-width 240px
		font-size 11.5px

	.CodeButton-bar
		padding 3px 5px

	.CodeButton-title
		max-width 128px
		padding 0 7px

	.CodeButton-source
		bottom calc( 12px + var( --saib, 0px ) )
		right calc( 12px + var( --sair, 0px ) )
		width 38px
		min-height 38px
		padding 0

	.CodeButton-sourceLabel
		display none

@media (prefers-reduced-motion: reduce)
	.CodeButton-about,
	.CodeButton-nav,
	.CodeButton-title,
	.CodeButton-source
		transition none
</style>

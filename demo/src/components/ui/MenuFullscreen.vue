<template>
	<div
		id="examples-menu"
		ref="root"
		class="MenuFullscreen"
		:class="{ open: isOpen }"
		:aria-hidden="!isOpen"
		:inert="!isOpen"
		aria-labelledby="examples-menu-title"
		aria-modal="true"
		role="dialog"
		@click.self="close"
		@keydown="onMenuKeyDown"
		@wheel.stop
		@touchmove.stop
		@pointerdown.stop
		@pointermove.stop
	>
		<aside ref="panel" class="panel">
			<header ref="menuHeader" class="header">
				<h1 id="examples-menu-title" class="title">Makio MeshLine</h1>
				<input
					id="examples-search"
					ref="search"
					v-model="query"
					class="search"
					type="search"
					placeholder="Search… (/)"
					aria-label="Search demos or APIs"
					autocomplete="off"
					spellcheck="false"
				>
			</header>

			<main class="content" aria-label="Example gallery">
				<section
					v-for="section in sections"
					v-show="sectionMatches( section )"
					:key="section.id"
					class="section"
					:aria-labelledby="`examples-section-${section.id}`"
				>
					<h2 :id="`examples-section-${section.id}`" ref="sectionTitle">{{ section.title }}</h2>
					<div class="cards">
						<a
							v-for="demo in section.demos"
							v-show="demoMatches( demo, section )"
							:key="demo.id"
							ref="link"
							class="card"
							:class="{ active: demo.id === currentId, unavailable: needsWebGPU( demo ) }"
							:href="`/examples/${demo.id}`"
							:data-demo-id="demo.id"
							:aria-current="demo.id === currentId ? 'page' : undefined"
							:aria-label="`${demo.title}: ${demo.blurb}`"
							@click="close"
							@pointerenter="hovered = demo"
							@focus="hovered = demo"
						>
							<img :src="`/thumbs/${demo.id}.webp`" alt="" width="640" height="400" loading="lazy" decoding="async">
							<span v-if="needsWebGPU( demo )" class="tag">WebGPU</span>
							<span class="name">{{ demo.title }}</span>
						</a>
					</div>
				</section>
				<p v-if="!hasMatches" class="empty">No demo matches “{{ query.trim() }}”. Try dash, instances or webgpu.</p>
			</main>

			<footer ref="footer" class="footer">
				<p class="detail" aria-live="polite">
					<template v-if="detailDemo">
						<b>{{ detailDemo.title }}</b>
						<span>{{ detailDemo.subtitle }}</span>
					</template>
				</p>
				<nav aria-label="Project links">
					<a href="https://meshline.makio.io" target="_blank" rel="noopener">Docs</a>
					<a href="https://github.com/Makio64/makio-meshline" target="_blank" rel="noopener">GitHub</a>
					<a href="https://x.com/makio64" target="_blank" rel="noopener">@Makio64</a>
				</nav>
			</footer>
		</aside>
	</div>
</template>

<script>
import { animate, stagger, utils } from 'animejs'

import { menuSections, resolveDemoMeta } from '@/demoMeta'
import stage3d from '@/makio/three/stage3d'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const currentDemoId = () => {
	const id = window.location.pathname.split( '/' ).filter( Boolean ).at( -1 ) || 'basic'
	return resolveDemoMeta( id )?.id || 'basic'
}

const isTyping = target => ['INPUT', 'TEXTAREA', 'SELECT'].includes( target?.tagName ) || target?.isContentEditable

export default {
	name: 'MenuFullscreen',
	data() {
		return {
			sections: menuSections,
			currentId: currentDemoId(),
			query: '',
			hovered: null,
			webgl2: false,
		}
	},
	computed: {
		isOpen() {
			return menuOpen.value
		},
		needle() {
			return this.query.trim().toLowerCase()
		},
		hasMatches() {
			return this.sections.some( section => this.sectionMatches( section ) )
		},
		detailDemo() {
			return this.hovered || resolveDemoMeta( this.currentId )
		},
	},
	methods: {
		demoMatches( demo, section ) {
			if ( !this.needle ) return true
			const text = `${demo.title} ${demo.subtitle} ${demo.blurb} ${demo.apis.join( ' ' )} ${demo.id} ${section.title} ${demo.requires || ''}`
			return text.toLowerCase().includes( this.needle )
		},
		sectionMatches( section ) {
			return section.demos.some( demo => this.demoMatches( demo, section ) )
		},
		needsWebGPU( demo ) {
			return this.webgl2 && demo.requires === 'webgpu'
		},
		close() {
			menuOpen.value = false
		},
		stopAnimations() {
			const { root, panel, link, sectionTitle, footer, menuHeader } = this.$refs
			const targets = [root, panel, menuHeader, link, sectionTitle, footer]
			targets.forEach( target => utils.remove( target ) )
		},
		prefersReducedMotion() {
			return window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
		},
		focusCurrentLink() {
			const links = this.$refs.link || []
			const target = links.find( link => link.dataset.demoId === this.currentId ) || links[0]
			target?.focus( { preventScroll: true } )
			target?.scrollIntoView( { block: 'nearest' } )
		},
		focusMenuButton() {
			document.querySelector( '.BurgerButton' )?.focus( { preventScroll: true } )
		},
		show() {
			const { root, panel, footer, menuHeader } = this.$refs
			const links = this.$refs.link || []
			const titles = this.$refs.sectionTitle || []
			this.currentId = currentDemoId()
			this.query = ''
			this.hovered = null
			this.webgl2 = stage3d.backend === 'webgl2'
			this.stopAnimations()

			root.style.pointerEvents = 'all'
			root.style.visibility = 'visible'

			if ( this.prefersReducedMotion() ) {
				utils.set( [root, panel, menuHeader, footer, ...titles], { opacity: 1, x: 0 } )
				utils.set( links, { opacity: 1, y: 0 } )
				this.$nextTick( this.focusCurrentLink )
				return
			}

			utils.set( [menuHeader, footer, ...titles], { opacity: 0 } )
			utils.set( links, { opacity: 0, y: 5 } )

			animate( root, { opacity: [0, 1], duration: 0.2, ease: 'outQuad' } )
			animate( panel, { opacity: [0, 1], x: [24, 0], duration: 0.3, ease: 'outExpo' } )
			animate( [menuHeader, footer], { opacity: [0, 1], duration: 0.32, delay: 0.04, ease: 'outQuad' } )
			animate( titles, { opacity: [0, 1], delay: stagger( 0.03, { start: 0.05 } ), duration: 0.32, ease: 'outQuad' } )
			animate( links, {
				opacity: [0, 1],
				y: [5, 0],
				delay: stagger( 0.01, { start: 0.06 } ),
				duration: 0.38,
				ease: 'outExpo',
			} )

			this.$nextTick( this.focusCurrentLink )
		},
		hide() {
			const { root, panel } = this.$refs
			this.stopAnimations()

			const finish = () => {
				root.style.pointerEvents = 'none'
				root.style.visibility = 'hidden'
				this.focusMenuButton()
			}

			if ( this.prefersReducedMotion() ) {
				utils.set( root, { opacity: 0 } )
				finish()
				return
			}

			animate( panel, { x: 16, duration: 0.16, ease: 'inQuad' } )
			animate( root, {
				opacity: 0,
				duration: 0.16,
				ease: 'inQuad',
				onComplete: finish,
			} )
		},
		onKeyDown( key, event ) {
			if ( key === 'Escape' && this.isOpen ) {
				event?.preventDefault()
				this.close()
				return
			}
			if ( event?.metaKey || event?.ctrlKey || event?.altKey || isTyping( event?.target ) ) return

			if ( key === '/' && this.isOpen ) {
				event?.preventDefault()
				this.$refs.search?.focus()
			} else if ( key.toLowerCase() === 'm' && !this.isOpen ) {
				menuOpen.value = true
			}
		},
		onMenuKeyDown( event ) {
			if ( event.key !== 'Tab' ) return

			const focusable = [...this.$refs.root.querySelectorAll( 'input, a[href]' )]
				.filter( element => element.getClientRects().length > 0 )
			if ( focusable.length === 0 ) return

			const first = focusable[0]
			const last = focusable.at( -1 )
			if ( event.shiftKey && document.activeElement === first ) {
				event.preventDefault()
				last.focus()
			} else if ( !event.shiftKey && document.activeElement === last ) {
				event.preventDefault()
				first.focus()
			}
		},
	},
	watch: {
		isOpen( isOpen ) {
			if ( isOpen ) this.show()
			else this.hide()
		},
	},
	mounted() {
		const { root } = this.$refs
		keyboard.onDown.add( this.onKeyDown )

		if ( this.isOpen ) {
			this.$nextTick( this.show )
		} else {
			root.style.opacity = 0
			root.style.visibility = 'hidden'
			root.style.pointerEvents = 'none'
		}
	},
	beforeUnmount() {
		keyboard.onDown.remove( this.onKeyDown )
		this.stopAnimations()
	},
}
</script>

<style lang="stylus" scoped>
// Right-docked full-height glass sheet: keeps the live 3D canvas visible on the left.
.MenuFullscreen
	--ink #f4f5f7
	--ink-2 rgba(244, 245, 247, .78)
	--ink-3 rgba(244, 245, 247, .46)
	--hair rgba(255, 255, 255, .08)
	--hair-2 rgba(255, 255, 255, .16)
	z-index 9999
	position fixed
	inset 0
	height 100dvh
	display flex
	justify-content flex-end
	user-select none
	color var(--ink)
	text-align left
	background linear-gradient(90deg, rgba(4, 5, 8, .08) 0%, rgba(4, 5, 8, .38) 100%)
	opacity 0
	visibility hidden
	pointer-events none

.panel
	box-sizing border-box
	width min(100vw, 364px)
	height 100dvh
	display grid
	grid-template-rows auto minmax(0, 1fr) auto
	padding calc(12px + var(--sait, 0px)) calc(14px + var(--sair, 0px)) calc(10px + var(--saib, 0px)) 14px
	background rgba(7, 8, 12, .88)
	border-left 1px solid rgba(255, 255, 255, .1)
	box-shadow -24px 0 80px rgba(0, 0, 0, .68)
	backdrop-filter blur(22px)
	-webkit-backdrop-filter blur(22px)
	overflow hidden

.header
	box-sizing border-box
	height 44px
	display flex
	align-items center
	justify-content space-between
	gap 10px
	padding 0 52px 0 2px
	margin-bottom 6px
	border-bottom 1px solid var(--hair)

.title
	margin 0
	font 600 13.5px/1.1 'Inter', sans-serif
	letter-spacing -.015em
	color var(--ink)
	white-space nowrap

.search
	appearance none
	box-sizing border-box
	flex 0 1 148px
	min-width 0
	height 30px
	padding 0 11px
	border 1px solid var(--hair-2)
	border-radius 999px
	background rgba(255, 255, 255, .04)
	color var(--ink)
	font 400 12px 'Inter', sans-serif
	transition border-color .18s ease, flex-basis .18s ease, background .18s ease

	&::placeholder
		color var(--ink-3)

	&:focus
		flex-basis 172px
		border-color rgba(255, 255, 255, .45)
		background rgba(255, 255, 255, .07)
		outline none

.content
	min-height 0
	overflow-y auto
	overscroll-behavior contain
	touch-action pan-y
	scrollbar-width thin
	scrollbar-color var(--hair-2) transparent
	display flex
	flex-direction column
	gap 18px
	padding 10px 2px 14px

.section
	display flex
	flex-direction column
	gap 8px

	& + .section
		padding-top 14px
		border-top 1px solid rgba(255, 255, 255, .1)

	h2
		margin 0
		font 600 11px/1.2 'Inter', sans-serif
		letter-spacing .16em
		text-transform uppercase
		color rgba(244, 245, 247, .88)

.cards
	display grid
	grid-template-columns repeat(2, minmax(0, 1fr))
	gap 8px

.card
	position relative
	display block
	aspect-ratio 16 / 9
	overflow hidden
	border-radius 7px
	background #0c0e14
	color var(--ink-2)
	text-decoration none
	outline none
	box-shadow 0 0 0 1px rgba(255, 255, 255, .09)
	transition box-shadow .2s ease, color .2s ease

	&::after
		content ''
		position absolute
		inset 0
		background linear-gradient(to top, rgba(4, 5, 8, .9) 0%, rgba(4, 5, 8, .28) 52%, transparent 100%)
		pointer-events none

	img
		display block
		width 100%
		height 100%
		object-fit cover
		filter saturate(.76) brightness(.88)
		transition filter .25s ease, transform .42s cubic-bezier(.16, 1, .3, 1)

	&:hover,
	&:focus-visible
		color #fff
		box-shadow 0 0 0 1px rgba(255, 255, 255, .58)

		img
			filter none
			transform scale(1.045)

	&:focus-visible
		box-shadow 0 0 0 2px var(--ink)

	&.active
		color #fff
		box-shadow 0 0 0 1.5px var(--ink)

		img
			filter none

		.name::before
			content ''
			display inline-block
			width 5px
			height 5px
			margin-right 5px
			border-radius 50%
			background var(--ink)
			vertical-align 1.5px

	&.unavailable
		opacity .42

.tag
	position absolute
	z-index 1
	top 5px
	right 5px
	padding 2.5px 5px
	border-radius 4px
	background rgba(0, 0, 0, .74)
	color var(--ink-2)
	font 600 8.5px/1 'Inter', sans-serif
	letter-spacing .08em
	text-transform uppercase

.name
	position absolute
	z-index 1
	left 7px
	right 7px
	bottom 5px
	overflow hidden
	text-overflow ellipsis
	white-space nowrap
	font 500 11.5px/1.2 'Inter', sans-serif
	text-shadow 0 1px 3px rgba(0, 0, 0, .85)

.empty
	margin 8px 0 0
	font-size 12.5px
	color var(--ink-2)

.footer
	display flex
	align-items center
	justify-content space-between
	gap 12px
	padding 8px 2px 0
	border-top 1px solid var(--hair)

.detail
	min-width 0
	margin 0
	overflow hidden
	text-overflow ellipsis
	white-space nowrap
	font-size 11.5px
	line-height 1.35
	color var(--ink-3)

	b
		margin-right 6px
		color var(--ink)
		font-weight 500

.footer nav
	flex none
	display flex
	gap 11px

	a
		color var(--ink-3)
		font 500 11.5px 'Inter', sans-serif
		text-decoration none
		transition color .18s ease

		&:hover,
		&:focus-visible
			color var(--ink)
			outline none

@media (max-width: 520px)
	.panel
		width 100vw
		border-left 0
		padding calc(10px + var(--sait, 0px)) calc(12px + var(--sair, 0px)) calc(10px + var(--saib, 0px)) calc(12px + var(--sail, 0px))

	.header
		padding-right 46px

@media (prefers-reduced-motion: reduce)
	.search,
	.card,
	.card img,
	.footer nav a
		transition none

	.card:hover img,
	.card:focus-visible img
		transform none
</style>

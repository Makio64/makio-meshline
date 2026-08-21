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
		@keydown="onMenuKeyDown"
		@wheel.stop.prevent
		@touchmove.stop.prevent
	>
		<header ref="menuHeader" class="header">
			<div class="brand">
				<h1 id="examples-menu-title">Makio MeshLine</h1>
				<div class="header-info">
					<p class="subdesc">Wide lines, world-space ribbons and GPU paths for Three.js.</p>
					<p class="credit">
						Open source · made by
						<a class="u-link" href="https://github.com/Makio64" target="_blank" rel="noopener">Makio64</a>
					</p>
				</div>
			</div>
		</header>

		<main class="content" aria-label="Example gallery">
			<section
				v-for="group in groups"
				:key="group.id"
				:class="['demo-group', `${group.id}-group`]"
				:aria-labelledby="`${group.id}-group-title`"
			>
				<header ref="desc" class="group-header">
					<span class="group-number">{{ group.number }}</span>
					<div class="group-copy">
						<h2 :id="`${group.id}-group-title`">{{ group.title }}</h2>
						<p>{{ group.description }}</p>
					</div>
				</header>

				<div class="link-grid">
					<a
						v-for="link in group.links"
						:key="link.id"
						ref="link"
						:href="link.href"
						:title="`${link.title} — ${link.subtitle}`"
						:aria-current="link.id === currentId ? 'page' : undefined"
						:class="{ primary: link.primary, active: link.id === currentId, experimental: link.status === 'experimental' }"
						:data-demo-id="link.id"
						class="demo-link"
						@click="close"
					>
						<span class="link-copy">
							<span class="link-title">{{ link.title }}</span>
							<span class="link-subtitle">{{ link.subtitle }}</span>
						</span>
						<span v-if="link.status === 'experimental'" class="lab-label">Lab</span>
					</a>
				</div>
			</section>
		</main>

		<footer ref="footer" class="footer" aria-label="Project links">
			<nav>
				<a class="u-link" href="https://meshline.makio.io" target="_blank" rel="noopener">Documentation</a>
				<span aria-hidden="true">·</span>
				<a class="u-link" href="https://github.com/Makio64/makio-meshline" target="_blank" rel="noopener">GitHub</a>
				<span aria-hidden="true">·</span>
				<a class="u-link" href="https://x.com/makio64" target="_blank" rel="noopener">@Makio64</a>
			</nav>
			<p class="shortcuts"><kbd>M</kbd> menu <span>·</span> <kbd>Esc</kbd> close</p>
		</footer>
	</div>
</template>

<script>
import { animate, stagger, utils } from 'animejs'

import { advancedDemoMeta, basicDemoMeta, resolveDemoMeta } from '@/demoMeta'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

const makeLinks = demos => demos.map( demo => ( {
	id: demo.id,
	title: demo.title,
	subtitle: demo.subtitle,
	status: demo.status,
	primary: demo.primary,
	href: `/examples/${demo.id}`,
} ) )

const productionDemoMeta = advancedDemoMeta.filter( demo => demo.category !== 'showcase' )
const showcaseDemoMeta = advancedDemoMeta.filter( demo => demo.category === 'showcase' )

const GROUPS = [
	{
		id: 'core',
		number: '01',
		title: 'Core patterns',
		description: 'Fundamentals and focused options.',
		links: makeLinks( basicDemoMeta ),
	},
	{
		id: 'production',
		number: '02',
		title: 'Production & labs',
		description: 'Tools, GPU paths and ribbon systems.',
		links: makeLinks( productionDemoMeta ),
	},
	{
		id: 'showcase',
		number: '03',
		title: 'Showcase',
		description: 'Complete interactive scenes.',
		links: makeLinks( showcaseDemoMeta ),
	},
]

const currentDemoId = () => {
	const id = window.location.pathname.split( '/' ).filter( Boolean ).at( -1 ) || 'basic'
	return resolveDemoMeta( id )?.id || 'basic'
}

export default {
	name: 'MenuFullscreen',
	data() {
		return {
			groups: GROUPS,
			currentId: currentDemoId(),
		}
	},
	computed: {
		isOpen() {
			return menuOpen.value
		},
	},
	methods: {
		close() {
			menuOpen.value = false
		},
		stopAnimations() {
			const { root, link, desc, footer, menuHeader } = this.$refs
			const targets = [root, menuHeader, link, desc, footer]
			targets.forEach( target => utils.remove( target ) )
		},
		prefersReducedMotion() {
			return window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
		},
		focusCurrentLink() {
			const links = this.$refs.link || []
			const target = links.find( link => link.dataset.demoId === this.currentId ) || links[0]
			target?.focus( { preventScroll: true } )
		},
		focusMenuButton() {
			document.querySelector( '.BurgerButton' )?.focus( { preventScroll: true } )
		},
		show() {
			const { root, link, desc, footer, menuHeader } = this.$refs
			this.currentId = currentDemoId()
			this.stopAnimations()

			root.style.pointerEvents = 'all'
			root.style.visibility = 'visible'

			if ( this.prefersReducedMotion() ) {
				utils.set( root, { opacity: 1 } )
				utils.set( menuHeader, { opacity: 1, y: 0 } )
				utils.set( desc, { opacity: 1, y: 0 } )
				utils.set( link, { opacity: 1, y: 0, scale: 1 } )
				utils.set( footer, { opacity: 1 } )
				this.$nextTick( this.focusCurrentLink )
				return
			}

			utils.set( menuHeader, { opacity: 0, y: -8 } )
			utils.set( desc, { opacity: 0, y: 6 } )
			utils.set( link, { opacity: 0, y: 8, scale: 0.985 } )
			utils.set( footer, { opacity: 0 } )

			animate( root, {
				opacity: [0, 1],
				duration: 0.24,
				ease: 'outQuad',
			} )
			animate( menuHeader, {
				opacity: [0, 1],
				y: [-8, 0],
				duration: 0.45,
				ease: 'outExpo',
			} )
			animate( desc, {
				opacity: [0, 1],
				y: [6, 0],
				delay: stagger( 0.04, { start: 0.06 } ),
				duration: 0.42,
				ease: 'outExpo',
			} )
			animate( link, {
				y: [8, 0],
				scale: [0.985, 1],
				opacity: [0, 1],
				delay: stagger( 0.018, { start: 0.08 } ),
				duration: 0.42,
				ease: 'outExpo',
			} )
			animate( footer, {
				opacity: [0, 1],
				delay: 0.16,
				duration: 0.4,
				ease: 'outQuad',
			} )

			this.$nextTick( this.focusCurrentLink )
		},
		hide() {
			const { root, link, desc, footer, menuHeader } = this.$refs
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

			animate( root, {
				opacity: 0,
				duration: 0.2,
				ease: 'inQuad',
				onComplete: finish,
			} )
			animate( menuHeader, { opacity: 0, y: -5, duration: 0.16, ease: 'inQuad' } )
			animate( desc, { opacity: 0, duration: 0.14, ease: 'inQuad' } )
			animate( link, {
				opacity: 0,
				y: 5,
				delay: stagger( 0.004, { from: 'last' } ),
				duration: 0.16,
				ease: 'inQuad',
			} )
			animate( footer, { opacity: 0, duration: 0.12, ease: 'inQuad' } )
		},
		onKeyDown( key, event ) {
			if ( key === 'Escape' && this.isOpen ) {
				event?.preventDefault()
				this.close()
				return
			}

			const tagName = event?.target?.tagName
			const isTyping = ['INPUT', 'TEXTAREA', 'SELECT'].includes( tagName ) || event?.target?.isContentEditable
			if ( key.toLowerCase() === 'm' && !this.isOpen && !isTyping && !event?.metaKey && !event?.ctrlKey && !event?.altKey ) {
				menuOpen.value = true
			}
		},
		onMenuKeyDown( event ) {
			if ( event.key !== 'Tab' ) return

			const focusable = [...this.$refs.root.querySelectorAll( 'a[href]' )]
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
.MenuFullscreen
	z-index 9999
	position fixed
	inset 0
	height 100dvh
	box-sizing border-box
	display grid
	grid-template-rows auto minmax(0, 1fr) auto
	gap clamp(8px, 1.8vh, 20px)
	padding calc(14px + var(--sait, 0px)) calc(18px + var(--sair, 0px)) calc(12px + var(--saib, 0px)) calc(18px + var(--sail, 0px))
	overflow hidden
	overscroll-behavior none
	user-select none
	background radial-gradient(ellipse at 50% 30%, rgba(20, 24, 36, .92) 0%, rgba(0, 0, 0, .92) 70%)
	backdrop-filter blur(10px)
	opacity 0
	visibility hidden
	pointer-events none

	> *
		position relative
		z-index 1

	.header
		width min(100%, 1320px)
		margin 0 auto
		text-align center
		color white

	.brand
		display inline-block

		h1
			margin 0 auto 10px
			font-family 'Space Grotesk', 'Inter', sans-serif
			font-size clamp(26px, 3vw, 34px)
			font-weight 800
			letter-spacing -.035em
			line-height 1
			color white

	.header-info
		position relative
		padding-bottom 11px

		&::after
			content ''
			position absolute
			left 10%
			right 10%
			bottom 0
			height 2px
			border-radius 2px
			background linear-gradient(90deg, #ffd93d, #ff6b6b, #ff6bcb, #6bcbff, #4d7fff)
			opacity .9

	.subdesc
		margin 0
		font-size clamp(11px, 1vw, 14px)
		font-weight 400
		letter-spacing -.005em
		color rgba(255,255,255,.82)

	.credit
		margin 5px 0 0
		font-size 10.5px
		font-weight 400
		letter-spacing 0
		color rgba(255,255,255,.56)

	.content
		width min(100%, 1320px)
		height 100%
		min-height 0
		margin 0 auto
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		align-items start
		align-content center
		gap clamp(18px, 2.6vw, 38px)

	.demo-group
		--group-start #b8e6ce
		--group-end #d4db8c
		--group-muted #cfe0a6
		--group-border rgba(191, 231, 198, .5)
		--group-tint rgba(144, 197, 155, .12)
		--group-shadow rgba(178, 220, 169, .2)
		min-width 0
		display grid
		grid-template-rows auto auto
		gap clamp(6px, 1vh, 10px)

	.production-group
		--group-start #ff8e53
		--group-end #ff6bcb
		--group-muted #ffb0a8
		--group-border rgba(255, 123, 135, .5)
		--group-tint rgba(255, 107, 107, .11)
		--group-shadow rgba(255, 107, 150, .2)

	.showcase-group
		--group-start #b9a0ff
		--group-end #ff79bd
		--group-muted #dfb7ef
		--group-border rgba(218, 139, 235, .5)
		--group-tint rgba(178, 111, 213, .11)
		--group-shadow rgba(206, 111, 210, .2)

	.group-header
		display grid
		grid-template-columns auto minmax(0, 1fr)
		align-items center
		gap 10px
		min-width 0
		text-align left

	.group-number
		width 26px
		height 26px
		display grid
		place-items center
		border 1px solid rgba(255,255,255,.13)
		border-radius 8px
		font-size 9px
		font-weight 750
		letter-spacing .08em
		color var(--group-start)
		background rgba(255,255,255,.04)

	.group-copy
		min-width 0

		h2
			margin 0
			font-family 'Space Grotesk', 'Inter', sans-serif
			font-size clamp(13px, 1.35vw, 18px)
			font-weight 680
			letter-spacing -.02em
			line-height 1.1
			color rgba(255,255,255,.94)

		p
			margin 3px 0 0
			font-size 10px
			line-height 1.2
			color rgba(255,255,255,.42)

	.link-grid
		display grid
		grid-template-columns repeat(2, minmax(0, 1fr))
		gap clamp(5px, .65vw, 10px)

	.demo-link
		position relative
		height clamp(42px, 6.2vh, 58px)
		min-width 0
		box-sizing border-box
		display flex
		align-items center
		justify-content center
		padding 6px clamp(9px, .9vw, 14px)
		border 1px solid rgba(255,255,255,.12)
		border-radius clamp(10px, 1vw, 14px)
		color white
		text-align center
		text-decoration none
		background rgba(255,255,255,.04)
		box-shadow inset 0 1px rgba(255,255,255,.04)
		overflow hidden
		opacity 0
		transition border-color .18s ease, background .18s ease, box-shadow .18s ease

		&:hover,
		&:focus-visible
			border-color var(--group-border)
			background rgba(255,255,255,.085)
			box-shadow inset 0 1px rgba(255,255,255,.08), 0 8px 24px -12px var(--group-shadow)
			outline none

		&.active
			border-color var(--group-border)
			background linear-gradient(135deg, var(--group-tint), rgba(255,255,255,.065))
			box-shadow inset 0 0 0 1px var(--group-tint), 0 8px 24px -14px var(--group-shadow)

		&.primary
			border-color rgba(91,194,255,.42)

			.link-title
				background linear-gradient(90deg, #007cf0, #00bfff)
				-webkit-background-clip text
				-webkit-text-fill-color transparent
				background-clip text

			.link-subtitle
				color #8fd6ff

	.link-copy
		position relative
		z-index 1
		width 100%
		min-width 0
		display block

	.link-title,
	.link-subtitle
		display block
		overflow hidden
		text-overflow ellipsis
		white-space nowrap

	.link-title
		font-family 'Inter', sans-serif
		font-size clamp(10.5px, 1vw, 13.5px)
		font-weight 650
		line-height 1.15
		letter-spacing -.015em
		color var(--group-start)
		background linear-gradient(135deg, var(--group-start), var(--group-end))
		-webkit-background-clip text
		-webkit-text-fill-color transparent
		background-clip text

	.link-subtitle
		margin-top 3px
		font-size clamp(7px, .62vw, 9px)
		font-weight 650
		line-height 1
		letter-spacing .1em
		text-transform uppercase
		color var(--group-muted)

	.lab-label
		position absolute
		right 8px
		top 50%
		z-index 1
		transform translateY(-50%)
		font-size 6px
		font-weight 800
		letter-spacing .08em
		text-transform uppercase
		color var(--group-muted)
		opacity .7

	.u-link
		position relative
		color rgba(255,255,255,.82)
		font-weight 600
		text-decoration none
		transition color .18s ease

		&::after
			content ''
			position absolute
			left 0
			right 0
			bottom -3px
			height 1px
			background currentColor
			transform scaleX(0)
			transform-origin left
			transition transform .18s ease

		&:hover,
		&:focus-visible
			color white
			outline none

			&::after
				transform scaleX(1)

	.footer
		width min(100%, 1320px)
		margin 0 auto
		display flex
		align-items center
		justify-content space-between
		gap 16px
		font-size 10px
		color rgba(255,255,255,.42)

		nav,
		.shortcuts
			display flex
			align-items center
			gap 10px

		.shortcuts
			margin 0

		kbd
			min-width 19px
			box-sizing border-box
			padding 2px 5px
			border 1px solid rgba(255,255,255,.14)
			border-radius 5px
			font-family inherit
			font-size 8px
			font-weight 700
			text-align center
			color rgba(255,255,255,.72)
			background rgba(255,255,255,.055)

	@media (max-width: 900px) and (min-height: 431px)
		gap 7px
		padding calc(10px + var(--sait, 0px)) calc(9px + var(--sair, 0px)) calc(8px + var(--saib, 0px)) calc(9px + var(--sail, 0px))
		backdrop-filter blur(6px)

		.header
			display block
			width 100%

		.credit
			display none

		.brand h1
			font-size clamp(21px, 7vw, 26px)

		.subdesc
			margin-top 4px
			padding 0 44px
			font-size clamp(8.5px, 2.65vw, 11px)
			white-space nowrap
			overflow hidden
			text-overflow ellipsis

		.content
			grid-template-columns minmax(0, 1fr)
			align-content center
			gap 7px

		.demo-group
			gap 4px

		.group-header
			grid-template-columns 20px minmax(0, 1fr)
			gap 6px

		.group-number
			width 20px
			height 20px
			border-radius 6px
			font-size 7px

		.group-copy h2
			font-size 11px

		.group-copy p
			display none

		.link-grid
			grid-template-columns repeat(2, minmax(0, 1fr))
			gap 4px

		.demo-link
			height clamp(30px, 4.7dvh, 42px)
			padding 3px 7px
			border-radius 8px

		.link-title
			font-size clamp(9.5px, 2.7vw, 11px)
			white-space normal
			display -webkit-box
			-webkit-box-orient vertical
			-webkit-line-clamp 2

		.link-subtitle,
		.lab-label
			display none

		.footer
			justify-content center
			font-size 9px

			.shortcuts
				display none

			nav
				gap 8px

	@media (max-width: 900px) and (min-height: 760px) and (min-width: 360px)
		.demo-link
			height clamp(38px, 4.9dvh, 44px)

		.link-title
			white-space nowrap
			display block

		.link-subtitle
			display block
			font-size 7px

	@media (max-height: 620px) and (min-width: 540px)
		gap 6px
		padding calc(8px + var(--sait, 0px)) calc(10px + var(--sair, 0px)) calc(7px + var(--saib, 0px)) calc(10px + var(--sail, 0px))

		.header
			display block

		.credit,
		.subdesc,
		.footer
			display none

		.brand h1
			font-size 20px

		.content
			grid-template-columns repeat(3, minmax(0, 1fr))
			gap 10px

		.group-copy p
			display none

		.group-number
			width 20px
			height 20px

		.group-copy h2
			font-size 11px

		.link-grid
			grid-template-columns repeat(2, minmax(0, 1fr))

		.demo-link
			height clamp(28px, 8.5vh, 34px)
			padding 3px 5px
			border-radius 7px

		.link-title
			font-size 9px

		.link-subtitle,
		.lab-label
			display none

	@media (max-width: 539px) and (max-height: 620px)
		gap 4px
		padding calc(6px + var(--sait, 0px)) calc(6px + var(--sair, 0px)) calc(6px + var(--saib, 0px)) calc(6px + var(--sail, 0px))

		.header
			display block

		.credit,
		.subdesc,
		.footer
			display none

		.brand h1
			font-size 18px

		.content
			grid-template-columns minmax(0, 1fr)
			align-content center
			gap 4px

		.demo-group
			gap 3px

		.group-header
			grid-template-columns 16px minmax(0, 1fr)
			gap 4px

		.group-number
			width 16px
			height 16px
			border-radius 5px
			font-size 6px

		.group-copy h2
			font-size 9px

		.group-copy p
			display none

		.link-grid
			grid-template-columns repeat(2, minmax(0, 1fr))
			gap 3px

		.demo-link
			height clamp(22px, 5.5dvh, 30px)
			padding 2px 4px
			border-radius 6px

		.link-title
			display block
			font-size clamp(7.5px, 2.4vw, 9px)
			white-space nowrap

		.link-subtitle,
		.lab-label
			display none

	@media (prefers-reduced-motion: reduce)
		.demo-link,
		.u-link
			transition none
</style>

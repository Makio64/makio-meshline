<!-- Simple MenuFullscreen by @makio64 || David Ronai -->
<template>
	<div ref="root" class="MenuFullscreen" :class="{ open: isOpen }" @wheel.stop @touchmove.stop>
		<div class="header">
			<h1>Makio MeshLine</h1>
			<div class="header-info">
				<p class="subdesc">{{ subtext }}</p>
				<p class="credit">{{ isMobile ? 'Made with ❤️ by' : 'Open‑source (MIT) & made with ❤️ by' }} <a class="u-link" href="https://github.com/Makio64" target="_blank" rel="noopener">Makio64</a>. 
					<!-- Contribute on <a class="u-link" href="https://github.com/Makio64/makio-meshline" target="_blank" rel="noopener">GitHub</a>. -->
				</p>
			</div>
		</div>
		<div class="content">
			<div class="column">
				<p ref="desc" class="desc basic-desc">Simple example</p>
				<a v-for="link in basicLinks" :key="link.id" ref="link" :href="link.href" class="basic-link" @click="close">
					<span class="link-title">{{ link.title }}</span>
					<span class="link-subtitle">{{ link.subtitle }}</span>
				</a>
			</div>
			<div class="column">
				<p ref="desc" class="desc advanced-desc">Advanced demo</p>
				<a v-for="link in advancedLinks" :key="link.id" ref="link" :href="link.href" :class="{ primary: link.primary, 'advanced-link': !link.primary }" @click="close">
					<span class="link-title">{{ link.title }}</span>
					<span class="link-subtitle">{{ link.subtitle }}</span>
				</a>
			</div>
		</div>
		<div ref="footer" class="footer">
			<a class="u-link" href="https://meshline.makio.io" target="_blank" rel="noopener">Full documentation & API</a>
			<span>·</span>
			<a class="u-link" href="https://github.com/Makio64/makio-meshline" target="_blank" rel="noopener">makio-meshline GitHub</a>
			<span>·</span>
			<a class="u-link" href="https://x.com/makio64" target="_blank" rel="noopener">@Makio64</a>
		</div>
	</div>
</template>

<script>
import { animate, stagger, utils } from 'animejs'

import { advancedDemoMeta, basicDemoMeta } from '@/demoMeta'
import { isMobile } from '@/makio/utils/detect'
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

export default {
	name: 'MenuFullscreen',
	data() {
		return {
			basicLinks: basicDemoMeta.map( demo => ( {
				...demo,
				href: `/examples/${demo.id}`
			} ) ),
			advancedLinks: advancedDemoMeta.map( demo => ( {
				...demo,
				href: `/examples/${demo.id}`
			} ) ),
		}
	},
	computed: {
		isOpen() {
			return menuOpen.value
		},
		subtext() {
			return isMobile ? 'Performant TSL Meshline for Three.js.' : 'A modern, performant TSL‑powered meshline for Three.js.'
		},
		isMobile() {
			return isMobile
		}
	},
	methods: {
		close() {
			menuOpen.value = false
		},
		show() {
			const { root, link, desc, footer } = this.$refs
			utils.remove( root )
			utils.remove( link )
			utils.remove( desc )
			utils.remove( footer )
			animate( root, { opacity: [0, 1], duration: 0.3, ease: 'outExpo',
				onBegin: () => {
					root.style.pointerEvents = 'all'
					root.style.visibility = 'visible'
				},
			} )
			utils.set( desc, { opacity: 0 } )
			utils.set( link, { opacity: 0, y: 14, scale: 0.96 } )
			utils.set( footer, { opacity: 0 } )
			animate( desc, {
				opacity: [0, 1],
				delay: stagger( 0.04, { start: 0.1 } ),
				duration: 0.8,
				ease: 'outExpo',
			} )
			animate( link, {
				y: [14, 0],
				scale: [0.96, 1],
				opacity: [0, 1],
				delay: stagger( 0.05, { start: 0.1 } ),
				duration: 0.8,
				ease: 'outExpo',
			} )
			animate( footer, {
				opacity: [0, 1],
				delay: 0.25,
				duration: 0.6,
				ease: 'outExpo',
			} )
		},
		hide() {
			const { root, link, desc, footer } = this.$refs
			utils.remove( root )
			utils.remove( link )
			utils.remove( desc )
			utils.remove( footer )
			animate( root, { opacity: 0, duration: 0.3, delay: .1, ease: 'inQuad', } )
			animate( desc, {
				opacity: 0,
				delay: stagger( 0.02 ),
				duration: 0.2,
				ease: 'inQuad',
			} )
			animate( link, {
				y: 10,
				scale: 0.97,
				opacity: 0,
				delay: stagger( 0.07 ),
				duration: 0.3,
				ease: 'easeInExpo',
				onComplete: () => {
					root.style.pointerEvents = 'none'
					root.style.visibility = 'hidden'
				},
			} )
			animate( footer, {
				opacity: 0,
				duration: 0.2,
				ease: 'inQuad',
			} )
		},
		onKeyDown( e ) {
			if ( e === 'Escape' && this.isOpen ) {
				menuOpen.value = false
			}
			if ( e === 'm' ) {
				menuOpen.value = true
			}
		}
	},
	watch: {
		isOpen( newVal ) {
			if ( newVal ) {
				this.show()
			} else {
				this.hide()
			}
		},
	},
	mounted() {
		const { root } = this.$refs
		root.style.opacity = 0
		root.style.visibility = 'hidden'
		root.style.pointerEvents = 'none'
		keyboard.onDown.add( this.onKeyDown )
	},
}
</script>

<style lang="stylus" scoped>
.MenuFullscreen
	z-index 9999
	position absolute
	user-select none
	inset 0
	background radial-gradient( ellipse at 50% 30%, rgba(20, 24, 36, 0.92) 0%, rgba(0, 0, 0, 0.92) 70% )
	backdrop-filter blur( 10px )
	display flex
	flex-direction column
	align-items center
	justify-content safe center
	gap 2.25rem
	padding 3rem 1.5rem
	overflow auto
	overscroll-behavior contain
	box-sizing border-box

	.header
		flex-shrink 0
		text-align center
		color white
		margin 0
		h1
			margin 0 auto 18px
			font-size 34px
			font-weight 800
			font-family 'Space Grotesk', 'Inter', sans-serif
			letter-spacing -0.035em
			line-height 1
		.header-info
			display inline-block
			position relative
			padding-bottom 1.25rem
			&::after
				content ''
				position absolute
				bottom 0
				left 10%
				right 10%
				height 2px
				border-radius 2px
				background linear-gradient(90deg, #ffd93d, #ff6b6b, #ff6bcb, #6bcbff, #4d7fff)
				opacity .9
		.subdesc
			margin .65rem 0 0
			opacity .9
			font-size 17px
			font-weight 400
			letter-spacing -0.01em
			line-height 1.5
		.credit
			margin .65rem 0 0
			opacity .65
			font-size .95rem
			font-weight 400
			letter-spacing -0.005em

	.content
		flex-shrink 0
		display grid
		grid-template-columns repeat( 2, minmax(240px, 280px) )
		justify-content center
		gap 1.25em 4em
		max-width 760px
		width 100%
		justify-items stretch

	.column
		display flex
		flex-direction column
		align-items stretch
		text-align center
		gap 1em
		h2
			margin 0
			color white
			font-weight 700
			font-family 'Space Grotesk', 'Inter', sans-serif
			font-size 1.25rem
			letter-spacing -0.02em
			text-transform uppercase
		.desc
			margin 0 auto .5em
			color rgba(255,255,255,.65)
			font-weight 400
			max-width 24ch
			font-size 13px
			line-height 1.5
			letter-spacing 0

			&.basic-desc, &.advanced-desc
				color rgba(255,255,255,.78)
				font-weight 500

	.content .column a
		background rgba(255,255,255,.04)
		width 100%
		min-height 64px
		color white
		font-weight 600
		font-size 1.075rem
		font-family 'Inter', sans-serif
		letter-spacing -0.02em
		text-decoration none
		display flex
		flex-direction column
		align-items center
		justify-content center
		gap 4px
		padding 12px 18px
		opacity 0
		box-sizing border-box
		overflow hidden
		border-radius 14px
		border 1px solid rgba(255,255,255,.12)
		box-shadow 0 1px 0 rgba(255,255,255,.04) inset

		transition border-color .25s ease, background .25s ease, box-shadow .25s ease

		&:hover
			border-color rgba(255,255,255,.45)
			background rgba(255,255,255,.085)
			box-shadow 0 8px 24px -10px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.08) inset
		
		&.basic-link .link-title
			background linear-gradient(135deg, #b8e6ce, #d4db8c)
			-webkit-background-clip text
			-webkit-text-fill-color transparent

		&.basic-link .link-subtitle
			color #cfe0a6

		&.advanced-link .link-title
			background linear-gradient(135deg, #ff6b6b, #ff8e53, #ff6bcb)
			-webkit-background-clip text
			-webkit-text-fill-color transparent

		&.advanced-link .link-subtitle
			color #ffb0a8

		&.primary .link-title
			background linear-gradient(90deg, #007cf0, #00bfff)
			-webkit-background-clip text
			-webkit-text-fill-color transparent

		&.primary .link-subtitle
			color #8fd6ff

	.link-title
		display block
		font-size 1.06rem
		font-weight 600
		line-height 1.1
		color white

	.link-subtitle
		display block
		font-size 10.5px
		font-weight 700
		letter-spacing 0.16em
		line-height 1.1
		text-transform uppercase
		opacity .7
		color rgba(255,255,255,.78)
	.u-link
		color white
		background transparent
		font-weight 500
		font-family 'Inter', sans-serif
		letter-spacing -0.01em
		opacity .7
		position relative
		text-decoration none
		transition opacity .2s ease
		&::before
			content ''
			position absolute
			left 0
			right 0
			bottom -2px
			margin 0 auto
			width 100%
			height 1px
			background currentColor
			opacity .7
		&::after
			content ''
			position absolute
			left 0
			right 0
			bottom -2px
			margin 0 auto
			width 100%
			height 1px
			background currentColor
			opacity 1
			transform scaleX(0)
			transform-origin center
			transition transform .25s ease
		&:hover,
		&:focus-visible
			opacity 1
			&::after
				transform scaleX(1)

	.footer
		flex-shrink 0
		margin 0
		display flex
		align-items center
		justify-content center
		gap 1rem
		font-size 12.5px
		opacity .9
		span
			color rgba(255,255,255,.35)

	@media (max-height: 820px) and (min-width: 721px)
		gap 1.5rem
		padding 2.25rem 1.5rem
		.header
			h1
				font-size 26px
				margin-bottom 12px
			.header-info
				padding-bottom .75rem
			.subdesc
				font-size 14.5px
				margin-top .35rem
			.credit
				font-size .85rem
				margin-top .35rem
		.content
			gap 1em 3em
			max-width 700px
		.column
			gap .7em
		.content .column a
			min-height 56px
			font-size 1rem
			padding 10px 14px

	@media (max-width: 720px)
		justify-content flex-start
		gap 1.5rem
		padding 4.5rem 1rem 2rem
		backdrop-filter blur( 6px )
		.header
			h1
				font-size 26px
				margin-bottom 14px
			.subdesc
				font-size 14.5px
				max-width 36ch
				margin-left auto
				margin-right auto
			.credit
				max-width 36ch
				margin-left auto
				margin-right auto
		.content
			grid-template-columns minmax(0, 320px)
			gap 1.5rem
			max-width 340px
		.column
			.desc
				max-width 36ch
		.content .column a
			min-height 58px
			font-size 1.025rem
		.footer
			flex-direction column
			gap .5rem
</style>

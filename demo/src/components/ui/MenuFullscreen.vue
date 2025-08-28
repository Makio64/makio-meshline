<!-- Simple MenuFullscreen by @makio64 || David Ronai -->
<template>
	<div ref="root" class="MenuFullscreen" :class="{ open: isOpen }">
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
				<a v-for="link in basicLinks" :key="link.text" ref="link" :href="link.href" class="basic-link" @click="close">{{ link.text }}</a>
			</div>
			<div class="column">
				<p ref="desc" class="desc advanced-desc">Advanced demo</p>
				<a v-for="link in advancedLinks" :key="link.text" ref="link" :href="link.href" :class="{ primary: link.primary, 'advanced-link': !link.primary }" @click="close">{{ link.text }}</a>
			</div>
		</div>
		<div ref="footer" class="footer">
			<a class="u-link" href="https://meshlines-docs.netlify.app" target="_blank" rel="noopener">Full documentation & API</a>
			<span>·</span>
			<a class="u-link" href="https://github.com/Makio64/makio-meshline" target="_blank" rel="noopener">makio-meshline GitHub</a>
			<span>·</span>
			<a class="u-link" href="https://x.com/makio64" target="_blank" rel="noopener">@Makio64</a>
		</div>
	</div>
</template>

<script>
import { animate, stagger, utils } from 'animejs'

import { menuOpen } from '@/store'
import keyboard from '@/makio/utils/input/keyboard'
import { isMobile } from '@/makio/utils/detect'

export default {
	name: 'MenuFullscreen',
	data() {
		return {
			basicLinks: [
				{ text: 'Basic', href: '/examples/basic' },
				{ text: 'Waves', href: '/examples/waves' },
				{ text: 'Follow', href: '/examples/follow' },
				{ text: 'GPU Circle', href: '/examples/gpu-circle' },
				{ text: 'GPU Instancing', href: '/examples/gpu-instance' },
			],
			advancedLinks: [
				{ text: 'Sandbox', href: '/examples/sandbox', primary: true },
				{ text: 'Rice Field', href: '/examples/ricefield' },
				{ text: 'Draw Lines', href: '/examples/drawlines' },
				{ text: 'Venus & David', href: '/examples/venus-and-david' },
			],
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
			utils.set( link, { opacity: 0, width: 0 } )
			utils.set( footer, { opacity: 0 } )
			animate( desc, {
				opacity: [0, 1],
				delay: stagger( 0.04, { start: 0.1 } ),
				duration: 0.8,
				ease: 'outExpo',
			} )
			animate( link, {
				// x: [-50, 0],
				width: [0, 200],
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
				width: 0,
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
			console.log( e )
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
	background rgba( 0, 0, 0, 0.85 )
	backdrop-filter blur( 4px )
	// transform translateX(-100%)
	display flex
	flex-direction column
	align-items center
	justify-content center
	gap 2em
	padding 2rem 1rem
	overflow hidden

	.header
		position absolute
		top 2rem
		left 2rem
		right 2rem 
		text-align center
		color white
		margin 0
		h1
			margin 0
			font-size 30px
			font-weight 900
			font-family 'Space Grotesk', 'Inter', sans-serif
			letter-spacing -0.03em
			margin auto
			margin-bottom 20px
		.header-info
			display inline-block
			position relative
			padding-bottom 1rem
			&::after
				content ''
				position absolute
				bottom 0
				left 0
				right 0
				height 2px
				background linear-gradient(90deg, #ffd93d, #ff6b6b, #ff6bcb, #6bcbff, #4d7fff)
		.subdesc
			margin .5rem 0 0
			opacity .85
			// max-width 40ch
			font-size 16px
			font-weight 400
			letter-spacing -0.01em
			line-height 1.5
		.credit
			margin .5rem 0 0
			opacity .65
			font-size .925rem
			// max-width 40ch
			font-weight 400
			letter-spacing -0.005em

	.content
		display grid
		grid-template-columns repeat( 2, minmax(200px, 280px) )
		gap 3em 4em
		max-width 800px
		width auto
		margin 0 auto
		justify-items center

	.column
		display flex
		flex-direction column
		align-items center
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
			margin 0
			color rgba(255,255,255,.65)
			font-weight 400
			max-width 24ch
			font-size 12px
			line-height 1.5
			letter-spacing 0
			
			&.basic-desc, &.advanced-desc
				color rgba(255,255,255,.75)
				font-weight 500

	.content .column a
		background white
		width 200px
		height 56px
		color black
		font-weight 600
		font-size 1.125rem
		font-family 'Inter', sans-serif
		letter-spacing -0.02em
		text-decoration none
		white-space nowrap
		display flex
		align-items center
		justify-content center
		opacity 0
		box-sizing border-box
		overflow hidden
		border-radius 12px
		border 1px solid rgba(255,255,255,.4)
		box-sizing border-box

		transition color .25s ease, background .25s ease, border .25s ease

		&:hover
			// color #fff
			border 1px solid rgba(255,255,255,.8)
			background rgba(255,255,255,.1)
		
		// Beginner-friendly soft green to soft yellow gradient for basic examples
		&.basic-link
			background: linear-gradient(135deg, #b8e6ce, #d4db8c)
			-webkit-background-clip: text
			-webkit-text-fill-color: transparent
		
		// Red-orange-pink gradient for advanced demos (except Sandbox)
		&.advanced-link
			background: linear-gradient(135deg, #ff6b6b, #ff8e53, #ff6bcb)
			-webkit-background-clip: text
			-webkit-text-fill-color: transparent
		
		// Blue gradient for primary (Sandbox)
		&.primary
			background: linear-gradient(90deg, #007cf0, #00bfff)
			-webkit-background-clip: text
			-webkit-text-fill-color: transparent
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
		position absolute
		bottom 2rem
		left 0
		right 0
		transform none
		display flex
		align-items center
		justify-content center
		gap .75rem
		font-size 12px
		span
			color rgba(255,255,255,.4)

	@media (max-width: 720px)
		justify-content flex-start
		align-items center
		padding 5rem 1rem 6rem
		overflow auto
		backdrop-filter none
		.header
			// display none
			position static
			top auto
			left auto
			margin 0 0 .5rem
			text-align center
			.subdesc
				max-width 36ch
				margin-left auto
				margin-right auto
			.credit
				max-width 36ch
				margin-left auto
				margin-right auto
		.content
			grid-template-columns 1fr
			gap 2rem
			max-width 460px
			margin 0 auto
		.column
			align-items center
			text-align center
			.desc
				max-width 36ch
			.content .column a
				width 180px
				height 50px
				font-size 1rem
		.footer
			position relative
			left auto
			right auto
			bottom auto
			transform none
			justify-content center
			padding 1rem 0
			display flex 
			flex-direction column
			background linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,.4) 50%, rgba(0,0,0,.9) 100%)
</style>

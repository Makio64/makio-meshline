<!-- Modern Button Style by @makio64 -->
<template>
	<div class="GradientButton" :class="{ isFull, red: color == 'red', blue: color == 'blue' }">
		<a v-if="href != ''" :href="href" target="_blank'">
			<slot />
		</a>
		<span v-else>
			<slot />
		</span>
	</div>
</template>

<script>
import { gsap, Quad } from 'gsap'
export default {
	name: 'GradientButton',
	props: {
		color: {
			type: String,
			default: 'blue',
		},
		href: {
			type: String,
			default: '',
		},
		isFull: {
			type: Boolean,
			default: false,
		},
		showAuto: {
			type: Boolean,
			default: true,
		},
	},
	mounted() {
		if ( this.showAuto ) {
			this.show()
		} else {
			gsap.set( this.$el, { opacity: 0 } )
		}
	},
	methods: {
		show() {
			gsap.from( this.$el, { opacity: 0, y: 20, delay: 0.1, duration: 0.5, ease: Quad.easeOut } )
		},
		hide() {
			gsap.to( this.$el, { opacity: 0, y: -20, duration: 0.5, ease: Quad.easeOut } )
		},
	},
}
</script>

<style lang="stylus" scoped>
.GradientButton
	text-align: center
	cursor pointer

	a,span
		text-decoration: none
		display: inline-block
		color: #0097FE
		font-family: 'Neue Montreal'
		font-size: 15px
		font-style: normal
		font-weight: 400
		line-height: 18px
		letter-spacing: 0em
		text-align: center
		font-size 15px
		background: #fff
		background-clip: padding-box /* !important */
		border: solid 2px transparent /* !important */
		border-radius: 40px
		padding 9px 20px 11px 20px
		position relative

		&:before
			content: ''
			position: absolute
			top: 0; right: 0; bottom: 0; left: 0
			background #0ff
			z-index: -1
			margin: -2px
			border-radius: inherit
			background: linear-gradient(100.57deg, rgba(0, 151, 254, 0.6), rgba(0, 151, 254, 1) )

	&.red
		a,span
			&:before
				background: linear-gradient(100.57deg, rgba(255, 83, 121, 0.5), rgba(255, 83, 121, 1) )
			color: #2E2E2E
	&.isFull
		a,span
			color: #fff
			background: linear-gradient(180deg, rgba(0, 151, 254, 0.7) 0%, #0097FE 100%);
		&.red
			a,span
				background: linear-gradient(180deg, rgba(255, 83, 121, 0.7) 0%, #FF5379 100%)
				color: #fff
</style>

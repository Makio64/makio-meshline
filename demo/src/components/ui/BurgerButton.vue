<!-- Simple BurgerButton by @makio64 || David Ronai -->
<template>
	<button
		type="button"
		class="BurgerButton"
		:class="{ cross: isOpen }"
		:aria-expanded="String( isOpen )"
		aria-controls="examples-menu"
		title="Browse all demos (M)"
		@click="toggle"
	>
		<span class="BurgerButton-icon" aria-hidden="true">
			<span />
			<span />
			<span />
		</span>
		<span class="BurgerButton-label">Demos</span>
	</button>
</template>

<script>
import { menuOpen } from '@/store'

export default {
	name: 'BurgerButton',
	props: {
		color: {
			type: String,
			default: 'white'
		},
		spacing: {
			type: String,
			default: '4'
		}
	},
	computed: {
		isOpen() {
			return menuOpen.value
		},
	},
	methods: {
		toggle() {
			menuOpen.value = !menuOpen.value
		},
	},
}
</script>

<style lang="stylus" scoped>
.BurgerButton
	z-index 10000
	position fixed
	top calc( 18px + var( --sait, 0px ) )
	right calc( 18px + var( --sair, 0px ) )
	box-sizing border-box
	display inline-flex
	align-items center
	justify-content center
	gap 7px
	min-height 40px
	padding 4px 13px
	appearance none
	cursor pointer
	user-select none
	border-radius 999px
	background rgba( 8, 9, 12, 0.7 )
	border 1px solid rgba( 255, 255, 255, 0.1 )
	box-shadow 0 12px 30px rgba( 0, 0, 0, 0.3 )
	backdrop-filter blur( 14px )
	-webkit-backdrop-filter blur( 14px )
	color rgba( 244, 245, 247, 0.78 )
	font 500 12px/1 'Inter', system-ui, -apple-system, sans-serif
	transition background 0.16s ease, border-color 0.16s ease, color 0.16s ease

	&:hover,
	&:focus-visible,
	&.cross
		background rgba( 20, 23, 32, 0.86 )
		border-color rgba( 255, 255, 255, 0.24 )
		color #ffffff
		outline none

	&:focus-visible
		outline 2px solid rgba( 255, 255, 255, 0.75 )
		outline-offset 2px

.BurgerButton-icon
	position relative
	display inline-block
	width 14px
	height 12px
	flex-shrink 0

	span
		position absolute
		left 0
		width 14px
		height 1.5px
		border-radius 2px
		background currentColor
		transform-origin center
		transition top 0.2s ease, transform 0.2s ease, opacity 0.16s ease

		&:first-child
			top 1px

		&:nth-child(2)
			top 5.25px

		&:last-child
			top 9.5px

.BurgerButton.cross .BurgerButton-icon
	span:nth-child(2)
		opacity 0

	span:first-child,
	span:last-child
		top 5.25px

	span:first-child
		transform rotate( 45deg )

	span:last-child
		transform rotate( -45deg )

.BurgerButton-label
	letter-spacing -0.01em

@media (max-width: 640px)
	.BurgerButton
		top calc( 12px + var( --sait, 0px ) )
		right calc( 12px + var( --sair, 0px ) )
		min-height 34px
		padding 4px 11px

	.BurgerButton-label
		display none

@media (prefers-reduced-motion: reduce)
	.BurgerButton,
	.BurgerButton-icon span
		transition none
</style>

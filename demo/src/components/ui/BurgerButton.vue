<!-- Simple BurgerButton by @makio64 || David Ronai -->
<template>
	<button
		type="button"
		class="BurgerButton"
		:class="{ cross: isOpen }"
		:aria-expanded="isOpen"
		:aria-label="isOpen ? 'Close example menu' : 'Open example menu'"
		aria-controls="examples-menu"
		@click="toggle"
	>
		<span />
		<span />
		<span />
	</button>
</template>

<script>
import { menuOpen } from '@/store'

export default {
	name: 'BurgerButton',
	props: {
		color: {
			type: String,
			default: 'black'
		},
		spacing: {
			type: String,
			default: '6'
		}
	},
	computed: {
		isOpen() {
			return menuOpen.value
		},
		spacingPx() {
			return this.spacing + 'px'
		},
		doubleSpacingPx() {
			return ( this.spacing * 2 ) + 'px'
		}
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
	top calc(12px + var(--sait, 0px))
	right calc(12px + var(--sair, 0px))
	box-sizing border-box
	width 44px
	height 44px
	padding 0
	appearance none
	cursor pointer
	border 1px solid rgba(255,255,255,.16)
	border-radius 13px
	background rgba(6,9,16,.42)
	box-shadow inset 0 1px rgba(255,255,255,.08), 0 10px 30px -16px rgba(0,0,0,.8)
	backdrop-filter blur(10px)
	transition border-color .18s ease, background .18s ease, box-shadow .18s ease

	&:hover,
	&:focus-visible,
	&.cross
		border-color rgba(255,255,255,.4)
		background rgba(16,21,34,.78)
		box-shadow inset 0 1px rgba(255,255,255,.1), 0 12px 32px -14px rgba(0,0,0,.9)

	&:focus-visible
		outline 2px solid rgba(255,255,255,.85)
		outline-offset 2px

	span
		background-color v-bind(color)
		height 2px
		position absolute
		width 22px
		left 10px
		border-radius 2px
		transform-origin center
		transition top .24s ease, transform .24s ease, opacity .18s ease
		&:first-child
			top 11px
		&:nth-child(2)
			top calc(11px + v-bind(spacingPx))
		&:last-child
			top calc(11px + v-bind(doubleSpacingPx))

	&.cross
		span:nth-child(2)
			opacity 0
		span:first-child,
		span:last-child
			top calc(11px + v-bind(spacingPx))
		span:first-child
			transform rotate(45deg)
		span:last-child
			transform rotate(-45deg)

	@media (max-width: 720px)
		top calc(8px + var(--sait, 0px))
		right calc(8px + var(--sair, 0px))
		width 40px
		height 40px
		border-radius 11px

		span
			width 20px
			left 9px
			&:first-child
				top 9px
			&:nth-child(2)
				top calc(9px + v-bind(spacingPx))
			&:last-child
				top calc(9px + v-bind(doubleSpacingPx))

		&.cross
			span:first-child,
			span:last-child
				top calc(9px + v-bind(spacingPx))

	@media (prefers-reduced-motion: reduce)
		transition none

		span
			transition none
</style>

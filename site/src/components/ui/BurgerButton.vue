<!-- Simple BurgerButton by @makio64 || David Ronai -->
<template>
	<div class="BurgerButton" :class="{ cross: isOpen }" @click="toggle">
		<span />
		<span />
		<span />
	</div>
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
			default: "6"
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
	z-index 1000
	position absolute
	top 16px
	right 16px
	box-sizing: border-box
	width: 30px
	height: 30px
	cursor: pointer

	span
		background-color: v-bind(color)
		height: 2px
		position: absolute
		width: 100%
		left: 0
		transition: all 0.3s ease
		&:first-child
			top: 0
		&:nth-child(2)
			top: v-bind(spacingPx)
		&:last-child
			top: v-bind(doubleSpacingPx)

	&.cross
		span:nth-child(2)
			opacity: 0
		span:first-child,
		span:last-child
			top: v-bind(spacingPx)
		span:first-child
			transform: rotate(45deg)
		span:last-child
			transform: rotate(-45deg)
</style>

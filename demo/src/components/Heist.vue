<template>
	<div class="HeistModeHud" @pointerdown="onBadgeClick">
		<span class="HeistModeHud__dot" :style="{ '--dot': color }" />
		{{ label }}
		<span class="HeistModeHud__hint">{{ hint }}</span>
	</div>
</template>

<script>
import keyboard from '@/makio/utils/input/keyboard'

export default {
	name: 'HeistUI',
	// Opt out of `class="bottom"` fall-through from ExampleView — the HUD sits at
	// the top of the viewport, not the bottom.
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			pickMode: this.api.pickMode,
			debugPicker: this.api.debugPicker,
		}
	},
	computed: {
		color() {
			if ( this.debugPicker ) return '#ffd24a'
			return this.pickMode === 'raycast' ? '#4ad8ff' : '#ff9368'
		},
		label() {
			if ( this.debugPicker ) return 'Debug: Picker IDs'
			return this.pickMode === 'raycast' ? 'Raycast (CPU)' : 'MeshLinePicker (GPU)'
		},
		hint() {
			return this.pickMode === 'picker'
				? 'P: toggle mode · D: toggle debug view'
				: 'click or press P to toggle'
		},
	},
	mounted() {
		keyboard.onDown.add( this.onKey )
	},
	unmounted() {
		keyboard.onDown.remove( this.onKey )
	},
	methods: {
		onBadgeClick( e ) {
			e.stopPropagation()
			this.togglePickMode()
		},
		onKey( key ) {
			if ( key === 'p' || key === 'P' ) this.togglePickMode()
			else if ( key === 'd' || key === 'D' ) this.toggleDebugPicker()
		},
		togglePickMode() {
			this.pickMode = this.api.togglePickMode()
			this.debugPicker = this.api.debugPicker // may auto-disable when leaving picker mode
		},
		toggleDebugPicker() {
			this.debugPicker = this.api.toggleDebugPicker()
		},
	},
}
</script>

<style lang="stylus" scoped>
.HeistModeHud
	position fixed
	left 50%
	top 22px
	transform translateX(-50%)
	z-index 20
	padding 8px 14px 8px 10px
	border-radius 6px
	font 500 12px/1 system-ui, -apple-system, sans-serif
	letter-spacing .08em
	text-transform uppercase
	color #ffb4a0
	background rgba(16, 4, 6, .72)
	border 1px solid rgba(255, 60, 30, .35)
	box-shadow 0 0 14px rgba(255, 0, 0, .18)
	backdrop-filter blur(6px)
	-webkit-backdrop-filter blur(6px)
	cursor pointer
	user-select none
	transition opacity .2s ease, transform .1s ease
	&__dot
		display inline-block
		width 7px
		height 7px
		margin-right 8px
		vertical-align 2px
		border-radius 50%
		background var(--dot)
		box-shadow 0 0 6px var(--dot)
	&__hint
		margin-left 10px
		opacity .6
		font-weight 400
		text-transform none
		letter-spacing .02em
</style>

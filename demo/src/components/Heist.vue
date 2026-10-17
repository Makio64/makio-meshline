<template>
	<div class="HeistModeHud" role="group" aria-label="Laser picking mode">
		<button
			v-for="mode in modes"
			:key="mode.id"
			type="button"
			class="HeistModeHud__segment"
			:class="{ 'is-active': pickMode === mode.id }"
			:style="{ '--dot': mode.color }"
			:aria-pressed="String( pickMode === mode.id )"
			@pointerdown.stop="selectMode( mode.id )"
			@click.stop="selectMode( mode.id )"
		>
			<span class="HeistModeHud__dot" />
			<span>{{ mode.label }}</span>
		</button>
		<span class="HeistModeHud__hint" title="Press P to cycle modes">P</span>
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
			modes: [
				{ id: 'raycast', label: 'Raycast (CPU)', color: '#4ad8ff' },
				{ id: 'picker', label: 'MeshLinePicker (GPU)', color: '#ff9368' },
				{ id: 'picker-debug', label: 'Picker Debug', color: '#7cffb2' },
			],
		}
	},
	mounted() {
		keyboard.onDown.add( this.onKey )
	},
	unmounted() {
		keyboard.onDown.remove( this.onKey )
	},
	methods: {
		selectMode( mode ) {
			if ( typeof this.api.setPickMode === 'function' ) {
				this.pickMode = this.api.setPickMode( mode )
			} else {
				this.pickMode = this.api.togglePickMode()
			}
		},
		onKey( key ) {
			if ( key === 'p' || key === 'P' ) this.togglePickMode()
		},
		togglePickMode() {
			this.pickMode = this.api.togglePickMode()
		},
	},
}
</script>

<style lang="stylus" scoped>
.HeistModeHud
	position fixed
	left 50%
	top calc( 18px + var( --sait, 0px ) )
	transform translateX(-50%)
	z-index 20
	display inline-flex
	align-items center
	gap 4px
	padding 4px
	border-radius 999px
	font 600 11px/1 'Mulish', system-ui, -apple-system, sans-serif
	letter-spacing .05em
	text-transform uppercase
	color #ffb4a0
	background rgba(16, 4, 6, .78)
	border 1px solid rgba(255, 60, 30, .35)
	box-shadow 0 0 18px rgba(255, 0, 0, .18)
	backdrop-filter blur(10px)
	-webkit-backdrop-filter blur(10px)
	user-select none
	max-width calc( 100vw - 96px )

	&__segment
		display inline-flex
		align-items center
		gap 6px
		padding 7px 11px
		border 1px solid transparent
		border-radius 999px
		background transparent
		color rgba( 255, 224, 214, 0.72 )
		font inherit
		letter-spacing inherit
		text-transform inherit
		white-space nowrap
		cursor pointer
		transition background .15s ease, color .15s ease, border-color .15s ease

		&:hover
			color #ffffff
			background rgba( 255, 255, 255, 0.06 )

		&.is-active
			color #ffffff
			background rgba( 255, 76, 48, 0.22 )
			border-color rgba( 255, 130, 96, 0.45 )

	&__dot
		display inline-block
		width 7px
		height 7px
		border-radius 50%
		background var(--dot)
		box-shadow 0 0 6px var(--dot)
		flex-shrink 0

	&__hint
		display inline-flex
		align-items center
		justify-content center
		min-width 20px
		height 20px
		margin 0 4px 0 2px
		padding 0 5px
		border-radius 6px
		border 1px solid rgba( 255, 180, 160, 0.28 )
		background rgba( 255, 255, 255, 0.06 )
		color rgba( 255, 210, 196, 0.8 )
		font-size 10px
		font-weight 700
		letter-spacing 0.04em

@media (max-width: 640px)
	.HeistModeHud
		top calc( 12px + var( --sait, 0px ) )
		gap 2px
		padding 3px
		font-size 10px

		&__segment
			padding 6px 8px
			gap 5px

		&__hint
			display none
</style>

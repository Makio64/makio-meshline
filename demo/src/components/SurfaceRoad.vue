<template>
	<div class="SurfaceRoadHud">
		<p class="SurfaceRoadHud__hint">
			<strong>Drag</strong> a point to reshape · <strong>Double-click</strong> the ground to add ·
			<strong>Double-click</strong> or <strong>right-click</strong> a point to remove
		</p>

		<div class="SurfaceRoadHud__status" :class="`SurfaceRoadHud__status--${ui.status}`" aria-live="polite">
			<span>{{ ui.controls }} points</span>
			<span>{{ ui.bends }} widened bends</span>
			<span>{{ ui.arcs }} fixed-radius turns</span>
			<span v-if="ui.tight" class="SurfaceRoadHud__warn">{{ ui.tight }} tighter than the road is wide</span>
		</div>

		<button
			class="SurfaceRoadHud__toggle"
			type="button"
			:aria-pressed="ui.debug"
			@pointerdown.stop
			@click="toggleDebug"
		>
			<span class="SurfaceRoadHud__dot" :class="{ 'is-on': ui.debug }" aria-hidden="true" />
			<span>Construction: {{ ui.debug ? 'on' : 'off' }}</span>
			<span class="SurfaceRoadHud__key">D</span>
		</button>

		<div v-if="ui.debug" class="SurfaceRoadHud__legend">
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--control" />Authored control points</span>
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--polygon" />Straight route between them</span>
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--path" />Planned centreline</span>
			<span><i class="SurfaceRoadHud__swatch SurfaceRoadHud__swatch--arc" />Turn too hard for the curve</span>
		</div>
	</div>
</template>

<script>
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

export default {
	name: 'SurfaceRoadUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	computed: {
		ui() {
			return this.api.ui
		},
	},
	mounted() {
		keyboard.onDown.add( this.onKey )
	},
	unmounted() {
		keyboard.onDown.remove( this.onKey )
	},
	methods: {
		onKey( key, event ) {
			const target = event?.target
			const isEditable = target?.matches?.( 'input, textarea, select, [contenteditable="true"]' )
			if (
				event?.repeat || event?.defaultPrevented || event?.altKey || event?.ctrlKey || event?.metaKey ||
				menuOpen.value || isEditable
			) return
			if ( key === 'd' || key === 'D' ) this.toggleDebug()
		},
		toggleDebug() {
			this.api.toggleDebug()
		},
	},
}
</script>

<style lang="stylus" scoped>
.SurfaceRoadHud
	position fixed
	left 50%
	top 22px
	transform translateX(-50%)
	z-index 20
	display flex
	flex-direction column
	align-items center
	gap 7px
	width max-content
	max-width calc(100vw - 32px)
	font 500 12px/1.3 system-ui, -apple-system, sans-serif
	color #f8fbff
	user-select none

	&__hint
		margin 0
		padding 6px 12px
		border-radius 999px
		background rgba(5, 13, 18, .72)
		box-shadow 0 2px 10px rgba(0, 0, 0, .25)
		backdrop-filter blur(6px)
		-webkit-backdrop-filter blur(6px)
		font-size 11px
		text-align center
		color rgba(255, 255, 255, .92)

		strong
			font-weight 700
			color #7fe6ff

	&__status
		display flex
		flex-wrap wrap
		justify-content center
		gap 6px 12px
		padding 5px 12px
		border 1px solid rgba(255, 255, 255, .16)
		border-radius 999px
		background rgba(5, 13, 18, .72)
		font-size 11px
		letter-spacing .02em
		transition border-color .2s ease

		&--arc
			border-color rgba(83, 198, 255, .6)

		&--tight
			border-color rgba(255, 93, 108, .7)

	&__warn
		color #ff9aa4

	&__toggle
		appearance none
		display flex
		align-items center
		gap 8px
		margin 0
		padding 7px 12px
		border 1px solid rgba(104, 225, 255, .5)
		border-radius 999px
		background rgba(5, 13, 18, .86)
		font inherit
		font-weight 700
		font-size 11px
		letter-spacing .06em
		text-transform uppercase
		color inherit
		cursor pointer
		transition border-color .2s ease

		&:hover
			border-color #8cecff

		&:focus-visible
			outline 2px solid #fff
			outline-offset 3px

	&__dot
		width 8px
		height 8px
		border-radius 50%
		background #63727a

		&.is-on
			background #ff8a2b
			box-shadow 0 0 9px #ff8a2b

	&__key
		padding 1px 5px
		border 1px solid rgba(255, 255, 255, .3)
		border-radius 4px
		font-size 9px
		opacity .7

	&__legend
		display grid
		grid-template-columns repeat(2, minmax(0, 1fr))
		column-gap 16px
		row-gap 6px
		padding 8px 11px
		border 1px solid rgba(255, 255, 255, .18)
		border-radius 8px
		background rgba(5, 13, 18, .82)
		font-size 10px
		white-space nowrap

		span
			display flex
			align-items center
			gap 6px

	&__swatch
		display inline-block
		flex 0 0 auto

		&--control
			width 8px
			height 8px
			border-radius 50%
			background #ff9f43

		&--arc
			width 8px
			height 8px
			border-radius 50%
			background #53c6ff

		&--polygon
			width 12px
			height 2px
			background #ff9f43

		&--path
			width 12px
			height 2px
			background #35d9ff

@media (max-width: 680px)
	.SurfaceRoadHud
		top 10px
		gap 5px
		max-width calc(100vw - 20px)

		&__hint
			font-size 10px

		&__status
			font-size 10px

		&__legend
			box-sizing border-box
			grid-template-columns 1fr
			align-self stretch
			font-size 9px
			white-space normal
</style>

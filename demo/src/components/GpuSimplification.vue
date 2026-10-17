<template>
	<aside
		v-if="ui.visible"
		class="GpuSimplificationHud"
		aria-label="Simplification controls"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<div class="GpuSimplificationHud__telemetry" aria-live="polite">
			<div class="GpuSimplificationHud__polys">
				<strong class="GpuSimplificationHud__value">{{ polyCountLabel }}</strong>
				<span class="GpuSimplificationHud__unit">polys</span>
				<span v-if="reductionTag" class="GpuSimplificationHud__tag">{{ reductionTag }}</span>
			</div>
			<div class="GpuSimplificationHud__time" title="GPU compute time">
				<i class="GpuSimplificationHud__dot" :class="{ 'is-busy': ui.busy }" aria-hidden="true" />
				<strong>{{ gpuTimeLabel }}</strong>
			</div>
		</div>

		<div class="GpuSimplificationHud__slider">
			<div class="GpuSimplificationHud__sliderHead">
				<label for="gpu-simplification-level">Simplify</label>
				<strong>{{ ui.level === 0 ? 'Lossless' : `${ui.level}%` }}</strong>
			</div>
			<input
				id="gpu-simplification-level"
				type="range"
				min="0"
				max="100"
				step="1"
				:value="ui.level"
				:style="{ '--slider-progress': `${ui.level}%` }"
				:disabled="controlsDisabled"
				:aria-valuetext="`simplification level ${ui.level} percent`"
				@input="api.setSimplificationLevel( Number( $event.target.value ), false )"
				@change="api.setSimplificationLevel( Number( $event.target.value ), true )"
			>
		</div>

		<div class="GpuSimplificationHud__bar" role="toolbar" aria-label="Dataset and view controls">
			<button
				v-for="dataset in api.datasets"
				:key="dataset.id"
				type="button"
				class="GpuSimplificationHud__btn"
				:class="{ 'is-active': ui.datasetId === dataset.id }"
				:aria-pressed="String( ui.datasetId === dataset.id )"
				@click="api.setDataset( dataset.id )"
			>{{ dataset.label }}</button>
			<span class="GpuSimplificationHud__divider" aria-hidden="true" />
			<button
				type="button"
				class="GpuSimplificationHud__btn"
				:class="{ 'is-active': ui.detail === 'before' }"
				:aria-pressed="String( ui.detail === 'before' )"
				:disabled="controlsDisabled"
				@click="toggleOriginal"
			>Original</button>
			<button
				type="button"
				class="GpuSimplificationHud__btn"
				:class="{ 'is-active': ui.renderMode === 'wireframe' }"
				:aria-pressed="String( ui.renderMode === 'wireframe' )"
				title="Toggle wireframe (W)"
				@click="toggleWireframe"
			>Wireframe</button>
		</div>
	</aside>
</template>

<script>
import keyboard from '@/makio/utils/input/keyboard'
import { menuOpen } from '@/store'

export default {
	name: 'GpuSimplificationUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	computed: {
		ui() {
			return this.api.ui
		},
		controlsDisabled() {
			return this.ui.backend !== 'webgpu'
		},
		activePolyCount() {
			if ( this.ui.detail === 'before' ) return this.ui.sourcePointCount
			return this.ui.retainedPointCount ?? this.ui.sourcePointCount
		},
		polyCountLabel() {
			return this.formatCompact( this.activePolyCount )
		},
		reductionTag() {
			if ( this.ui.detail === 'before' ) return 'raw'
			if ( this.ui.retainedPointCount == null || !this.ui.sourcePointCount ) return ''
			const reduction = Math.max( 0, 1 - this.ui.retainedPointCount / this.ui.sourcePointCount )
			if ( reduction < 0.005 ) return ''
			return `−${Math.round( reduction * 100 )}%`
		},
		gpuTimeLabel() {
			if ( this.ui.detail === 'before' ) return '0 ms'
			if ( this.ui.gpuComputeMs == null ) return '—'
			const ms = this.ui.gpuComputeMs
			return `${ms < 10 ? ms.toFixed( 1 ) : Math.round( ms )} ms`
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
			if ( event?.repeat || event?.defaultPrevented || menuOpen.value || isEditable ) return
			if ( event?.altKey || event?.ctrlKey || event?.metaKey ) return
			if ( key === 'w' || key === 'W' ) this.toggleWireframe()
		},
		toggleOriginal() {
			this.api.setDetailView( this.ui.detail === 'before' ? 'after' : 'before' )
		},
		toggleWireframe() {
			this.api.setRenderMode( this.ui.renderMode === 'wireframe' ? 'ribbons' : 'wireframe' )
		},
		formatCompact( value ) {
			if ( value == null || !Number.isFinite( value ) ) return '—'
			if ( value < 1000 ) return String( Math.round( value ) )
			if ( value < 10000 ) return `${( value / 1000 ).toFixed( 1 ).replace( /\.0$/, '' )}k`
			return `${Math.round( value / 1000 )}k`
		},
	},
}
</script>

<style lang="stylus" scoped>
.GpuSimplificationHud
	position fixed
	left calc(18px + var(--sail, 0px))
	top calc(18px + var(--sait, 0px))
	z-index 20
	display grid
	gap 10px
	box-sizing border-box
	width 288px
	max-width calc(100vw - 84px)
	padding 12px 14px
	border 1px solid rgba(255, 255, 255, .1)
	border-radius 16px
	background rgba(8, 12, 22, .76)
	box-shadow 0 16px 40px rgba(0, 0, 0, .36)
	backdrop-filter blur(16px)
	-webkit-backdrop-filter blur(16px)
	color rgba(235, 245, 255, .86)
	font 500 11px/1.2 'Inter', system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	text-align left
	user-select none

	&__telemetry
		display flex
		align-items center
		justify-content space-between
		gap 8px

	&__polys
		display flex
		align-items baseline
		gap 5px
		min-width 0

	&__value
		color #fff
		font-size 20px
		font-weight 760
		letter-spacing -.03em
		line-height 1

	&__unit
		color rgba(190, 214, 235, .64)
		font-size 11px
		font-weight 600

	&__tag
		margin-left 2px
		padding 2px 6px
		border-radius 999px
		background rgba(56, 189, 248, .14)
		color #7dd3fc
		font-size 10px
		font-weight 700
		line-height 1.1

	&__time
		display inline-flex
		align-items center
		gap 6px
		padding 4px 9px
		border 1px solid rgba(255, 255, 255, .09)
		border-radius 999px
		background rgba(255, 255, 255, .04)
		color #f8fafc
		font-size 11px
		font-weight 700
		line-height 1
		flex-shrink 0

	&__dot
		width 6px
		height 6px
		border-radius 50%
		background #34d399
		box-shadow 0 0 8px rgba(52, 211, 153, .75)
		transition background .15s ease, box-shadow .15s ease

		&.is-busy
			background #38bdf8
			box-shadow 0 0 8px rgba(56, 189, 248, .85)

	&__slider
		display grid
		gap 3px

		input[type='range']
			--slider-track-size 5px
			--slider-thumb-size 14px
			--slider-track-radius 999px
			--slider-thumb-radius 50%
			--slider-track-color rgba(255, 255, 255, .14)
			--slider-fill-color #38bdf8
			--slider-thumb-color #e0f2fe
			--slider-progress 58%
			appearance none
			inline-size 100%
			block-size 20px
			margin 0
			padding 0
			border 0
			border-radius 0
			background transparent
			cursor pointer

		input[type='range']::-webkit-slider-runnable-track
			block-size var(--slider-track-size)
			border 0
			border-radius var(--slider-track-radius)
			background linear-gradient(to right, var(--slider-fill-color) 0 var(--slider-progress), var(--slider-track-color) var(--slider-progress) 100%)

		input[type='range']::-webkit-slider-thumb
			-webkit-appearance none
			appearance none
			inline-size var(--slider-thumb-size)
			block-size var(--slider-thumb-size)
			margin-block-start calc((var(--slider-track-size) - var(--slider-thumb-size)) / 2)
			border 2px solid var(--slider-fill-color)
			border-radius var(--slider-thumb-radius)
			background var(--slider-thumb-color)
			box-shadow 0 2px 6px rgba(0, 0, 0, .35)

		input[type='range']::-moz-range-track
			block-size var(--slider-track-size)
			border 0
			border-radius var(--slider-track-radius)
			background var(--slider-track-color)

		input[type='range']::-moz-range-progress
			block-size var(--slider-track-size)
			border-radius var(--slider-track-radius)
			background var(--slider-fill-color)

		input[type='range']::-moz-range-thumb
			inline-size var(--slider-thumb-size)
			block-size var(--slider-thumb-size)
			border 2px solid var(--slider-fill-color)
			border-radius var(--slider-thumb-radius)
			background var(--slider-thumb-color)

		input[type='range']:focus-visible
			outline 2px solid var(--slider-fill-color)
			outline-offset 4px

		input[type='range']:disabled
			opacity .4
			cursor not-allowed

	&__sliderHead
		display flex
		align-items baseline
		justify-content space-between
		gap 8px

		label
			font-size 10px
			font-weight 600
			color rgba(203, 225, 245, .68)

		strong
			font-size 10px
			font-weight 700
			color rgba(235, 245, 255, .92)

	&__bar
		display flex
		align-items center
		gap 3px
		padding 3px
		border 1px solid rgba(255, 255, 255, .08)
		border-radius 999px
		background rgba(0, 0, 0, .28)

	&__divider
		width 1px
		height 14px
		margin 0 1px
		background rgba(255, 255, 255, .12)
		flex-shrink 0

	&__btn
		appearance none
		flex 1
		min-height 26px
		padding 0 8px
		border 1px solid transparent
		border-radius 999px
		background transparent
		color rgba(226, 242, 252, .68)
		font 600 10px/1 system-ui, -apple-system, sans-serif
		white-space nowrap
		cursor pointer
		transition background .15s ease, color .15s ease, border-color .15s ease

		&:hover,
		&:focus-visible
			color #fff
			background rgba(255, 255, 255, .08)
			outline none

		&:focus-visible
			outline 2px solid #7dd3fc
			outline-offset 2px

		&.is-active
			border-color rgba(255, 255, 255, .16)
			background rgba(255, 255, 255, .14)
			color #fff

		&:disabled
			opacity .4
			cursor not-allowed

@media (max-width: 620px)
	.GpuSimplificationHud
		left calc(10px + var(--sail, 0px))
		top calc(10px + var(--sait, 0px))
		width auto
		max-width calc(100vw - 76px)
		padding 10px 12px
		gap 8px

		&__value
			font-size 18px
</style>

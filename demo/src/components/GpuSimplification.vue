<template>
	<template v-if="ui.visible">
		<div class="DemoHint GpuSimplificationInfo" :style="{ '--demo-accent': ui.busy ? '#38bdf8' : '#34d399' }" aria-live="polite">
			<strong class="GpuSimplificationInfo__value">{{ polyCountLabel }}</strong>
			<span class="GpuSimplificationInfo__unit">polys</span>
			<span v-if="reductionTag" class="GpuSimplificationInfo__tag">{{ reductionTag }}</span>
			<span class="GpuSimplificationInfo__sep" aria-hidden="true">·</span>
			<strong class="GpuSimplificationInfo__time" title="GPU compute time">{{ gpuTimeLabel }}</strong>
		</div>

		<aside
			class="DemoControls"
			style="--demo-accent: #38bdf8"
			aria-label="Simplification controls"
			@pointerdown.stop
			@touchstart.stop
			@wheel.stop
		>
			<div class="GpuSimplificationBar" role="toolbar" aria-label="Dataset and view controls">
				<button
					v-for="dataset in api.datasets"
					:key="dataset.id"
					type="button"
					:aria-pressed="ui.datasetId === dataset.id"
					@click="api.setDataset( dataset.id )"
				>{{ dataset.label }}</button>

				<hr aria-hidden="true">

				<div class="GpuSimplificationBar__slider">
					<label for="gpu-simplification-level">Simplify</label>
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
						@input="api.setSimplificationLevel( Number( $event.target.value ) )"
						@change="api.setSimplificationLevel( Number( $event.target.value ), true )"
					>
					<strong>{{ ui.level }}%</strong>
				</div>

				<hr aria-hidden="true">

				<button
					type="button"
					:aria-pressed="ui.detail === 'before'"
					:disabled="controlsDisabled"
					@click="toggleOriginal"
				>Original</button>
				<button
					type="button"
					:aria-pressed="ui.renderMode === 'wireframe'"
					title="Toggle wireframe (W)"
					@click="toggleWireframe"
				>Wireframe</button>
			</div>
		</aside>
	</template>
</template>

<script>
import { onShortcut } from '@/utils/demoControls'

export default {
	name: 'GpuSimplificationUI',
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
			const count = this.activePolyCount
			if ( count < 1000 ) return String( count )
			if ( count < 10000 ) return `${( count / 1000 ).toFixed( 1 ).replace( /\.0$/, '' )}k`
			return `${Math.round( count / 1000 )}k`
		},
		reductionTag() {
			if ( this.ui.detail === 'before' ) return 'raw'
			if ( this.ui.retainedPointCount == null ) return ''
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
		onShortcut( 'w', this.toggleWireframe )
	},
	methods: {
		toggleOriginal() {
			this.api.setDetailView( this.ui.detail === 'before' ? 'after' : 'before' )
		},
		toggleWireframe() {
			this.api.setRenderMode( this.ui.renderMode === 'wireframe' ? 'ribbons' : 'wireframe' )
		},
	},
}
</script>

<style lang="stylus" scoped>
.GpuSimplificationInfo
	font-variant-numeric tabular-nums

	// This bar is wider than most, so the pill must drop below it sooner than .DemoHint does.
	@media (min-width 721px) and (max-width 1120px)
		top calc(66px + var(--sait, 0px))

	&__value
		color #fff
		font-size 12px
		font-weight 760
		letter-spacing -.01em

	&__unit
		color rgba(190, 214, 235, .68)

	&__tag
		padding 2px 6px
		border-radius 999px
		background rgba(56, 189, 248, .16)
		color #7dd3fc
		font-size 9px
		font-weight 700

	&__sep
		opacity .4

	&__time
		color #f8fafc
		font-weight 700

.GpuSimplificationBar
	display inline-flex
	align-items center
	gap 3px
	font 650 10px/1 'Inter', system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	letter-spacing .05em
	text-transform uppercase

	button:disabled
		opacity .4
		cursor not-allowed

	@media (max-width 820px)
		button
			padding 0 8px
			font-size 9px

			&::before
				display none

	&__slider
		display inline-flex
		align-items center
		gap 7px
		padding 0 8px

		label
			color rgba(203, 225, 245, .68)
			font-size 9.5px
			font-weight 650

			@media (max-width 820px)
				display none

		strong
			min-width 28px
			text-align right
			color #fff
			font-size 10px
			font-weight 700

		input[type='range']
			--slider-track-size 4px
			--slider-thumb-size 12px
			--slider-track-radius 999px
			--slider-thumb-radius 50%
			--slider-track-color rgba(255, 255, 255, .16)
			--slider-fill-color #38bdf8
			--slider-thumb-color #e0f2fe
			appearance none
			inline-size 78px
			block-size 18px
			margin 0
			padding 0
			border 0
			border-radius 0
			background transparent
			cursor pointer

			@media (max-width 820px)
				inline-size 56px

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
</style>

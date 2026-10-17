<template>
	<aside
		v-if="ui.visible"
		class="GpuSimplificationHud"
		:class="{
			'GpuSimplificationHud--collapsed': !expanded,
			'GpuSimplificationHud--fallback': ui.backend === 'webgl2',
		}"
		aria-label="GPU simplification controls"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<header class="GpuSimplificationHud__header">
			<span :class="`GpuSimplificationHud__title GpuSimplificationHud__title--${badgeTone}`">
				<i aria-hidden="true" />GPU Simplification
			</span>
			<button
				class="GpuSimplificationHud__collapse"
				type="button"
				:aria-expanded="expanded"
				:aria-label="expanded ? 'Collapse controls' : 'Expand controls'"
				@click="expanded = !expanded"
			>{{ expanded ? 'Hide' : 'Show' }}</button>
		</header>

		<div v-if="expanded" class="GpuSimplificationHud__body">
			<section class="GpuSimplificationHud__stats" aria-label="Reduction stats">
				<div class="GpuSimplificationHud__statMain">
					<span>Points</span>
					<strong :class="{ 'is-pending': ui.busy }">
						{{ formatCount( ui.sourcePointCount ) }} <i>→</i> {{ retainedLabel }}
					</strong>
				</div>
				<div class="GpuSimplificationHud__statRow">
					<div>
						<span>Reduction</span>
						<strong>{{ reductionLabel }}</strong>
					</div>
					<div>
						<span>GPU</span>
						<strong>{{ gpuTimeLabel }}</strong>
					</div>
				</div>
			</section>

			<section class="GpuSimplificationHud__group" aria-label="Models">
				<span class="GpuSimplificationHud__label">Model</span>
				<div class="GpuSimplificationHud__datasets">
					<button
						v-for="dataset in api.datasets"
						:key="dataset.id"
						type="button"
						:aria-pressed="ui.datasetId === dataset.id"
						@click="api.setDataset( dataset.id )"
					>{{ shortDatasetLabel( dataset ) }}</button>
				</div>
			</section>

			<section class="GpuSimplificationHud__group" aria-label="Display options">
				<div class="GpuSimplificationHud__modes" role="group" aria-label="Line or Ribbon">
					<button
						type="button"
						:aria-pressed="ui.renderMode === 'ribbons'"
						@click="selectBaseMode( 'ribbons' )"
					>Ribbon</button>
					<button
						type="button"
						:aria-pressed="ui.renderMode === 'lines'"
						@click="selectBaseMode( 'lines' )"
					>Line</button>
				</div>

				<label class="GpuSimplificationHud__toggle">
					<input
						type="checkbox"
						:checked="ui.renderMode === 'wireframe'"
						@change="toggleWireframe( $event.target.checked )"
					>
					<span class="GpuSimplificationHud__switch" aria-hidden="true" />
					<span>Wireframe <em>(topology)</em></span>
				</label>

				<div class="GpuSimplificationHud__slider">
					<div class="GpuSimplificationHud__sliderHead">
						<label for="gpu-simplification-width">LineWidth</label>
						<strong>{{ ui.lineWidth.toFixed( 2 ) }}</strong>
					</div>
					<input
						id="gpu-simplification-width"
						type="range"
						min="0.05"
						max="2"
						step="0.01"
						:value="ui.lineWidth"
						:style="{ '--slider-progress': `${( ui.lineWidth - 0.05 ) / ( 2 - 0.05 ) * 100}%` }"
						:aria-valuetext="`line width ${ui.lineWidth.toFixed( 2 )}`"
						@input="api.setLineWidth( Number( $event.target.value ) )"
					>
				</div>
			</section>

			<section class="GpuSimplificationHud__group" aria-label="Reduction options">
				<div class="GpuSimplificationHud__modes" role="group" aria-label="Comparison view">
					<button
						type="button"
						:aria-pressed="ui.detail === 'after'"
						:disabled="controlsDisabled"
						@click="api.setDetailView( 'after' )"
					>Reduced</button>
					<button
						type="button"
						:aria-pressed="ui.detail === 'before'"
						@click="api.setDetailView( 'before' )"
					>Original</button>
				</div>

				<div class="GpuSimplificationHud__slider">
					<div class="GpuSimplificationHud__sliderHead">
						<label for="gpu-simplification-level">Reduction</label>
						<strong>{{ ui.level === 0 ? 'Lossless' : `${ui.level}% · ${formatTolerance( ui.worldTolerance )}` }}</strong>
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
						:aria-valuetext="`reduction level ${ui.level} of 100`"
						@input="api.setSimplificationLevel( Number( $event.target.value ), false )"
						@change="api.setSimplificationLevel( Number( $event.target.value ), true )"
					>
				</div>

				<div class="GpuSimplificationHud__slider">
					<div class="GpuSimplificationHud__sliderHead">
						<label for="gpu-simplification-relax">Smooth (relax)</label>
						<strong>{{ ui.relax > 0 ? `${ui.relax}` : 'Off' }}</strong>
					</div>
					<input
						id="gpu-simplification-relax"
						type="range"
						min="0"
						:max="relaxMax"
						step="1"
						:value="ui.relax"
						:style="{ '--slider-progress': `${ui.relax / relaxMax * 100}%` }"
						:disabled="controlsDisabled"
						:aria-valuetext="ui.relax > 0 ? `${ui.relax} relaxation passes` : 'relaxation off'"
						@input="api.setRelax( Number( $event.target.value ), false )"
						@change="api.setRelax( Number( $event.target.value ), true )"
					>
				</div>

				<label class="GpuSimplificationHud__toggle">
					<input
						type="checkbox"
						:checked="ui.cameraLod"
						:disabled="controlsDisabled"
						@change="api.setCameraLod( $event.target.checked )"
					>
					<span class="GpuSimplificationHud__switch" aria-hidden="true" />
					<span>Screen LOD <em>(zoom)</em></span>
				</label>
			</section>
		</div>
	</aside>
</template>

<script>
const countFormat = new Intl.NumberFormat( 'en-US' )

const SHORT_LABELS = {
	anime: 'Anime',
	france: 'France',
	gps: 'GPS',
	isolines: 'Isolines',
}

export default {
	name: 'GpuSimplificationUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			expanded: true,
			lastBaseMode: 'ribbons',
			relaxMax: 24,
		}
	},
	computed: {
		ui() {
			return this.api.ui
		},
		badgeTone() {
			if ( this.ui.backend === 'webgpu' ) return this.ui.busy ? 'busy' : 'gpu'
			if ( this.ui.backend === 'webgl2' ) return 'fallback'
			return 'loading'
		},
		controlsDisabled() {
			return this.ui.backend !== 'webgpu'
		},
		retainedLabel() {
			if ( this.ui.retainedPointCount == null ) return '…'
			return this.formatCount( this.ui.retainedPointCount )
		},
		reductionLabel() {
			if ( this.ui.retainedPointCount == null || !this.ui.sourcePointCount ) return '—'
			const reduction = 1 - this.ui.retainedPointCount / this.ui.sourcePointCount
			return `−${( reduction * 100 ).toFixed( reduction > 0.99 ? 2 : 1 )}%`
		},
		gpuTimeLabel() {
			if ( this.ui.gpuComputeMs == null ) return this.ui.timingSupported ? '…' : 'N/A'
			return `${this.ui.gpuComputeMs.toFixed( this.ui.gpuComputeMs < 1 ? 2 : 1 )} ms`
		},
	},
	methods: {
		shortDatasetLabel( dataset ) {
			return SHORT_LABELS[dataset.id] || dataset.label
		},
		selectBaseMode( mode ) {
			this.lastBaseMode = mode
			this.api.setRenderMode( mode )
		},
		toggleWireframe( enabled ) {
			if ( enabled ) {
				if ( this.ui.renderMode !== 'wireframe' ) {
					this.lastBaseMode = this.ui.renderMode
				}
				this.api.setRenderMode( 'wireframe' )
			} else {
				this.api.setRenderMode( this.lastBaseMode || 'ribbons' )
			}
		},
		formatCount( value ) {
			return value == null ? '—' : countFormat.format( value )
		},
		formatTolerance( value ) {
			if ( value == null || value === 0 ) return '0'
			if ( value < 0.01 ) return value.toFixed( 4 )
			return value < 0.1 ? value.toFixed( 3 ) : value.toFixed( 2 )
		},
	},
}
</script>

<style lang="stylus" scoped>
.GpuSimplificationHud
	position fixed
	top 68px
	right 68px
	z-index 30
	box-sizing border-box
	width 256px
	max-width calc(100vw - 32px)
	padding 12px 14px
	border 1px solid rgba(255, 255, 255, .1)
	border-radius 14px
	background rgba(7, 13, 24, .82)
	box-shadow 0 16px 40px rgba(0, 0, 0, .4)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	font 500 11px/1.35 system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	text-align left
	color #eef6fc
	user-select none
	touch-action pan-y

	&--collapsed
		width auto

	&--fallback
		border-color rgba(251, 191, 36, .28)

	&__header
		display flex
		align-items center
		justify-content space-between
		gap 10px

	&__title
		display inline-flex
		align-items center
		gap 7px
		font-size 10px
		font-weight 700
		letter-spacing .08em
		text-transform uppercase
		color rgba(235, 246, 255, .88)

		i
			width 6px
			height 6px
			border-radius 50%
			background #718292

		&--gpu i
			background #47ecc3
			box-shadow 0 0 8px rgba(71, 236, 195, .85)

		&--busy i
			background #38d5f5
			box-shadow 0 0 9px rgba(56, 213, 245, .9)

		&--fallback i
			background #fbbf24

	&__collapse
		appearance none
		padding 3px 8px
		border 1px solid rgba(255, 255, 255, .12)
		border-radius 6px
		background rgba(255, 255, 255, .04)
		font inherit
		font-size 10px
		color rgba(255, 255, 255, .7)
		cursor pointer

		&:hover,
		&:focus-visible
			border-color rgba(104, 225, 255, .5)
			color #fff

	&__body
		display flex
		flex-direction column
		gap 10px
		margin-top 10px

	&__stats
		padding 9px 10px
		border 1px solid rgba(255, 255, 255, .08)
		border-radius 10px
		background rgba(255, 255, 255, .03)

	&__statMain
		display flex
		align-items baseline
		justify-content space-between
		gap 8px

		span
			font-size 9px
			font-weight 600
			letter-spacing .06em
			text-transform uppercase
			color rgba(185, 210, 226, .6)

		strong
			font-size 12px
			font-weight 700
			color #fff

			&.is-pending
				color #7de9ff

		i
			margin 0 2px
			font-style normal
			color #46daf3

	&__statRow
		display grid
		grid-template-columns 1fr 1fr
		gap 8px
		margin-top 6px
		padding-top 6px
		border-top 1px solid rgba(255, 255, 255, .06)

		div
			display flex
			align-items baseline
			justify-content space-between
			gap 6px

		span
			font-size 9px
			color rgba(185, 210, 226, .58)

		strong
			font-size 11px
			font-weight 700
			color #aef4ff

	&__group
		display flex
		flex-direction column
		gap 7px
		padding-top 9px
		border-top 1px solid rgba(255, 255, 255, .07)

	&__label
		font-size 9px
		font-weight 700
		letter-spacing .07em
		text-transform uppercase
		color rgba(185, 210, 226, .58)

	&__datasets
		display grid
		grid-template-columns repeat(4, minmax(0, 1fr))
		gap 4px

		button
			appearance none
			padding 6px 4px
			border 1px solid rgba(255, 255, 255, .08)
			border-radius 7px
			background rgba(255, 255, 255, .03)
			font inherit
			font-size 10px
			font-weight 600
			text-align center
			color rgba(226, 240, 250, .68)
			cursor pointer

			&:hover,
			&:focus-visible
				border-color rgba(104, 225, 255, .38)
				color #fff

			&[aria-pressed='true']
				border-color rgba(72, 221, 247, .48)
				background rgba(22, 178, 208, .2)
				color #d8f8ff

	&__modes
		display grid
		grid-template-columns repeat(2, minmax(0, 1fr))
		gap 3px
		padding 2px
		border 1px solid rgba(255, 255, 255, .08)
		border-radius 8px
		background rgba(0, 0, 0, .25)

		button
			appearance none
			padding 5px 6px
			border 1px solid transparent
			border-radius 6px
			background transparent
			font inherit
			font-size 10px
			font-weight 600
			color rgba(225, 239, 247, .6)
			cursor pointer

			&:hover,
			&:focus-visible
				color #fff

			&[aria-pressed='true']
				border-color rgba(72, 221, 247, .36)
				background rgba(22, 178, 208, .18)
				color #d2f9ff

			&:disabled
				opacity .4
				cursor not-allowed

	&__toggle
		display flex
		align-items center
		justify-content space-between
		gap 8px
		padding 2px 0
		font-size 10px
		font-weight 600
		color rgba(226, 240, 250, .82)
		cursor pointer

		em
			font-style normal
			font-weight 500
			color rgba(185, 210, 226, .52)

		input
			position absolute
			opacity 0
			pointer-events none

	&__switch
		position relative
		order 2
		flex 0 0 auto
		width 28px
		height 16px
		border 1px solid rgba(255, 255, 255, .16)
		border-radius 999px
		background rgba(255, 255, 255, .08)

		&::after
			content ''
			position absolute
			top 3px
			left 3px
			width 8px
			height 8px
			border-radius 50%
			background rgba(255, 255, 255, .6)
			transition transform .15s ease, background .15s ease

	&__toggle input:checked + &__switch
		border-color rgba(48, 216, 241, .48)
		background rgba(29, 192, 218, .25)

		&::after
			transform translateX(12px)
			background #71efff

	&__toggle input:focus-visible + &__switch
		outline 2px solid #6de4ff
		outline-offset 2px

	&__slider
		display flex
		flex-direction column
		gap 3px

		input[type='range']
			--slider-track-size 5px
			--slider-thumb-size 15px
			--slider-track-radius 999px
			--slider-thumb-radius 50%
			--slider-track-color rgba(255, 255, 255, .12)
			--slider-fill-color #3ddcf5
			--slider-progress 50%
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
			background linear-gradient(90deg, var(--slider-fill-color) 0 var(--slider-progress), var(--slider-track-color) var(--slider-progress) 100%)

		input[type='range']::-webkit-slider-thumb
			-webkit-appearance none
			appearance none
			inline-size var(--slider-thumb-size)
			block-size var(--slider-thumb-size)
			margin-block-start calc((var(--slider-track-size) - var(--slider-thumb-size)) / 2)
			border 2px solid #e6fcff
			border-radius var(--slider-thumb-radius)
			background #12b9d7
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
			inline-size 11px
			block-size 11px
			border 2px solid #e6fcff
			border-radius var(--slider-thumb-radius)
			background #12b9d7

		input[type='range']:focus-visible
			outline 2px solid #6de4ff
			outline-offset 2px

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
			color rgba(226, 240, 250, .8)

		strong
			font-size 10px
			font-weight 700
			color #8cecff

	button:focus-visible
		outline 2px solid #6de4ff
		outline-offset 2px

@media (max-width: 700px)
	.GpuSimplificationHud
		top auto
		right 10px
		bottom 72px
		left 10px
		width auto
		max-width none

		&--collapsed
			left auto
			width auto
</style>

<template>
	<aside
		v-if="ui.visible"
		class="GpuSimplificationHud"
		:class="{
			'GpuSimplificationHud--collapsed': !expanded,
			'GpuSimplificationHud--fallback': ui.backend === 'webgl2',
		}"
		aria-label="GPU simplification controls and live results"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<header class="GpuSimplificationHud__header">
			<div>
				<p class="GpuSimplificationHud__eyebrow">GPU Simplification · Experimental</p>
				<span :class="`GpuSimplificationHud__badge GpuSimplificationHud__badge--${badgeTone}`">
					<i aria-hidden="true" />{{ badgeLabel }}
				</span>
			</div>
			<button
				class="GpuSimplificationHud__collapse"
				type="button"
				:aria-expanded="expanded"
				:aria-label="expanded ? 'Collapse GPU simplification controls' : 'Expand GPU simplification controls'"
				@click="expanded = !expanded"
			>{{ expanded ? 'Hide' : 'Tune' }}</button>
		</header>

		<div v-if="expanded" class="GpuSimplificationHud__body">
			<nav class="GpuSimplificationHud__datasets" aria-label="Source dataset">
				<button
					v-for="dataset in api.datasets"
					:key="dataset.id"
					type="button"
					:aria-pressed="ui.datasetId === dataset.id"
					@click="api.setDataset( dataset.id )"
				>
					<strong>{{ dataset.label }}</strong>
					<small>{{ dataset.subtitle }}</small>
				</button>
			</nav>
			<p class="GpuSimplificationHud__datasetNote">{{ ui.datasetDescription }}</p>

			<section class="GpuSimplificationHud__hero" aria-label="Point reduction">
				<div>
					<span>Source points</span>
					<strong>{{ formatCount( ui.sourcePointCount ) }}</strong>
				</div>
				<i aria-hidden="true">→</i>
				<div>
					<span>{{ ui.relax > 0 ? 'Relaxed · kept' : 'Kept' }}</span>
					<strong :class="{ 'is-pending': ui.busy }">{{ retainedLabel }}</strong>
				</div>
			</section>

			<section class="GpuSimplificationHud__metrics" aria-label="Simplification metrics">
				<article>
					<span>Reduction</span>
					<strong>{{ reductionLabel }}</strong>
					<small>{{ ui.lineCount }} polylines</small>
				</article>
				<article>
					<span>GPU</span>
					<strong>{{ gpuTimeLabel }}</strong>
					<small>{{ timingDetail }}</small>
				</article>
				<article>
					<span>CPU reference</span>
					<strong>{{ cpuTimeLabel }}</strong>
					<small>{{ cpuDetail }}</small>
				</article>
			</section>

			<section class="GpuSimplificationHud__control" aria-labelledby="simplification-level-label">
				<div class="GpuSimplificationHud__controlHeading">
					<label id="simplification-level-label" for="gpu-simplification-level">Tolerance</label>
					<strong>{{ ui.level === 0 ? 'lossless' : formatTolerance( ui.worldTolerance ) + ' world units' }}</strong>
				</div>
				<input
					id="gpu-simplification-level"
					type="range"
					min="0"
					max="100"
					step="1"
					:value="ui.level"
					:style="{ '--level': `${ui.level}%` }"
					:disabled="controlsDisabled"
					:aria-valuetext="`tolerance level ${ui.level} of 100`"
					@input="api.setSimplificationLevel( Number( $event.target.value ), false )"
					@change="api.setSimplificationLevel( Number( $event.target.value ), true )"
				>
				<div class="GpuSimplificationHud__rangeLabels" aria-hidden="true">
					<span>Lossless</span><span>Balanced</span><span>Brutal</span>
				</div>

				<div class="GpuSimplificationHud__controlHeading">
					<label id="simplification-relax-label" for="gpu-simplification-relax">Relax</label>
					<strong>{{ ui.relax > 0 ? `${ui.relax} pass${ui.relax > 1 ? 'es' : ''}` : 'off' }}</strong>
				</div>
				<input
					id="gpu-simplification-relax"
					type="range"
					min="0"
					:max="relaxMax"
					step="1"
					:value="ui.relax"
					:style="{ '--level': `${ui.relax / relaxMax * 100}%` }"
					:disabled="controlsDisabled"
					:aria-labelledby="'simplification-relax-label'"
					:aria-valuetext="ui.relax > 0 ? `${ui.relax} relaxation passes` : 'relaxation off'"
					@input="api.setRelax( Number( $event.target.value ), false )"
					@change="api.setRelax( Number( $event.target.value ), true )"
				>
				<p v-if="relaxIsInert">
					At this tolerance the simplifier discards everything relaxation smooths, so this slider has
					nothing left to affect. Lower the tolerance to see it work.
				</p>
				<p v-else>
					Relaxation runs <em>before</em> the simplifier: it eases every point toward its neighbours,
					so steps and jitter become gentle curves and Douglas-Peucker has far less to keep.
				</p>
			</section>

			<div class="GpuSimplificationHud__viewRow">
				<nav class="GpuSimplificationHud__modes" aria-label="Comparison view">
					<button
						type="button"
						:aria-pressed="ui.detail === 'after'"
						:disabled="controlsDisabled"
						@click="api.setDetailView( 'after' )"
					>Simplified</button>
					<button
						type="button"
						:aria-pressed="ui.detail === 'before'"
						@click="api.setDetailView( 'before' )"
					>Original</button>
				</nav>
			</div>

			<nav class="GpuSimplificationHud__modes GpuSimplificationHud__modes--triple" aria-label="Render mode">
				<button
					v-for="mode in renderModes"
					:key="mode.id"
					type="button"
					:aria-pressed="ui.renderMode === mode.id"
					@click="api.setRenderMode( mode.id )"
				>{{ mode.label }}</button>
			</nav>

			<label class="GpuSimplificationHud__toggle">
				<input
					type="checkbox"
					:checked="ui.cameraLod"
					:disabled="controlsDisabled"
					@change="api.setCameraLod( $event.target.checked )"
				>
				<span aria-hidden="true" />Screen-space LOD (re-runs while the camera moves)
			</label>

			<section v-if="ui.detail === 'after'" class="GpuSimplificationHud__legend" aria-label="Heatmap legend">
				<div class="GpuSimplificationHud__sectionHeading">
					<span>Source points collapsed per emitted segment</span>
					<strong>Adaptive density</strong>
				</div>
				<i class="GpuSimplificationHud__gradient" aria-hidden="true" />
				<div class="GpuSimplificationHud__legendTicks" aria-hidden="true">
					<span>1× detail</span><span>16×</span><span>256×</span><span>4,096× collapsed</span>
				</div>
			</section>

			<p class="GpuSimplificationHud__algorithm">
				<span>Method</span>
				Taubin relaxation, then Douglas-Peucker. The line is cut into chunks whose length follows the
				tolerance, {{ refinePasses }} parallel refinement passes split each open interval at its farthest
				point, and an exact flush, a prefix-sum compaction and one indirect draw finish the job.
			</p>
			<p class="GpuSimplificationHud__status" aria-live="polite">{{ ui.status }}</p>
		</div>
	</aside>
</template>

<script>
const countFormat = new Intl.NumberFormat( 'en-US' )

export default {
	name: 'GpuSimplificationUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			expanded: true,
			refinePasses: 48,
			relaxMax: 24,
			renderModes: [
				{ id: 'ribbons', label: 'Ribbons' },
				{ id: 'lines', label: 'Centerline' },
				{ id: 'wireframe', label: 'Topology' },
			],
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
		badgeLabel() {
			if ( this.ui.backend === 'webgpu' ) {
				if ( this.ui.busy ) return 'GPU rebuilding'
				return this.ui.cameraLod ? 'Native WebGPU · camera LOD' : 'Native WebGPU · one shot'
			}
			if ( this.ui.backend === 'webgl2' ) return 'Full-detail fallback'
			return 'Preparing GPU pipeline'
		},
		controlsDisabled() {
			return this.ui.backend !== 'webgpu'
		},
		// Past roughly this point Douglas-Peucker throws away every wavelength the
		// relaxation touches, so the two sliders stop interacting. Saying so beats
		// letting people push both to the top and wonder why nothing changes.
		relaxIsInert() {
			return this.ui.level >= 85
		},
		retainedLabel() {
			if ( this.ui.retainedPointCount == null ) return 'Measuring…'
			return this.formatCount( this.ui.retainedPointCount )
		},
		reductionLabel() {
			if ( this.ui.retainedPointCount == null || !this.ui.sourcePointCount ) return '—'
			const reduction = 1 - this.ui.retainedPointCount / this.ui.sourcePointCount
			return `${( reduction * 100 ).toFixed( reduction > 0.99 ? 2 : 1 )}%`
		},
		gpuTimeLabel() {
			if ( this.ui.gpuComputeMs == null ) return this.ui.timingSupported ? 'Measuring…' : 'N/A'
			return `${this.ui.gpuComputeMs.toFixed( this.ui.gpuComputeMs < 1 ? 3 : 2 )} ms`
		},
		timingDetail() {
			if ( !this.ui.timingSupported ) return 'timestamp unavailable'
			if ( this.ui.timingSource === 'queue-completion-wall-time' ) return 'queue-complete wall time'
			return 'timestamp query'
		},
		cpuTimeLabel() {
			if ( this.ui.cpuReferenceMs == null ) return this.ui.cpuReferencePending ? 'Running…' : '—'
			return `${this.ui.cpuReferenceMs.toFixed( this.ui.cpuReferenceMs < 1 ? 3 : 1 )} ms`
		},
		cpuDetail() {
			if ( this.ui.cpuReferencePending ) return 'single-threaded oracle'
			if ( this.ui.cpuReferenceCount == null ) return this.ui.cameraLod ? 'skipped in LOD mode' : 'not run'
			if ( this.ui.retainedPointCount == null ) return 'single-threaded oracle'
			const delta = this.ui.retainedPointCount - this.ui.cpuReferenceCount
			if ( delta === 0 ) return 'identical result'
			return `${delta > 0 ? '+' : ''}${countFormat.format( delta )} pts vs GPU`
		},
	},
	methods: {
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
	width 390px
	max-width calc(100vw - 92px)
	max-height calc(100vh - 92px)
	overflow-y auto
	padding 16px
	border 1px solid rgba(95, 222, 255, .24)
	border-radius 20px
	background linear-gradient(145deg, rgba(7, 15, 29, .94), rgba(4, 8, 18, .88))
	box-shadow 0 24px 80px rgba(0, 0, 0, .48), inset 0 1px rgba(255, 255, 255, .08)
	backdrop-filter blur(18px)
	-webkit-backdrop-filter blur(18px)
	font 500 12px/1.4 system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	text-align left
	color #f4f9ff
	user-select none
	touch-action pan-y
	scrollbar-width thin
	scrollbar-color rgba(64, 211, 238, .42) transparent

	&--collapsed
		width 292px

	&--fallback
		border-color rgba(251, 191, 36, .24)

	&__header
		display flex
		align-items flex-start
		justify-content space-between
		gap 12px

	&__eyebrow
		margin 0 0 6px
		font-size 9px
		font-weight 800
		letter-spacing .15em
		text-transform uppercase
		color rgba(204, 225, 239, .62)

	&__badge
		display inline-flex
		align-items center
		gap 7px
		font-size 10px
		font-weight 750
		letter-spacing .07em
		text-transform uppercase

		i
			width 7px
			height 7px
			border-radius 50%

		&--gpu
			color #8df7dc

			i
				background #47ecc3
				box-shadow 0 0 11px rgba(71, 236, 195, .9)

		&--busy
			color #7de9ff

			i
				background #38d5f5
				box-shadow 0 0 12px rgba(56, 213, 245, .95)
				animation gpuSimplificationPulse 1s ease-in-out infinite

		&--fallback
			color #ffd488

			i
				background #fbbf24
				box-shadow 0 0 11px rgba(251, 191, 36, .75)

		&--loading
			color #a8b5c1

			i
				background #718292

	&__collapse
		appearance none
		flex 0 0 auto
		min-height 32px
		padding 5px 10px
		border 1px solid rgba(255, 255, 255, .13)
		border-radius 8px
		background rgba(255, 255, 255, .05)
		font inherit
		font-size 10px
		color rgba(255, 255, 255, .72)
		cursor pointer

		&:hover,
		&:focus-visible
			border-color rgba(104, 225, 255, .58)
			color #fff

	&__body
		padding-top 14px

	&__datasets
		display grid
		gap 5px
		grid-template-columns repeat(2, minmax(0, 1fr))

		button
			appearance none
			display flex
			min-width 0
			flex-direction column
			gap 1px
			padding 8px 9px
			border 1px solid rgba(255, 255, 255, .09)
			border-radius 10px
			background rgba(1, 7, 15, .4)
			font inherit
			text-align left
			cursor pointer

			strong
				overflow hidden
				font-size 11px
				font-weight 740
				white-space nowrap
				text-overflow ellipsis
				color rgba(233, 244, 250, .78)

			small
				overflow hidden
				font-size 8px
				white-space nowrap
				text-overflow ellipsis
				color rgba(178, 202, 216, .5)

			&:hover,
			&:focus-visible
				border-color rgba(104, 225, 255, .4)

			&[aria-pressed='true']
				border-color rgba(72, 221, 247, .42)
				background rgba(22, 178, 208, .18)

				strong
					color #d6f7ff

	&__datasetNote
		margin 7px 1px 0
		font-size 9px
		line-height 1.45
		color rgba(190, 211, 224, .56)

	&__hero
		display grid
		grid-template-columns 1fr auto 1fr
		align-items center
		gap 12px
		margin-top 10px
		padding 13px
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 14px
		background linear-gradient(135deg, rgba(18, 52, 74, .52), rgba(11, 21, 39, .42))

		div
			display flex
			min-width 0
			flex-direction column

			&:last-child
				text-align right

		span
			font-size 9px
			font-weight 700
			letter-spacing .08em
			text-transform uppercase
			color rgba(189, 213, 227, .62)

		strong
			margin-top 2px
			overflow hidden
			font-size 20px
			font-weight 780
			line-height 1.05
			letter-spacing -.035em
			white-space nowrap
			text-overflow ellipsis
			color #fff

			&.is-pending
				color #8aeaff

		> i
			font-style normal
			font-size 18px
			color #55dff6

	&__metrics
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 6px
		margin-top 8px

		article
			display flex
			min-width 0
			padding 9px
			border 1px solid rgba(255, 255, 255, .08)
			border-radius 10px
			background rgba(1, 7, 15, .36)
			flex-direction column

		span
			font-size 8px
			font-weight 750
			letter-spacing .08em
			text-transform uppercase
			color rgba(161, 193, 211, .58)

		strong
			margin-top 3px
			font-size 14px
			font-weight 760
			color #dffaff

		small
			margin-top 1px
			overflow hidden
			font-size 8px
			white-space nowrap
			text-overflow ellipsis
			color rgba(190, 207, 218, .5)

	&__control
		margin-top 12px
		padding 12px
		border 1px solid rgba(69, 217, 241, .13)
		border-radius 13px
		background rgba(10, 30, 46, .32)

		input[type='range']
			appearance none
			width 100%
			height 26px
			margin 5px 0 0
			background transparent
			cursor pointer

			&::-webkit-slider-runnable-track
				height 6px
				border-radius 999px
				background linear-gradient(90deg, #3ddcf5 0 var(--level), rgba(255, 255, 255, .12) var(--level) 100%)

			&::-webkit-slider-thumb
				appearance none
				width 19px
				height 19px
				margin-top -6.5px
				border 3px solid #dffcff
				border-radius 50%
				background #12b9d7
				box-shadow 0 0 0 4px rgba(41, 215, 240, .16), 0 4px 12px rgba(0, 0, 0, .35)

			&::-moz-range-track
				height 6px
				border-radius 999px
				background rgba(255, 255, 255, .12)

			&::-moz-range-progress
				height 6px
				border-radius 999px
				background #3ddcf5

			&::-moz-range-thumb
				width 14px
				height 14px
				border 3px solid #dffcff
				border-radius 50%
				background #12b9d7

			&:focus-visible
				outline 2px solid #6de4ff
				outline-offset 3px

			&:disabled
				opacity .42
				cursor not-allowed

		> p
			margin 7px 0 0
			font-size 9px
			color rgba(192, 214, 227, .58)

	&__controlHeading,
	&__sectionHeading
		display flex
		align-items baseline
		justify-content space-between
		gap 12px
		margin-top 6px

		span,
		label
			font-size 10px
			font-weight 720
			color rgba(224, 238, 246, .78)

		strong
			font-size 10px
			font-weight 760
			color #8cecff

	&__rangeLabels
		display flex
		justify-content space-between
		margin-top -2px
		font-size 8px
		color rgba(176, 200, 214, .47)

	&__viewRow
		display flex
		align-items center
		gap 8px
		margin-top 10px

	&__modes
		display grid
		width 100%
		min-width 0
		padding 3px
		border 1px solid rgba(255, 255, 255, .09)
		border-radius 10px
		background rgba(0, 0, 0, .25)
		grid-template-columns repeat(2, minmax(0, 1fr))

		&--triple
			margin-top 6px
			grid-template-columns repeat(3, minmax(0, 1fr))

		button
			appearance none
			min-height 34px
			padding 6px
			border 1px solid transparent
			border-radius 7px
			background transparent
			font inherit
			font-size 9px
			font-weight 700
			color rgba(225, 239, 247, .58)
			cursor pointer

			&:hover,
			&:focus-visible
				color #fff

			&[aria-pressed='true']
				border-color rgba(72, 221, 247, .36)
				background rgba(22, 178, 208, .17)
				color #c8f8ff

	&__toggle
		display inline-flex
		align-items center
		min-height 40px
		gap 7px
		font-size 9px
		color rgba(221, 236, 244, .64)
		cursor pointer

		input
			position absolute
			opacity 0
			pointer-events none

		span
			position relative
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
				background rgba(255, 255, 255, .58)
				transition transform .15s ease, background .15s ease

		input:checked + span
			border-color rgba(48, 216, 241, .44)
			background rgba(29, 192, 218, .25)

			&::after
				transform translateX(12px)
				background #71efff

		input:focus-visible + span
			outline 2px solid #6de4ff
			outline-offset 2px

	&__legend
		margin-top 4px
		padding 11px
		border 1px solid rgba(255, 255, 255, .08)
		border-radius 12px
		background rgba(3, 10, 19, .38)

	&__gradient
		display block
		height 7px
		margin-top 9px
		border-radius 999px
		background linear-gradient(90deg, #38bdf8, #5eead4 35%, #facc15 70%, #fb7185)
		box-shadow 0 0 14px rgba(67, 220, 233, .2)

	&__legendTicks
		display flex
		justify-content space-between
		margin-top 4px
		font-size 7px
		color rgba(190, 210, 222, .47)

	&__algorithm
		margin 10px 1px 0
		font-size 9px
		line-height 1.45
		color rgba(190, 211, 224, .58)

		span
			margin-right 5px
			font-weight 760
			letter-spacing .06em
			text-transform uppercase
			color #7de9f9

	&__status
		min-height 13px
		margin 8px 1px 0
		font-size 9px
		color rgba(126, 230, 245, .72)

	button:focus-visible
		outline 2px solid #6de4ff
		outline-offset 2px

@keyframes gpuSimplificationPulse
	0%, 100%
		opacity .55
		transform scale(.86)
	50%
		opacity 1
		transform scale(1)

@media (max-width: 700px), (max-height: 660px)
	.GpuSimplificationHud
		top auto
		right 10px
		bottom 72px
		left 10px
		width auto
		max-width none
		max-height min(56vh, 540px)
		padding 13px
		border-radius 17px

		&--collapsed
			left auto
			width 275px

@media (prefers-reduced-motion: reduce)
	.GpuSimplificationHud *
		animation-duration .001ms !important
		transition-duration .001ms !important
</style>

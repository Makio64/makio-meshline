<template>
	<aside
		v-show="!noUI"
		class="MeshlineComputeGui"
		:data-mode="params.mode"
		:data-open="params.open ? 'true' : 'false'"
		aria-label="Compute curve controls"
		@pointerdown.stop
	>
		<header class="MeshlineComputeGui__header">
			<div class="MeshlineComputeGui__titleGroup">
				<span class="MeshlineComputeGui__dot" aria-hidden="true" />
				<span class="MeshlineComputeGui__title">Compute</span>
				<span class="MeshlineComputeGui__badge" aria-live="polite">
					{{ activeModeLabel }} · {{ params.curveCount }} curves
				</span>
			</div>
			<button
				type="button"
				class="MeshlineComputeGui__collapse"
				:aria-expanded="String( params.open )"
				:aria-label="params.open ? 'Collapse compute controls' : 'Expand compute controls'"
				:title="params.open ? 'Collapse controls' : 'Expand controls'"
				@click="params.open = !params.open"
			>
				<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
					<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</header>

		<div class="MeshlineComputeGui__telemetry" role="status" aria-live="polite">
			<div class="MeshlineComputeGui__stat">
				<span class="MeshlineComputeGui__statLabel">Curves</span>
				<strong class="MeshlineComputeGui__statValue">{{ params.curveCount }}</strong>
			</div>
			<div class="MeshlineComputeGui__stat">
				<span class="MeshlineComputeGui__statLabel">Points</span>
				<strong class="MeshlineComputeGui__statValue">{{ pointCountLabel }}</strong>
			</div>
			<div class="MeshlineComputeGui__stat">
				<span class="MeshlineComputeGui__statLabel">Solver</span>
				<strong class="MeshlineComputeGui__statValue">{{ activeModeLabel }}</strong>
			</div>
		</div>

		<div v-show="params.open" class="MeshlineComputeGui__body">
			<div class="MeshlineComputeGui__toggles" role="group" aria-label="Simulation mode">
				<button
					v-for="mode in modes"
					:key="mode.id"
					type="button"
					class="MeshlineComputeGui__toggle"
					:aria-pressed="String( params.mode === mode.id )"
					@click="api.setMode( mode.id )"
				>
					<span class="MeshlineComputeGui__toggleDot" aria-hidden="true" />
					<span>{{ mode.label }}</span>
				</button>
			</div>

			<div class="MeshlineComputeGui__sliders">
				<div
					v-for="slider in sliders"
					:key="slider.id"
					class="MeshlineComputeGui__control"
					:style="{ '--slider-fill-color': slider.color, '--slider-progress': slider.progress }"
				>
					<div class="MeshlineComputeGui__controlHeader">
						<label :for="slider.id">{{ slider.label }}</label>
						<strong>{{ slider.display }}</strong>
					</div>
					<input
						:id="slider.id"
						type="range"
						:min="slider.min"
						:max="slider.max"
						:step="slider.step"
						:value="slider.value"
						:aria-valuetext="slider.ariaText"
						@input="slider.onInput( Number( $event.target.value ) )"
						@change="slider.onChange && slider.onChange( Number( $event.target.value ) )"
					>
				</div>
			</div>
		</div>
	</aside>
</template>

<script>
import { noUI } from '@/makio/utils/detect'

const POINTS_PER_CURVE = 64

const MODES = [
	{ id: 'autonomous', label: 'Galaxy' },
	{ id: 'follow', label: 'Follow' },
	{ id: 'field', label: 'Field' },
]

const progressPercent = ( value, min, max ) => `${Math.max( 0, Math.min( 100, ( ( value - min ) / ( max - min ) ) * 100 ) ).toFixed( 1 )}%`

export default {
	name: 'MeshlineComputeUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			noUI,
			modes: MODES,
		}
	},
	computed: {
		params() {
			return this.api.params
		},
		activeModeLabel() {
			const match = this.modes.find( mode => mode.id === this.params.mode )
			return match ? match.label : 'Galaxy'
		},
		pointCountLabel() {
			const total = this.params.curveCount * POINTS_PER_CURVE
			return total >= 1000 ? `${( total / 1000 ).toFixed( 1 )}k` : String( total )
		},
		sliders() {
			const { params } = this
			return [
				{
					id: 'meshline-compute-curves',
					label: 'Curves',
					min: 16,
					max: 320,
					step: 1,
					value: params.curveCount,
					display: String( params.curveCount ),
					ariaText: `${params.curveCount} curves`,
					color: '#ff7a9e',
					progress: progressPercent( params.curveCount, 16, 320 ),
					onInput: value => this.api.setCurveCount( value, false ),
					onChange: value => this.api.setCurveCount( value, true ),
				},
				{
					id: 'meshline-compute-mouse',
					label: 'Mouse strength',
					min: 0,
					max: 24,
					step: 0.1,
					value: params.mouseStrength,
					display: params.mouseStrength.toFixed( 1 ),
					ariaText: `mouse strength ${params.mouseStrength.toFixed( 1 )}`,
					color: '#fb923c',
					progress: progressPercent( params.mouseStrength, 0, 24 ),
					onInput: value => this.api.setMouseStrength( value ),
				},
				{
					id: 'meshline-compute-curl',
					label: 'Curl strength',
					min: 0,
					max: 5,
					step: 0.05,
					value: params.curlStrength,
					display: params.curlStrength.toFixed( 2 ),
					ariaText: `curl strength ${params.curlStrength.toFixed( 2 )}`,
					color: '#a78bfa',
					progress: progressPercent( params.curlStrength, 0, 5 ),
					onInput: value => this.api.setCurlStrength( value ),
				},
				{
					id: 'meshline-compute-stiffness',
					label: 'Stiffness',
					min: 0,
					max: 1,
					step: 0.01,
					value: params.stiffness,
					display: params.stiffness.toFixed( 2 ),
					ariaText: `stiffness ${params.stiffness.toFixed( 2 )}`,
					color: '#38bdf8',
					progress: progressPercent( params.stiffness, 0, 1 ),
					onInput: value => this.api.setStiffness( value ),
				},
				{
					id: 'meshline-compute-dash',
					label: 'Dash spacing',
					min: 0.5,
					max: 4,
					step: 0.01,
					value: params.dashSpacing,
					display: params.dashSpacing.toFixed( 2 ),
					ariaText: `dash spacing ${params.dashSpacing.toFixed( 2 )}`,
					color: '#34d399',
					progress: progressPercent( params.dashSpacing, 0.5, 4 ),
					onInput: value => this.api.setDashSpacing( value ),
				},
			]
		},
	},
}
</script>

<style lang="stylus" scoped>
.MeshlineComputeGui
	--topo-accent #ff7a9e
	position fixed
	top calc(18px + var(--sait, 0px))
	left calc(18px + var(--sail, 0px))
	z-index 24
	display grid
	gap 10px
	box-sizing border-box
	width unquote('min(292px, calc(100vw - 88px))')
	padding 12px 14px
	border 1px solid rgba(255, 255, 255, .11)
	border-radius 18px
	background rgba(7, 11, 20, .78)
	box-shadow 0 18px 42px rgba(0, 0, 0, .42), inset 0 1px 0 rgba(255, 255, 255, .06)
	backdrop-filter blur(16px)
	-webkit-backdrop-filter blur(16px)
	color rgba(241, 245, 249, .9)
	font 500 11px/1.25 'Inter', system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	text-align left
	user-select none

	&[data-mode='follow']
		--topo-accent #38bdf8

	&[data-mode='field']
		--topo-accent #a78bfa

	&__header
		display flex
		align-items center
		justify-content space-between
		gap 8px

	&__titleGroup
		display flex
		align-items center
		gap 7px
		min-width 0

	&__dot
		flex none
		width 7px
		height 7px
		border-radius 50%
		background var(--topo-accent)
		box-shadow 0 0 10px var(--topo-accent)
		transition background .2s ease, box-shadow .2s ease

	&__title
		color #fff
		font-size 10.5px
		font-weight 750
		letter-spacing .1em
		text-transform uppercase

	&__badge
		padding 3px 8px
		border 1px solid rgba(255, 122, 158, .3)
		border-radius 999px
		background rgba(255, 122, 158, .12)
		color #fda4af
		font-size 9.5px
		font-weight 700
		letter-spacing .04em
		white-space nowrap
		transition border-color .2s ease, background .2s ease, color .2s ease

	&[data-mode='follow'] &__badge
		border-color rgba(56, 189, 248, .28)
		background rgba(56, 189, 248, .12)
		color #7dd3fc

	&[data-mode='field'] &__badge
		border-color rgba(167, 139, 250, .32)
		background rgba(167, 139, 250, .14)
		color #ddd6fe

	&__collapse
		appearance none
		display inline-flex
		align-items center
		justify-content center
		width 26px
		height 26px
		padding 0
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 8px
		background rgba(255, 255, 255, .05)
		color rgba(226, 232, 240, .78)
		cursor pointer
		transition background .16s ease, border-color .16s ease, color .16s ease

		svg
			transition transform .2s ease

		&[aria-expanded='false'] svg
			transform rotate(-90deg)

		&:hover
			border-color rgba(255, 255, 255, .22)
			background rgba(255, 255, 255, .11)
			color #fff

		&:focus-visible
			outline 2px solid var(--topo-accent)
			outline-offset 2px

	&__telemetry
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 6px
		padding 7px 10px
		border 1px solid rgba(255, 255, 255, .07)
		border-radius 12px
		background rgba(15, 23, 42, .52)

	&__stat
		display grid
		gap 2px
		min-width 0

	&__statLabel
		color rgba(186, 206, 228, .62)
		font-size 9px
		font-weight 650
		letter-spacing .06em
		text-transform uppercase

	&__statValue
		color #fff
		font-size 13px
		font-weight 760
		letter-spacing -.02em

	&__body
		display grid
		gap 10px

	&__toggles
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 6px

	&__toggle
		appearance none
		display inline-flex
		align-items center
		justify-content center
		gap 6px
		min-height 30px
		padding 0 8px
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 10px
		background rgba(255, 255, 255, .04)
		color rgba(226, 232, 240, .72)
		font 650 10px/1 'Inter', system-ui, -apple-system, sans-serif
		letter-spacing .05em
		text-transform uppercase
		white-space nowrap
		cursor pointer
		transition border-color .16s ease, background .16s ease, color .16s ease

		&:hover
			background rgba(255, 255, 255, .09)
			color #fff

		&:focus-visible
			outline 2px solid var(--topo-accent)
			outline-offset 2px

		&[aria-pressed='true']
			border-color rgba(255, 122, 158, .42)
			background rgba(255, 122, 158, .16)
			color #fff

			.MeshlineComputeGui__toggleDot
				background var(--topo-accent)
				box-shadow 0 0 8px var(--topo-accent)
				opacity 1

	&[data-mode='follow'] &__toggle[aria-pressed='true']
		border-color rgba(56, 189, 248, .42)
		background rgba(56, 189, 248, .16)

	&[data-mode='field'] &__toggle[aria-pressed='true']
		border-color rgba(167, 139, 250, .42)
		background rgba(167, 139, 250, .16)

	&__toggleDot
		width 6px
		height 6px
		border-radius 50%
		background currentColor
		opacity .45
		transition background .16s ease, box-shadow .16s ease, opacity .16s ease

	&__sliders
		display grid
		gap 8px

	&__control
		display grid
		gap 3px

	&__controlHeader
		display flex
		align-items baseline
		justify-content space-between
		gap 8px

		label
			color rgba(203, 213, 225, .78)
			font-size 10px
			font-weight 600
			letter-spacing .02em
			cursor pointer

		strong
			color #f8fafc
			font-size 10.5px
			font-weight 700

	input[type='range']
		--slider-track-size 4px
		--slider-thumb-size 13px
		--slider-track-radius 999px
		--slider-thumb-radius 50%
		--slider-track-color rgba(255, 255, 255, .14)
		--slider-thumb-color #f8fafc
		appearance none
		inline-size 100%
		block-size 18px
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
		box-shadow 0 2px 6px rgba(0, 0, 0, .4)
		transition transform .12s ease

	input[type='range']:hover::-webkit-slider-thumb
		transform scale(1.12)

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
		box-shadow 0 2px 6px rgba(0, 0, 0, .4)

	input[type='range']:focus-visible
		outline 2px solid var(--slider-fill-color)
		outline-offset 3px

@media (max-width: 700px)
	.MeshlineComputeGui
		top calc(12px + var(--sait, 0px))
		left calc(12px + var(--sail, 0px))
		width unquote('min(272px, calc(100vw - 72px))')
		padding 10px 12px
		gap 8px

@media (prefers-reduced-motion: reduce)
	.MeshlineComputeGui
		&__dot,
		&__badge,
		&__collapse,
		&__collapse svg,
		&__toggle,
		&__toggleDot,
		input[type='range']::-webkit-slider-thumb
			transition none
</style>

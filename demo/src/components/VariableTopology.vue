<template>
	<aside
		v-show="!noUI"
		class="VariableTopologyGui"
		:data-clipped="miterClipped ? 'true' : 'false'"
		:data-open="params.open ? 'true' : 'false'"
		aria-label="Surface topology controls"
		@pointerdown.stop
	>
		<header class="VariableTopologyGui__header">
			<div class="VariableTopologyGui__titleGroup">
				<span class="VariableTopologyGui__dot" aria-hidden="true" />
				<span class="VariableTopologyGui__title">Topology</span>
				<span class="VariableTopologyGui__badge" aria-live="polite">
					{{ miterClipped ? `×${miterScaleLabel} · bevel` : `×${miterScaleLabel} · miter` }}
				</span>
			</div>
			<button
				type="button"
				class="VariableTopologyGui__collapse"
				:aria-expanded="String( params.open )"
				:aria-label="params.open ? 'Collapse topology controls' : 'Expand topology controls'"
				:title="params.open ? 'Collapse controls' : 'Expand controls'"
				@click="params.open = !params.open"
			>
				<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
					<path d="M2.5 4.25L6 7.75L9.5 4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
				</svg>
			</button>
		</header>

		<div class="VariableTopologyGui__telemetry" role="status" aria-live="polite" :aria-label="params.telemetry">
			<svg class="VariableTopologyGui__glyph" viewBox="-22 -22 44 44" width="40" height="40" aria-hidden="true">
				<circle cx="0" cy="0" r="19" class="VariableTopologyGui__glyphRing" />
				<path :d="glyphArcPath" class="VariableTopologyGui__glyphArc" />
				<path :d="glyphArmsPath" class="VariableTopologyGui__glyphRibbon" />
				<path :d="glyphArmsPath" class="VariableTopologyGui__glyphCenterline" />
				<circle :cx="0" :cy="glyphApexY" r="2.4" class="VariableTopologyGui__glyphApex" />
			</svg>
			<div class="VariableTopologyGui__stats">
				<div class="VariableTopologyGui__stat">
					<span class="VariableTopologyGui__statLabel">Opening</span>
					<strong class="VariableTopologyGui__statValue">{{ openingLabel }}°</strong>
				</div>
				<div class="VariableTopologyGui__stat">
					<span class="VariableTopologyGui__statLabel">Turn</span>
					<strong class="VariableTopologyGui__statValue">{{ turnLabel }}°</strong>
				</div>
				<div class="VariableTopologyGui__stat">
					<span class="VariableTopologyGui__statLabel">Miter</span>
					<strong class="VariableTopologyGui__statValue" :class="{ 'is-clipped': miterClipped }">×{{ miterScaleLabel }}</strong>
				</div>
			</div>
		</div>

		<div v-show="params.open" class="VariableTopologyGui__body">
			<div class="VariableTopologyGui__toggles" role="group" aria-label="Playback and wireframe">
				<button
					type="button"
					class="VariableTopologyGui__toggle"
					:aria-pressed="String( params.animateAngles )"
					@click="api.setAnimateAngles( !params.animateAngles )"
				>
					<span class="VariableTopologyGui__toggleDot" aria-hidden="true" />
					<span>Animate joins</span>
				</button>
				<button
					type="button"
					class="VariableTopologyGui__toggle"
					:aria-pressed="String( params.showTriangles )"
					title="Toggle triangle wireframe (W)"
					@click="api.setShowTriangles( !params.showTriangles )"
				>
					<span class="VariableTopologyGui__toggleDot" aria-hidden="true" />
					<span>Triangles</span>
					<kbd>W</kbd>
				</button>
			</div>

			<div class="VariableTopologyGui__sliders">
				<div
					v-for="slider in sliders"
					:key="slider.id"
					class="VariableTopologyGui__control"
					:style="{ '--slider-fill-color': slider.color, '--slider-progress': slider.progress }"
				>
					<div class="VariableTopologyGui__controlHeader">
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
					>
				</div>
			</div>
		</div>
	</aside>
</template>

<script>
import { noUI } from '@/makio/utils/detect'
import { onShortcut } from '@/utils/demoControls'

const progressPercent = ( value, min, max ) => `${Math.max( 0, Math.min( 100, ( ( value - min ) / ( max - min ) ) * 100 ) ).toFixed( 1 )}%`

export default {
	name: 'VariableTopologyUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return { noUI }
	},
	computed: {
		params() {
			return this.api.params
		},
		openingLabel() {
			return Math.round( this.params.joinAngle )
		},
		turnLabel() {
			return Math.round( this.params.turnAngle )
		},
		miterScaleLabel() {
			return this.params.miterScale.toFixed( 2 )
		},
		miterClipped() {
			return this.params.miterScale > this.params.miterLimit
		},
		glyphApexY() {
			return -5.5
		},
		glyphArmsPath() {
			const half = ( this.params.joinAngle * 0.5 * Math.PI ) / 180
			const arm = 14.5
			const dx = Math.sin( half ) * arm
			const dy = this.glyphApexY + Math.cos( half ) * arm
			return `M ${-dx.toFixed( 2 )} ${dy.toFixed( 2 )} L 0 ${this.glyphApexY} L ${dx.toFixed( 2 )} ${dy.toFixed( 2 )}`
		},
		glyphArcPath() {
			const half = ( this.params.joinAngle * 0.5 * Math.PI ) / 180
			const radius = 7.2
			const dx = Math.sin( half ) * radius
			const dy = this.glyphApexY + Math.cos( half ) * radius
			return `M ${-dx.toFixed( 2 )} ${dy.toFixed( 2 )} A ${radius} ${radius} 0 0 0 ${dx.toFixed( 2 )} ${dy.toFixed( 2 )}`
		},
		sliders() {
			const { params } = this
			return [
				{
					id: 'variable-topology-opening',
					label: 'Opening (°)',
					min: 20,
					max: 165,
					step: 0.1,
					value: params.joinAngle,
					display: `${params.joinAngle.toFixed( 1 )}°`,
					ariaText: `opening angle ${Math.round( params.joinAngle )} degrees`,
					color: '#f59e0b',
					progress: progressPercent( params.joinAngle, 20, 165 ),
					onInput: value => this.api.scrubJoinAngle( value ),
				},
				{
					id: 'variable-topology-turn',
					label: 'Turn (°)',
					min: 15,
					max: 160,
					step: 0.1,
					value: params.turnAngle,
					display: `${params.turnAngle.toFixed( 1 )}°`,
					ariaText: `turn angle ${Math.round( params.turnAngle )} degrees`,
					color: '#fb7185',
					progress: progressPercent( params.turnAngle, 15, 160 ),
					onInput: value => this.api.scrubTurnAngle( value ),
				},
				{
					id: 'variable-topology-miter-limit',
					label: 'Miter limit',
					min: 1.2,
					max: 6,
					step: 0.05,
					value: params.miterLimit,
					display: `×${params.miterLimit.toFixed( 2 )}`,
					ariaText: `miter limit ${params.miterLimit.toFixed( 2 )}`,
					color: this.miterClipped ? '#fde047' : '#34d399',
					progress: progressPercent( params.miterLimit, 1.2, 6 ),
					onInput: value => this.api.setMiterLimit( value ),
				},
			]
		},
	},
	mounted() {
		onShortcut( 'w', () => this.api.setShowTriangles( !this.params.showTriangles ) )
	},
}
</script>

<style lang="stylus" scoped>
.VariableTopologyGui
	--topo-accent #38bdf8
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

	&[data-clipped='true']
		--topo-accent #fde047

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
		border 1px solid rgba(56, 189, 248, .28)
		border-radius 999px
		background rgba(56, 189, 248, .12)
		color #7dd3fc
		font-size 9.5px
		font-weight 700
		letter-spacing .04em
		white-space nowrap
		transition border-color .2s ease, background .2s ease, color .2s ease

	&[data-clipped='true'] &__badge
		border-color rgba(250, 204, 21, .36)
		background rgba(250, 204, 21, .14)
		color #fde047

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
		display flex
		align-items center
		gap 10px
		padding 7px 9px
		border 1px solid rgba(255, 255, 255, .07)
		border-radius 12px
		background rgba(15, 23, 42, .52)

	&__glyph
		flex none
		display block

	&__glyphRing
		fill rgba(2, 6, 23, .55)
		stroke rgba(148, 163, 184, .18)
		stroke-width 1

	&__glyphArc
		fill none
		stroke rgba(148, 163, 184, .45)
		stroke-width 1.2
		stroke-dasharray 1.5 1.5

	&__glyphRibbon
		fill none
		stroke rgba(245, 158, 11, .28)
		stroke-width 5.5
		stroke-linecap butt
		stroke-linejoin round

	&__glyphCenterline
		fill none
		stroke #f8fafc
		stroke-width 1.6
		stroke-linecap round
		stroke-linejoin round

	&__glyphApex
		fill var(--topo-accent)

	&__stats
		flex 1
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 6px
		min-width 0

	&__stat
		display grid
		gap 2px

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

		&.is-clipped
			color #fde047

	&__body
		display grid
		gap 10px

	&__toggles
		display grid
		grid-template-columns 1fr 1fr
		gap 6px

	&__toggle
		appearance none
		display inline-flex
		align-items center
		justify-content center
		gap 6px
		min-height 30px
		padding 0 10px
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
			border-color rgba(56, 189, 248, .42)
			background rgba(56, 189, 248, .16)
			color #fff

			.VariableTopologyGui__toggleDot
				background #38bdf8
				box-shadow 0 0 8px #38bdf8
				opacity 1

		kbd
			padding 2px 4px
			border 1px solid rgba(255, 255, 255, .16)
			border-radius 4px
			color rgba(255, 255, 255, .64)
			font 700 8.5px/1 system-ui, sans-serif

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
	.VariableTopologyGui
		top calc(12px + var(--sait, 0px))
		left calc(12px + var(--sail, 0px))
		width unquote('min(272px, calc(100vw - 72px))')
		padding 10px 12px
		gap 8px

		&__toggle kbd
			display none

@media (prefers-reduced-motion: reduce)
	.VariableTopologyGui
		&__dot,
		&__badge,
		&__collapse,
		&__collapse svg,
		&__toggle,
		&__toggleDot,
		input[type='range']::-webkit-slider-thumb
			transition none
</style>

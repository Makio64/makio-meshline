<template>
	<div class="GpuPathOverlay">
		<div class="GpuPathInfo" aria-live="polite">
			<i :class="`GpuPathHud__dot GpuPathHud__dot--${badgeTone}`" aria-hidden="true" />
			<span><strong>{{ formatCount( ui.pointCount ) }}</strong> pts</span>
			<span class="GpuPathInfo__sep" aria-hidden="true">·</span>
			<span><strong>{{ segmentSummary }}</strong> segs</span>
			<span class="GpuPathInfo__sep" aria-hidden="true">·</span>
			<strong>{{ badgeLabel }}</strong>
			<template v-if="ui.mode === 'gpu-topology'">
				<span class="GpuPathInfo__sep" aria-hidden="true">·</span>
				<span>{{ ui.joinType }} / {{ ui.capType }}</span>
			</template>
		</div>

		<aside
			class="GpuPathHud"
			aria-label="GPU path controls"
			@pointerdown.stop
			@touchstart.stop
			@wheel.stop
		>
			<div class="GpuPathHud__modes" role="group" aria-label="GPU path mode">
				<button
					v-for="mode in modes"
					:key="mode.key"
					type="button"
					class="GpuPathHud__btn"
					:aria-pressed="mode.key === ui.mode"
					@click="api.setMode( mode.key )"
				>
					<span class="GpuPathHud__btnDot" aria-hidden="true" />
					<span>{{ mode.label }}</span>
				</button>
			</div>

			<span class="GpuPathHud__divider" aria-hidden="true" />

			<button
				class="GpuPathHud__wireframe"
				type="button"
				:aria-pressed="ui.wireframe"
				@click="api.toggleWireframe()"
			>
				<span class="GpuPathHud__wireframeLabel">
					<i aria-hidden="true" />
					Wireframe
				</span>
				<kbd>W</kbd>
			</button>
		</aside>
	</div>
</template>

<script>
const countFormat = new Intl.NumberFormat( 'en-US' )

export default {
	name: 'GpuPathUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	computed: {
		ui() {
			return this.api.ui
		},
		modes() {
			return [
				{ key: 'gpu-simplified', label: 'Simplify' },
				{ key: 'gpu-raw', label: 'Raw GPU' },
				{ key: 'cpu', label: 'CPU' },
			]
		},
		isSimplified() {
			return this.ui.backend === 'gpu' && this.ui.mode === 'gpu-simplified'
		},
		reductionPercent() {
			const retained = this.ui.expectedRetainedSegments / this.ui.sourceSegmentCount * 100
			return ( 100 - retained ).toFixed( 1 )
		},
		segmentSummary() {
			if ( this.isSimplified ) {
				return `${this.formatCount( this.ui.expectedRetainedSegments )} (−${this.reductionPercent}%)`
			}
			return this.formatCount( this.ui.sourceSegmentCount )
		},
		badgeTone() {
			if ( this.ui.backend === 'gpu' ) return 'gpu'
			if ( this.ui.backend === 'loading' ) return 'loading'
			return 'cpu'
		},
		badgeLabel() {
			if ( this.ui.backend === 'gpu' ) return 'WebGPU'
			if ( this.ui.backend === 'cpu-requested' ) return 'CPU'
			if ( this.ui.backend === 'cpu-fallback' ) return 'CPU fallback'
			return 'Loading'
		},
	},
	methods: {
		formatCount( value ) {
			return countFormat.format( value )
		},
	},
}
</script>

<style lang="stylus" scoped>
.GpuPathInfo
	position fixed
	top calc(18px + var(--sait, 0px))
	left calc(18px + var(--sail, 0px))
	z-index 25
	display inline-flex
	align-items center
	gap 7px
	min-height 36px
	max-width unquote( 'min(440px, calc(100vw - 96px))' )
	padding 6px 14px
	border 1px solid rgba(255, 255, 255, .1)
	border-radius 999px
	background rgba(8, 9, 12, .7)
	box-shadow 0 12px 30px rgba(0, 0, 0, .28)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	font 600 10px/1.2 'Inter', system-ui, -apple-system, sans-serif
	font-variant-numeric tabular-nums
	letter-spacing .05em
	text-transform uppercase
	color rgba(244, 245, 247, .74)
	pointer-events none
	user-select none

	strong
		color #fff
		font-weight 700

	&__sep
		opacity .4

.GpuPathHud
	position fixed
	top calc(18px + var(--sait, 0px))
	left 50%
	transform translateX(-50%)
	z-index 30
	display inline-flex
	align-items center
	gap 4px
	padding 4px
	border 1px solid rgba(255, 255, 255, .12)
	border-radius 999px
	background rgba(8, 9, 12, .72)
	box-shadow 0 12px 30px rgba(0, 0, 0, .32)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	font 650 11px/1 'Inter', system-ui, -apple-system, sans-serif
	letter-spacing .06em
	text-transform uppercase
	color #f3f8ff
	user-select none

	&__dot
		width 6px
		height 6px
		border-radius 50%
		flex-shrink 0

		&--gpu
			background #48ecc4
			box-shadow 0 0 10px rgba(72, 236, 196, .9)

		&--cpu
			background #ffb54c
			box-shadow 0 0 10px rgba(255, 181, 76, .8)

		&--loading
			background #778896

	&__modes
		display inline-flex
		align-items center
		gap 3px

	&__btn
		appearance none
		display inline-flex
		align-items center
		gap 6px
		min-height 30px
		padding 0 12px
		border 1px solid transparent
		border-radius 999px
		background transparent
		font inherit
		letter-spacing inherit
		text-transform inherit
		color rgba(244, 245, 247, .68)
		cursor pointer
		transition border-color .16s ease, background .16s ease, color .16s ease

		&:hover,
		&:focus-visible
			color #fff
			background rgba(255, 255, 255, .07)

		&:focus-visible
			outline 2px solid #6de4ff
			outline-offset 2px

		&[aria-pressed='true']
			border-color rgba(74, 221, 255, .48)
			background rgba(25, 170, 207, .2)
			color #fff

			.GpuPathHud__btnDot
				background #43e9ff
				box-shadow 0 0 8px #43e9ff
				opacity 1

	&__btnDot
		width 6px
		height 6px
		border-radius 50%
		background currentColor
		opacity .5

	&__divider
		width 1px
		height 16px
		margin 0 2px
		background rgba(255, 255, 255, .12)

	&__wireframe
		appearance none
		display inline-flex
		align-items center
		gap 7px
		min-height 30px
		padding 0 11px
		border 1px solid transparent
		border-radius 999px
		background transparent
		font inherit
		letter-spacing inherit
		text-transform inherit
		color rgba(244, 245, 247, .74)
		cursor pointer
		transition border-color .16s ease, background .16s ease, color .16s ease

		&:hover,
		&:focus-visible
			color #fff
			background rgba(255, 255, 255, .07)

		&:focus-visible
			outline 2px solid #6de4ff
			outline-offset 2px

		&[aria-pressed='true']
			border-color rgba(74, 221, 255, .52)
			background rgba(25, 170, 207, .22)
			color #fff

			.GpuPathHud__wireframeLabel i
				background #43e9ff
				box-shadow 0 0 8px rgba(67, 233, 255, .9)

		kbd
			padding 2px 4px
			border 1px solid rgba(255, 255, 255, .16)
			border-radius 4px
			background rgba(0, 0, 0, .25)
			font-family ui-monospace, SFMono-Regular, Menlo, monospace
			font-size 9px
			font-weight 600
			color rgba(209, 226, 239, .72)

	&__wireframeLabel
		display inline-flex
		align-items center
		gap 6px

		i
			width 6px
			height 6px
			border-radius 50%
			background rgba(255, 255, 255, .32)
			transition background .16s ease, box-shadow .16s ease

@media (max-width: 760px)
	.GpuPathInfo
		top calc(58px + var(--sait, 0px))
		left calc(12px + var(--sail, 0px))
		min-height 30px
		padding 4px 11px
		font-size 9px

	.GpuPathHud
		top calc(12px + var(--sait, 0px))
		padding 3px
		font-size 10px

		&__btn,
		&__wireframe
			min-height 27px
			padding 0 9px

		kbd
			display none

@media (prefers-reduced-motion: reduce)
	.GpuPathHud__btn,
	.GpuPathHud__wireframe,
	.GpuPathHud__wireframeLabel i
		transition none
</style>

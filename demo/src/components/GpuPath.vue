<template>
	<aside
		class="GpuPathHud"
		:class="{ 'GpuPathHud--collapsed': !expanded }"
		aria-label="GPU path controls"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<header class="GpuPathHud__header">
			<span class="GpuPathHud__title">
				<i :class="`GpuPathHud__dot GpuPathHud__dot--${badgeTone}`" aria-hidden="true" />
				GPU Path
			</span>
			<button
				class="GpuPathHud__collapse"
				type="button"
				:aria-expanded="expanded"
				:aria-label="expanded ? 'Collapse GPU path controls' : 'Expand GPU path controls'"
				@click="expanded = !expanded"
			>{{ expanded ? 'Hide' : 'Show' }}</button>
		</header>

		<div v-if="expanded" class="GpuPathHud__body">
			<div class="GpuPathHud__stats" aria-live="polite">
				<div>
					<span>Points</span>
					<strong>{{ formatCount( ui.pointCount ) }}</strong>
				</div>
				<div>
					<span>Segments</span>
					<strong>{{ segmentSummary }}</strong>
				</div>
				<div>
					<span>Backend</span>
					<strong>{{ badgeLabel }}</strong>
				</div>
			</div>

			<div class="GpuPathHud__modes" role="group" aria-label="GPU path mode">
				<button
					v-for="mode in modes"
					:key="mode.key"
					type="button"
					:aria-pressed="mode.key === ui.mode"
					@click="api.setMode( mode.key )"
				>{{ mode.label }}</button>
			</div>

			<p v-if="ui.mode === 'gpu-topology'" class="GpuPathHud__advancedMode">
				{{ ui.joinType }} joins · {{ ui.capType }} caps
			</p>

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

			<p v-if="ui.backend === 'cpu-fallback'" class="GpuPathHud__fallbackReason">{{ ui.reason }}</p>
		</div>
	</aside>
</template>

<script>
const countFormat = new Intl.NumberFormat( 'en-US' )

export default {
	name: 'GpuPathUI',
	inheritAttrs: false,
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			expanded: true,
		}
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
.GpuPathHud
	position fixed
	top 18px
	left 18px
	z-index 30
	box-sizing border-box
	width 256px
	max-width calc(100vw - 92px)
	padding 12px
	border 1px solid rgba(114, 225, 255, .2)
	border-radius 14px
	background linear-gradient(145deg, rgba(7, 15, 28, .92), rgba(4, 8, 18, .84))
	box-shadow 0 18px 48px rgba(0, 0, 0, .38), inset 0 1px rgba(255, 255, 255, .07)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	font 500 11px/1.35 system-ui, -apple-system, sans-serif
	text-align left
	color #f3f8ff
	user-select none

	&--collapsed
		width auto

	&__header
		display flex
		align-items center
		justify-content space-between
		gap 12px

	&__title
		display inline-flex
		align-items center
		gap 8px
		font-size 11px
		font-weight 750
		letter-spacing .08em
		text-transform uppercase
		color #e8f6ff

	&__dot
		width 7px
		height 7px
		border-radius 50%

		&--gpu
			background #48ecc4
			box-shadow 0 0 10px rgba(72, 236, 196, .9)

		&--cpu
			background #ffb54c
			box-shadow 0 0 10px rgba(255, 181, 76, .8)

		&--loading
			background #778896

	&__collapse
		appearance none
		padding 4px 8px
		border 1px solid rgba(255, 255, 255, .13)
		border-radius 7px
		background rgba(255, 255, 255, .05)
		font inherit
		font-size 10px
		color rgba(255, 255, 255, .72)
		cursor pointer

		&:hover,
		&:focus-visible
			border-color rgba(104, 225, 255, .58)
			color #fff

		&:focus-visible
			outline 2px solid #6de4ff
			outline-offset 2px

	&__body
		margin-top 10px

	&__stats
		display grid
		gap 5px
		padding 8px 10px
		border 1px solid rgba(255, 255, 255, .08)
		border-radius 10px
		background rgba(1, 6, 13, .42)

		div
			display flex
			align-items baseline
			justify-content space-between
			gap 8px

		span
			font-size 10px
			color rgba(187, 210, 222, .68)

		strong
			font-size 11px
			font-weight 700
			font-variant-numeric tabular-nums
			color #f8fdff

	&__modes
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 4px
		margin-top 8px
		padding 3px
		border 1px solid rgba(255, 255, 255, .09)
		border-radius 9px
		background rgba(0, 0, 0, .24)

		button
			appearance none
			padding 6px 4px
			border 1px solid transparent
			border-radius 6px
			background transparent
			font inherit
			font-size 10px
			font-weight 700
			text-align center
			color rgba(229, 240, 247, .64)
			cursor pointer
			transition border-color .16s ease, background .16s ease, color .16s ease

			&:hover,
			&:focus-visible
				color #fff
				background rgba(255, 255, 255, .07)

			&:focus-visible
				outline 2px solid #6de4ff
				outline-offset 1px

			&[aria-pressed='true']
				border-color rgba(74, 221, 255, .38)
				background rgba(25, 170, 207, .17)
				box-shadow inset 0 1px rgba(255, 255, 255, .07)
				color #baf4ff

	&__advancedMode
		margin 7px 0 0
		padding 5px 8px
		border-radius 7px
		background rgba(129, 94, 229, .15)
		font-size 10px
		color #d9ccff

	&__wireframe
		appearance none
		display flex
		align-items center
		justify-content space-between
		width 100%
		margin-top 8px
		padding 7px 10px
		border 1px solid rgba(255, 255, 255, .11)
		border-radius 9px
		background rgba(255, 255, 255, .04)
		font inherit
		font-size 11px
		font-weight 650
		color rgba(235, 245, 252, .84)
		cursor pointer
		transition border-color .16s ease, background .16s ease, color .16s ease

		&:hover,
		&:focus-visible
			border-color rgba(104, 225, 255, .45)
			color #fff

		&:focus-visible
			outline 2px solid #6de4ff
			outline-offset 1px

		&[aria-pressed='true']
			border-color rgba(74, 221, 255, .48)
			background rgba(25, 170, 207, .18)
			color #baf4ff

			.GpuPathHud__wireframeLabel i
				background #43e9ff
				box-shadow 0 0 8px rgba(67, 233, 255, .9)

		kbd
			padding 2px 5px
			border 1px solid rgba(255, 255, 255, .14)
			border-radius 5px
			background rgba(0, 0, 0, .28)
			font-family ui-monospace, SFMono-Regular, Menlo, monospace
			font-size 9px
			font-weight 600
			color rgba(209, 226, 239, .72)

	&__wireframeLabel
		display inline-flex
		align-items center
		gap 7px

		i
			width 7px
			height 7px
			border-radius 50%
			background rgba(255, 255, 255, .24)
			transition background .16s ease, box-shadow .16s ease

	&__fallbackReason
		margin 8px 0 0
		padding 6px 8px
		border 1px solid rgba(255, 179, 71, .2)
		border-radius 7px
		background rgba(255, 151, 37, .08)
		font-size 9px
		line-height 1.4
		color rgba(255, 218, 167, .82)

@media (max-width: 620px)
	.GpuPathHud
		top 60px
		left 8px
		width 236px

@media (prefers-reduced-motion: reduce)
	.GpuPathHud__modes button,
	.GpuPathHud__wireframe,
	.GpuPathHud__wireframeLabel i
		transition none
</style>

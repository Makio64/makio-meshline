<template>
	<aside
		class="GpuPathHud"
		:class="{ 'GpuPathHud--collapsed': !expanded }"
		aria-label="GPU path explainer"
		@pointerdown.stop
		@touchstart.stop
		@wheel.stop
	>
		<header class="GpuPathHud__header">
			<div>
				<p class="GpuPathHud__eyebrow">GPU Path · experimental</p>
				<span :class="`GpuPathHud__badge GpuPathHud__badge--${badgeTone}`" aria-live="polite">
					<i aria-hidden="true" />{{ badgeLabel }}
				</span>
			</div>
			<button
				class="GpuPathHud__collapse"
				type="button"
				:aria-expanded="expanded"
				:aria-label="expanded ? 'Collapse GPU path explanation' : 'Expand GPU path explanation'"
				@click="expanded = !expanded"
			>{{ expanded ? 'Hide' : 'Explain' }}</button>
		</header>

		<div v-if="expanded" class="GpuPathHud__body">
			<h1>{{ headline }}</h1>
			<p class="GpuPathHud__summary">{{ summary }}</p>

			<nav class="GpuPathHud__modes" aria-label="GPU path comparison mode">
				<a
					v-for="mode in modeLinks"
					:key="mode.key"
					:href="mode.href"
					:aria-current="mode.key === ui.mode ? 'page' : undefined"
				>{{ mode.label }}</a>
			</nav>
			<p v-if="ui.mode === 'gpu-topology'" class="GpuPathHud__advancedMode">
				Advanced query · {{ ui.joinType }} joins · {{ ui.capType }} caps
			</p>

			<section class="GpuPathHud__pipeline" aria-label="Rendering pipeline">
				<article v-for="step in pipeline" :key="step.label">
					<span>{{ step.label }}</span>
					<strong>{{ step.value }}</strong>
					<small>{{ step.detail }}</small>
				</article>
			</section>

			<div class="GpuPathHud__facts" aria-label="Active path facts">
				<span v-for="fact in facts" :key="fact">{{ fact }}</span>
			</div>

			<section v-if="isSimplified" class="GpuPathHud__comparison" aria-labelledby="gpu-path-comparison-title">
				<div class="GpuPathHud__sectionHeading">
					<span id="gpu-path-comparison-title">Segments reaching the draw</span>
					<strong>−{{ reductionLabel }}</strong>
				</div>
				<div class="GpuPathHud__barRow">
					<div class="GpuPathHud__barLabel">
						<span>Source</span><strong>{{ formatCount( ui.sourceSegmentCount ) }}</strong>
					</div>
					<div class="GpuPathHud__bar"><i class="GpuPathHud__barFill GpuPathHud__barFill--source" /></div>
				</div>
				<div class="GpuPathHud__barRow">
					<div class="GpuPathHud__barLabel">
						<span>GPU-selected*</span><strong>{{ formatCount( ui.expectedRetainedSegments ) }} · {{ retainedPercentLabel }}</strong>
					</div>
					<div class="GpuPathHud__bar"><i class="GpuPathHud__barFill GpuPathHud__barFill--selected" :style="outputBarStyle" /></div>
				</div>
			</section>

			<section v-if="isSimplified && ui.preview" class="GpuPathHud__preview" aria-labelledby="gpu-path-preview-title">
				<div class="GpuPathHud__sectionHeading">
					<span id="gpu-path-preview-title">Zoom into one real chunk</span>
					<strong>{{ ui.preview.sourceSampleCount }} samples → {{ ui.preview.selectedChordCount }} longer pieces</strong>
				</div>
				<svg viewBox="0 0 100 35" role="img" aria-label="Dense source samples and the longer straight pieces selected from them">
					<polyline class="GpuPathHud__sourceLine" :points="sourcePolyline" />
					<circle
						v-for="( point, index ) in ui.preview.source"
						:key="`source-${index}`"
						class="GpuPathHud__sourcePoint"
						:cx="point.x"
						:cy="point.y"
						r="0.34"
					/>
					<polyline class="GpuPathHud__selectedLine" :points="selectedPolyline" />
					<circle
						v-for="( point, index ) in ui.preview.selected"
						:key="`selected-${index}`"
						class="GpuPathHud__selectedPoint"
						:cx="point.x"
						:cy="point.y"
						r="0.9"
					/>
				</svg>
				<p><i class="GpuPathHud__key GpuPathHud__key--source" />source samples <i class="GpuPathHud__key GpuPathHud__key--selected" />selected points and straight pieces</p>
			</section>

			<p v-if="isSimplified" class="GpuPathHud__note">
				*Expected for this fixed demo, verified by the matching CPU oracle. The runtime path does not read the count back from the GPU.
			</p>
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
			// On narrower screens the explainer would cover the curve it explains.
			expanded: window.innerWidth >= 1100,
		}
	},
	computed: {
		ui() {
			return this.api.ui
		},
		modeLinks() {
			return [
				{ key: 'gpu-simplified', label: 'GPU + simplify', href: this.api.getModeHref( 'gpu-simplified' ) },
				{ key: 'gpu-raw', label: 'Raw GPU', href: this.api.getModeHref( 'gpu-raw' ) },
				{ key: 'cpu', label: 'CPU baseline', href: this.api.getModeHref( 'cpu' ) },
			]
		},
		isSimplified() {
			return this.ui.backend === 'gpu' && this.ui.mode === 'gpu-simplified'
		},
		retainedPercent() {
			return this.ui.expectedRetainedSegments / this.ui.sourceSegmentCount * 100
		},
		retainedPercentLabel() {
			return `${this.retainedPercent.toFixed( 2 )}%`
		},
		reductionLabel() {
			return `${( 100 - this.retainedPercent ).toFixed( 2 )}%`
		},
		outputBarStyle() {
			return { width: `${Math.max( this.retainedPercent, 1.5 )}%` }
		},
		badgeTone() {
			if ( this.ui.backend === 'gpu' ) return 'gpu'
			if ( this.ui.backend === 'loading' ) return 'loading'
			return 'cpu'
		},
		badgeLabel() {
			if ( this.ui.backend === 'gpu' ) return 'Native WebGPU active'
			if ( this.ui.backend === 'cpu-requested' ) return 'CPU baseline selected'
			if ( this.ui.backend === 'cpu-fallback' ) return 'CPU fallback active'
			return 'Preparing path'
		},
		headline() {
			if ( this.ui.backend === 'cpu-fallback' ) return 'GPU unavailable. The line stays visible.'
			if ( this.ui.backend === 'cpu-requested' ) return 'The complete CPU baseline.'
			if ( this.ui.mode === 'gpu-topology' ) return 'True joins and caps, built on the GPU.'
			if ( this.ui.mode === 'gpu-raw' ) return 'One record per point. One indirect draw.'
			return `Same curve. ${this.reductionLabel} fewer segments emitted.`
		},
		summary() {
			if ( this.ui.backend === 'cpu-fallback' ) {
				return 'The requested GPU path could not run here, so its complete CPU MeshLine fallback is drawing every source segment.'
			}
			if ( this.ui.backend === 'cpu-requested' ) {
				return 'This is the compatibility baseline: the CPU builds the full indexed MeshLine geometry, then the renderer draws it normally.'
			}
			if ( this.ui.mode === 'gpu-topology' ) {
				return 'Compact GPU records create real join and cap triangles, split reversals, and clip the ribbon before perspective division.'
			}
			if ( this.ui.mode === 'gpu-raw' ) {
				return 'Each source point is stored once. The vertex shader looks up its neighbours and turns the full path into triangles as it draws, with no segment buffer or compute work.'
			}
			return 'The cyan curve should look unchanged. GPU preparation joins dense samples into longer straight pieces within 0.012 local units, then writes the draw size without sending the result back to JavaScript.'
		},
		pipeline() {
			const points = this.formatCount( this.ui.pointCount )
			const sourceSegments = this.formatCount( this.ui.sourceSegmentCount )
			if ( this.ui.backend === 'cpu-fallback' || this.ui.backend === 'cpu-requested' ) {
				return [
					{ label: '1 · Input', value: points, detail: 'source points' },
					{ label: '2 · CPU build', value: 'Full strip', detail: `${sourceSegments} segments` },
					{ label: '3 · Draw', value: 'Indexed', detail: 'ordinary MeshLine' },
				]
			}
			if ( this.ui.mode === 'gpu-topology' ) {
				return [
					{ label: '1 · Store', value: points, detail: 'point records' },
					{ label: '2 · Topology', value: 'Full detail', detail: `${this.ui.joinType} + ${this.ui.capType}` },
					{ label: '3 · Draw', value: '1', detail: 'indirect draw' },
				]
			}
			if ( this.ui.mode === 'gpu-raw' ) {
				return [
					{ label: '1 · Store', value: points, detail: 'point records' },
					{ label: '2 · Derive', value: sourceSegments, detail: 'vertex-shader segments' },
					{ label: '3 · Draw', value: '1', detail: 'indirect draw' },
				]
			}
			return [
				{ label: '1 · Store', value: points, detail: 'point records' },
				{ label: '2 · GPU simplify', value: `${this.formatCount( this.ui.expectedRetainedSegments )}*`, detail: 'longer line pieces' },
				{ label: '3 · Draw', value: '1', detail: 'indirect draw' },
			]
		},
		facts() {
			if ( this.ui.backend === 'cpu-fallback' || this.ui.backend === 'cpu-requested' ) {
				return ['Complete fallback geometry', 'Full detail', 'WebGL2 compatible']
			}
			if ( this.ui.mode === 'gpu-topology' ) {
				return ['Compact triangle records', 'Homogeneous clipping', 'Full detail']
			}
			if ( this.ui.mode === 'gpu-raw' ) return ['No segment buffer', '0 compute dispatches', 'Full detail']
			return ['No GPU → CPU readback', `≤ ${this.ui.localTolerance} local units`, 'Stable source order']
		},
		sourcePolyline() {
			return this.ui.preview?.source.map( point => `${point.x},${point.y}` ).join( ' ' ) ?? ''
		},
		selectedPolyline() {
			return this.ui.preview?.selected.map( point => `${point.x},${point.y}` ).join( ' ' ) ?? ''
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
	width 440px
	max-width calc(100vw - 92px)
	max-height calc(100vh - 36px)
	overflow-y auto
	padding 16px
	border 1px solid rgba(114, 225, 255, .22)
	border-radius 18px
	background linear-gradient(145deg, rgba(7, 15, 28, .94), rgba(4, 8, 18, .86))
	box-shadow 0 24px 70px rgba(0, 0, 0, .42), inset 0 1px rgba(255, 255, 255, .07)
	backdrop-filter blur(16px)
	-webkit-backdrop-filter blur(16px)
	font 500 12px/1.35 system-ui, -apple-system, sans-serif
	text-align left
	color #f3f8ff
	user-select none
	touch-action pan-y
	scrollbar-width thin
	scrollbar-color rgba(90, 214, 239, .45) transparent

	&--collapsed
		width 330px

	&__header
		display flex
		align-items flex-start
		justify-content space-between
		gap 12px

	&__eyebrow
		margin 0 0 6px
		font-size 10px
		font-weight 800
		letter-spacing .14em
		text-transform uppercase
		color rgba(209, 226, 239, .68)

	&__badge
		display inline-flex
		align-items center
		gap 7px
		font-size 10px
		font-weight 750
		letter-spacing .08em
		text-transform uppercase

		i
			width 7px
			height 7px
			border-radius 50%

		&--gpu
			color #8df7dc

			i
				background #48ecc4
				box-shadow 0 0 10px rgba(72, 236, 196, .9)

		&--cpu
			color #ffd490

			i
				background #ffb54c
				box-shadow 0 0 10px rgba(255, 181, 76, .8)

		&--loading
			color #9baab7

			i
				background #778896

	&__collapse
		appearance none
		flex 0 0 auto
		padding 5px 8px
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
		h1
			margin 15px 0 7px
			max-width 390px
			font-size 25px
			font-weight 760
			line-height 1.08
			letter-spacing -.035em
			color #fff

	&__summary
		margin 0
		font-size 12px
		line-height 1.5
		color rgba(224, 237, 246, .76)

	&__modes
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		gap 4px
		margin-top 14px
		padding 4px
		border 1px solid rgba(255, 255, 255, .09)
		border-radius 10px
		background rgba(0, 0, 0, .24)

		a
			padding 7px 5px
			border 1px solid transparent
			border-radius 7px
			font-size 10px
			font-weight 700
			text-align center
			text-decoration none
			color rgba(229, 240, 247, .62)
			transition border-color .16s ease, background .16s ease, color .16s ease

			&:hover,
			&:focus-visible
				color #fff
				background rgba(255, 255, 255, .07)

			&:focus-visible
				outline 2px solid #6de4ff
				outline-offset 1px

			&[aria-current='page']
				border-color rgba(74, 221, 255, .38)
				background rgba(25, 170, 207, .17)
				box-shadow inset 0 1px rgba(255, 255, 255, .07)
				color #baf4ff

	&__advancedMode
		margin 7px 0 0
		padding 6px 8px
		border-radius 7px
		background rgba(129, 94, 229, .15)
		font-size 10px
		color #d9ccff

	&__pipeline
		display grid
		grid-template-columns repeat(3, minmax(0, 1fr))
		margin-top 13px
		border 1px solid rgba(255, 255, 255, .1)
		border-radius 12px
		overflow hidden
		background rgba(1, 6, 13, .44)

		article
			position relative
			display flex
			min-width 0
			padding 10px 9px
			flex-direction column

			&:not(:last-child)
				border-right 1px solid rgba(255, 255, 255, .09)

		span
			font-size 8px
			font-weight 750
			letter-spacing .09em
			text-transform uppercase
			color rgba(167, 195, 211, .62)

		strong
			margin-top 3px
			overflow hidden
			font-size 15px
			font-weight 760
			letter-spacing -.02em
			text-overflow ellipsis
			white-space nowrap
			color #f8fdff

		small
			margin-top 1px
			overflow hidden
			font-size 8px
			text-overflow ellipsis
			white-space nowrap
			color rgba(187, 210, 222, .62)

	&__facts
		display flex
		flex-wrap wrap
		gap 5px
		margin-top 7px

		span
			padding 4px 7px
			border 1px solid rgba(101, 217, 242, .14)
			border-radius 999px
			background rgba(18, 98, 116, .12)
			font-size 9px
			color rgba(205, 235, 241, .76)

	&__comparison,
	&__preview
		margin-top 13px
		padding-top 11px
		border-top 1px solid rgba(255, 255, 255, .1)

	&__sectionHeading
		display flex
		align-items baseline
		justify-content space-between
		gap 8px
		margin-bottom 8px
		font-size 9px
		font-weight 750
		letter-spacing .08em
		text-transform uppercase
		color rgba(193, 215, 227, .66)

		strong
			font-size 9px
			text-align right
			color #66eed0

	&__barRow + &__barRow
		margin-top 7px

	&__barLabel
		display flex
		justify-content space-between
		gap 10px
		margin-bottom 3px
		font-size 9px
		color rgba(213, 229, 238, .66)

		strong
			font-variant-numeric tabular-nums
			color rgba(246, 251, 255, .9)

	&__bar
		height 5px
		overflow hidden
		border-radius 999px
		background rgba(255, 255, 255, .07)

	&__barFill
		display block
		height 100%
		border-radius inherit

		&--source
			width 100%
			background linear-gradient(90deg, #657586, #a5b3c0)

		&--selected
			min-width 5px
			background #43e9ff
			box-shadow 0 0 9px rgba(67, 233, 255, .8)

	&__preview
		svg
			display block
			width 100%
			height 83px
			border 1px solid rgba(255, 255, 255, .08)
			border-radius 9px
			background linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), rgba(0, 3, 9, .44)
			background-size 100% 25%

		p
			display flex
			align-items center
			gap 5px
			margin 5px 0 0
			font-size 8px
			color rgba(197, 217, 228, .58)

	&__sourceLine,
	&__selectedLine
		fill none
		stroke-linecap round
		stroke-linejoin round

	&__sourceLine
		stroke rgba(164, 181, 193, .52)
		stroke-width .5

	&__selectedLine
		stroke #43e9ff
		stroke-width .8
		filter drop-shadow(0 0 1.2px rgba(67, 233, 255, .75))

	&__sourcePoint
		fill rgba(188, 202, 211, .75)

	&__selectedPoint
		fill #07101a
		stroke #66f1ff
		stroke-width .5

	&__key
		display inline-block
		width 11px
		height 2px
		margin-left 5px

		&:first-child
			margin-left 0

		&--source
			background #94a4b0

		&--selected
			background #43e9ff
			box-shadow 0 0 5px rgba(67, 233, 255, .65)

	&__note,
	&__fallbackReason
		margin 9px 0 0
		font-size 9px
		line-height 1.45
		color rgba(190, 211, 222, .58)

	&__fallbackReason
		padding 7px 8px
		border 1px solid rgba(255, 179, 71, .2)
		border-radius 7px
		background rgba(255, 151, 37, .08)
		color rgba(255, 218, 167, .82)

@media (max-width: 620px)
	.GpuPathHud
		top 60px
		left 8px
		right 8px
		width auto
		max-width none
		max-height calc(100vh - 70px)
		padding 13px
		border-radius 14px

		&--collapsed
			width auto

		&__body
			h1
				margin-top 12px
				font-size 21px

		&__summary
			font-size 11px

		&__modes
			margin-top 11px

			a
				font-size 9px

		&__pipeline
			margin-top 10px

			article
				padding 8px 7px

			strong
				font-size 13px

		&__preview
			svg
				height 68px

@media (prefers-reduced-motion: reduce)
	.GpuPathHud__modes a
		transition none
</style>

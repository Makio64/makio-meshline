<template>
	<aside v-show="!noUI" class="GpuCullingHud" :data-state="hud.state" role="status" aria-live="polite">
		<div class="GpuCullingHud__header">
			<span class="GpuCullingHud__title">GPU culling</span>
			<span class="GpuCullingHud__badge">{{ hud.badge }}</span>
		</div>
		<div class="GpuCullingHud__stat">
			<span class="GpuCullingHud__percent">{{ hud.measuring ? '—' : percent }}</span>
			<span class="GpuCullingHud__label">{{ hud.measuring ? 'measuring…' : 'of the line drawn' }}</span>
		</div>
		<div class="GpuCullingHud__bar" aria-hidden="true">
			<i :style="{ transform: `scaleX(${hud.measuring ? 0 : ratio})` }" />
		</div>
		<span class="GpuCullingHud__metric">{{ metric }}</span>
	</aside>

	<button
		v-if="hud.inset.shown"
		type="button"
		class="GpuCullingInset"
		:style="insetStyle"
		title="Swap views"
		@click="api.swapViews"
		@pointerdown.stop
		@touchstart.stop
	>
		<span>{{ hud.povHero ? 'Overview' : 'Cull camera' }}</span>
	</button>
</template>

<script>
import { noUI } from '@/makio/utils/detect'

const formatCount = value => {
	if ( value >= 1_000_000 ) return `${( value / 1_000_000 ).toFixed( 2 )}M`
	if ( value >= 1_000 ) return `${( value / 1_000 ).toFixed( value >= 100_000 ? 0 : 1 )}K`
	return String( value )
}

export default {
	name: 'GpuCullingUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return { noUI, hud: this.api.hud }
	},
	computed: {
		ratio() {
			const { indexCount, visibleIndexCount } = this.hud
			return indexCount ? visibleIndexCount / indexCount : 1
		},
		percent() {
			const r = this.ratio
			return `${( r * 100 ).toFixed( r < 0.1 ? 1 : 0 )}%`
		},
		metric() {
			const { gpuTime, indexCount, measuring, visibleIndexCount } = this.hud
			const counts = !indexCount || measuring
				? `${formatCount( this.api.metrics.pointCount )} points`
				: `${formatCount( visibleIndexCount / 3 )} of ${formatCount( indexCount / 3 )} triangles`
			return gpuTime === null ? counts : `${counts} · ${gpuTime.toFixed( 2 )} ms`
		},
		insetStyle() {
			const { x, y, width, height } = this.hud.inset
			return { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` }
		},
	},
}
</script>

<style lang="stylus" scoped>
.GpuCullingHud
	position fixed
	left calc(18px + var(--sail, 0px))
	top calc(18px + var(--sait, 0px))
	z-index 20
	display grid
	gap 8px
	box-sizing border-box
	width unquote('min(252px, calc(100vw - 84px))')
	padding 11px 14px 12px
	border 1px solid rgba(255, 255, 255, .1)
	border-radius 16px
	background rgba(8, 9, 12, .74)
	box-shadow 0 14px 36px rgba(0, 0, 0, .34)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	color rgba(226, 242, 252, .78)
	font 500 11px/1.3 'Inter', system-ui, -apple-system, sans-serif
	text-align left
	pointer-events none
	user-select none

	&__header
		display flex
		align-items center
		justify-content space-between
		gap 10px

	&__title
		color #fff
		font-size 10px
		font-weight 750
		letter-spacing .1em
		text-transform uppercase
		white-space nowrap

	&__badge
		display inline-flex
		align-items center
		gap 5px
		padding 3px 8px
		border 1px solid rgba(250, 204, 21, .28)
		border-radius 999px
		background rgba(250, 204, 21, .1)
		color #fde68a
		font-size 9px
		font-weight 700
		letter-spacing .06em
		text-transform uppercase
		white-space nowrap

		&::before
			content ''
			width 5px
			height 5px
			border-radius 50%
			background currentColor
			box-shadow 0 0 8px currentColor

	&[data-state='active'] &__badge
		border-color rgba(56, 189, 248, .32)
		background rgba(56, 189, 248, .12)
		color #7dd3fc

	&[data-state='fallback'] &__badge
		border-color rgba(251, 113, 133, .28)
		background rgba(244, 63, 94, .1)
		color #fecdd3

	&[data-state='baseline'] &__badge
		border-color rgba(148, 163, 184, .26)
		background rgba(148, 163, 184, .1)
		color #cbd5e1

	&__stat
		display flex
		align-items baseline
		gap 7px

	&__percent
		color #fff
		font-size 30px
		font-weight 760
		line-height 1
		letter-spacing -.03em
		font-variant-numeric tabular-nums

	&__label
		color rgba(186, 230, 253, .74)
		font-size 10.5px
		font-weight 600

	&__bar
		height 3px
		border-radius 999px
		background rgba(255, 255, 255, .1)
		overflow hidden

		i
			display block
			height 100%
			border-radius inherit
			background linear-gradient(90deg, #38bdf8, #a78bfa 55%, #fb7185)
			transform-origin left
			transition transform .25s ease

	&__metric
		color rgba(203, 225, 240, .64)
		font-size 10px
		font-variant-numeric tabular-nums

// A frame over the second view, which the demo draws into the same canvas.
.GpuCullingInset
	position fixed
	z-index 12
	box-sizing border-box
	margin 0
	padding 0
	border 1px solid rgba(255, 255, 255, .2)
	border-radius 0
	background transparent
	box-shadow 0 18px 44px rgba(0, 0, 0, .5)
	cursor pointer
	transition border-color .16s ease

	&:hover
		border-color rgba(125, 211, 252, .7)

	&:focus-visible
		outline 2px solid #38bdf8
		outline-offset 2px

	span
		position absolute
		left 8px
		top 8px
		display inline-flex
		align-items center
		gap 6px
		padding 4px 8px
		border-radius 999px
		background rgba(8, 9, 12, .66)
		color #e0f2fe
		font 700 9px/1 'Inter', system-ui, -apple-system, sans-serif
		letter-spacing .08em
		text-transform uppercase

		&::before
			content ''
			width 5px
			height 5px
			border-radius 50%
			background #fb7185
			box-shadow 0 0 8px #fb7185

@media (max-width: 720px)
	.GpuCullingHud
		left calc(12px + var(--sail, 0px))
		top calc(58px + var(--sait, 0px))
		width auto
		min-width 190px
		padding 9px 12px 10px
		gap 6px

		&__percent
			font-size 24px

@media (prefers-reduced-motion: reduce)
	.GpuCullingHud__bar i, .GpuCullingInset
		transition none
</style>

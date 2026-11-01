<template>
	<aside v-show="!noUI" class="GpuCullingHud" :data-state="hud.state" role="status" aria-live="polite">
		<div class="GpuCullingHud__header">
			<span class="GpuCullingHud__title">GPU culling</span>
			<span class="GpuCullingHud__badge">{{ hud.badge }}</span>
		</div>
		<div class="GpuCullingHud__summary">
			<div class="GpuCullingHud__big">
				<div class="GpuCullingHud__statRow">
					<span class="GpuCullingHud__percent">{{ hud.measuring ? '—' : percent }}</span>
					<span class="GpuCullingHud__label">{{ hud.measuring ? 'measuring…' : 'drawn' }}</span>
				</div>
				<span class="GpuCullingHud__metric">{{ metric }}</span>
			</div>
			<canvas ref="map" class="GpuCullingHud__ring" width="148" height="148" aria-hidden="true" />
		</div>
	</aside>
</template>

<script>
import { Vector3 } from 'three/webgpu'

import { noUI } from '@/makio/utils/detect'
import { MAP_BINS, passCentre } from '@/utils/gpuCullingPass'
import { times } from '@/utils/points'

const MAP_PATH = times( MAP_BINS + 1, i => passCentre( i / MAP_BINS * Math.PI * 2, new Vector3() ) )

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
		percent() {
			const { indexCount, visibleIndexCount } = this.hud
			const ratio = indexCount ? visibleIndexCount / indexCount : 1
			return `${( ratio * 100 ).toFixed( ratio < 0.1 ? 1 : 0 )}%`
		},
		metric() {
			const { chunkCount, gpuTime, indexCount, measuring, visibleIndexCount } = this.hud
			const counts = !indexCount || measuring
				? `${formatCount( this.api.metrics.pointCount )} pts · ${formatCount( chunkCount )} chunks`
				: `${formatCount( visibleIndexCount / 3 )} / ${formatCount( indexCount / 3 )} tris`
			return gpuTime === null ? counts : `${counts} · ${gpuTime.toFixed( 2 )} ms`
		},
	},
	watch: {
		hud: { handler: 'drawMap', deep: true },
	},
	mounted() {
		this.drawMap()
	},
	methods: {
		drawMap() {
			const { passCamera, ringBins } = this.api
			const canvas = this.$refs.map
			const context = canvas.getContext( '2d' )
			const { width, height } = canvas
			const center = width * 0.5
			const scale = width / 225
			const toX = x => center + x * scale
			const toY = z => center + z * scale
			const peak = Math.max( ...ringBins )

			context.clearRect( 0, 0, width, height )
			context.lineCap = 'round'
			context.lineJoin = 'round'

			// Base serpentine alpine route.
			context.lineWidth = width * 0.065
			context.strokeStyle = 'rgba(148, 163, 184, .22)'
			context.beginPath()
			for ( const point of MAP_PATH ) context.lineTo( toX( point.x ), toY( point.z ) )
			context.stroke()

			// Retained chunks along the alpine pass.
			for ( let bin = 0; bin < MAP_BINS; bin++ ) {
				if ( ringBins[bin] === 0 ) continue
				const a = MAP_PATH[bin]
				const b = MAP_PATH[bin + 1]
				context.strokeStyle = `rgba(103, 232, 249, ${0.45 + ringBins[bin] / peak * 0.55})`
				context.beginPath()
				context.moveTo( toX( a.x ), toY( a.z ) )
				context.lineTo( toX( b.x ), toY( b.z ) )
				context.stroke()
			}

			// Pass camera position and frustum cone on the map.
			const camIdx = Math.floor( this.hud.flight / ( Math.PI * 2 ) * MAP_BINS )
			const camera = MAP_PATH[camIdx]
			const next = MAP_PATH[( camIdx + 4 ) % MAP_BINS]
			const cx = toX( camera.x )
			const cy = toY( camera.z )
			const heading = Math.atan2( toY( next.z ) - cy, toX( next.x ) - cx )

			context.fillStyle = 'rgba(103, 232, 249, .2)'
			context.beginPath()
			context.moveTo( cx, cy )
			context.arc( cx, cy, passCamera.far * scale, heading - 0.52, heading + 0.52 )
			context.closePath()
			context.fill()

			context.fillStyle = '#ffffff'
			context.beginPath()
			context.arc( cx, cy, width * 0.042, 0, Math.PI * 2 )
			context.fill()
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
	width unquote('min(260px, calc(100vw - 84px))')
	padding 11px 14px
	border 1px solid rgba(255, 255, 255, .1)
	border-radius 16px
	background rgba(8, 9, 12, .72)
	box-shadow 0 14px 36px rgba(0, 0, 0, .34)
	backdrop-filter blur(14px)
	-webkit-backdrop-filter blur(14px)
	color rgba(226, 242, 252, .78)
	font 500 11px/1.3 'Inter', system-ui, -apple-system, sans-serif
	text-align left
	pointer-events none
	user-select none

	&__header, &__summary
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

	&__big
		display grid
		gap 2px
		color #fff

	&__statRow
		display flex
		align-items baseline
		gap 6px

	&__percent
		font-size 26px
		font-weight 760
		line-height 1
		letter-spacing -.03em
		font-variant-numeric tabular-nums

	&__label
		color rgba(186, 230, 253, .74)
		font-size 10px
		font-weight 600

	&__metric
		color rgba(203, 225, 240, .64)
		font-size 10px
		font-variant-numeric tabular-nums

	&__ring
		display block
		flex none
		width 52px
		height 52px

@media (max-width: 720px)
	.GpuCullingHud
		left calc(12px + var(--sail, 0px))
		top calc(58px + var(--sait, 0px))
		width auto
		max-width calc(100vw - 24px)
		padding 9px 12px
		gap 6px

		&__percent
			font-size 22px

		&__ring
			width 44px
			height 44px
</style>

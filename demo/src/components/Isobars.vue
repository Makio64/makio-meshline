<template>
	<template v-if="api.ui.visible">
		<aside class="DemoControls" style="--demo-accent: #38bdf8" aria-label="Isobar synoptic transition controls" @pointerdown.stop>
			<button
				v-for="( state, index ) in states"
				:key="state.id"
				type="button"
				:aria-pressed="api.ui.activeState === index"
				@click="api.jumpToState( index )"
			>
				{{ state.title }}
			</button>
			<hr aria-hidden="true">
			<button type="button" @click="api.togglePlaying()">
				{{ api.ui.playing ? 'Pause' : 'Play' }}
			</button>
			<input
				class="IsobarSlider"
				type="range"
				min="0"
				max="100"
				:value="api.ui.percent"
				@input="api.scrub( $event.target.value / 100 )"
			>
		</aside>

		<div class="IsobarOverlay">
			<div
				v-for="( type, index ) in systemTypes"
				ref="markers"
				:key="index"
				class="IsobarMarker"
				:class="type === 'H' ? 'is-high' : 'is-low'"
			>
				<b>{{ type }}</b>
				<small />
			</div>
			<div v-for="index in 10" ref="labels" :key="index" class="IsobarLabel" />
		</div>
	</template>
</template>

<script>
import '@/utils/demoHud.styl'

import { MathUtils, Vector3 } from 'three/webgpu'

import stage from '@/makio/core/stage'
import stage3d from '@/makio/three/stage3d'
import { LINE_SEGMENTS, pressureToY, SYNOPTIC_STATES, SYSTEM_TYPES } from '@/utils/isobarsChart'

const point = new Vector3()
const target = new Vector3()

// Pin `element` over a world `position`, or hide it once that is behind the camera.
function pin( element, position, display ) {
	position.project( stage3d.camera )
	if ( position.z > 1 ) {
		element.style.display = 'none'
		return
	}
	const x = ( position.x + 1 ) * stage.width * 0.5
	const y = ( 1 - position.y ) * stage.height * 0.5
	element.style.display = display
	element.style.transform = `translate(${x.toFixed( 1 )}px, ${y.toFixed( 1 )}px)`
}

// A Vue pill rather than createDemoControls, which has no slider.
export default {
	name: 'IsobarsUI',
	props: {
		api: { type: Object, required: true },
	},
	data() {
		return {
			states: SYNOPTIC_STATES,
			systemTypes: SYSTEM_TYPES,
		}
	},
	mounted() {
		// onRender follows every onUpdate, so the camera and the morph are already this frame's.
		stage3d.listen( stage.onRender, this.updateOverlay )
	},
	methods: {
		updateOverlay() {
			const { markers, labels } = this.$refs
			if ( !markers ) return

			const { pair, morph } = this.api
			const t = MathUtils.smoothstep( morph.value, 0, 1 )

			// H/L pressure centers.
			for ( let i = 0; i < markers.length; i++ ) {
				const { from, to } = pair.extrema[i]
				const value = Math.round( MathUtils.lerp( from.value, to.value, t ) )
				point.set( MathUtils.lerp( from.x, to.x, t ), pressureToY( value ) + 0.26, MathUtils.lerp( from.z, to.z, t ) )
				pin( markers[i], point, 'flex' )
				markers[i].lastElementChild.textContent = value
			}

			// hPa value pills on the primary contours, staggered around the rings.
			for ( let i = 0; i < labels.length; i++ ) {
				const track = pair.primary[i]
				const sample = ( Math.floor( LINE_SEGMENTS * 0.18 ) + i * 19 ) % LINE_SEGMENTS
				point.fromArray( track.fromPoints, sample * 3 ).lerp( target.fromArray( track.toPoints, sample * 3 ), t )
				point.y += 0.08
				pin( labels[i], point, 'block' )
				labels[i].textContent = `${track.value} hPa`
			}
		},
	},
}
</script>

<style lang="stylus" scoped>
.IsobarSlider
	width 72px
	margin 0 8px 0 3px
	accent-color #38bdf8
	cursor pointer
	@media (max-width 820px)
		width 52px

.IsobarOverlay
	position fixed
	inset 0
	z-index 12
	overflow hidden
	font-family -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif
	pointer-events none
	user-select none

.IsobarMarker
	position absolute
	top 0
	left 0
	display none
	flex-direction column
	align-items center
	justify-content center
	width 42px
	height 42px
	border 2px solid rgba(255, 255, 255, .92)
	border-radius 50%
	color #fff
	box-shadow 0 4px 14px rgba(0, 0, 0, .4)
	line-height 1
	will-change transform
	&.is-high
		background linear-gradient(135deg, #ff7670, #c92d35)
	&.is-low
		background linear-gradient(135deg, #59b7ff, #1458af)
	b
		font-size 15px
		font-weight 800
	small
		margin-top 2px
		font-size 9px
		font-weight 700
		font-variant-numeric tabular-nums

.IsobarLabel
	position absolute
	top 0
	left 0
	display none
	padding 2px 5px
	border-radius 4px
	background rgba(245, 250, 255, .9)
	color #0f2942
	font 800 9px/1 system-ui, sans-serif
	font-variant-numeric tabular-nums
	box-shadow 0 1px 4px rgba(0, 0, 0, .3)
	opacity .9
	will-change transform
</style>

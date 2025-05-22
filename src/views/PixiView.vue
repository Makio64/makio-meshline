<template>
	<div class="PixiView view">
		<div ref="title" class="title">PIXIJS</div>
		<div ref="subtitle" class="subtitle">{{ $t('subtitle') }}</div>
		<div class="bottom">
			<div ref="btn" class="btn" @click="goToTHREE">{{ $t('see_three') }}</div>
		</div>
	</div>
</template>

<script>
import Manager2D from '@/2d/Manager2D'
import { contentLoaded } from '@/store'
import { animate, stagger, utils } from 'animejs'

export default {
	name: 'PixiView',
	async mounted() {
		utils.set( this.elts, { opacity: 0 } )
		await Manager2D.init()
		contentLoaded.value = true
		this.transitionIn()
	},
	computed: {
		elts() {
			return [this.$refs.title, this.$refs.subtitle, this.$refs.btn]
		},
	},
	methods: {
		goToTHREE() {
			this.$router.push( '/' )
		},
		transitionIn() {
			animate( this.elts, { opacity: [0, 1], translateY: [50, 0], duration: 1.1, delay: stagger( 0.15, { start: 0.5 } ), ease: 'outQuad' } )
			Manager2D.show()
			Manager2D.showCircle()
		},
		transitionOut( cb ) {
			Manager2D.hideCircle( cb )
			animate( this.elts, { opacity: 0, y: -50, duration: 0.5, delay: stagger( 0.05 ), ease: 'inQuad' } )
		},
		beforeRouteLeave( next ) {
			this.transitionOut( next )
		},
	},
	unmounted() {
		Manager2D.hide()
	},
}
</script>

<style lang="stylus" scoped>
.PixiView
	.title
		font-size 3rem
	.subtitle
		font-size 1.5rem
	.bottom
		position absolute
		bottom 20px
		left 0
		right 0
</style>

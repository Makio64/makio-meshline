<template>
	<div class="HomeView view" />
</template>

<script>
import Manager3D from '@/3d/Manager3D'
import stage3d from '@/makio/three/stage3d'
import { animate, stagger, utils } from 'animejs'
import { contentLoaded } from '@/store'

export default {
	name: 'HomeView',
	async mounted() {
		utils.set( this.elts, { opacity: 0 } )
		await Manager3D.init()
		contentLoaded.value = true
		this.transitionIn()
	},
	computed: {
		elts() {
			return [this.$refs.title, this.$refs.subtitle, this.$refs.btn]
		},
	},
	methods: {
		async transitionIn() {
			animate( this.elts, { opacity: [0, 1], translateY: [50, 0], duration: 1.1, delay: stagger( 0.15, { start: 0.5 } ), ease: 'outQuad' } )
			Manager3D.show()
		},
		transitionOut( cb ) {
			animate( this.elts, { opacity: 0, y: -50, duration: 0.5, delay: stagger( 0.05 ), ease: 'inQuad' } )
			Manager3D.hide( cb )
		},
		beforeRouteLeave( next ) {
			this.transitionOut( next )
		},
	},
	beforeUnmount() {
		stage3d.removeAll()
	},
}
</script>

<style lang="stylus" scoped>
.HomeView
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

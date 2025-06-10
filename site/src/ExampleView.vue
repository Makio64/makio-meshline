<template>
	<div class="ExampleView view" />
</template>

<script>
import waves from '@/examples/waves'
import basic from '@/examples/basic'
import stage3d from '@/makio/three/stage3d'
import { contentLoaded } from '@/store'

export default {
	name: 'ExampleView',
	async mounted() {
		this.example = this.$router.params.id === 'waves' ? waves : basic
		await this.example.init()
		contentLoaded.value = true
		this.transitionIn()
	},
	computed: {
		elts() {
			return [this.$refs.title, this.$refs.subtitle, this.$refs.btn]
		},
	},
	beforeUnmount() {
		console.log( 'beforeUnmount' )
		this.example?.dispose()
	},
	methods: {
		async transitionIn() {
			// animate( this.elts, { opacity: [0, 1], translateY: [50, 0], duration: 1.1, delay: stagger( 0.15, { start: 0.5 } ), ease: 'outQuad' } )
			this.example?.show()
		},
		transitionOut( cb ) {
			// animate( this.elts, { opacity: 0, y: -50, duration: 0.5, delay: stagger( 0.05 ), ease: 'inQuad' } )
			this.example?.hide( cb )
		},
		// beforeRouteLeave( next ) {
		// 	this.transitionOut( next )
		// },
	},

}
</script>

<style lang="stylus" scoped>
.ExampleView
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

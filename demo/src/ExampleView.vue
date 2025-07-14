<template>
	<div class="ExampleView view" />
</template>

<script>
import waves from '@/demos/waves'
import basic from '@/demos/basic'
import follow from '@/demos/follow'
import stress from '@/demos/stress'
import ricefield from '@/demos/ricefield'
import gpuCircle from '@/demos/gpuCircle'
import gpuInstance from '@/demos/gpuInstance'
import { contentLoaded } from '@/store'

export default {
	name: 'ExampleView',
	async mounted() {
		const id = this.$router.params.id
		const mapping = {
			waves,
			follow,
			'gpu-circle': gpuCircle,
			'gpu-instance': gpuInstance,
			stress,
			ricefield
		}
		this.example = mapping[id] || basic
		await this.example.init()
		contentLoaded.value = true
		this.transitionIn()
	},
	beforeUnmount() {
		this.example?.dispose()
	},
	methods: {
		async transitionIn() {
			this.example?.show()
		},
		transitionOut( cb ) {
			this.example?.hide( cb )
		},
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

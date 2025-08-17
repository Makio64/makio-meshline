<template>
	<div class="ExampleView view">
		<div v-if="text" class="instruction" v-html="text" />
		<component :is="example && example.uiComponent" v-if="example && example.uiComponent" :api="example" class="bottom" />
	</div></template>

<script>
import waves from '@/demos/waves'
import basic from '@/demos/basic'
import follow from '@/demos/follow'
import drawlines from '@/demos/drawlines'
import stress from '@/demos/stress'
import ricefield from '@/demos/ricefield'
import gpuCircle from '@/demos/gpuCircle'
import gpuInstance from '@/demos/gpuInstance'
import sandbox from '@/demos/sandbox'
import ghost from '@/demos/ghost'
import venus from '@/demos/venus'
import { contentLoaded } from '@/store'

export default {
	name: 'ExampleView',
	data: function() {
		return {
			text: '',
			example: null,
		}
	},
	async mounted() {
		const id = this.$router.params.id
		const mapping = {
			waves,
			follow,
			drawlines,
			'gpu-circle': gpuCircle,
			'gpu-instance': gpuInstance,
			stress,
			ricefield,
			sandbox,
			ghost,
			'venus-and-david': venus,
		}
		this.example = mapping[id] || basic
		await this.example.init()
		this.text = this.example.text || ''
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
		bottom 10px
</style>

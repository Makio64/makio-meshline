<template>
	<div class="ExampleView view">
		<div v-if="text" class="instruction" v-html="text" />
		<component :is="example && example.uiComponent" v-if="example && example.uiComponent" :api="example" class="bottom" />
		<CodeButton v-if="codeUrl" :href="codeUrl" />
	</div></template>

<script>
import basic from '@/demos/basic'
import drawlines from '@/demos/drawlines'
import follow from '@/demos/follow'
import ghost from '@/demos/ghost'
import gpuCircle from '@/demos/gpuCircle'
import gpuInstance from '@/demos/gpuInstance'
import ricefield from '@/demos/ricefield'
import sandbox from '@/demos/sandbox'
import stress from '@/demos/stress'
import venus from '@/demos/venus'
import waves from '@/demos/waves'
import { contentLoaded } from '@/store'

export default {
	name: 'ExampleView',
	data: function() {
		return {
			text: '',
			example: null,
			codeUrl: ''
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

		// map route id to source filename for GitHub link
		const fileMap = {
			waves: 'waves.js',
			follow: 'follow.js',
			drawlines: 'drawlines.js',
			'gpu-circle': 'gpuCircle.js',
			'gpu-instance': 'gpuInstance.js',
			stress: 'stress.js',
			ricefield: 'ricefield.js',
			sandbox: 'sandbox.js',
			ghost: 'ghost.js',
			'venus-and-david': 'venus.js',
			basic: 'basic.js'
		}
		const file = fileMap[id] || 'basic.js'
		this.codeUrl = `https://github.com/Makio64/Meshline/tree/main/demo/src/demos/${file}`
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
	.instruction 
		user-select none
		pointer-events none


</style>

<template>
	<div class="ExampleView view">
		<div v-if="text" class="instruction" v-html="text" />
		<component :is="example && example.uiComponent" v-if="example && example.uiComponent" :api="example" class="bottom" />
		<CodeButton v-if="codeUrl" :href="codeUrl" />
	</div></template>

<script>
import { resolveDemoMeta } from '@/demoMeta'
import baguettes from '@/demos/baguettes'
import bambooGrove from '@/demos/bambooGrove'
import basic from '@/demos/basic'
import bunker from '@/demos/bunker'
import drawlines from '@/demos/drawlines'
import follow from '@/demos/follow'
import gpuCircle from '@/demos/gpuCircle'
import gpuInstance from '@/demos/gpuInstance'
import ricefield from '@/demos/ricefield'
import sandbox from '@/demos/sandbox'
import shadow from '@/demos/shadow'
import venus from '@/demos/venus'
import vertexColors from '@/demos/vertexColors'
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
			basic,
			waves,
			follow,
			drawlines,
			'gpu-circle': gpuCircle,
			'gpu-instance': gpuInstance,
			'bamboooo': bambooGrove,
			shadow,
			ricefield,
			sandbox,
			'venus-and-david': venus,
			baguettes,
			'vertex-colors': vertexColors,
			'laser-heist': bunker,
		}
		const demo = resolveDemoMeta( id ) || resolveDemoMeta( 'basic' )
		this.example = mapping[demo.id] || basic

		const file = demo?.sourceFile || 'basic.js'
		this.codeUrl = `https://github.com/Makio64/makio-meshline/tree/main/demo/src/demos/${file}`
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

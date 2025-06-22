<template>
	<div class="ExampleView view" />
</template>

<script>
import waves from '@/demos/waves'
import basic from '@/demos/basic'
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

<!-- Simple MenuFullscreen by @makio64 || David Ronai -->
<template>
	<div ref="root" class="MenuFullscreen" :class="{ open: isOpen }">
		<a v-for="link in links" :key="link.text" ref="link" :href="link.href" @click="close">{{ link.text }}</a>
	</div>
</template>

<script>
import { menuOpen } from '@/store'
import { stagger, animate, utils } from 'animejs'

export default {
	name: 'MenuFullscreen',
	data() {
		return {
			links: [
				{ text: 'Basic', href: '/examples/basic' },
				{ text: 'Waves', href: '/examples/waves' },
				{ text: 'Follow', href: '/examples/follow' },
				{ text: 'GPU Circle', href: '/examples/gpuCircle' },
			],
		}
	},
	computed: {
		isOpen() {
			return menuOpen.value
		},
	},
	methods: {
		close() {
			menuOpen.value = false
		},
		show() {
			const { root, link } = this.$refs
			animate( root, { opacity: [0, 1], duration: 0.4, ease: 'outExpo',
				onBegin: () => {
					root.style.pointerEvents = 'all'
					root.style.visibility = 'visible'
				},
			} )
			utils.set( link, { opacity: 0, } )
			animate( link, {
				// x: [-50, 0],
				width: [0, 200],
				opacity: [0, 1],
				delay: stagger( 0.1, { start: 0.2 } ),
				duration: 0.8,
				ease: 'outExpo',
			} )
		},
		hide() {
			const { root, link } = this.$refs
			animate( root, { opacity: 0, duration: 0.3, delay: .1, ease: 'inQuad', } )
			animate( link, {
				width: 0,
				delay: stagger( 0.1 ),
				duration: 0.3,
				ease: 'easeInExpo',
				onComplete: () => {
					root.style.pointerEvents = 'none'
					root.style.visibility = 'hidden'
				},
			} )
		},
	},
	watch: {
		isOpen( newVal ) {
			if ( newVal ) {
				this.show()
			} else {
				this.hide()
			}
		},
	},
	mounted() {
		const { root } = this.$refs
		root.style.opacity = 0
		root.style.visibility = 'hidden'
		root.style.pointerEvents = 'none'
	},
}
</script>

<style lang="stylus" scoped>
.MenuFullscreen
	z-index 999
	position absolute
	inset 0
	background rgba( 0, 0, 0, 0.9 )
	// backdrop-filter blur( 4px )
	// transform translateX(-100%)
	display flex
	flex-direction column
	align-items center
	justify-content center
	gap 2em
	a
		background white
		width 200px
		height 60px
		color black
		font-weight 800
		font-size 1.5em
		text-decoration none
		display flex
		align-items center
		justify-content center
		opacity 0
		box-sizing border-box
		overflow hidden
</style>

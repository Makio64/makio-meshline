<!-- Add an Intersection observer to start loading the image at the right moment, also change src to srcset for browser not supporting webp?  -->
<template>
	<img :srcset="srcset" :src="srcToShow" :alt="alt">
</template>

<script>
import stage from '@/makio/core/stage'

export default {
	name: 'ImgNext',
	props: {
		src: {
			type: String,
			required: true,
		},
		alt: {
			type: String,
			default: '',
		},
	},
	data() {
		return {
			show: false,
		}
	},
	mounted() {
		if ( window.IntersectionObserver ) {
			let options = {
				root: document.querySelector( '#app' ),
				rootMargin: `0px 1000px ${stage.height}px 1000px`,
				threshold: 1,
			}
			this.observer = new IntersectionObserver( this.onIntersect, options )
			this.observer.observe( this.$el )
		}
	},
	methods: {
		onIntersect( els, offset ) {
			if ( els[0].isIntersecting ) {
				this.show = true
				this.observer.unobserve( this.$el )
			}
		},
	},
	computed: {
		width() {
			return this.$el.width
		},
		height() {
			return this.$el.height
		},
		webp() {
			return this.src.replace( 'jpg', 'webp' ).replace( 'png', 'webp' )
		},
		srcset() {
			return this.show ? `${this.webp}, ${this.src}` : ''
		},
		srcToShow() {
			return this.show ? this.src : ''
		},
	},
}
</script>

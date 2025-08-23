<!-- Simple SVGCircle with the possibility to set the percent -->
<template>
	<svg :height="radius * 2" :width="radius * 2">
		<path ref="progress" :stroke-width="strokeWidth" fill="transparent" :stroke="color" class="progress" :d="path" />
	</svg>
</template>

<script>
import gsap, { Quad } from 'gsap'

import DrawSVGPlugin from '@/lib/gsap-bonus/DrawSVGPlugin'
gsap.registerPlugin( DrawSVGPlugin )

export default {
	name: 'SVGCircle',
	props: {
		radius: {
			type: Number,
			default: 16,
		},
		color: {
			type: String,
			default: '#FF5379',
		},
		strokeWidth: {
			type: Number,
			default: 2,
		},
	},
	methods: {
		setPercent( value, instant = true ) {
			if ( instant ) {
				gsap.set( this.$refs.progress, { drawSVG: `100% ${100 - value}%` } )
			} else {
				gsap.to( this.$refs.progress, { ease: Quad.easeOut, drawSVG: `100% ${100 - value}%` } )
			}
		},
	},

	computed: {
		path() {
			const r = this.radius - this.strokeWidth
			return `M ${this.radius - r}, ${this.radius} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 -${r * 2},0`
		},
	},
}
</script>

<style lang="stylus" scoped>
.percent
	width 46px
	height 46px
	font-family: 'Neue Montreal'
	font-style: normal
	font-weight: bold
	font-size: 12px
	text-align: center
	position absolute
	top 20px
	left 20px
	color #FF5379
	svg
		position absolute
		transform rotate(90deg)
		top 0
		left 0
		&.circle
			opacity 0.4
		&.progress
			opacity 0.6
	&.dark{
		.progress{
			stroke #FF5379
		}
		color #FF5379
		border-color: rgba(1, 1, 1, 0.25)
	}
</style>
